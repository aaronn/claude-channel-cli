import assert from "node:assert/strict";
import test from "node:test";
import {
  CLAUDE_CHANNEL_CLIENT_CAPABILITY,
  hasClaudeChannelClientCapability,
  isChannelReady,
} from "../src/channel-readiness.js";

test("hasClaudeChannelClientCapability detects the Claude channel client capability", () => {
  assert.equal(hasClaudeChannelClientCapability(undefined), false);
  assert.equal(hasClaudeChannelClientCapability({ experimental: {} }), false);
  assert.equal(
    hasClaudeChannelClientCapability({ experimental: { [CLAUDE_CHANNEL_CLIENT_CAPABILITY]: {} } }),
    true,
  );
});

test("isChannelReady accepts the channel client capability", () => {
  assert.equal(isChannelReady({ experimental: { [CLAUDE_CHANNEL_CLIENT_CAPABILITY]: {} } }), true);
});

test("isChannelReady rejects clients without the channel capability", () => {
  assert.equal(isChannelReady(undefined), false);
});
