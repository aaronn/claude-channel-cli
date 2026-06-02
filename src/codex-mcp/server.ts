import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { askClaude, tellClaude, type TargetedAskResponse, type TellResponse } from "../channel-client/client.js";
import { readChannelStatus, type ChannelStatusResult } from "../channel-client/status.js";
import { TargetResolutionError } from "../channel-client/target-resolver.js";
import { DEFAULT_ASK_TIMEOUT_MS } from "../config/defaults.js";
import { errorMessage } from "../errors.js";
import { toEndpointCandidates, type EndpointCandidate } from "../registry/endpoint-record.js";
import { listLiveEndpoints } from "../registry/endpoint-store.js";
import {
  readOptionalPositiveInteger,
  readOptionalString,
  readRecordObject,
  readRequiredString,
} from "../validation.js";

type JsonObject = Record<string, unknown>;
type StructuredToolPayload = object;

export type CodexChannelToolDeps = {
  list: () => Promise<{ targets: EndpointCandidate[] }>;
  status: (options: { target?: string }) => Promise<ChannelStatusResult>;
  tell: (message: string, options: { target?: string; sender?: string }) => Promise<TellResponse>;
  ask: (message: string, options: { target?: string; sender?: string; timeoutMs: number }) => Promise<TargetedAskResponse>;
};

const LIST_TOOL = "list_claude_targets";
const STATUS_TOOL = "status_claude_channel";
const TELL_TOOL = "tell_claude";
const ASK_TOOL = "ask_claude";

const defaultDeps: CodexChannelToolDeps = {
  list: async () => ({ targets: toEndpointCandidates(await listLiveEndpoints()) }),
  status: (options) => readChannelStatus(options),
  tell: (message, options) => tellClaude(message, options),
  ask: (message, options) => askClaude(message, options),
};

export function createCodexChannelMcpServer(deps: CodexChannelToolDeps = defaultDeps): Server {
  const server = new Server(
    { name: "claude-cli-channel-codex", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions: [
        "Use these tools to communicate with the user's live Claude Code session through claude-cli-channel.",
        "Call list_claude_targets or status_claude_channel before tell_claude or ask_claude.",
        "Use tell_claude only for one-way messages.",
        "Use ask_claude when Codex needs Claude Code's answer returned as tool output.",
      ].join(" "),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: listCodexChannelTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    return callCodexChannelTool(req.params.name, req.params.arguments, deps);
  });

  return server;
}

export function listCodexChannelTools(): Array<{
  name: string;
  description: string;
  inputSchema: JsonObject;
}> {
  return [
    {
      name: LIST_TOOL,
      description: "List live Claude Code channel targets.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: STATUS_TOOL,
      description: "Check whether the local claude-cli-channel bridge is reachable.",
      inputSchema: {
        type: "object",
        properties: {
          target: targetSchema(),
        },
      },
    },
    {
      name: TELL_TOOL,
      description: "Send a one-way message into the live Claude Code session.",
      inputSchema: messageInputSchema({ includeTimeout: false }),
    },
    {
      name: ASK_TOOL,
      description: "Send a request to Claude Code and wait for complete_channel_request.",
      inputSchema: messageInputSchema({ includeTimeout: true }),
    },
  ];
}

export async function callCodexChannelTool(
  name: string,
  args: unknown,
  deps: CodexChannelToolDeps = defaultDeps,
): Promise<CallToolResult> {
  if (![LIST_TOOL, STATUS_TOOL, TELL_TOOL, ASK_TOOL].includes(name)) {
    throw new Error(`unknown tool: ${name}`);
  }

  try {
    if (name === LIST_TOOL) {
      return toolResult(await deps.list());
    }

    if (name === STATUS_TOOL) {
      const input = parseTargetArgs(args);
      const status = await deps.status({ target: input.target });
      return toolResult(status.report, !status.ok);
    }

    if (name === TELL_TOOL) {
      const input = parseMessageArgs(args);
      return toolResult(await deps.tell(input.message, { target: input.target, sender: input.sender }));
    }

    if (name === ASK_TOOL) {
      const input = parseAskArgs(args);
      return toolResult(await deps.ask(input.message, {
        target: input.target,
        sender: input.sender,
        timeoutMs: input.timeoutMs,
      }));
    }
  } catch (error) {
    return toolResult(toolErrorPayload(error), true);
  }

  throw new Error(`unhandled tool: ${name}`);
}

function messageInputSchema(options: { includeTimeout: boolean }): JsonObject {
  const properties: JsonObject = {
    target: targetSchema(),
    message: {
      type: "string",
      description: "Exact Claude-facing message after Codex has removed any local handling instructions.",
    },
    sender: {
      type: "string",
      description: "Optional sender metadata. Defaults to codex.",
    },
  };

  if (options.includeTimeout) {
    properties.timeout_ms = {
      type: "integer",
      minimum: 1,
      description: "Optional timeout in milliseconds. Defaults to 30 minutes.",
    };
  }

  return {
    type: "object",
    properties,
    required: ["message"],
  };
}

function targetSchema(): JsonObject {
  return {
    type: "string",
    description: "Optional Claude Code endpoint id, unique display name, project path, or list index.",
  };
}

function parseTargetArgs(args: unknown): { target?: string } {
  const record = readToolArgsObject(args, { optional: true });
  return {
    target: readOptionalString(record, "target"),
  };
}

function parseMessageArgs(args: unknown): { target?: string; message: string; sender?: string } {
  const record = readToolArgsObject(args, { optional: false });
  return {
    target: readOptionalString(record, "target"),
    message: readRequiredString(record, "message"),
    sender: readOptionalString(record, "sender"),
  };
}

function parseAskArgs(args: unknown): { target?: string; message: string; sender?: string; timeoutMs: number } {
  const record = readToolArgsObject(args, { optional: false });
  return {
    target: readOptionalString(record, "target"),
    message: readRequiredString(record, "message"),
    sender: readOptionalString(record, "sender"),
    timeoutMs: readOptionalPositiveInteger(record, "timeout_ms", DEFAULT_ASK_TIMEOUT_MS),
  };
}

function readToolArgsObject(args: unknown, options: { optional: boolean }): Record<string, unknown> {
  if (args === undefined && options.optional) return {};
  return readRecordObject(args, "tool arguments must be an object");
}

function toolResult(data: StructuredToolPayload, isError = false): CallToolResult {
  const structuredContent = data as Record<string, unknown>;
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
    isError,
  };
}

function toolErrorPayload(error: unknown): JsonObject {
  if (error instanceof TargetResolutionError) {
    return {
      ok: false,
      error: error.code,
      message: error.message,
      candidates: error.candidates,
    };
  }

  return { ok: false, error: errorMessage(error) };
}
