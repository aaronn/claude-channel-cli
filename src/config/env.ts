import { parseNonNegativeIntegerEnv, parsePositiveIntegerEnv } from "../validation.js";
import { normalizeEndpointDisplayName, type EndpointDisplayName } from "../registry/display-name.js";
import {
  DEFAULT_ASK_TIMEOUT_MS,
  DEFAULT_CHANNEL_HOST,
  DEFAULT_CHANNEL_PORT,
  DEFAULT_MAX_BODY_BYTES,
} from "./defaults.js";

export type ChannelRuntimeConfig = {
  host: string;
  port: number;
  maxBodyBytes: number;
  defaultAskTimeoutMs: number;
  displayName?: EndpointDisplayName;
};

export function readChannelRuntimeConfig(env: NodeJS.ProcessEnv = process.env): ChannelRuntimeConfig {
  return {
    host: env.CLAUDE_CHANNEL_HOST ?? DEFAULT_CHANNEL_HOST,
    port: parseNonNegativeIntegerEnv(env.CLAUDE_CHANNEL_PORT, "CLAUDE_CHANNEL_PORT", DEFAULT_CHANNEL_PORT),
    maxBodyBytes: parsePositiveIntegerEnv(
      env.CLAUDE_CHANNEL_MAX_BODY_BYTES,
      "CLAUDE_CHANNEL_MAX_BODY_BYTES",
      DEFAULT_MAX_BODY_BYTES,
    ),
    defaultAskTimeoutMs: parsePositiveIntegerEnv(
      env.CLAUDE_CHANNEL_ASK_TIMEOUT_MS,
      "CLAUDE_CHANNEL_ASK_TIMEOUT_MS",
      DEFAULT_ASK_TIMEOUT_MS,
    ),
    displayName: parseDisplayNameEnv(env.CLAUDE_CHANNEL_DISPLAY_NAME),
  };
}

function parseDisplayNameEnv(value: string | undefined): EndpointDisplayName | undefined {
  return value === undefined
    ? undefined
    : normalizeEndpointDisplayName(value, "CLAUDE_CHANNEL_DISPLAY_NAME");
}
