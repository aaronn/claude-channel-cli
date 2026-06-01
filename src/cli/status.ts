import { formatChannelUrl } from "./client.js";
import {
  readState as readDefaultState,
  statePath as defaultStatePath,
  tokenPath as defaultTokenPath,
  type BridgeState,
} from "../config/paths.js";

export type ChannelStatusReport = {
  state: BridgeState;
  health: unknown;
  reachable: boolean;
  state_path: string;
  token_path: string;
};

export type ChannelStatusResult = {
  ok: boolean;
  report: ChannelStatusReport;
};

export type ChannelStatusOptions = {
  readState?: () => Promise<BridgeState>;
  fetchFn?: typeof fetch;
  statePath?: string;
  tokenPath?: string;
};

export async function readChannelStatus(options: ChannelStatusOptions = {}): Promise<ChannelStatusResult> {
  const readState = options.readState ?? readDefaultState;
  const fetchFn = options.fetchFn ?? fetch;
  const state = await readState();
  const baseReport = {
    state,
    state_path: options.statePath ?? defaultStatePath,
    token_path: options.tokenPath ?? defaultTokenPath,
  };

  try {
    const response = await fetchFn(formatChannelUrl(state, "/health"), { method: "GET" });
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        report: {
          ...baseReport,
          reachable: false,
          health: text,
        },
      };
    }

    const health = parseHealthJson(text);
    return {
      ok: health.valid && isHealthyResponse(health.value),
      report: {
        ...baseReport,
        reachable: true,
        health: health.value,
      },
    };
  } catch (error) {
    return {
      ok: false,
      report: {
        ...baseReport,
        reachable: false,
        health: {
          ok: false,
          error: `channel server is not reachable: ${errorMessage(error)}`,
        },
      },
    };
  }
}

function parseHealthJson(text: string): { valid: boolean; value: unknown } {
  try {
    return { valid: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      valid: false,
      value: {
        ok: false,
        error: "channel health response was not valid JSON",
        body: text,
      },
    };
  }
}

function isHealthyResponse(value: unknown): boolean {
  return typeof value === "object" && value !== null && "ok" in value && value.ok === true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
