import assert from "node:assert/strict";
import test from "node:test";
import { TargetResolutionError } from "../src/channel-client/target-resolver.js";
import { callCodexChannelTool, listCodexChannelTools, type CodexChannelToolDeps } from "../src/codex-mcp/server.js";
import { createCodexToolDeps, testCandidate, testEndpoint, toolText } from "./helpers.js";

test("listCodexChannelTools exposes the Codex-facing tool set", () => {
  assert.deepEqual(
    listCodexChannelTools().map((tool) => tool.name),
    ["list_claude_targets", "status_claude_channel", "tell_claude", "ask_claude"],
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

test("tell_claude passes message and sender to channel client", async () => {
  const calls: Array<Parameters<CodexChannelToolDeps["tell"]>> = [];
  const testDeps = createCodexToolDeps();
  testDeps.tell = async (message, options) => {
    calls.push([message, options]);
    return { ok: true, target: testEndpoint.endpoint_id };
  };

  const result = await callCodexChannelTool("tell_claude", {
    message: "From Codex: hello",
    sender: "codex-test",
  }, testDeps);

  assert.equal(result.isError, false);
  assert.deepEqual(calls, [
    ["From Codex: hello", { target: undefined, sender: "codex-test" }],
  ]);
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
