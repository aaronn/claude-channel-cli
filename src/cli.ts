#!/usr/bin/env node
import { Command } from "commander";
import { askClaude, renameClaudeDisplayName } from "./channel-client/client.js";
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
import { formatSetupCodexPluginResult, setupCodexPlugin } from "./cli/setup-codex-plugin.js";
import { formatSetupMcpResult, setupMcp } from "./cli/setup-mcp.js";
import { startWaitFeedback } from "./cli/wait-feedback.js";
import { toEndpointCandidates } from "./registry/endpoint-record.js";
import { listLiveEndpoints } from "./registry/endpoint-store.js";
import { VERSION } from "./version.js";

type ChannelTargetOptions = {
  sender?: string;
  to?: string;
};

type AskOptions = ChannelTargetOptions & {
  output?: string;
  timeout?: string;
  timeoutMs?: string;
  progress?: boolean;
};

type ListOptions = {
  json?: boolean;
};

type RenameOptions = {
  to: string;
};

type SetupMcpCommandOptions = {
  scope?: string;
  dryRun?: boolean;
  force?: boolean;
};

type SetupCodexPluginCommandOptions = {
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

async function status(options: ChannelTargetOptions): Promise<void> {
  const result = await readChannelStatus({ target: options.to });
  process.stdout.write(
    JSON.stringify(result.report, null, 2) + "\n",
  );
  if (!result.ok) process.exitCode = 1;
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

async function rename(displayName: string, options: RenameOptions): Promise<void> {
  const result = await renameClaudeDisplayName(displayName, { target: options.to });
  process.stdout.write(`Renamed ${result.target} to ${result.display_name}\n`);
}

async function setupMcpCommand(options: SetupMcpCommandOptions): Promise<void> {
  process.stdout.write(formatSetupMcpResult(await setupMcp(options)));
}

async function setupCodexPluginCommand(options: SetupCodexPluginCommandOptions): Promise<void> {
  process.stdout.write(formatSetupCodexPluginResult(await setupCodexPlugin(options)));
}

const program = new Command();

program
  .name("claude-channel")
  .description("Ask a live Claude Code session through a local CLI channel.")
  .version(VERSION);

program
  .command("status")
  .description("Print channel connection state and health.")
  .option("--to <target>", "Claude Code endpoint id, unique display name, project path, or list index.")
  .action(async (options: ChannelTargetOptions) => {
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
  .command("setup-codex-plugin")
  .description("Register the bundled Codex Desktop plugin in the personal marketplace.")
  .option("--force", "Replace an existing claude-channel-cli symlink when safe.")
  .option("--dry-run", "Print the Codex plugin setup changes without writing files.")
  .action(async (options: SetupCodexPluginCommandOptions) => {
    try {
      await setupCodexPluginCommand(options);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("ask")
  .description("Ask Claude Code and wait for complete_channel_request.")
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
  .description("Ask Claude Code with a file's contents and wait for complete_channel_request.")
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

program
  .command("rename")
  .description("Rename a live Claude Code channel target.")
  .requiredOption("--to <target>", "Claude Code endpoint id, unique display name, project path, or list index.")
  .argument("<display-name...>", "New display name.")
  .action(async (parts: string[], options: RenameOptions) => {
    try {
      await rename(parts.join(" "), options);
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
