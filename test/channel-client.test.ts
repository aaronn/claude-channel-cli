import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChannelMessageBody,
  resolveSender,
  validateAskResponse,
  validateTellResponse,
} from "../src/channel-client/client.js";

test("resolveSender uses explicit sender before environment", () => {
  assert.equal(resolveSender("reviewer", { CLAUDE_CHANNEL_SENDER: "env-sender" }), "reviewer");
});

test("resolveSender falls back to CLAUDE_CHANNEL_SENDER", () => {
  assert.equal(resolveSender(undefined, { CLAUDE_CHANNEL_SENDER: "env-sender" }), "env-sender");
});

test("resolveSender defaults to codex", () => {
  assert.equal(resolveSender(undefined, {}), "codex");
});

test("buildChannelMessageBody preserves plain text messages", () => {
  assert.deepEqual(buildChannelMessageBody("\n  hello\n", { format: "text" }), {
    body: "\n  hello\n",
    contentType: "text/plain; charset=utf-8",
  });
});

test("buildChannelMessageBody wraps JSON messages", () => {
  assert.deepEqual(buildChannelMessageBody("\n  hello\n", { format: "json" }), {
    body: JSON.stringify({ message: "\n  hello\n" }),
    contentType: "application/json; charset=utf-8",
  });
});

test("validateTellResponse accepts the tell response envelope", () => {
  assert.deepEqual(validateTellResponse({ ok: true }, "tell"), { ok: true });
});

test("validateAskResponse accepts the ask response envelope", () => {
  assert.deepEqual(validateAskResponse({
    ok: true,
    request_id: "req_abc123",
    status: "answered",
    answer: "done",
  }, "ask"), {
    ok: true,
    request_id: "req_abc123",
    status: "answered",
    answer: "done",
  });
});

test("response validation rejects malformed envelopes", () => {
  assert.throws(() => validateTellResponse({ ok: false }, "tell"), /expected shape/);
  assert.throws(() => validateAskResponse({
    ok: true,
    request_id: "bad",
    status: "answered",
    answer: "done",
  }, "ask"), /expected shape/);
});
