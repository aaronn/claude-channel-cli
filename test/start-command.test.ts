import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CLAUDE_CHANNEL_LAUNCH_MODE_ENV,
  CLAUDE_CHANNEL_START_LAUNCH_MODE,
  type ServerCommand,
} from "../src/cli/claude-mcp.js";
import { buildClaudeStartArgs, formatNativeStartCommand } from "../src/cli/start.js";

const serverCommand: ServerCommand = {
  command: "claude-channel-server",
  args: [],
};
const sessionMcpArg = `--mcp-config=${JSON.stringify({
  mcpServers: {
    "claude-channel-cli": {
      command: "claude-channel-server",
      args: [],
      env: {
        [CLAUDE_CHANNEL_LAUNCH_MODE_ENV]: CLAUDE_CHANNEL_START_LAUNCH_MODE,
      },
    },
  },
})}`;

test("buildClaudeStartArgs enables the claude-channel server and forwards args", () => {
  assert.deepEqual(buildClaudeStartArgs(serverCommand, ["--model", "opus", "--continue"]), [
    sessionMcpArg,
    "--dangerously-load-development-channels",
    "server:claude-channel-cli",
    "--model",
    "opus",
    "--continue",
  ]);
});

test("formatNativeStartCommand shell-quotes forwarded args", () => {
  assert.equal(
    formatNativeStartCommand(serverCommand, ["--name", "review left"]),
    `claude '${sessionMcpArg}' --dangerously-load-development-channels server:claude-channel-cli --name 'review left'`,
  );
});

test("start command forwards option-first Claude args through commander", async () => {
  const captured = await runStartWithFakeClaude(["--model", "opus", "--continue"]);

  assert.deepEqual(captured, [
    sessionMcpArg,
    "--dangerously-load-development-channels",
    "server:claude-channel-cli",
    "--model",
    "opus",
    "--continue",
  ]);
});

test("start command forwards args after separator through commander", async () => {
  const captured = await runStartWithFakeClaude(["--", "--help"]);

  assert.deepEqual(captured, [
    sessionMcpArg,
    "--dangerously-load-development-channels",
    "server:claude-channel-cli",
    "--help",
  ]);
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

async function runStartWithFakeClaude(args: string[]): Promise<string[]> {
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
      ...process.env,
      PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}`,
      HOME: homeDir,
      CLAUDE_CHANNEL_TEST_CAPTURE: capturePath,
    });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    return JSON.parse(await readFile(capturePath, "utf8")) as string[];
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  }
}

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

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

  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { code, stdout, stderr };
}
