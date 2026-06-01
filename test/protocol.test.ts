import test from "node:test";
import assert from "node:assert/strict";
import { buildChannelMeta, createRequestId, isRequestId, sanitizeMeta } from "../src/protocol.js";

test("createRequestId returns a valid request id", () => {
  const requestId = createRequestId();

  assert.match(requestId, /^req_[A-Za-z0-9]+$/);
  assert.equal(isRequestId(requestId), true);
});

test("isRequestId rejects malformed ids", () => {
  assert.equal(isRequestId("req_bad-id"), false);
  assert.equal(isRequestId("bad"), false);
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

test("buildChannelMeta adds defaults and preserves valid overrides", () => {
  const meta = buildChannelMeta({ sender: "tester", reply_required: "true" });

  assert.equal(meta.sender, "tester");
  assert.equal(meta.reply_required, "true");
  assert.match(meta.received_at, /^\d{4}-\d{2}-\d{2}T/);
});
