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
    port: parseIntegerEnv(env.CLAUDE_CHANNEL_PORT, DEFAULT_CHANNEL_PORT),
    maxBodyBytes: parseIntegerEnv(env.CLAUDE_CHANNEL_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES),
    defaultAskTimeoutMs: parseIntegerEnv(env.CLAUDE_CHANNEL_ASK_TIMEOUT_MS, DEFAULT_ASK_TIMEOUT_MS),
  };
}

function parseIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
