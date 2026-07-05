import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TargetResolutionError } from "../src/channel-client/target-resolver.js";
import {
  callCodexChannelTool,
  listCodexChannelTools,
  resolveCodexAnswerArtifactDir,
  type CodexChannelToolDeps,
} from "../src/codex-mcp/server.js";
import { createCodexToolDeps, testCandidate, testEndpoint, toolText } from "./helpers.js";

test("listCodexChannelTools exposes the Codex-facing tool set", () => {
  assert.deepEqual(
    listCodexChannelTools().map((tool) => tool.name),
    ["list_claude_targets", "status_claude_channel", "ask_claude"],
  );
});

test("list_claude_targets returns structured targets", async () => {
  const result = await callCodexChannelTool("list_claude_targets", {}, createCodexToolDeps());

  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent?.targets, [testCandidate]);
});

test("status_claude_channel returns structured status", async () => {
  const result = await callCodexChannelTool("status_claude_channel", undefined, createCodexToolDeps());

  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent?.health, { ok: true });
});

test("ask_claude passes timeout and returns structured answer", async () => {
  const calls: Array<Parameters<CodexChannelToolDeps["ask"]>> = [];
  const testDeps = createCodexToolDeps();
  testDeps.ask = async (message, options) => {
    calls.push([message, options]);
    return {
      ok: true,
      target: testEndpoint.endpoint_id,
      request_id: "req_abc123",
      status: "answered",
      answer: "done",
    };
  };

  const result = await callCodexChannelTool("ask_claude", {
    message: "From Codex: review",
    sender: "codex-test",
    timeout_ms: 42,
  }, testDeps);

  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent, {
    ok: true,
    target: testEndpoint.endpoint_id,
    request_id: "req_abc123",
    status: "answered",
    answer: "done",
    answer_truncated: false,
    answer_bytes: 4,
  });
  assert.deepEqual(calls, [
    ["From Codex: review", { target: undefined, sender: "codex-test", timeoutMs: 42 }],
  ]);
});

test("ask_claude passes target through to channel client", async () => {
  const calls: Array<Parameters<CodexChannelToolDeps["ask"]>> = [];
  const testDeps = createCodexToolDeps();
  testDeps.ask = async (message, options) => {
    calls.push([message, options]);
    return {
      ok: true,
      target: testEndpoint.endpoint_id,
      request_id: "req_abc123",
      status: "answered",
      answer: "done",
    };
  };

  await callCodexChannelTool("ask_claude", {
    target: "app",
    message: "From Codex: review",
  }, testDeps);

  assert.deepEqual(calls, [
    ["From Codex: review", { target: "app", sender: undefined, timeoutMs: 1_800_000 }],
  ]);
});

test("ask_claude spills large answers to a file instead of duplicating them in the MCP result", async () => {
  const previousAnswerDir = process.env.CLAUDE_CHANNEL_CODEX_ANSWER_DIR;
  const answerDir = await mkdtemp(path.join(tmpdir(), "claude-channel-answer-"));
  process.env.CLAUDE_CHANNEL_CODEX_ANSWER_DIR = answerDir;
  const answer = "x".repeat(128_001);
  const testDeps = createCodexToolDeps();
  testDeps.ask = async () => ({
    ok: true,
    target: testEndpoint.endpoint_id,
    request_id: "req_large123",
    status: "answered",
    answer,
  });

  try {
    const result = await callCodexChannelTool("ask_claude", { message: "From Codex: review" }, testDeps);
    const answerFile = result.structuredContent?.answer_file;

    assert.equal(result.isError, false);
    assert.equal(result.structuredContent?.answer_truncated, true);
    assert.equal(result.structuredContent?.answer_bytes, 128_001);
    assert.equal(typeof result.structuredContent?.answer_preview, "string");
    assert.equal("answer" in (result.structuredContent ?? {}), false);
    assert.equal(typeof answerFile, "string");
    assert.equal(await readFile(answerFile as string, "utf8"), answer);
    assert.doesNotMatch(toolText(result), new RegExp(`x{${128_001}}`));
  } finally {
    if (previousAnswerDir === undefined) {
      delete process.env.CLAUDE_CHANNEL_CODEX_ANSWER_DIR;
    } else {
      process.env.CLAUDE_CHANNEL_CODEX_ANSWER_DIR = previousAnswerDir;
    }
    await rm(answerDir, { recursive: true, force: true });
  }
});

test("answer artifact dir treats empty env as unset", () => {
  assert.equal(
    resolveCodexAnswerArtifactDir({ CLAUDE_CHANNEL_CODEX_ANSWER_DIR: "" }),
    resolveCodexAnswerArtifactDir({}),
  );
});

test("ask_claude returns structured tool errors when large answer spill fails", async () => {
  const previousAnswerDir = process.env.CLAUDE_CHANNEL_CODEX_ANSWER_DIR;
  const dir = await mkdtemp(path.join(tmpdir(), "claude-channel-answer-file-"));
  const blockingFile = path.join(dir, "not-a-directory");
  await writeFile(blockingFile, "block", "utf8");
  process.env.CLAUDE_CHANNEL_CODEX_ANSWER_DIR = blockingFile;
  const testDeps = createCodexToolDeps();
  testDeps.ask = async () => ({
    ok: true,
    target: testEndpoint.endpoint_id,
    request_id: "req_large123",
    status: "answered",
    answer: "x".repeat(128_001),
  });

  try {
    const result = await callCodexChannelTool("ask_claude", { message: "From Codex: review" }, testDeps);

    assert.equal(result.isError, true);
    assert.match(toolText(result), /not-a-directory|EEXIST|ENOTDIR/);
  } finally {
    restoreAnswerDir(previousAnswerDir);
    await rm(dir, { recursive: true, force: true });
  }
});

test("large answer artifacts are private and pruned on write", async () => {
  const previousAnswerDir = process.env.CLAUDE_CHANNEL_CODEX_ANSWER_DIR;
  const answerDir = await mkdtemp(path.join(tmpdir(), "claude-channel-answer-"));
  process.env.CLAUDE_CHANNEL_CODEX_ANSWER_DIR = answerDir;
  const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  for (let index = 0; index < 105; index += 1) {
    const file = path.join(answerDir, `req_old${index}.txt`);
    await writeFile(file, "old", "utf8");
    await utimes(file, oldDate, oldDate);
  }
  const testDeps = createCodexToolDeps();
  testDeps.ask = async () => ({
    ok: true,
    target: testEndpoint.endpoint_id,
    request_id: "req_current",
    status: "answered",
    answer: "x".repeat(128_001),
  });

  try {
    const result = await callCodexChannelTool("ask_claude", { message: "From Codex: review" }, testDeps);
    const answerFile = result.structuredContent?.answer_file as string;
    const dirMode = (await stat(answerDir)).mode & 0o777;
    const fileMode = (await stat(answerFile)).mode & 0o777;
    const artifacts = (await readdir(answerDir)).filter((name) => /^req_.*\.txt$/.test(name));

    assert.equal(result.isError, false);
    assert.equal(dirMode, 0o700);
    assert.equal(fileMode, 0o600);
    assert.deepEqual(artifacts, ["req_current.txt"]);
  } finally {
    restoreAnswerDir(previousAnswerDir);
    await rm(answerDir, { recursive: true, force: true });
  }
});

test("ask_claude defaults to 30 minute timeout", async () => {
  let timeoutMs = 0;
  const testDeps = createCodexToolDeps();
  testDeps.ask = async (_message, options) => {
    timeoutMs = options.timeoutMs;
    return {
      ok: true,
      target: testEndpoint.endpoint_id,
      request_id: "req_abc123",
      status: "answered",
      answer: "done",
    };
  };

  await callCodexChannelTool("ask_claude", { message: "From Codex: review" }, testDeps);

  assert.equal(timeoutMs, 1_800_000);
});

function restoreAnswerDir(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.CLAUDE_CHANNEL_CODEX_ANSWER_DIR;
  } else {
    process.env.CLAUDE_CHANNEL_CODEX_ANSWER_DIR = value;
  }
}

test("tell_claude is not exposed as a Codex-facing tool", async () => {
  await assert.rejects(
    callCodexChannelTool("tell_claude", { message: "From Codex: hello" }, createCodexToolDeps()),
    /unknown tool: tell_claude/,
  );
});

test("tool argument validation returns tool-visible errors", async () => {
  const result = await callCodexChannelTool("ask_claude", {
    message: "From Codex: review",
    timeout_ms: 0,
  }, createCodexToolDeps());

  assert.equal(result.isError, true);
  assert.match(toolText(result), /timeout_ms/);
});

test("target ambiguity returns retry-friendly structured error", async () => {
  const testDeps = createCodexToolDeps();
  testDeps.ask = async () => {
    throw new TargetResolutionError("multiple_claude_targets", "Multiple targets", [testCandidate]);
  };

  const result = await callCodexChannelTool("ask_claude", {
    message: "From Codex: review",
  }, testDeps);

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent?.error, "multiple_claude_targets");
  assert.deepEqual(result.structuredContent?.candidates, [testCandidate]);
});
