import assert from "node:assert/strict";
import test from "node:test";
import {
  callClaudeChannelTool,
  CLAUDE_CHANNEL_INSTRUCTIONS,
  createClaudeChannel,
  formatReplyRequiredChannelContent,
} from "../src/mcp/claude-channel.js";
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

test("formatReplyRequiredChannelContent frames request content with completion instructions", () => {
  const content = "\n  review this\n    keep indentation\n";
  const framed = formatReplyRequiredChannelContent("req_abc123", content);

  assert.match(framed, /^Channel Handling Instructions:/);
  assert.match(framed, /request_id="req_abc123"/);
  assert.match(framed, /complete_channel_request/);
  assert.match(framed, /channel sender/);
  assert.match(framed, /A normal Claude Code reply is not delivered/);
  assert.match(framed, /Incoming Channel Request:\n/);
  assert.doesNotMatch(framed, /Codex/);
  assert.ok(framed.endsWith(content));
});

test("formatReplyRequiredChannelContent rejects invalid request ids", () => {
  assert.throws(() => formatReplyRequiredChannelContent("bad", "question"), /invalid request_id/);
});

test("emitAsk frames reply-required content and preserves channel metadata", async () => {
  const pending = new PendingRequests();
  const channel = createClaudeChannel(pending);
  const notifications: Array<Parameters<typeof channel.server.notification>[0]> = [];
  channel.server.notification = async (notification) => {
    notifications.push(notification);
  };

  await channel.emitAsk("req_abc123", "question", { sender: "tester" });

  assert.equal(notifications.length, 1);
  const notification = notifications[0];
  assert.equal(notification?.method, "notifications/claude/channel");
  const params = notification.params as { content: string; meta: Record<string, string> };
  assert.equal(params.meta.request_id, "req_abc123");
  assert.equal(params.meta.reply_required, "true");
  assert.equal(params.meta.sender, "tester");
  assert.equal(params.content, formatReplyRequiredChannelContent("req_abc123", "question"));
});

test("emitTell sends one-way content without reply-required framing", async () => {
  const pending = new PendingRequests();
  const channel = createClaudeChannel(pending);
  const notifications: Array<Parameters<typeof channel.server.notification>[0]> = [];
  channel.server.notification = async (notification) => {
    notifications.push(notification);
  };

  await channel.emitTell("one-way message", { sender: "tester" });

  assert.equal(notifications.length, 1);
  const notification = notifications[0];
  assert.equal(notification?.method, "notifications/claude/channel");
  const params = notification.params as { content: string; meta: Record<string, string> };
  assert.equal(params.meta.reply_required, "false");
  assert.equal(params.meta.sender, "tester");
  assert.equal(params.content, "one-way message");
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
