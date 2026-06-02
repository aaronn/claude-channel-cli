import type { AskResponse } from "../protocol.js";
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
  const body = await readJsonResponse<Omit<TellResponse, "target">>(response, "tell");
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
  const body = await readJsonResponse<AskResponse>(response, "ask");
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
  const { body, contentType } = buildChannelMessageBody(message, false);
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

export async function readJsonResponse<T>(response: Response, action: string): Promise<T> {
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${action} failed: HTTP ${response.status} ${body}`);
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`${action} failed: response was not valid JSON`);
  }
}

export function resolveSender(sender: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  return sender ?? env.CLAUDE_CHANNEL_SENDER ?? "codex";
}

export function buildChannelMessageBody(message: string, json: boolean): ChannelMessageBody {
  if (json) {
    return {
      body: JSON.stringify({ message }),
      contentType: "application/json; charset=utf-8",
    };
  }

  return {
    body: message,
    contentType: "text/plain; charset=utf-8",
  };
}

export function formatChannelUrl(endpoint: Pick<EndpointRecord, "host" | "port">, path: string): string {
  return `http://${endpoint.host}:${endpoint.port}${path}`;
}
