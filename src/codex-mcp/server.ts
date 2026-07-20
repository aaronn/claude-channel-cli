import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { askClaude, type TargetedAskResponse } from "../channel-client/client.js";
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
import { VERSION } from "../version.js";

type JsonObject = Record<string, unknown>;

export type CodexChannelToolDeps = {
  list: () => Promise<{ targets: EndpointCandidate[] }>;
  status: (options: { target?: string }) => Promise<ChannelStatusResult>;
  ask: (message: string, options: { target?: string; sender?: string; timeoutMs: number }) => Promise<TargetedAskResponse>;
};

const LIST_TOOL = "list_claude_targets";
const STATUS_TOOL = "status_claude_channel";
const ASK_TOOL = "ask_claude";

const defaultDeps: CodexChannelToolDeps = {
  list: async () => ({ targets: toEndpointCandidates(await listLiveEndpoints()) }),
  status: (options) => readChannelStatus(options),
  ask: (message, options) => askClaude(message, options),
};

export function createCodexChannelMcpServer(deps: CodexChannelToolDeps = defaultDeps): Server {
  const server = new Server(
    { name: "claude-channel-cli-codex", version: VERSION },
    {
      capabilities: { tools: {} },
      instructions: [
        "Use these tools to communicate with the user's live Claude Code session through claude-channel-cli.",
        "Call list_claude_targets or status_claude_channel before ask_claude.",
        "Use ask_claude to ask Claude Code and receive the response as tool output.",
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
      description: "Check whether the local claude-channel-cli bridge is reachable.",
      inputSchema: {
        type: "object",
        properties: {
          target: targetSchema(),
        },
      },
    },
    {
      name: ASK_TOOL,
      description: "Ask Claude Code and wait for complete_channel_request.",
      inputSchema: askInputSchema(),
    },
  ];
}

export async function callCodexChannelTool(
  name: string,
  args: unknown,
  deps: CodexChannelToolDeps = defaultDeps,
): Promise<CallToolResult> {
  if (![LIST_TOOL, STATUS_TOOL, ASK_TOOL].includes(name)) {
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

function askInputSchema(): JsonObject {
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
    timeout_ms: {
      type: "integer",
      minimum: 1,
      description: "Optional timeout in milliseconds. Defaults to 30 minutes.",
    },
  };

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

function toolResult(data: JsonObject, isError = false): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data,
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
