import assert from "node:assert/strict";
import test from "node:test";
import {
  CLAUDE_CHANNEL_CLIENT_CAPABILITY,
  detectChannelReadiness,
  hasClaudeChannelClientCapability,
} from "../src/channel-readiness.js";

test("hasClaudeChannelClientCapability detects the Claude channel client capability", () => {
  assert.equal(hasClaudeChannelClientCapability(undefined), false);
  assert.equal(hasClaudeChannelClientCapability({ experimental: {} }), false);
  assert.equal(
    hasClaudeChannelClientCapability({ experimental: { [CLAUDE_CHANNEL_CLIENT_CAPABILITY]: {} } }),
    true,
  );
});

test("detectChannelReadiness accepts the channel client capability", () => {
  assert.deepEqual(
    detectChannelReadiness({ experimental: { [CLAUDE_CHANNEL_CLIENT_CAPABILITY]: {} } }),
    { ready: true, reason: "client_capability" },
  );
});

test("detectChannelReadiness rejects clients without the channel capability", () => {
  assert.deepEqual(
    detectChannelReadiness(undefined),
    { ready: false, reason: "missing_channel_capability" },
  );
});
