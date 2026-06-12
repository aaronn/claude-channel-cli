#!/usr/bin/env node
import { Command } from "commander";
import { askClaude, tellClaude } from "./channel-client/client.js";
import { readChannelStatus } from "./channel-client/status.js";
import { TargetResolutionError } from "./channel-client/target-resolver.js";
import { resolveAskTimeoutMs } from "./channel-client/timeout.js";
import {
  exitCodeForAskStatus,
  parseAskOutputFormat,
  renderAskResponse,
  statusSummaryForAskStatus,
} from "./cli/ask-output.js";
import { readPromptInput } from "./cli/input.js";
import { formatAmbiguousTargets, formatEndpointList } from "./cli/list-format.js";
import { formatSetupMcpResult, setupMcp } from "./cli/setup-mcp.js";
import { startWaitFeedback } from "./cli/wait-feedback.js";
import { toEndpointCandidates } from "./registry/endpoint-record.js";
import { listLiveEndpoints } from "./registry/endpoint-store.js";
import { VERSION } from "./version.js";

type SendOptions = {
  sender?: string;
  to?: string;
};

type AskOptions = SendOptions & {
  output?: string;
  timeout?: string;
  timeoutMs?: string;
  progress?: boolean;
};

type ListOptions = {
  json?: boolean;
};

type SetupMcpCommandOptions = {
  scope?: string;
  dryRun?: boolean;
  force?: boolean;
};

async function list(options: ListOptions): Promise<void> {
  const candidates = toEndpointCandidates(await listLiveEndpoints());
  const output = options.json
    ? `${JSON.stringify({ targets: candidates }, null, 2)}\n`
    : formatEndpointList(candidates);
  process.stdout.write(output);
}

async function status(options: SendOptions): Promise<void> {
  const result = await readChannelStatus({ target: options.to });
  process.stdout.write(
    JSON.stringify(result.report, null, 2) + "\n",
  );
  if (!result.ok) process.exitCode = 1;
}

async function tell(message: string, options: SendOptions): Promise<void> {
  process.stdout.write(`${JSON.stringify(await tellClaude(message, {
    target: options.to,
    sender: options.sender,
  }))}\n`);
}

async function ask(message: string, options: AskOptions): Promise<void> {
  const outputFormat = parseAskOutputFormat(options.output);
  const resolvedTimeoutMs = resolveAskTimeoutMs(options);
  const feedback = options.progress === false ? undefined : startWaitFeedback({ timeoutMs: resolvedTimeoutMs });

  try {
    const response = await askClaude(message, {
      target: options.to,
      sender: options.sender,
      timeoutMs: resolvedTimeoutMs,
    });
    process.stdout.write(renderAskResponse(response, outputFormat));
    const summary = outputFormat === "text" ? statusSummaryForAskStatus(response.status) : undefined;
    if (summary) process.stderr.write(summary);
    process.exitCode = exitCodeForAskStatus(response.status);
  } finally {
    feedback?.stop();
  }
}

async function setupMcpCommand(options: SetupMcpCommandOptions): Promise<void> {
  process.stdout.write(formatSetupMcpResult(await setupMcp(options)));
}

const program = new Command();

program
  .name("claude-channel")
  .description("Send messages into a live Claude Code session through a local CLI channel.")
  .version(VERSION);

program
  .command("status")
  .description("Print channel connection state and health.")
  .option("--to <target>", "Claude Code endpoint id, unique display name, project path, or list index.")
  .action(async (options: SendOptions) => {
    try {
      await status(options);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("list")
  .description("List live Claude Code channel endpoints.")
  .option("--json", "Print machine-readable JSON.")
  .action(async (options: ListOptions) => {
    try {
      await list(options);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("setup-mcp")
  .description("Register the Claude channel MCP server with Claude Code.")
  .option("--scope <scope>", "Claude MCP scope: local or user. Defaults to local.")
  .option("--force", "Remove an existing claude-channel-cli MCP entry at that scope before adding it.")
  .option("--dry-run", "Print the Claude MCP command that would be run without changing config.")
  .action(async (options: SetupMcpCommandOptions) => {
    try {
      await setupMcpCommand(options);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("tell")
  .alias("send")
  .description("Send a one-way message into the running Claude Code session.")
  .argument("<message...>", "Message text.")
  .option("--to <target>", "Claude Code endpoint id, unique display name, project path, or list index.")
  .option("--sender <name>", "Sender metadata. Defaults to CLAUDE_CHANNEL_SENDER or codex.")
  .action(async (parts: string[], options: SendOptions) => {
    try {
      await tell(parts.join(" "), options);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("tell-file")
  .alias("send-file")
  .description("Send a file's contents into the running Claude Code session.")
  .argument("<file>", "File containing the message, or - for stdin.")
  .option("--to <target>", "Claude Code endpoint id, unique display name, project path, or list index.")
  .option("--sender <name>", "Sender metadata. Defaults to CLAUDE_CHANNEL_SENDER or codex.")
  .action(async (file: string, options: SendOptions) => {
    try {
      await tell(await readPromptInput(file), options);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("ask")
  .description("Send a request to Claude Code and wait for complete_channel_request.")
  .argument("<message...>", "Message text.")
  .option("--to <target>", "Claude Code endpoint id, unique display name, project path, or list index.")
  .option("--sender <name>", "Sender metadata. Defaults to CLAUDE_CHANNEL_SENDER or codex.")
  .option("-o, --output <format>", "Output format: text or json. Defaults to text.")
  .option("--timeout <duration>", "How long to wait, such as 30s, 30m, or 1800000ms.")
  .option("--timeout-ms <ms>", "How long to wait in milliseconds.")
  .option("--no-progress", "Disable waiting progress messages on stderr.")
  .action(async (parts: string[], options: AskOptions) => {
    try {
      await ask(parts.join(" "), options);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("ask-file")
  .description("Send a file's contents to Claude Code and wait for complete_channel_request.")
  .argument("<file>", "File containing the request, or - for stdin.")
  .option("--to <target>", "Claude Code endpoint id, unique display name, project path, or list index.")
  .option("--sender <name>", "Sender metadata. Defaults to CLAUDE_CHANNEL_SENDER or codex.")
  .option("-o, --output <format>", "Output format: text or json. Defaults to text.")
  .option("--timeout <duration>", "How long to wait, such as 30s, 30m, or 1800000ms.")
  .option("--timeout-ms <ms>", "How long to wait in milliseconds.")
  .option("--no-progress", "Disable waiting progress messages on stderr.")
  .action(async (file: string, options: AskOptions) => {
    try {
      await ask(await readPromptInput(file), options);
    } catch (error) {
      fail(error);
    }
  });

function fail(error: unknown): never {
  const message = error instanceof TargetResolutionError
    ? formatTargetResolutionError(error)
    : error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function formatTargetResolutionError(error: TargetResolutionError): string {
  if (error.code === "multiple_claude_targets") {
    return formatAmbiguousTargets(error.candidates);
  }
  if (error.candidates.length > 0) {
    return `${error.message}\n${formatEndpointList(error.candidates).trimEnd()}`;
  }
  return error.message;
}

await program.parseAsync(process.argv);
