import { spawn } from "node:child_process";
import {
  buildSessionMcpConfig,
  CLAUDE_CHANNEL_DEVELOPMENT_CHANNEL,
  findPersistentClaudeMcpEntries,
  formatPersistentClaudeMcpError,
  formatShellCommand,
  resolveServerCommand,
  type PersistentClaudeMcpEntry,
  type ServerCommand,
} from "./claude-mcp.js";

export type StartClaudeOptions = {
  resolveServerCommand?: () => Promise<ServerCommand>;
  findPersistentEntries?: () => Promise<PersistentClaudeMcpEntry[]>;
};

export function buildClaudeStartArgs(serverCommand: ServerCommand, args: string[] = []): string[] {
  return [
    `--mcp-config=${buildSessionMcpConfig(serverCommand)}`,
    "--dangerously-load-development-channels",
    CLAUDE_CHANNEL_DEVELOPMENT_CHANNEL,
    ...args,
  ];
}

export function formatNativeStartCommand(serverCommand: ServerCommand, args: string[] = []): string {
  return formatShellCommand("claude", buildClaudeStartArgs(serverCommand, args));
}

export async function startClaude(args: string[] = [], options: StartClaudeOptions = {}): Promise<never> {
  const entries = await (options.findPersistentEntries ?? findPersistentClaudeMcpEntries)();
  if (entries.length > 0) {
    throw new Error(formatPersistentClaudeMcpError(entries));
  }

  const serverCommand = await (options.resolveServerCommand ?? resolveServerCommand)();
  const child = spawn("claude", buildClaudeStartArgs(serverCommand, args), {
    stdio: "inherit",
  });

  const ignoreSignal = (): void => undefined;
  process.on("SIGINT", ignoreSignal);
  process.on("SIGTERM", ignoreSignal);

  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          reject(new Error("Claude Code CLI (`claude`) not found on PATH."));
        } else {
          reject(error);
        }
      });
      child.once("close", resolve);
    });

    process.exit(code ?? 1);
  } finally {
    process.off("SIGINT", ignoreSignal);
    process.off("SIGTERM", ignoreSignal);
  }
}
