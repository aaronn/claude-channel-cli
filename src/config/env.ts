import { parsePositiveIntegerEnv } from "../validation.js";
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
};

export function readChannelRuntimeConfig(env: NodeJS.ProcessEnv = process.env): ChannelRuntimeConfig {
  return {
    host: env.CLAUDE_CHANNEL_HOST ?? DEFAULT_CHANNEL_HOST,
    port: parsePositiveIntegerEnv(env.CLAUDE_CHANNEL_PORT, "CLAUDE_CHANNEL_PORT", DEFAULT_CHANNEL_PORT),
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
  };
}
