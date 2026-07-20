import assert from "node:assert/strict";
import { spawn, type ChildProcess, type ChildProcessByStdio } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CLAUDE_CHANNEL_RECEIVER_LAUNCH_ARG,
  type ServerCommand,
} from "../src/cli/claude-mcp.js";
import { launchClaudeForeground } from "../src/cli/claude-process.js";
import { buildClaudeStartArgs } from "../src/cli/start.js";

const serverCommand: ServerCommand = {
  command: "claude-channel-server",
  args: [],
};
function sessionMcpArg(command: string): string {
  return `--mcp-config=${JSON.stringify({
    mcpServers: {
      "claude-channel-cli": {
        command,
        args: [CLAUDE_CHANNEL_RECEIVER_LAUNCH_ARG],
        env: {},
      },
    },
  })}`;
}

test("buildClaudeStartArgs enables the claude-channel server and forwards args", () => {
  assert.deepEqual(buildClaudeStartArgs(serverCommand, ["--model", "opus", "--continue"], {}), [
    sessionMcpArg(serverCommand.command),
    "--dangerously-load-development-channels=server:claude-channel-cli",
    "--model",
    "opus",
    "--continue",
  ]);
});

test("buildClaudeStartArgs snapshots receiver runtime env into the session MCP config", () => {
  const [mcpConfigArg] = buildClaudeStartArgs(serverCommand, [], {
    CLAUDE_CHANNEL_DISPLAY_NAME: "review-left",
    CLAUDE_CHANNEL_PORT: "8790",
    CLAUDE_CHANNEL_TARGET: "ignored-client-env",
  });

  assert.deepEqual(JSON.parse(mcpConfigArg.replace(/^--mcp-config=/, "")), {
    mcpServers: {
      "claude-channel-cli": {
        command: "claude-channel-server",
        args: [CLAUDE_CHANNEL_RECEIVER_LAUNCH_ARG],
        env: {
          CLAUDE_CHANNEL_DISPLAY_NAME: "review-left",
          CLAUDE_CHANNEL_PORT: "8790",
        },
      },
    },
  });
});

test("start command forwards option-first Claude args through commander", async () => {
  const { args: captured, serverCommand } = await runStartWithFakeClaude(["--model", "opus", "--continue"]);

  assert.deepEqual(captured, [
    sessionMcpArg(serverCommand),
    "--dangerously-load-development-channels=server:claude-channel-cli",
    "--model",
    "opus",
    "--continue",
  ]);
});

test("start command forwards args after separator through commander", async () => {
  const { args: captured, serverCommand } = await runStartWithFakeClaude(["--", "--help"]);

  assert.deepEqual(captured, [
    sessionMcpArg(serverCommand),
    "--dangerously-load-development-channels=server:claude-channel-cli",
    "--help",
  ]);
});

test("start command forwards help flags to Claude after other Claude options", async () => {
  const { args: captured, serverCommand } = await runStartWithFakeClaude(["--model", "opus", "--", "--help"]);

  assert.deepEqual(captured, [
    sessionMcpArg(serverCommand),
    "--dangerously-load-development-channels=server:claude-channel-cli",
    "--model",
    "opus",
    "--help",
  ]);
});

test("start command forwards short help flags to Claude", async () => {
  const { args: captured, serverCommand } = await runStartWithFakeClaude(["--", "-h"]);

  assert.deepEqual(captured, [
    sessionMcpArg(serverCommand),
    "--dangerously-load-development-channels=server:claude-channel-cli",
    "-h",
  ]);
});

test("start command keeps positional Claude prompts separate from the variadic channel option", async () => {
  const { args: captured, serverCommand } = await runStartWithFakeClaude(["review", "this", "branch"]);

  assert.deepEqual(captured, [
    sessionMcpArg(serverCommand),
    "--dangerously-load-development-channels=server:claude-channel-cli",
    "review",
    "this",
    "branch",
  ]);
});

test("start command forwards parent-only SIGTERM to Claude and exits", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-channel-start-signal-"));
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-channel-home-"));
  const signalPath = path.join(dir, "signal.txt");
  const childPidPath = path.join(dir, "child-pid.txt");
  const fakeClaude = path.join(dir, "claude");
  const fakeServer = path.join(dir, "claude-channel-server");
  await writeFile(
    fakeClaude,
    [
      "#!/usr/bin/env node",
      "const { writeFileSync } = require('node:fs');",
      "writeFileSync(process.env.CLAUDE_CHANNEL_TEST_CHILD_PID, String(process.pid));",
      "process.on('SIGTERM', () => {",
      "  writeFileSync(process.env.CLAUDE_CHANNEL_TEST_SIGNAL, 'SIGTERM');",
      "  process.exit(0);",
      "});",
      "setInterval(() => {}, 1000);",
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(fakeClaude, 0o755);
  await writeFile(fakeServer, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(fakeServer, 0o755);

  try {
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "start"], {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: {
        ...process.env,
        PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}`,
        HOME: homeDir,
        CLAUDE_CHANNEL_TEST_CHILD_PID: childPidPath,
        CLAUDE_CHANNEL_TEST_SIGNAL: signalPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await readFileEventually(childPidPath);
    child.kill("SIGTERM");

    const result = await waitForProcess(child, 5_000);
    assert.equal(result.timedOut, false, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.equal(await readFile(signalPath, "utf8"), "SIGTERM");
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("start command reports a friendly error when Claude is not on PATH", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-channel-start-missing-"));
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-channel-home-"));
  const fakeServer = path.join(dir, "claude-channel-server");
  await writeFile(fakeServer, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(fakeServer, 0o755);

  try {
    const result = await runCli(["start"], {
      ...receiverTestEnv(process.env),
      PATH: dir,
      HOME: homeDir,
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Claude Code CLI \(`claude`\) not found on PATH/);
    assert.doesNotMatch(result.stderr, /uncaughtException|Error:/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("launcher rejects Windows command shims before starting Claude", async () => {
  let launched = false;

  await assert.rejects(
    launchClaudeForeground([], {
      env: { PATH: "C:\\fake" },
      platform: "win32",
      findExecutable: async () => "C:\\fake\\claude.cmd",
      foregroundChild: () => {
        launched = true;
        return new EventEmitter() as ChildProcess;
      },
    }),
    /requires a native Windows executable.*claude\.cmd.*native Windows installer/,
  );
  assert.equal(launched, false);
});

test("launcher starts native Windows executables without a shell and reports spawn errors", async () => {
  await assert.rejects(
    launchClaudeForeground([], {
      env: { PATH: "C:\\fake" },
      platform: "win32",
      findExecutable: async () => "C:\\fake\\claude.exe",
      foregroundChild: (program, _args, spawnOptions) => {
        assert.equal(program, "C:\\fake\\claude.exe");
        assert.equal(spawnOptions.shell, undefined);
        const child = new EventEmitter() as ChildProcess;
        setImmediate(() => {
          child.emit("error", Object.assign(new Error("permission denied"), { code: "EACCES" }));
        });
        return child;
      },
    }),
    /Failed to start Claude Code CLI \(`claude`\): permission denied/,
  );
});

test("setup-mcp prints the migration error with legacy flags", async () => {
  for (const args of [
    ["setup-mcp"],
    ["setup-mcp", "--force"],
    ["setup-mcp", "--scope", "user"],
  ]) {
    const result = await runCli(args, process.env);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /setup-mcp has been removed/);
    assert.match(result.stderr, /claude-channel start/);
    assert.doesNotMatch(result.stderr, /unknown option/);
  }
});

async function runStartWithFakeClaude(args: string[]): Promise<{ args: string[]; serverCommand: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-channel-start-"));
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-channel-home-"));
  const capturePath = path.join(dir, "args.json");
  const fakeClaude = path.join(dir, "claude");
  const fakeServer = path.join(dir, "claude-channel-server");
  await writeFile(
    fakeClaude,
    [
      "#!/usr/bin/env node",
      "const { writeFileSync } = require('node:fs');",
      "writeFileSync(process.env.CLAUDE_CHANNEL_TEST_CAPTURE, JSON.stringify(process.argv.slice(2)));",
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(fakeClaude, 0o755);
  await writeFile(fakeServer, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(fakeServer, 0o755);

  try {
    const result = await runCli(["start", ...args], {
      ...receiverTestEnv(process.env),
      PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}`,
      HOME: homeDir,
      CLAUDE_CHANNEL_TEST_CAPTURE: capturePath,
    });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    return {
      args: JSON.parse(await readFile(capturePath, "utf8")) as string[],
      serverCommand: fakeServer,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  }
}

function receiverTestEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean = { ...env };
  for (const key of [
    "CLAUDE_CHANNEL_HOST",
    "CLAUDE_CHANNEL_PORT",
    "CLAUDE_CHANNEL_MAX_BODY_BYTES",
    "CLAUDE_CHANNEL_ASK_TIMEOUT_MS",
    "CLAUDE_CHANNEL_DISPLAY_NAME",
    "CLAUDE_CHANNEL_PROJECT_DIR",
  ]) {
    delete clean[key];
  }
  return clean;
}

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return waitForProcess(child);
}

async function waitForProcess(
  child: ChildProcessByStdio<null, Readable, Readable>,
  timeoutMs?: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }> {

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  let timedOut = false;
  const timeout = timeoutMs
    ? setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs)
    : undefined;

  const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  if (timeout) clearTimeout(timeout);
  return { code, signal, stdout, stderr, timedOut };
}

async function readFileEventually(file: string, timeoutMs = 5_000): Promise<string> {
  const startedAt = Date.now();
  while (true) {
    try {
      return await readFile(file, "utf8");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      if (Date.now() - startedAt > timeoutMs) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}
