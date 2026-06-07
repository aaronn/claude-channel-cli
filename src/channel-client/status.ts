import { formatChannelUrl } from "./client.js";
import { tokenPath } from "../config/paths.js";
import { errorMessage } from "../errors.js";
import type { EndpointCandidate, EndpointRecord } from "../registry/endpoint-record.js";
import { endpointsDir } from "../registry/endpoint-store.js";
import { resolveClaudeTarget, type TargetResolutionOptions } from "./target-resolver.js";

export type ChannelStatusReport = {
  target: string;
  endpoint: EndpointRecord;
  candidates: EndpointCandidate[];
  health: unknown;
  reachable: boolean;
  endpoints_path: string;
  token_path: string;
};

export type ChannelStatusResult = {
  ok: boolean;
  report: ChannelStatusReport;
};

export type ChannelStatusOptions = TargetResolutionOptions & {
  fetchFn?: typeof fetch;
};

export async function readChannelStatus(options: ChannelStatusOptions = {}): Promise<ChannelStatusResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const resolved = await resolveClaudeTarget(options);
  const endpoint = resolved.endpoint;
  const baseReport = {
    target: endpoint.endpoint_id,
    endpoint,
    candidates: resolved.candidates,
    endpoints_path: endpointsDir,
    token_path: tokenPath,
  };

  try {
    const response = await fetchFn(formatChannelUrl(endpoint, "/health"), { method: "GET" });
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
