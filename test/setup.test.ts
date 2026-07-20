import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertClaudeChannelReceiverLaunch,
  buildSessionMcpConfig,
  CLAUDE_CHANNEL_RECEIVER_LAUNCH_ARG,
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
    resolveClaudeExecutable: async () => "/usr/local/bin/claude",
    resolveServerCommand: async () => serverCommand,
    inspectPersistentClaudeMcp: async () => ({ ok: true, entries: [] }),
  });

  assert.match(formatSetupResult(result), /Claude Channel setup check passed/);
  assert.match(formatSetupResult(result), /No persistent Claude MCP registration was written/);
});

test("setup fails before receiver resolution when Claude is unavailable", async () => {
  let receiverResolved = false;

  await assert.rejects(
    setup({
      inspectPersistentClaudeMcp: async () => ({ ok: true, entries: [] }),
      resolveClaudeExecutable: async () => {
        throw new Error("Claude Code CLI (`claude`) not found on PATH.");
      },
      resolveServerCommand: async () => {
        receiverResolved = true;
        return serverCommand;
      },
    }),
    /Claude Code CLI \(`claude`\) not found on PATH/,
  );
  assert.equal(receiverResolved, false);
});

test("setup fails when the receiver is unavailable", async () => {
  await assert.rejects(
    setup({
      inspectPersistentClaudeMcp: async () => ({ ok: true, entries: [] }),
      resolveClaudeExecutable: async () => "/usr/local/bin/claude",
      resolveServerCommand: async () => {
        throw new Error("Claude Channel receiver not found.");
      },
    }),
    /Claude Channel receiver not found/,
  );
});

test("setup fails closed when stale persistent registrations exist", async () => {
  await assert.rejects(
    setup({
      resolveClaudeExecutable: async () => {
        throw new Error("should not resolve Claude");
      },
      resolveServerCommand: async () => {
        throw new Error("should not resolve receiver");
      },
      inspectPersistentClaudeMcp: async () => ({
        ok: true,
        entries: [
          {
            scope: "local",
          },
        ],
      }),
    }),
    /Persistent Claude MCP registration/,
  );
});

test("receiver launch check accepts the internal start command marker", async () => {
  await assert.doesNotReject(assertClaudeChannelReceiverLaunch({
    argv: [CLAUDE_CHANNEL_RECEIVER_LAUNCH_ARG],
    inspectPersistentClaudeMcp: async () => {
      throw new Error("should not inspect persistent config");
    },
  }));
});

test("receiver launch check rejects stale persistent registrations before endpoint registration", async () => {
  await assert.rejects(
    assertClaudeChannelReceiverLaunch({
      argv: [],
      inspectPersistentClaudeMcp: async () => ({
        ok: true,
        entries: [
          {
            scope: "local",
          },
        ],
      }),
    }),
    /claude mcp remove --scope local claude-channel-cli/,
  );
});

test("receiver launch check rejects unknown unmarked launches", async () => {
  await assert.rejects(
    assertClaudeChannelReceiverLaunch({
      argv: [],
      inspectPersistentClaudeMcp: async () => ({ ok: true, entries: [] }),
    }),
    /was not started by claude-channel start/,
  );
});

test("persistent MCP inspection detects user, local, and project registrations", async () => {
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

    const inspection = await inspectPersistentClaudeMcp({ cwd, homeDir });

    if (!inspection.ok) assert.fail("expected successful persistent MCP inspection");
    assert.deepEqual(inspection.entries.map((entry) => entry.scope), ["user", "local", "project"]);
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
        inspectPersistentClaudeMcp: () => inspectPersistentClaudeMcp({ cwd, homeDir }),
      }),
      /Could not inspect Claude MCP configuration/,
    );
  } finally {
    await rm(homeDir, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test("persistent MCP inspection rejects non-object configuration roots", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-channel-home-"));
  const cwd = await mkdtemp(path.join(tmpdir(), "claude-channel-project-"));
  const canonicalCwd = await realpath(cwd);
  try {
    for (const file of [path.join(homeDir, ".claude.json"), path.join(canonicalCwd, ".mcp.json")]) {
      await writeFile(file, "[]", "utf8");

      const inspection = await inspectPersistentClaudeMcp({ cwd, homeDir });

      if (inspection.ok) assert.fail("expected persistent MCP inspection to fail");
      assert.equal(inspection.errors.length, 1);
      assert.equal(inspection.errors[0]?.source, file);
      assert.match(inspection.errors[0]?.message ?? "", /top-level value must be a JSON object/);
      await rm(file, { force: true });
    }
  } finally {
    await rm(homeDir, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test("persistent MCP inspection rejects malformed relevant fields", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-channel-home-"));
  const cwd = await mkdtemp(path.join(tmpdir(), "claude-channel-project-"));
  const canonicalCwd = await realpath(cwd);
  const claudeConfigPath = path.join(homeDir, ".claude.json");
  const projectMcpPath = path.join(canonicalCwd, ".mcp.json");
  const cases = [
    { file: claudeConfigPath, config: { mcpServers: [] }, field: "mcpServers" },
    { file: claudeConfigPath, config: { projects: [] }, field: "projects" },
    { file: claudeConfigPath, config: { projects: { [cwd]: [] } }, field: `projects[${JSON.stringify(cwd)}]` },
    {
      file: claudeConfigPath,
      config: { projects: { [cwd]: { mcpServers: [] } } },
      field: `projects[${JSON.stringify(cwd)}].mcpServers`,
    },
    { file: projectMcpPath, config: { mcpServers: [] }, field: "mcpServers" },
  ];

  try {
    for (const testCase of cases) {
      await writeFile(testCase.file, JSON.stringify(testCase.config), "utf8");

      const inspection = await inspectPersistentClaudeMcp({ cwd, homeDir });

      if (inspection.ok) assert.fail("expected persistent MCP inspection to fail");
      assert.equal(inspection.errors.length, 1);
      assert.equal(inspection.errors[0]?.source, testCase.file);
      assert.equal(inspection.errors[0]?.message, `${testCase.field} must be a JSON object`);
      await rm(testCase.file, { force: true });
    }
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

    const inspection = await inspectPersistentClaudeMcp({ cwd: realProject, homeDir });

    if (!inspection.ok) assert.fail("expected successful persistent MCP inspection");
    assert.deepEqual(inspection.entries.map((entry) => entry.scope), ["local"]);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
    await rm(parentDir, { recursive: true, force: true });
  }
});

test("persistent MCP inspection tolerates missing historical project paths", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-channel-home-"));
  const cwd = await mkdtemp(path.join(tmpdir(), "claude-channel-project-"));
  const parentDir = await mkdtemp(path.join(tmpdir(), "claude-channel-history-"));
  const missingProject = path.join(parentDir, "missing-project");
  const formerDirectory = path.join(parentDir, "former-directory");
  const missingNestedProject = path.join(formerDirectory, "missing-project");
  try {
    await writeFile(formerDirectory, "no longer a directory", "utf8");
    await writeFile(
      path.join(homeDir, ".claude.json"),
      JSON.stringify({
        projects: {
          [missingProject]: {
            mcpServers: {
              "claude-channel-cli": {
                command: "claude-channel-server",
              },
            },
          },
          [missingNestedProject]: {
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

    const inspection = await inspectPersistentClaudeMcp({ cwd, homeDir });

    assert.deepEqual(inspection, { ok: true, entries: [] });
  } finally {
    await rm(homeDir, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
    await rm(parentDir, { recursive: true, force: true });
  }
});

test("persistent MCP inspection rejects non-missing project path resolution failures", async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-channel-home-"));
  const cwd = await mkdtemp(path.join(tmpdir(), "claude-channel-project-"));
  const parentDir = await mkdtemp(path.join(tmpdir(), "claude-channel-loop-"));
  const loopPath = path.join(parentDir, "loop-a");
  const loopTarget = path.join(parentDir, "loop-b");
  const claudeConfigPath = path.join(homeDir, ".claude.json");
  try {
    await symlink(loopTarget, loopPath, "dir");
    await symlink(loopPath, loopTarget, "dir");
    await writeFile(
      claudeConfigPath,
      JSON.stringify({
        projects: {
          [loopPath]: {
            mcpServers: {},
          },
        },
      }),
      "utf8",
    );

    const inspection = await inspectPersistentClaudeMcp({ cwd, homeDir });

    if (inspection.ok) assert.fail("expected persistent MCP inspection to fail");
    assert.equal(inspection.errors.length, 1);
    assert.equal(inspection.errors[0]?.source, claudeConfigPath);
    assert.ok(inspection.errors[0]?.message.includes(`projects[${JSON.stringify(loopPath)}]`));
    assert.ok(inspection.errors[0]?.message.includes(`path ${JSON.stringify(loopPath)} could not be resolved`));
  } finally {
    await rm(homeDir, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
    await rm(parentDir, { recursive: true, force: true });
  }
});

test("formatPersistentClaudeMcpError explains the 0.4 migration", () => {
  const message = formatPersistentClaudeMcpError([
    {
      scope: "project",
    },
  ]);

  assert.match(message, /session-scoped --mcp-config/);
  assert.match(message, /claude mcp remove --scope project claude-channel-cli/);
});

test("resolveServerCommand prefers a readable bundled receiver", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-channel-bundled-"));
  const bundledScriptPath = path.join(dir, "channel.js");
  try {
    await writeFile(bundledScriptPath, "export {};\n", "utf8");

    assert.deepEqual(await resolveServerCommand({
      env: { PATH: "" },
      bundledScriptPath,
    }), {
      command: process.execPath,
      args: [bundledScriptPath],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveServerCommand stores the absolute PATH fallback when the bundle is missing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-channel-bin-"));
  const bin = path.join(dir, "claude-channel-server");
  try {
    await writeFile(bin, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(bin, 0o755);

    assert.deepEqual(await resolveServerCommand({
      env: { PATH: dir },
      bundledScriptPath: path.join(dir, "missing-channel.js"),
    }), {
      command: bin,
      args: [],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveServerCommand fails closed when the bundled receiver cannot be inspected", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-channel-bundled-loop-"));
  const firstLink = path.join(dir, "channel-a.js");
  const secondLink = path.join(dir, "channel-b.js");
  const installedBin = path.join(dir, "claude-channel-server");
  try {
    await symlink(secondLink, firstLink);
    await symlink(firstLink, secondLink);
    await writeFile(installedBin, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(installedBin, 0o755);

    await assert.rejects(
      resolveServerCommand({
        env: { PATH: dir },
        bundledScriptPath: firstLink,
      }),
      (error: Error & { cause?: NodeJS.ErrnoException }) => {
        assert.match(error.message, /Could not access bundled Claude Channel receiver/);
        assert.ok(error.message.includes(JSON.stringify(firstLink)));
        assert.equal(error.cause?.code, "ELOOP");
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveServerCommand rejects a missing bundled and installed receiver", async () => {
  await assert.rejects(
    resolveServerCommand({ env: { PATH: "" } }),
    /Claude Channel receiver not found/,
  );
});

test("formatShellCommand quotes inline MCP config safely", () => {
  assert.equal(
    formatShellCommand("claude", ["--mcp-config={\"mcpServers\":{}}", "--name", "review left"]),
    "claude '--mcp-config={\"mcpServers\":{}}' --name 'review left'",
  );
});
