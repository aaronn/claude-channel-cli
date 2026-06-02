import http from "node:http";
import { errorMessage, HttpError, RequestTimeoutError } from "../errors.js";
import type { ClaudeChannel } from "../mcp/claude-channel.js";
import { PendingRequests } from "../pending-requests.js";
import { createRequestId, normalizeChannelSender } from "../protocol.js";
import { isAuthorized } from "../security/auth.js";
import { parsePositiveIntegerString } from "../validation.js";
import { messageFromBody, readBody } from "./body.js";
import { sendJson, sendText } from "./responses.js";

export type BridgeHttpServerOptions = {
  host: string;
  token: string;
  maxBodyBytes: number;
  defaultAskTimeoutMs: number;
  channel: ClaudeChannel;
  pendingRequests: PendingRequests;
};

export function createBridgeHttpServer(options: BridgeHttpServerOptions): http.Server {
  return http.createServer((req, res) => {
    void handleHttpRequest(req, res, options);
  });
}

async function handleHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: BridgeHttpServerOptions,
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", `http://${options.host}`);

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, pid: process.pid });
      return;
    }

    if (req.method === "POST" && url.pathname === "/tell") {
      await handleTell(req, res, options);
      return;
    }

    if (req.method === "POST" && url.pathname === "/ask") {
      await handleAsk(req, res, url, options);
      return;
    }

    sendText(res, 404, "not found\n");
  } catch (error) {
    const status = statusForError(error);
    const message = status === 500 ? "internal server error" : errorMessage(error);
    if (status === 500) console.error(`claude-cli-channel unexpected HTTP error: ${errorMessage(error)}`);
    sendJson(res, status, { ok: false, error: message });
  }
}

async function handleTell(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: BridgeHttpServerOptions,
): Promise<void> {
  if (!isAuthorized(req, options.token)) {
    sendText(res, 401, "unauthorized\n");
    return;
  }

  const content = await readMessage(req, options.maxBodyBytes);
  await options.channel.emitTell(content, {
    sender: normalizeChannelSender(req.headers["x-claude-channel-sender"]),
  });

  sendJson(res, 202, { ok: true });
}

async function handleAsk(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  options: BridgeHttpServerOptions,
): Promise<void> {
  if (!isAuthorized(req, options.token)) {
    sendText(res, 401, "unauthorized\n");
    return;
  }

  const timeoutMs = parseTimeout(url.searchParams.get("timeout_ms"), options.defaultAskTimeoutMs);
  const requestId = createRequestId();
  const content = await readMessage(req, options.maxBodyBytes);
  const waitForReply = options.pendingRequests.waitFor(requestId, timeoutMs);
  void waitForReply.catch(() => undefined);

  try {
    await options.channel.emitAsk(requestId, content, {
      sender: normalizeChannelSender(req.headers["x-claude-channel-sender"]),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.pendingRequests.cancel(requestId, new Error(message));
    throw error;
  }

  const completion = await waitForReply;
  sendJson(res, 200, {
    ok: true,
    request_id: requestId,
    status: completion.status,
    answer: completion.answer,
  });
}

async function readMessage(req: http.IncomingMessage, maxBodyBytes: number): Promise<string> {
  const body = await readBody(req, maxBodyBytes);
  const content = messageFromBody(req, body);
  if (content.trim().length === 0) {
    throw new HttpError(400, "message body is required");
  }
  return content;
}

function parseTimeout(value: string | null, fallback: number): number {
  if (!value) return fallback;
  try {
    return parsePositiveIntegerString(value, "timeout_ms");
  } catch {
    throw new HttpError(400, "timeout_ms must be a positive integer");
  }
}

function statusForError(error: unknown): number {
  if (error instanceof HttpError) return error.status;
  if (error instanceof RequestTimeoutError) return 504;
  return 500;
}
