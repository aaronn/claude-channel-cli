import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChannelMeta,
  createRequestId,
  isAskStatus,
  isRequestId,
  normalizeChannelSender,
  sanitizeMeta,
} from "../src/protocol.js";

test("createRequestId returns a valid request id", () => {
  const requestId = createRequestId();

  assert.match(requestId, /^req_[A-Za-z0-9]+$/);
  assert.equal(isRequestId(requestId), true);
});

test("isRequestId rejects malformed ids", () => {
  assert.equal(isRequestId("req_bad-id"), false);
  assert.equal(isRequestId("bad"), false);
});

test("isAskStatus accepts the completion status values", () => {
  assert.equal(isAskStatus("answered"), true);
  assert.equal(isAskStatus("needs_user"), true);
  assert.equal(isAskStatus("declined"), true);
  assert.equal(isAskStatus("failed"), true);
  assert.equal(isAskStatus("done"), false);
});

test("sanitizeMeta drops invalid metadata keys", () => {
  assert.deepEqual(
    sanitizeMeta({
      sender: "codex",
      request_id: "req_123",
      "bad-key": "dropped",
    }),
    {
      sender: "codex",
      request_id: "req_123",
    },
  );
});

test("sanitizeMeta drops unsafe metadata values without dropping protocol values", () => {
  assert.deepEqual(
    sanitizeMeta({
      sender: 'bad"value',
      request_id: "req_123",
      received_at: "2026-06-02T00:00:00.000Z",
      reply_required: "true",
    }),
    {
      request_id: "req_123",
      received_at: "2026-06-02T00:00:00.000Z",
      reply_required: "true",
    },
  );
});

test("buildChannelMeta adds defaults and preserves valid overrides", () => {
  const meta = buildChannelMeta({ sender: "tester", reply_required: "true" });

  assert.equal(meta.sender, "tester");
  assert.equal(meta.reply_required, "true");
  assert.match(meta.received_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("buildChannelMeta falls back to default sender when sender metadata is unsafe", () => {
  const meta = buildChannelMeta({ sender: "<bad>", reply_required: "true" });

  assert.equal(meta.sender, "codex");
  assert.equal(meta.reply_required, "true");
});

test("normalizeChannelSender accepts safe labels and falls back for unsafe labels", () => {
  assert.equal(normalizeChannelSender(" codex-review "), "codex-review");
  assert.equal(normalizeChannelSender('bad"sender'), "codex");
  assert.equal(normalizeChannelSender(["codex"]), "codex");
});
