import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ASK_TIMEOUT_MS,
  DEFAULT_CHANNEL_PORT,
  DEFAULT_MAX_BODY_BYTES,
} from "../src/config/defaults.js";
import { readChannelRuntimeConfig } from "../src/config/env.js";

test("readChannelRuntimeConfig uses positive integer environment values", () => {
  assert.deepEqual(readChannelRuntimeConfig({
    CLAUDE_CHANNEL_HOST: "127.0.0.2",
    CLAUDE_CHANNEL_PORT: "8790",
    CLAUDE_CHANNEL_MAX_BODY_BYTES: "2048",
    CLAUDE_CHANNEL_ASK_TIMEOUT_MS: "600000",
  }), {
    host: "127.0.0.2",
    port: 8790,
    maxBodyBytes: 2048,
    defaultAskTimeoutMs: 600_000,
  });
});

test("readChannelRuntimeConfig falls back for malformed numeric environment values", () => {
  assert.deepEqual(readChannelRuntimeConfig({
    CLAUDE_CHANNEL_PORT: "8790abc",
    CLAUDE_CHANNEL_MAX_BODY_BYTES: "0",
    CLAUDE_CHANNEL_ASK_TIMEOUT_MS: "-1",
  }), {
    host: "127.0.0.1",
    port: DEFAULT_CHANNEL_PORT,
    maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
    defaultAskTimeoutMs: DEFAULT_ASK_TIMEOUT_MS,
  });
});
