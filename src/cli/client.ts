import type { BridgeState } from "../config/paths.js";
import { readState, readToken } from "../config/paths.js";

export type ChannelMessageOptions = {
  sender?: string;
  json?: boolean;
  searchParams?: URLSearchParams;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
};

export type ChannelMessageBody = {
  body: string;
  contentType: string;
};

export async function requestChannel(
  path: string,
  init: RequestInit,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const state = await readState();
  return fetchFn(formatChannelUrl(state, path), init);
}

export async function postChannelMessage(
  path: "/tell" | "/ask",
  message: string,
  options: ChannelMessageOptions,
): Promise<Response> {
  const token = await readToken();
  const sender = resolveSender(options.sender, options.env);
  const { body, contentType } = buildChannelMessageBody(message, options.json ?? false);
  const search = options.searchParams ? `?${options.searchParams.toString()}` : "";

  return requestChannel(
    `${path}${search}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": contentType,
        "x-claude-channel-sender": sender,
      },
      body,
    },
    options.fetchFn,
  );
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

export function formatChannelUrl(state: Pick<BridgeState, "host" | "port">, path: string): string {
  return `http://${state.host}:${state.port}${path}`;
}
