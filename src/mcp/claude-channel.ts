import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { PendingRequests } from "../pending-requests.js";
import { buildChannelMeta, isRequestId, type AskStatus, type ChannelEventMeta } from "../protocol.js";

export type ClaudeChannel = {
  server: Server;
  emitTell: (content: string, meta?: ChannelEventMeta) => Promise<void>;
  emitAsk: (requestId: string, content: string, meta?: ChannelEventMeta) => Promise<void>;
};

const COMPLETE_TOOL_NAME = "complete_channel_request";

export function createClaudeChannel(pendingRequests: PendingRequests): ClaudeChannel {
  const server = new Server(
    { name: "claude-cli-channel", version: "0.1.0" },
    {
      capabilities: {
        experimental: { "claude/channel": {} },
        tools: {},
      },
      instructions: [
        'Events from claude-cli-channel arrive as <channel source="claude-cli-channel" ...>.',
        'Messages with reply_required="true" are synchronous requests from Codex.',
        `When the work is complete, call ${COMPLETE_TOOL_NAME} with the request_id and final answer.`,
        "Do not call the completion tool for unrelated manual user messages.",
      ].join(" "),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: COMPLETE_TOOL_NAME,
        description: "Complete a pending Codex request that arrived through the claude-cli-channel channel.",
        inputSchema: {
          type: "object",
          properties: {
            request_id: {
              type: "string",
              description: "The request_id attribute from the claude-cli-channel message.",
            },
            status: {
              type: "string",
              enum: ["answered", "needs_user", "declined", "failed"],
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

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name !== COMPLETE_TOOL_NAME) {
      throw new Error(`unknown tool: ${req.params.name}`);
    }

    const args = parseCompletionArgs(req.params.arguments);
    const completed = pendingRequests.complete({
      requestId: args.request_id,
      status: args.status,
      answer: args.answer,
    });

    return {
      content: [
        {
          type: "text",
          text: completed ? "Codex request completed." : "No pending Codex request matched that request_id.",
        },
      ],
    };
  });

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
  if (typeof args !== "object" || args === null) {
    throw new Error("completion arguments must be an object");
  }

  const record = args as Record<string, unknown>;
  const requestId = readString(record, "request_id");
  const status = readString(record, "status") as AskStatus;
  const answer = readString(record, "answer");

  if (!["answered", "needs_user", "declined", "failed"].includes(status)) {
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

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}
