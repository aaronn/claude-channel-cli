import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertClaudeChannelReceiverLaunch,
  buildSessionMcpConfig,
  CLAUDE_CHANNEL_RECEIVER_LAUNCH_ARG,
  findPersistentClaudeMcpEntries,
  formatPersistentClaudeMcpError,
  formatShellCommand,
  inspectPersistentClaudeMcp,
  resolveServerCommand,
  type ServerCommand,
} from "../src/cli/claude-mcp.js";
import { formatSetupResult, setup } from "../src/cli/setup.js";

const serverCommand: ServerCommand = {
  command: "/usr/local/bin/claude-channel-server",
  args: [],
};

test("buildSessionMcpConfig defines the channel server without persistent registration", () => {
  assert.deepEqual(
    JSON.parse(buildSessionMcpConfig(serverCommand, {
      CLAUDE_CHANNEL_DISPLAY_NAME: "review-left",
      CLAUDE_CHANNEL_HOST: "127.0.0.2",
      CLAUDE_CHANNEL_TARGET: "ignored-client-env",
    })),
    {
      mcpServers: {
        "claude-channel-cli": {
          command: "/usr/local/bin/claude-channel-server",
          args: [CLAUDE_CHANNEL_RECEIVER_LAUNCH_ARG],
          env: {
            CLAUDE_CHANNEL_DISPLAY_NAME: "review-left",
            CLAUDE_CHANNEL_HOST: "127.0.0.2",
          },
        },
      },
    },
  );
});

test("setup reports readiness without writing Claude MCP config", async () => {
  const result = await setup({
    resolveServerCommand: async () => serverCommand,
    inspectPersistentEntries: async () => ({ entries: [], errors: [] }),
  });

  assert.match(formatSetupResult(result), /Claude Channel setup check passed/);
  assert.match(formatSetupResult(result), /No persistent Claude MCP registration was written/);
});

test("setup fails closed when stale persistent registrations exist", async () => {
  await assert.rejects(
    setup({
      resolveServerCommand: async () => serverCommand,
      inspectPersistentEntries: async () => ({
        entries: [
          {
            scope: "local",
            source: "/tmp/.claude.json",
            removeCommand: "claude mcp remove --scope local claude-channel-cli",
          },
        ],
        errors: [],
      }),
    }),
    /Persistent Claude MCP registration/,
  );
});

test("receiver launch check accepts the internal start command marker", async () => {
  await assert.doesNotReject(assertClaudeChannelReceiverLaunch({
    argv: [CLAUDE_CHANNEL_RECEIVER_LAUNCH_ARG],
    inspectPersistentEntries: async () => {
      throw new Error("should not inspect persistent config");
    },
  }));
});

test("receiver launch check rejects stale persistent registrations before endpoint registration", async () => {
  await assert.rejects(
    assertClaudeChannelReceiverLaunch({
      argv: [],
      inspectPersistentEntries: async () => ({
        entries: [
          {
            scope: "local",
            source: "/tmp/.claude.json",
            removeCommand: "claude mcp remove --scope local claude-channel-cli",
          },
        ],
        errors: [],
      }),
    }),
    /claude mcp remove --scope local claude-channel-cli/,
  );
});

test("receiver launch check rejects unknown unmarked launches", async () => {
  await assert.rejects(
    assertClaudeChannelReceiverLaunch({
      argv: [],
      inspectPersistentEntries: async () => ({ entries: [], errors: [] }),
    }),
    /was not started by claude-channel start/,
  );
});

test("findPersistentClaudeMcpEntries detects user, local, and project registrations", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-channel-home-"));
  const cwd = await mkdtemp(path.join(tmpdir(), "claude-channel-project-"));
  try {
    await writeFile(
      path.join(homeDir, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          "claude-channel-cli": {
            command: "claude-channel-server",
          },
        },
        projects: {
          [cwd]: {
            mcpServers: {
              "claude-channel-cli": {
                command: "claude-channel-server",
              },
            },
          },
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(cwd, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          "claude-channel-cli": {
            command: "claude-channel-server",
          },
        },
      }),
      "utf8",
    );

    const entries = await findPersistentClaudeMcpEntries({ cwd, homeDir });

    assert.deepEqual(entries.map((entry) => entry.scope), ["user", "local", "project"]);
    assert.deepEqual(entries.map((entry) => entry.removeCommand), [
      "claude mcp remove --scope user claude-channel-cli",
      "claude mcp remove --scope local claude-channel-cli",
      "claude mcp remove --scope project claude-channel-cli",
    ]);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test("persistent MCP inspection fails closed on malformed config", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-channel-home-"));
  const cwd = await mkdtemp(path.join(tmpdir(), "claude-channel-project-"));
  try {
    await writeFile(path.join(homeDir, ".claude.json"), "{ bad json", "utf8");

    await assert.rejects(
      setup({
        resolveServerCommand: async () => serverCommand,
        inspectPersistentEntries: () => inspectPersistentClaudeMcp({ cwd, homeDir }),
      }),
      /Could not inspect Claude MCP configuration/,
    );
  } finally {
    await rm(homeDir, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test("persistent MCP inspection matches symlinked project paths canonically", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-channel-home-"));
  const parentDir = await mkdtemp(path.join(tmpdir(), "claude-channel-parent-"));
  const realProject = path.join(parentDir, "real-project");
  const linkedProject = path.join(parentDir, "linked-project");
  try {
    await mkdir(realProject);
    await symlink(realProject, linkedProject, "dir");
    await writeFile(
      path.join(homeDir, ".claude.json"),
      JSON.stringify({
        projects: {
          [linkedProject]: {
            mcpServers: {
              "claude-channel-cli": {
                command: "claude-channel-server",
              },
            },
          },
        },
      }),
      "utf8",
    );

    const entries = await findPersistentClaudeMcpEntries({ cwd: realProject, homeDir });

    assert.deepEqual(entries.map((entry) => entry.scope), ["local"]);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
    await rm(parentDir, { recursive: true, force: true });
  }
});

test("formatPersistentClaudeMcpError explains the 0.4 migration", () => {
  const message = formatPersistentClaudeMcpError([
    {
      scope: "project",
      source: "/tmp/project/.mcp.json",
      removeCommand: "claude mcp remove --scope project claude-channel-cli",
    },
  ]);

  assert.match(message, /session-scoped --mcp-config/);
  assert.match(message, /claude mcp remove --scope project claude-channel-cli/);
});

test("resolveServerCommand stores the server bin name when it is on PATH", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-channel-bin-"));
  const bin = path.join(dir, "claude-channel-server");
  try {
    await mkdir(dir, { recursive: true });
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

test("formatShellCommand quotes inline MCP config safely", () => {
  assert.equal(
    formatShellCommand("claude", ["--mcp-config={\"mcpServers\":{}}", "--name", "review left"]),
    "claude '--mcp-config={\"mcpServers\":{}}' --name 'review left'",
  );
});
