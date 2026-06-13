import assert from "node:assert/strict";
import test from "node:test";
import { callClaudeChannelTool, CLAUDE_CHANNEL_INSTRUCTIONS } from "../src/mcp/claude-channel.js";
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

  assert.equal(toolText(result), "Channel request completed.");
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

  assert.equal(toolText(result), "No pending channel request matched that request_id.");
});

test("channel instructions explain reply-required delivery through the completion tool", () => {
  assert.match(CLAUDE_CHANNEL_INSTRUCTIONS, /reply_required="true"/);
  assert.match(CLAUDE_CHANNEL_INSTRUCTIONS, /complete_channel_request/);
  assert.match(CLAUDE_CHANNEL_INSTRUCTIONS, /request_id/);
  assert.match(CLAUDE_CHANNEL_INSTRUCTIONS, /channel sender/);
  assert.match(CLAUDE_CHANNEL_INSTRUCTIONS, /Text written only in the Claude Code conversation is not sent back/);
  assert.doesNotMatch(CLAUDE_CHANNEL_INSTRUCTIONS, /Codex/);
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
