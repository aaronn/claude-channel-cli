import test from "node:test";
import assert from "node:assert/strict";
import { PendingRequests } from "../src/pending-requests.js";

test("PendingRequests resolves matching completions", async () => {
  const pending = new PendingRequests();
  const promise = pending.waitFor("req_123", 100);

  assert.equal(
    pending.complete({
      requestId: "req_123",
      status: "answered",
      answer: "done",
    }),
    true,
  );

  assert.deepEqual(await promise, {
    requestId: "req_123",
    status: "answered",
    answer: "done",
  });
});

test("PendingRequests returns false for unknown completions", () => {
  const pending = new PendingRequests();

  assert.equal(
    pending.complete({
      requestId: "req_missing",
      status: "failed",
      answer: "missing",
    }),
    false,
  );
});

test("PendingRequests rejects on timeout", async () => {
  const pending = new PendingRequests();

  await assert.rejects(pending.waitFor("req_timeout", 5), /timed out waiting for Claude Code reply/);
});

test("PendingRequests can cancel a pending request", async () => {
  const pending = new PendingRequests();
  const promise = pending.waitFor("req_cancel", 100);

  assert.equal(pending.cancel("req_cancel", new Error("cancelled")), true);
  await assert.rejects(promise, /cancelled/);
});

test("PendingRequests rejects all pending requests", async () => {
  const pending = new PendingRequests();
  const first = pending.waitFor("req_first", 100);
  const second = pending.waitFor("req_second", 100);

  pending.rejectAll(new Error("stopped"));

  await assert.rejects(first, /stopped/);
  await assert.rejects(second, /stopped/);
});
