import { isAskStatus, isRequestId, type AskResponse } from "../protocol.js";
import { readToken } from "../config/paths.js";
import type { EndpointRecord } from "../registry/endpoint-record.js";
import { resolveClaudeTarget, type TargetResolutionOptions } from "./target-resolver.js";

export type ChannelMessageOptions = TargetResolutionOptions & {
  sender?: string;
  searchParams?: URLSearchParams;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
};

export type ChannelMessageBody = {
  body: string;
  contentType: string;
};

export type TellResponse = {
  ok: true;
  target: string;
};

export type TargetedAskResponse = AskResponse & {
  target: string;
};

export async function tellClaude(message: string, options: ChannelMessageOptions = {}): Promise<TellResponse> {
  const { response, endpoint } = await postChannelMessage("/tell", message, options);
  const body = validateTellResponse(await readJsonResponse(response, "tell"), "tell");
  return { ...body, target: endpoint.endpoint_id };
}

export async function askClaude(
  message: string,
  options: ChannelMessageOptions & { timeoutMs: number },
): Promise<TargetedAskResponse> {
  const { response, endpoint } = await postChannelMessage("/ask", message, {
    ...options,
    searchParams: new URLSearchParams({ timeout_ms: String(options.timeoutMs) }),
  });
  const body = validateAskResponse(await readJsonResponse(response, "ask"), "ask");
  return { ...body, target: endpoint.endpoint_id };
}

export async function postChannelMessage(
  path: "/tell" | "/ask",
  message: string,
  options: ChannelMessageOptions,
): Promise<{ response: Response; endpoint: EndpointRecord }> {
  const { endpoint } = await resolveClaudeTarget(options);
  const token = await readToken();
  const sender = resolveSender(options.sender, options.env);
  const { body, contentType } = buildChannelMessageBody(message);
  const search = options.searchParams ? `?${options.searchParams.toString()}` : "";

  return {
    endpoint,
    response: await (options.fetchFn ?? fetch)(formatChannelUrl(endpoint, `${path}${search}`), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": contentType,
        "x-claude-channel-sender": sender,
      },
      body,
    }),
  };
}

export async function readJsonResponse(response: Response, action: string): Promise<unknown> {
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

export function validateTellResponse(value: unknown, action: string): Omit<TellResponse, "target"> {
  const record = readResponseRecord(value, action);
  if (record.ok !== true) throw new Error(`${action} failed: response JSON did not match expected shape`);
  return { ok: true };
}

export function validateAskResponse(value: unknown, action: string): AskResponse {
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

export function resolveSender(sender: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  return sender ?? env.CLAUDE_CHANNEL_SENDER ?? "codex";
}

export function buildChannelMessageBody(message: string): ChannelMessageBody {
  return {
    body: message,
    contentType: "text/plain; charset=utf-8",
  };
}

export function formatChannelUrl(endpoint: Pick<EndpointRecord, "host" | "port">, path: string): string {
  return `http://${endpoint.host}:${endpoint.port}${path}`;
}

function readResponseRecord(value: unknown, action: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${action} failed: response JSON did not match expected shape`);
  }
  return value as Record<string, unknown>;
}
