#!/usr/bin/env node
import { Command } from "commander";
import { postChannelMessage } from "./cli/client.js";
import { readPromptInput } from "./cli/input.js";
import { readChannelStatus } from "./cli/status.js";
import { resolveAskTimeoutMs } from "./cli/timeout.js";
import { startWaitFeedback } from "./cli/wait-feedback.js";
import { statePath, tokenPath } from "./config/paths.js";

type SendOptions = {
  sender?: string;
  json?: boolean;
};

type AskOptions = SendOptions & {
  timeout?: string;
  timeoutMs?: string;
  progress?: boolean;
};

async function status(): Promise<void> {
  const result = await readChannelStatus({ statePath, tokenPath });
  process.stdout.write(
    JSON.stringify(result.report, null, 2) + "\n",
  );
  if (!result.ok) process.exitCode = 1;
}

async function send(path: "/tell" | "/ask", message: string, options: SendOptions): Promise<string> {
  const response = await postChannelMessage(path, message, options);

  if (!response.ok) {
    throw new Error(`send failed: HTTP ${response.status} ${await response.text()}`);
  }

  return response.text();
}

async function tell(message: string, options: SendOptions): Promise<void> {
  process.stdout.write(`${await send("/tell", message, options)}\n`);
}

async function ask(message: string, options: AskOptions): Promise<void> {
  const resolvedTimeoutMs = resolveAskTimeoutMs(options);
  const feedback = options.progress === false ? undefined : startWaitFeedback({ timeoutMs: resolvedTimeoutMs });

  try {
    const response = await postChannelMessage("/ask", message, {
      ...options,
      searchParams: new URLSearchParams({ timeout_ms: String(resolvedTimeoutMs) }),
    });

    if (!response.ok) {
      throw new Error(`ask failed: HTTP ${response.status} ${await response.text()}`);
    }

    process.stdout.write(`${await response.text()}\n`);
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
  .action(async () => {
    try {
      await status();
    } catch (error) {
      fail(error);
    }
  });

program
  .command("tell")
  .description("Send a one-way message into the running Claude Code session.")
  .argument("<message...>", "Message text.")
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
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

await program.parseAsync(process.argv);
