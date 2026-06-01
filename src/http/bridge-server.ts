import http from "node:http";
import type { ClaudeChannel } from "../mcp/claude-channel.js";
import { PendingRequests } from "../pending-requests.js";
import { createRequestId } from "../protocol.js";
import { isAuthorized } from "../security/auth.js";
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
  return http.createServer(async (req, res) => {
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
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, statusForError(message), { ok: false, error: message });
    }
  });
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
    sender: req.headers["x-claude-channel-sender"]?.toString() ?? "codex",
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

  try {
    await options.channel.emitAsk(requestId, content, {
      sender: req.headers["x-claude-channel-sender"]?.toString() ?? "codex",
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
    throw new Error("message body is required");
  }
  return content;
}

function parseTimeout(value: string | null, fallback: number): number {
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error("timeout_ms must be a positive integer");
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("timeout_ms must be a positive integer");
  }

  return parsed;
}

function statusForError(message: string): number {
  if (message.startsWith("timed out waiting for Claude Code reply")) return 504;
  if (message === "message body is required") return 400;
  if (message === "invalid JSON request body") return 400;
  if (message === 'JSON requests must include a string "message" field') return 400;
  if (message === "timeout_ms must be a positive integer") return 400;
  if (message.includes("exceeds")) return 413;
  return 500;
}
