#!/usr/bin/env node
import { Command } from "commander";
import { askClaude, tellClaude } from "./channel-client/client.js";
import { readChannelStatus } from "./channel-client/status.js";
import { TargetResolutionError } from "./channel-client/target-resolver.js";
import { resolveAskTimeoutMs } from "./channel-client/timeout.js";
import { readPromptInput } from "./cli/input.js";
import { formatAmbiguousTargets, formatEndpointList } from "./cli/list-format.js";
import { startWaitFeedback } from "./cli/wait-feedback.js";
import { tokenPath } from "./config/paths.js";
import { toEndpointCandidates } from "./registry/endpoint-record.js";
import { endpointsDir, listLiveEndpoints } from "./registry/endpoint-store.js";

type SendOptions = {
  sender?: string;
  json?: boolean;
  to?: string;
};

type AskOptions = SendOptions & {
  timeout?: string;
  timeoutMs?: string;
  progress?: boolean;
};

type ListOptions = {
  json?: boolean;
};

async function list(options: ListOptions): Promise<void> {
  const candidates = toEndpointCandidates(await listLiveEndpoints());
  const output = options.json
    ? `${JSON.stringify({ targets: candidates }, null, 2)}\n`
    : formatEndpointList(candidates);
  process.stdout.write(output);
}

async function status(options: SendOptions): Promise<void> {
  const result = await readChannelStatus({ target: options.to, endpointsPath: endpointsDir, tokenPath });
  process.stdout.write(
    JSON.stringify(result.report, null, 2) + "\n",
  );
  if (!result.ok) process.exitCode = 1;
}

async function tell(message: string, options: SendOptions): Promise<void> {
  process.stdout.write(`${JSON.stringify(await tellClaude(message, { ...options, target: options.to }))}\n`);
}

async function ask(message: string, options: AskOptions): Promise<void> {
  const resolvedTimeoutMs = resolveAskTimeoutMs(options);
  const feedback = options.progress === false ? undefined : startWaitFeedback({ timeoutMs: resolvedTimeoutMs });

  try {
    const response = await askClaude(message, {
      ...options,
      target: options.to,
      timeoutMs: resolvedTimeoutMs,
    });
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } finally {
    feedback?.stop();
  }
}

const program = new Command();

program
  .name("claude-channel")
  .description("Send messages into a live Claude Code session through a local CLI channel.")
  .version("0.1.0");

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
  .command("tell")
  .description("Send a one-way message into the running Claude Code session.")
  .argument("<message...>", "Message text.")
  .option("--to <target>", "Claude Code endpoint id, unique display name, project path, or list index.")
  .option("--sender <name>", "Sender metadata. Defaults to CLAUDE_CHANNEL_SENDER or codex.")
  .option("--json", "Send as an application/json payload.")
  .action(async (parts: string[], options: SendOptions) => {
    try {
      await tell(parts.join(" "), options);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("send")
  .description("Alias for tell.")
  .argument("<message...>", "Message text.")
  .option("--to <target>", "Claude Code endpoint id, unique display name, project path, or list index.")
  .option("--sender <name>", "Sender metadata. Defaults to CLAUDE_CHANNEL_SENDER or codex.")
  .option("--json", "Send as an application/json payload.")
  .action(async (parts: string[], options: SendOptions) => {
    try {
      await tell(parts.join(" "), options);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("tell-file")
  .description("Send a file's contents into the running Claude Code session.")
  .argument("<file>", "File containing the message, or - for stdin.")
  .option("--to <target>", "Claude Code endpoint id, unique display name, project path, or list index.")
  .option("--sender <name>", "Sender metadata. Defaults to CLAUDE_CHANNEL_SENDER or codex.")
  .option("--json", "Send as an application/json payload.")
  .action(async (file: string, options: SendOptions) => {
    try {
      await tell(await readPromptInput(file), options);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("send-file")
  .description("Alias for tell-file.")
  .argument("<file>", "File containing the message, or - for stdin.")
  .option("--to <target>", "Claude Code endpoint id, unique display name, project path, or list index.")
  .option("--sender <name>", "Sender metadata. Defaults to CLAUDE_CHANNEL_SENDER or codex.")
  .option("--json", "Send as an application/json payload.")
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
  .option("--json", "Send as an application/json payload.")
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
  .option("--json", "Send as an application/json payload.")
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
