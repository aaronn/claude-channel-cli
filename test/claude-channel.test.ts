import assert from "node:assert/strict";
import test from "node:test";
import { callClaudeChannelTool } from "../src/mcp/claude-channel.js";
import { PendingRequests } from "../src/pending-requests.js";
import { toolText } from "./helpers.js";

const COMPLETE_TOOL = "complete_channel_request";

test("complete_channel_request resolves a pending request and preserves answer whitespace", async () => {
  const pending = new PendingRequests();
  const promise = pending.waitFor("req_123", 100);

  const result = callClaudeChannelTool(COMPLETE_TOOL, {
    request_id: " req_123 ",
    status: " answered ",
    answer: "\n  final answer\n",
  }, pending);

  assert.equal(toolText(result), "Codex request completed.");
  assert.deepEqual(await promise, {
    requestId: "req_123",
    status: "answered",
    answer: "\n  final answer\n",
  });
});

test("complete_channel_request reports unknown request ids without resolving anything", () => {
  const pending = new PendingRequests();

  const result = callClaudeChannelTool(COMPLETE_TOOL, {
    request_id: "req_missing",
    status: "failed",
    answer: "missing",
  }, pending);

  assert.equal(toolText(result), "No pending Codex request matched that request_id.");
});

test("complete_channel_request validates completion arguments", () => {
  const pending = new PendingRequests();

  assert.throws(() => callClaudeChannelTool(COMPLETE_TOOL, undefined, pending), /completion arguments/);
  assert.throws(() => callClaudeChannelTool(COMPLETE_TOOL, {
    request_id: "bad",
    status: "answered",
    answer: "ok",
  }, pending), /invalid request_id/);
  assert.throws(() => callClaudeChannelTool(COMPLETE_TOOL, {
    request_id: "req_123",
    status: "done",
    answer: "ok",
  }, pending), /invalid completion status/);
  assert.throws(() => callClaudeChannelTool(COMPLETE_TOOL, {
    request_id: "req_123",
    status: "answered",
    answer: "   ",
  }, pending), /answer must be a non-empty string/);
});
