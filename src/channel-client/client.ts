import { Agent } from "undici";
import { DEFAULT_CHANNEL_SENDER, isAskStatus, isRequestId, type AskResponse } from "../protocol.js";
import { readToken } from "../config/paths.js";
import type { EndpointRecord } from "../registry/endpoint-record.js";
import { readRecordObject } from "../validation.js";
import { formatChannelUrl } from "../registry/endpoint-url.js";
import { resolveClaudeTarget, type TargetResolutionOptions } from "./target-resolver.js";
import { ASK_TRANSPORT_TIMEOUT_GRACE_MS } from "../config/defaults.js";
import { isEndpointId } from "../registry/endpoint-id.js";
import { normalizeEndpointDisplayName } from "../registry/display-name.js";

type ChannelMessageOptions = TargetResolutionOptions & {
  sender?: string;
  searchParams?: URLSearchParams;
  transportTimeoutMs?: number;
  token?: string;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
};

export type TargetedAskResponse = AskResponse & {
  target: string;
};

export type RenameDisplayNameResponse = {
  ok: true;
  target: string;
  endpoint_id: string;
  display_name: string;
};

export async function askClaude(
  message: string,
  options: ChannelMessageOptions & { timeoutMs: number },
): Promise<TargetedAskResponse> {
  const { response, endpoint } = await postAskMessage(message, {
    ...options,
    searchParams: new URLSearchParams({ timeout_ms: String(options.timeoutMs) }),
    transportTimeoutMs: askTransportTimeoutMs(options.timeoutMs),
  });
  const body = validateAskResponse(await readJsonResponse(response, "ask"), "ask");
  return { ...body, target: endpoint.endpoint_id };
}

export async function renameClaudeDisplayName(
  displayName: string,
  options: TargetResolutionOptions & {
    token?: string;
    fetchFn?: typeof fetch;
  } = {},
): Promise<RenameDisplayNameResponse> {
  const normalizedDisplayName = normalizeEndpointDisplayName(displayName);
  const { endpoint } = await resolveClaudeTarget(options);
  const token = options.token ?? await readToken();
  const response = await (options.fetchFn ?? fetch)(formatChannelUrl(endpoint, "/display-name"), {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ display_name: normalizedDisplayName }),
  });
  const body = validateRenameDisplayNameResponse(
    await readJsonResponse(response, "rename"),
    endpoint,
    "rename",
  );
  return { ...body, target: endpoint.endpoint_id };
}

export function askTransportTimeoutMs(timeoutMs: number): number {
  return timeoutMs + ASK_TRANSPORT_TIMEOUT_GRACE_MS;
}

async function postAskMessage(
  message: string,
  options: ChannelMessageOptions,
): Promise<{ response: Response; endpoint: EndpointRecord }> {
  const { endpoint } = await resolveClaudeTarget(options);
  const token = options.token ?? await readToken();
  const sender = resolveSender(options.sender, options.env);
  const search = options.searchParams ? `?${options.searchParams.toString()}` : "";

  const url = formatChannelUrl(endpoint, `/ask${search}`);
  const init: RequestInit = {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "text/plain; charset=utf-8",
      "x-claude-channel-sender": sender,
    },
    body: message,
  };

  return {
    endpoint,
    response: options.fetchFn
      ? await options.fetchFn(url, init)
      : await fetch(url, withTransportTimeout(init, options.transportTimeoutMs)),
  };
}

const askTransportDispatchers = new Map<number, Agent>();

function withTransportTimeout(init: RequestInit, timeoutMs: number | undefined): RequestInit {
  if (!timeoutMs) return init;
  return {
    ...init,
    dispatcher: askTransportDispatcher(timeoutMs),
  } as RequestInit;
}

function askTransportDispatcher(timeoutMs: number): Agent {
  const existing = askTransportDispatchers.get(timeoutMs);
  if (existing) return existing;

  const dispatcher = new Agent({
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });
  askTransportDispatchers.set(timeoutMs, dispatcher);
  return dispatcher;
}

async function readJsonResponse(response: Response, action: string): Promise<unknown> {
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${action} failed: HTTP ${response.status} ${body}`);
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(`${action} failed: response was not valid JSON`);
  }
}

function validateAskResponse(value: unknown, action: string): AskResponse {
  const record = readResponseRecord(value, action);
  const requestId = record.request_id;
  const status = record.status;
  const answer = record.answer;

  if (
    record.ok !== true ||
    typeof requestId !== "string" ||
    !isRequestId(requestId) ||
    !isAskStatus(status) ||
    typeof answer !== "string"
  ) {
    throw new Error(`${action} failed: response JSON did not match expected shape`);
  }

  return {
    ok: true,
    request_id: requestId,
    status,
    answer,
  };
}

function validateRenameDisplayNameResponse(
  value: unknown,
  endpoint: EndpointRecord,
  action: string,
): Omit<RenameDisplayNameResponse, "target"> {
  const record = readResponseRecord(value, action);
  const endpointId = record.endpoint_id;
  const displayName = record.display_name;

  if (
    record.ok !== true ||
    typeof endpointId !== "string" ||
    !isEndpointId(endpointId) ||
    endpointId !== endpoint.endpoint_id ||
    typeof displayName !== "string"
  ) {
    throw new Error(`${action} failed: response JSON did not match expected shape`);
  }

  return {
    ok: true,
    endpoint_id: endpointId,
    display_name: normalizeEndpointDisplayName(displayName),
  };
}

function resolveSender(sender: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  return sender ?? env.CLAUDE_CHANNEL_SENDER ?? DEFAULT_CHANNEL_SENDER;
}

function readResponseRecord(value: unknown, action: string): Record<string, unknown> {
  return readRecordObject(value, `${action} failed: response JSON did not match expected shape`);
}
