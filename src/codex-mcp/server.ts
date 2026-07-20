import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { chmod, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { askClaude, type TargetedAskResponse } from "../channel-client/client.js";
import { readChannelStatus, type ChannelStatusResult } from "../channel-client/status.js";
import { TargetResolutionError } from "../channel-client/target-resolver.js";
import { DEFAULT_ASK_TIMEOUT_MS } from "../config/defaults.js";
import { bridgeDir } from "../config/paths.js";
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
const INLINE_ASK_ANSWER_MAX_BYTES = 128_000;
const ASK_ANSWER_PREVIEW_CHARS = 8_000;
const CODEX_ANSWER_DIR_ENV = "CLAUDE_CHANNEL_CODEX_ANSWER_DIR";
const ANSWER_ARTIFACT_MAX_COUNT = 100;
const ANSWER_ARTIFACT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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
      return await askToolResult(await deps.ask(input.message, {
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

async function askToolResult(response: TargetedAskResponse): Promise<CallToolResult> {
  const answerBytes = Buffer.byteLength(response.answer, "utf8");
  if (answerBytes <= INLINE_ASK_ANSWER_MAX_BYTES) {
    return {
      content: [
        {
          type: "text",
          text: response.answer,
        },
      ],
      structuredContent: {
        ...response,
        answer_truncated: false,
        answer_bytes: answerBytes,
      },
      isError: false,
    };
  }

  const answerFile = await writeLargeAnswer(response);
  const answerPreview = previewAnswer(response.answer);
  const structuredContent = {
    ok: response.ok,
    target: response.target,
    request_id: response.request_id,
    status: response.status,
    answer_preview: answerPreview,
    answer_truncated: true,
    answer_bytes: answerBytes,
    answer_file: answerFile,
  };

  return {
    content: [
      {
        type: "text",
        text: [
          `Claude returned a large ${answerBytes} byte answer.`,
          `Full answer saved to: ${answerFile}`,
          "",
          "Preview:",
          answerPreview,
        ].join("\n"),
      },
    ],
    structuredContent,
    isError: false,
  };
}

async function writeLargeAnswer(response: TargetedAskResponse): Promise<string> {
  const dir = resolveCodexAnswerArtifactDir();
  await prepareAnswerArtifactDir(dir);
  const file = join(dir, `${response.request_id}.txt`);
  await writeFile(file, response.answer, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(file, 0o600);
  await pruneAnswerArtifacts(dir, file);
  return file;
}

export function resolveCodexAnswerArtifactDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[CODEX_ANSWER_DIR_ENV]?.trim();
  return configured && configured.length > 0 ? configured : join(bridgeDir, "codex-answers");
}

async function prepareAnswerArtifactDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // mkdir's mode only applies to newly created directories, so enforce it for configured existing directories too.
  await chmod(dir, 0o700);
}

async function pruneAnswerArtifacts(dir: string, currentFile: string, now = Date.now()): Promise<void> {
  const artifacts = await answerArtifacts(dir);
  const expired = new Set(
    artifacts
      .filter((artifact) => artifact.file !== currentFile && now - artifact.mtimeMs > ANSWER_ARTIFACT_MAX_AGE_MS)
      .map((artifact) => artifact.file),
  );

  for (const file of expired) {
    await rm(file, { force: true });
  }

  const retained = artifacts.filter((artifact) => !expired.has(artifact.file));
  const current = retained.find((artifact) => artifact.file === currentFile);
  const previous = retained
    .filter((artifact) => artifact.file !== currentFile)
    .sort((left, right) => right.mtimeMs - left.mtimeMs || left.file.localeCompare(right.file));
  const ordered = current ? [current, ...previous] : previous;

  for (const artifact of ordered.slice(ANSWER_ARTIFACT_MAX_COUNT)) {
    await rm(artifact.file, { force: true });
  }
}

async function answerArtifacts(dir: string): Promise<Array<{ file: string; mtimeMs: number }>> {
  const entries = await readdir(dir, { withFileTypes: true });
  const artifacts: Array<{ file: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^req_[A-Za-z0-9]+\.txt$/.test(entry.name)) continue;
    const file = join(dir, entry.name);
    try {
      artifacts.push({ file, mtimeMs: (await stat(file)).mtimeMs });
    } catch (error) {
      if (!isFileNotFoundError(error)) throw error;
    }
  }
  return artifacts;
}

function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT";
}

function previewAnswer(answer: string): string {
  if (answer.length <= ASK_ANSWER_PREVIEW_CHARS) return answer;
  return `${answer.slice(0, ASK_ANSWER_PREVIEW_CHARS)}\n\n[answer truncated; read answer_file for the full response]`;
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
