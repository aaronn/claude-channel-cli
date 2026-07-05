import { foregroundChild } from "foreground-child";
import {
  buildSessionMcpConfig,
  CLAUDE_CHANNEL_DEVELOPMENT_CHANNEL,
  findPersistentClaudeMcpEntries,
  findExecutableOnPath,
  formatPersistentClaudeMcpError,
  formatShellCommand,
  resolveServerCommand,
  type PersistentClaudeMcpEntry,
  type ServerCommand,
} from "./claude-mcp.js";

const CLAUDE_COMMAND = "claude";

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
  return formatShellCommand(CLAUDE_COMMAND, buildClaudeStartArgs(serverCommand, args));
}

export async function startClaude(args: string[] = [], options: StartClaudeOptions = {}): Promise<never> {
  const entries = await (options.findPersistentEntries ?? findPersistentClaudeMcpEntries)();
  if (entries.length > 0) {
    throw new Error(formatPersistentClaudeMcpError(entries));
  }

  const serverCommand = await (options.resolveServerCommand ?? resolveServerCommand)();
  if (!await findExecutableOnPath(CLAUDE_COMMAND)) {
    throw new Error("Claude Code CLI (`claude`) not found on PATH.");
  }

  foregroundChild(CLAUDE_COMMAND, buildClaudeStartArgs(serverCommand, args), {
    stdio: "inherit",
  });
  return new Promise<never>(() => undefined);
}
