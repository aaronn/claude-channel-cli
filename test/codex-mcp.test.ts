import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
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

test("ask_claude spills large answers to a private file without duplicating them in the MCP result", async () => {
  await withAnswerDir(async (answerDir) => {
    const answer = "x".repeat(128_001);
    const testDeps = createCodexToolDeps({
      ask: async () => ({
        ok: true,
        target: testEndpoint.endpoint_id,
        request_id: "req_large123",
        status: "answered",
        answer,
      }),
    });

    const result = await callCodexChannelTool("ask_claude", { message: "From Codex: review" }, testDeps);
    const answerFile = result.structuredContent?.answer_file;

    assert.equal(result.isError, false);
    assert.equal(result.structuredContent?.answer_truncated, true);
    assert.equal(result.structuredContent?.answer_bytes, 128_001);
    assert.equal(typeof result.structuredContent?.answer_preview, "string");
    assert.equal("answer" in (result.structuredContent ?? {}), false);
    assert.equal(answerFile, path.join(answerDir, "req_large123.txt"));
    assert.equal(await readFile(answerFile, "utf8"), answer);
    assert.ok(toolText(result).length < answer.length);
  });
});

test("answer artifact dir treats empty environment configuration as unset", () => {
  assert.equal(
    resolveCodexAnswerArtifactDir({ CLAUDE_CHANNEL_CODEX_ANSWER_DIR: "" }),
    resolveCodexAnswerArtifactDir({}),
  );
});

test("ask_claude returns a structured tool error when large answer storage fails", async () => {
  await withAnswerDir(async (answerDir) => {
    const blockingFile = path.join(answerDir, "not-a-directory");
    await writeFile(blockingFile, "block", "utf8");
    process.env.CLAUDE_CHANNEL_CODEX_ANSWER_DIR = blockingFile;
    const testDeps = createCodexToolDeps({
      ask: async () => ({
        ok: true,
        target: testEndpoint.endpoint_id,
        request_id: "req_large123",
        status: "answered",
        answer: "x".repeat(128_001),
      }),
    });

    const result = await callCodexChannelTool("ask_claude", { message: "From Codex: review" }, testDeps);

    assert.equal(result.isError, true);
    assert.match(toolText(result), /not-a-directory|EEXIST|ENOTDIR/);
  });
});

test("large answer storage rejects an artifact path collision without overwriting it", async () => {
  await withAnswerDir(async (answerDir) => {
    const existingFile = path.join(answerDir, "req_large123.txt");
    await writeFile(existingFile, "existing", "utf8");
    const testDeps = createCodexToolDeps({
      ask: async () => ({
        ok: true,
        target: testEndpoint.endpoint_id,
        request_id: "req_large123",
        status: "answered",
        answer: "x".repeat(128_001),
      }),
    });

    const result = await callCodexChannelTool("ask_claude", { message: "From Codex: review" }, testDeps);

    assert.equal(result.isError, true);
    assert.match(toolText(result), /EEXIST|file already exists/);
    assert.equal(await readFile(existingFile, "utf8"), "existing");
  });
});

test("large answer storage enforces private modes and prunes only owned artifacts", async () => {
  await withAnswerDir(async (answerDir) => {
    const now = Date.now();
    await chmod(answerDir, 0o755);
    for (let index = 0; index <= 100; index += 1) {
      const file = path.join(answerDir, `req_old${index}.txt`);
      await writeFile(file, "old", "utf8");
      const modified = new Date(now - (index + 1) * 1_000);
      await utimes(file, modified, modified);
    }

    const expiredFile = path.join(answerDir, "req_expired.txt");
    const expired = new Date(now - 8 * 24 * 60 * 60 * 1000);
    await writeFile(expiredFile, "expired", "utf8");
    await utimes(expiredFile, expired, expired);

    const currentFile = path.join(answerDir, "req_current.txt");
    const unrelatedFile = path.join(answerDir, "unrelated.txt");
    await writeFile(unrelatedFile, "keep", "utf8");

    const testDeps = createCodexToolDeps({
      ask: async () => ({
        ok: true,
        target: testEndpoint.endpoint_id,
        request_id: "req_current",
        status: "answered",
        answer: "x".repeat(128_001),
      }),
    });

    const result = await callCodexChannelTool("ask_claude", { message: "From Codex: review" }, testDeps);
    const artifactNames = (await readdir(answerDir)).filter((name) => /^req_[A-Za-z0-9]+\.txt$/.test(name));

    assert.equal(result.isError, false);
    assert.equal((await stat(answerDir)).mode & 0o777, 0o700);
    assert.equal((await stat(currentFile)).mode & 0o777, 0o600);
    assert.equal(artifactNames.length, 100);
    assert.ok(artifactNames.includes("req_current.txt"));
    assert.ok(artifactNames.includes("req_old98.txt"));
    assert.ok(!artifactNames.includes("req_old99.txt"));
    assert.ok(!artifactNames.includes("req_old100.txt"));
    assert.ok(!artifactNames.includes("req_expired.txt"));
    assert.equal(await readFile(unrelatedFile, "utf8"), "keep");
  });
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

async function withAnswerDir(run: (answerDir: string) => Promise<void>): Promise<void> {
  const previousAnswerDir = process.env.CLAUDE_CHANNEL_CODEX_ANSWER_DIR;
  const answerDir = await mkdtemp(path.join(tmpdir(), "claude-channel-answer-"));
  process.env.CLAUDE_CHANNEL_CODEX_ANSWER_DIR = answerDir;

  try {
    await run(answerDir);
  } finally {
    if (previousAnswerDir === undefined) {
      delete process.env.CLAUDE_CHANNEL_CODEX_ANSWER_DIR;
    } else {
      process.env.CLAUDE_CHANNEL_CODEX_ANSWER_DIR = previousAnswerDir;
    }
    await rm(answerDir, { recursive: true, force: true });
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
