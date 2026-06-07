import { DEFAULT_ASK_TIMEOUT_MS } from "../config/defaults.js";
import { parsePositiveIntegerEnv, parsePositiveIntegerString } from "../validation.js";

export type AskTimeoutOptions = {
  timeout?: string;
  timeoutMs?: string;
};

export function resolveAskTimeoutMs(
  options: AskTimeoutOptions,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (options.timeoutMs) return parsePositiveIntegerString(options.timeoutMs, "timeout-ms");
  if (options.timeout) return parseDurationMs(options.timeout);
  return parsePositiveIntegerEnv(env.CLAUDE_CHANNEL_ASK_TIMEOUT_MS, "CLAUDE_CHANNEL_ASK_TIMEOUT_MS", DEFAULT_ASK_TIMEOUT_MS);
}

export function parseDurationMs(value: string): number {
  const trimmed = value.trim();
  const match = /^(\d+)(ms|s|m|h)?$/.exec(trimmed);
  if (!match) {
    throw new Error("timeout must be a duration like 30000ms, 30s, 2m, or 1h");
  }

  const amount = Number.parseInt(match[1], 10);
  if (amount <= 0) {
    throw new Error("timeout must be greater than zero");
  }

  const unit = match[2] ?? "ms";
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
  };

  return amount * multipliers[unit];
}
