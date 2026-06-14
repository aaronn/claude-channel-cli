import http from "node:http";
import { errorMessage, HttpError, RequestTimeoutError } from "../errors.js";
import { PendingRequests } from "../pending-requests.js";
import { createRequestId, normalizeChannelSender, type ChannelEventMeta } from "../protocol.js";
import { isAuthorized } from "../security/auth.js";
import { parsePositiveIntegerString } from "../validation.js";
import { messageFromBody, readBody } from "./body.js";

export type ChannelEmitter = {
  emitAsk: (requestId: string, content: string, meta?: ChannelEventMeta) => Promise<void>;
};

export type BridgeHttpServerOptions = {
  host: string;
  token: string;
  maxBodyBytes: number;
  defaultAskTimeoutMs: number;
  channel: ChannelEmitter;
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
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, pid: process.pid });
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
    if (status === 500) console.error(`claude-channel-cli unexpected HTTP error: ${errorMessage(error)}`);
    if (canWriteResponse(res)) {
      sendJson(res, status, { ok: false, error: message });
    }
  }
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
  // emitAsk can fail before waitForReply is awaited; keep that cancellation rejection handled.
  void waitForReply.catch(() => undefined);
  const removeDisconnectHandler = cancelPendingAskOnDisconnect(res, () => {
    options.pendingRequests.cancel(requestId, new Error("caller disconnected before Claude Code reply"));
  });

  try {
    await options.channel.emitAsk(requestId, content, {
      sender: normalizeChannelSender(req.headers["x-claude-channel-sender"]),
    });

    const completion = await waitForReply;
    if (canWriteResponse(res)) {
      sendJson(res, 200, {
        ok: true,
        request_id: requestId,
        status: completion.status,
        answer: completion.answer,
      });
    }
  } catch (error) {
    options.pendingRequests.cancel(requestId, toError(error));
    if (canWriteResponse(res)) {
      throw error;
    }
  } finally {
    removeDisconnectHandler();
  }
}

function cancelPendingAskOnDisconnect(res: http.ServerResponse, cancel: () => void): () => void {
  const onClose = (): void => {
    if (!res.writableFinished) {
      cancel();
    }
  };

  res.once("close", onClose);
  return () => res.off("close", onClose);
}

function canWriteResponse(res: http.ServerResponse): boolean {
  return !res.destroyed && !res.writableEnded;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendText(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
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
