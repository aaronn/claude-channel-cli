import path from "node:path";
import {
  type EndpointCandidate,
  type EndpointRecord,
  sortEndpointRecords,
  toEndpointCandidates,
} from "../registry/endpoint-record.js";
import { listLiveEndpoints } from "../registry/endpoint-store.js";
import { isListIndexTargetToken } from "../registry/target-token.js";

export type TargetResolutionOptions = {
  target?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  endpoints?: EndpointRecord[];
  now?: Date;
};

export type TargetResolution = {
  endpoint: EndpointRecord;
  candidates: EndpointCandidate[];
  reason: "explicit" | "env" | "workspace";
};

export type TargetResolutionErrorCode =
  | "no_claude_targets"
  | "unknown_claude_target"
  | "multiple_claude_targets"
  | "no_workspace_claude_target";

export class TargetResolutionError extends Error {
  readonly code: TargetResolutionErrorCode;
  readonly candidates: EndpointCandidate[];

  constructor(code: TargetResolutionErrorCode, message: string, candidates: EndpointCandidate[]) {
    super(message);
    this.name = "TargetResolutionError";
    this.code = code;
    this.candidates = candidates;
  }
}

export async function resolveClaudeTarget(options: TargetResolutionOptions = {}): Promise<TargetResolution> {
  const endpoints = sortEndpointRecords(options.endpoints ?? await listLiveEndpoints({ now: options.now }));
  const candidates = toEndpointCandidates(endpoints, options.now ?? new Date());

  if (endpoints.length === 0) {
    throw new TargetResolutionError("no_claude_targets", "No live Claude Code channel endpoints are running.", candidates);
  }

  const explicitTarget = normalizedTarget(options.target);
  if (explicitTarget) {
    return {
      endpoint: resolveNamedTarget(explicitTarget, endpoints, candidates),
      candidates,
      reason: "explicit",
    };
  }

  const env = options.env ?? process.env;
  const envTarget = normalizedTarget(env.CLAUDE_CHANNEL_TARGET);
  if (envTarget) {
    return {
      endpoint: resolveNamedTarget(envTarget, endpoints, candidates),
      candidates,
      reason: "env",
    };
  }

  const workspaceMatch = uniqueWorkspaceMatch(endpoints, options.cwd ?? process.cwd());
  if (workspaceMatch) {
    return { endpoint: workspaceMatch, candidates, reason: "workspace" };
  }

  if (endpoints.length === 1) {
    throw new TargetResolutionError(
      "no_workspace_claude_target",
      "The only live Claude Code channel endpoint is outside this workspace. Specify a target to use it.",
      candidates,
    );
  }

  throw new TargetResolutionError(
    "multiple_claude_targets",
    "Multiple Claude Code channel endpoints are running. Specify a target.",
    candidates,
  );
}

function resolveNamedTarget(
  target: string,
  endpoints: EndpointRecord[],
  candidates: EndpointCandidate[],
): EndpointRecord {
  const byIndex = isListIndexTargetToken(target) ? endpoints[Number.parseInt(target, 10) - 1] : undefined;
  if (byIndex) return byIndex;

  const byEndpointId = endpoints.find((endpoint) => endpoint.endpoint_id === target);
  if (byEndpointId) return byEndpointId;

  const matches = endpoints.filter((endpoint) =>
    endpoint.display_name === target || endpoint.project_dir === target
  );

  if (matches.length === 1) return matches[0];

  if (matches.length > 1) {
    throw new TargetResolutionError(
      "multiple_claude_targets",
      `Target ${target} matches multiple Claude Code channel endpoints.`,
      toEndpointCandidates(matches),
    );
  }

  throw new TargetResolutionError(
    "unknown_claude_target",
    `No live Claude Code channel endpoint matched target ${target}.`,
    candidates,
  );
}

function uniqueWorkspaceMatch(endpoints: EndpointRecord[], cwd: string): EndpointRecord | undefined {
  const matches = endpoints.filter((endpoint) => isSameOrChildPath(cwd, endpoint.project_dir));
  return matches.length === 1 ? matches[0] : undefined;
}

function isSameOrChildPath(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizedTarget(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
