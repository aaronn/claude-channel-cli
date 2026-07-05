import {
  CLAUDE_CHANNEL_LAUNCH_COMMAND,
  findPersistentClaudeMcpEntries,
  formatPersistentClaudeMcpError,
  formatShellCommand,
  resolveServerCommand,
  type PersistentClaudeMcpEntry,
  type ServerCommand,
} from "./claude-mcp.js";

export type SetupOptions = {
  dryRun?: boolean;
  resolveServerCommand?: () => Promise<ServerCommand>;
  findPersistentEntries?: () => Promise<PersistentClaudeMcpEntry[]>;
};

export type SetupResult = {
  dryRun: boolean;
  serverCommand: ServerCommand;
};

export async function setup(options: SetupOptions = {}): Promise<SetupResult> {
  const entries = await (options.findPersistentEntries ?? findPersistentClaudeMcpEntries)();
  if (entries.length > 0) {
    throw new Error(formatPersistentClaudeMcpError(entries));
  }

  return {
    dryRun: options.dryRun === true,
    serverCommand: await (options.resolveServerCommand ?? resolveServerCommand)(),
  };
}

export function formatSetupResult(result: SetupResult): string {
  return [
    result.dryRun ? "Claude Channel setup check passed." : "Claude Channel is ready.",
    "",
    "Start Claude Code with:",
    CLAUDE_CHANNEL_LAUNCH_COMMAND,
    "",
    "No persistent Claude MCP registration was written; ordinary `claude` launches are unchanged.",
    `Receiver command: ${formatShellCommand(result.serverCommand.command, result.serverCommand.args)}`,
    "",
  ].join("\n");
}
