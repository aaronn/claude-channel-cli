import assert from "node:assert/strict";
import test from "node:test";
import { parseDurationMs, resolveAskTimeoutMs } from "../src/channel-client/timeout.js";
import { DEFAULT_ASK_TIMEOUT_MS } from "../src/config/defaults.js";

test("resolveAskTimeoutMs defaults to 30 minutes", () => {
  assert.equal(resolveAskTimeoutMs({}, {}), DEFAULT_ASK_TIMEOUT_MS);
});

test("resolveAskTimeoutMs uses CLAUDE_CHANNEL_ASK_TIMEOUT_MS when set", () => {
  assert.equal(resolveAskTimeoutMs({}, { CLAUDE_CHANNEL_ASK_TIMEOUT_MS: "600000" }), 600_000);
});

test("resolveAskTimeoutMs rejects malformed CLAUDE_CHANNEL_ASK_TIMEOUT_MS", () => {
  assert.throws(
    () => resolveAskTimeoutMs({}, { CLAUDE_CHANNEL_ASK_TIMEOUT_MS: "nope" }),
    /CLAUDE_CHANNEL_ASK_TIMEOUT_MS must be a positive integer/,
  );
});

test("resolveAskTimeoutMs uses --timeout over environment default", () => {
  assert.equal(resolveAskTimeoutMs({ timeout: "5m" }, { CLAUDE_CHANNEL_ASK_TIMEOUT_MS: "600000" }), 300_000);
});

test("resolveAskTimeoutMs uses --timeout-ms over --timeout", () => {
  assert.equal(resolveAskTimeoutMs({ timeout: "5m", timeoutMs: "42000" }), 42_000);
});

test("parseDurationMs supports review-scale durations", () => {
  assert.equal(parseDurationMs("30m"), 1_800_000);
  assert.equal(parseDurationMs("1h"), 3_600_000);
});

test("resolveAskTimeoutMs rejects malformed --timeout-ms", () => {
  assert.throws(() => resolveAskTimeoutMs({ timeoutMs: "abc" }), /timeout-ms must be a positive integer/);
});
