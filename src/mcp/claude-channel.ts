import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { PendingRequests } from "../pending-requests.js";
import {
  ASK_STATUSES,
  buildChannelMeta,
  isAskStatus,
  isRequestId,
  type AskStatus,
  type ChannelEventMeta,
} from "../protocol.js";
import { readRecordObject, readRequiredString } from "../validation.js";
import { VERSION } from "../version.js";

export type ClaudeChannel = {
  server: Server;
  emitTell: (content: string, meta?: ChannelEventMeta) => Promise<void>;
  emitAsk: (requestId: string, content: string, meta?: ChannelEventMeta) => Promise<void>;
};

const COMPLETE_TOOL_NAME = "complete_channel_request";

export function createClaudeChannel(pendingRequests: PendingRequests): ClaudeChannel {
  const server = new Server(
    { name: "claude-channel-cli", version: VERSION },
    {
      capabilities: {
        experimental: { "claude/channel": {} },
        tools: {},
      },
      instructions: [
        'Events from claude-channel-cli arrive as <channel source="claude-channel-cli" ...>.',
        'Messages with reply_required="true" are synchronous requests from Codex.',
        `When the work is complete, call ${COMPLETE_TOOL_NAME} with the request_id and final answer.`,
        "Do not call the completion tool for unrelated manual user messages.",
      ].join(" "),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: COMPLETE_TOOL_NAME,
        description: "Complete a pending Codex request that arrived through the claude-channel-cli channel.",
        inputSchema: {
          type: "object",
          properties: {
            request_id: {
              type: "string",
              description: "The request_id attribute from the claude-channel-cli message.",
            },
            status: {
              type: "string",
              enum: [...ASK_STATUSES],
              description: "Outcome of the request.",
            },
            answer: {
              type: "string",
              description: "Final answer to return to Codex.",
            },
          },
          required: ["request_id", "status", "answer"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, (req) =>
    callClaudeChannelTool(req.params.name, req.params.arguments, pendingRequests));

  return {
    server,
    emitTell: (content, meta = {}) => emitChannelEvent(server, content, {
      ...meta,
      reply_required: "false",
    }),
    emitAsk: (requestId, content, meta = {}) => emitChannelEvent(server, content, {
      ...meta,
      request_id: requestId,
      reply_required: "true",
    }),
  };
}

export function callClaudeChannelTool(
  name: string,
  args: unknown,
  pendingRequests: PendingRequests,
): CallToolResult {
  if (name !== COMPLETE_TOOL_NAME) {
    throw new Error(`unknown tool: ${name}`);
  }

  const completion = parseCompletionArgs(args);
  const completed = pendingRequests.complete({
    requestId: completion.request_id,
    status: completion.status,
    answer: completion.answer,
  });

  return {
    content: [
      {
        type: "text",
        text: completed ? "Codex request completed." : "No pending Codex request matched that request_id.",
      },
    ],
  };
}

async function emitChannelEvent(
  server: Server,
  content: string,
  meta: ChannelEventMeta,
): Promise<void> {
  await server.notification({
    method: "notifications/claude/channel",
    params: {
      content,
      meta: buildChannelMeta(meta),
    },
  });
}

function parseCompletionArgs(args: unknown): { request_id: string; status: AskStatus; answer: string } {
  const record = readRecordObject(args, "completion arguments must be an object");
  const requestId = readRequiredString(record, "request_id", { trim: true });
  const status = readRequiredString(record, "status", { trim: true });
  const answer = readRequiredString(record, "answer");

  if (!isAskStatus(status)) {
    throw new Error(`invalid completion status: ${status}`);
  }

  if (!isRequestId(requestId)) {
    throw new Error(`invalid request_id: ${requestId}`);
  }

  return {
    request_id: requestId,
    status,
    answer,
  };
}
