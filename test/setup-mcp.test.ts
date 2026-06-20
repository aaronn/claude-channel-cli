import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildClaudeMcpAddArgs,
  buildClaudeMcpRemoveArgs,
  formatSetupMcpResult,
  formatShellCommand,
  parseSetupMcpScope,
  resolveServerCommand,
  setupMcp,
  type CommandResult,
  type ServerCommand,
} from "../src/cli/setup-mcp.js";

const serverCommand: ServerCommand = {
  command: "/usr/local/bin/claude-channel-server",
  args: [],
};

test("parseSetupMcpScope defaults to local and accepts user", () => {
  assert.equal(parseSetupMcpScope(undefined), "local");
  assert.equal(parseSetupMcpScope(""), "local");
  assert.equal(parseSetupMcpScope("user"), "user");
});

test("parseSetupMcpScope rejects unsupported scopes", () => {
  assert.throws(() => parseSetupMcpScope("project"), /scope must be either local or user/);
});

test("buildClaudeMcpAddArgs registers the server through Claude's MCP command", () => {
  assert.deepEqual(buildClaudeMcpAddArgs("local", serverCommand), [
    "mcp",
    "add",
    "--scope",
    "local",
    "claude-channel-cli",
    "--",
    "/usr/local/bin/claude-channel-server",
  ]);
});

test("buildClaudeMcpRemoveArgs targets the configured scope", () => {
  assert.deepEqual(buildClaudeMcpRemoveArgs("user"), [
    "mcp",
    "remove",
    "--scope",
    "user",
    "claude-channel-cli",
  ]);
});

test("setupMcp dry run reports the commands without running them", async () => {
  const result = await setupMcp({
    dryRun: true,
    force: true,
    claudeCommand: "claude-dev",
    resolveServerCommand: async () => serverCommand,
  });

  assert.equal(result.dryRun, true);
  assert.deepEqual(result.commands.map((command) => formatShellCommand(command.command, command.args)), [
    "claude-dev mcp remove --scope local claude-channel-cli",
    "claude-dev mcp add --scope local claude-channel-cli -- /usr/local/bin/claude-channel-server",
  ]);
  const output = formatSetupMcpResult(result);
  assert.match(output, /Would run:/);
  assert.match(output, /Then start Claude Code from this project with:\nclaude/);
  assert.doesNotMatch(output, /dangerously-load-development-channels/);
});

test("setupMcp runs remove before add when force is set", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const ok: CommandResult = { code: 0, stdout: "", stderr: "" };

  await setupMcp({
    force: true,
    scope: "user",
    claudeCommand: "claude-dev",
    resolveServerCommand: async () => serverCommand,
    commandRunner: async (command, args) => {
      calls.push({ command, args });
      return ok;
    },
  });

  assert.deepEqual(calls, [
    {
      command: "claude-dev",
      args: ["mcp", "remove", "--scope", "user", "claude-channel-cli"],
    },
    {
      command: "claude-dev",
      args: [
        "mcp",
        "add",
        "--scope",
        "user",
        "claude-channel-cli",
        "--",
        "/usr/local/bin/claude-channel-server",
      ],
    },
  ]);
});

test("setupMcp reports Claude command failures", async () => {
  await assert.rejects(
    setupMcp({
      claudeCommand: "claude-dev",
      resolveServerCommand: async () => serverCommand,
      commandRunner: async () => ({
        code: 1,
        stdout: "",
        stderr: "server already exists\n",
      }),
    }),
    /server already exists/,
  );
});

test("resolveServerCommand stores the server bin name when it is on PATH", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-channel-bin-"));
  const bin = path.join(dir, "claude-channel-server");
  try {
    await writeFile(bin, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(bin, 0o755);

    assert.deepEqual(await resolveServerCommand({ PATH: dir }), {
      command: "claude-channel-server",
      args: [],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
