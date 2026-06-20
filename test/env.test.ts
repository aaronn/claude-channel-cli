import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ASK_TIMEOUT_MS,
  DEFAULT_CHANNEL_PORT,
  DEFAULT_MAX_BODY_BYTES,
} from "../src/config/defaults.js";
import { readChannelRuntimeConfig } from "../src/config/env.js";

test("readChannelRuntimeConfig uses numeric environment values", () => {
  assert.deepEqual(readChannelRuntimeConfig({
    CLAUDE_CHANNEL_HOST: "127.0.0.2",
    CLAUDE_CHANNEL_PORT: "8790",
    CLAUDE_CHANNEL_MAX_BODY_BYTES: "2048",
    CLAUDE_CHANNEL_ASK_TIMEOUT_MS: "600000",
    CLAUDE_CHANNEL_DISPLAY_NAME: " review-left ",
  }), {
    host: "127.0.0.2",
    port: 8790,
    maxBodyBytes: 2048,
    defaultAskTimeoutMs: 600_000,
    displayName: "review-left",
  });
});

test("readChannelRuntimeConfig accepts port zero", () => {
  assert.equal(readChannelRuntimeConfig({ CLAUDE_CHANNEL_PORT: "0" }).port, 0);
});

test("readChannelRuntimeConfig uses defaults when numeric environment values are absent", () => {
  assert.deepEqual(readChannelRuntimeConfig({}), {
    host: "127.0.0.1",
    port: DEFAULT_CHANNEL_PORT,
    maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
    defaultAskTimeoutMs: DEFAULT_ASK_TIMEOUT_MS,
    displayName: undefined,
  });
});

test("readChannelRuntimeConfig treats empty display names as unset", () => {
  assert.equal(readChannelRuntimeConfig({ CLAUDE_CHANNEL_DISPLAY_NAME: "" }).displayName, undefined);
  assert.equal(readChannelRuntimeConfig({ CLAUDE_CHANNEL_DISPLAY_NAME: "   " }).displayName, undefined);
});

test("readChannelRuntimeConfig rejects malformed numeric environment values", () => {
  assert.throws(() => readChannelRuntimeConfig({
    CLAUDE_CHANNEL_PORT: "8790abc",
  }), /CLAUDE_CHANNEL_PORT must be a non-negative integer/);
  assert.throws(() => readChannelRuntimeConfig({
    CLAUDE_CHANNEL_MAX_BODY_BYTES: "0",
  }), /CLAUDE_CHANNEL_MAX_BODY_BYTES must be a positive integer/);
  assert.throws(() => readChannelRuntimeConfig({
    CLAUDE_CHANNEL_ASK_TIMEOUT_MS: "-1",
  }), /CLAUDE_CHANNEL_ASK_TIMEOUT_MS must be a positive integer/);
  assert.throws(() => readChannelRuntimeConfig({
    CLAUDE_CHANNEL_DISPLAY_NAME: "ep_ABC234",
  }), /CLAUDE_CHANNEL_DISPLAY_NAME must not be a reserved target name/);
});
