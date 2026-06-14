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
  emitAsk: (requestId: string, content: string, meta?: ChannelEventMeta) => Promise<void>;
};

const COMPLETE_TOOL_NAME = "complete_channel_request";

export const CLAUDE_CHANNEL_INSTRUCTIONS = [
  'Events from claude-channel-cli arrive as <channel source="claude-channel-cli" ...>.',
  'Messages with reply_required="true" require a response back to the channel sender.',
  `To send that response, call ${COMPLETE_TOOL_NAME} with the request_id attribute from the matching channel message.`,
  "The answer argument is the response delivered to the channel sender.",
  "Text written only in the Claude Code conversation is not sent back to the channel sender.",
  'Use the completion tool only for the matching reply_required="true" channel request.',
].join(" ");

export function formatReplyRequiredChannelContent(requestId: string, content: string): string {
  if (!isRequestId(requestId)) {
    throw new Error(`invalid request_id: ${requestId}`);
  }

  return [
    "Channel Handling Instructions:",
    `This is a reply-required channel request with request_id="${requestId}".`,
    `The channel sender receives your response only if you call ${COMPLETE_TOOL_NAME} with request_id="${requestId}".`,
    "Set answer to the response for the channel sender and choose the appropriate status.",
    "A normal Claude Code reply is not delivered to the channel sender; it leaves the sender waiting until timeout.",
    `Call ${COMPLETE_TOOL_NAME} before finishing this response.`,
    "",
    "Incoming Channel Request:",
    content,
  ].join("\n");
}

export function createClaudeChannel(pendingRequests: PendingRequests): ClaudeChannel {
  const server = new Server(
    { name: "claude-channel-cli", version: VERSION },
    {
      capabilities: {
        experimental: { "claude/channel": {} },
        tools: {},
      },
      instructions: CLAUDE_CHANNEL_INSTRUCTIONS,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: COMPLETE_TOOL_NAME,
        description: "Send the final response for a reply-required channel request back to the channel sender.",
        inputSchema: {
          type: "object",
          properties: {
            request_id: {
              type: "string",
              description: "The request_id attribute from the matching reply-required channel message.",
            },
            status: {
              type: "string",
              enum: [...ASK_STATUSES],
              description: "Outcome of the channel request.",
            },
            answer: {
              type: "string",
              description: "Final response to deliver to the channel sender.",
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
    emitAsk: (requestId, content, meta = {}) =>
      emitChannelEvent(server, formatReplyRequiredChannelContent(requestId, content), {
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
        text: completed ? "Channel request completed." : "No pending channel request matched that request_id.",
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
