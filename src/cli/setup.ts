import {
  assertPersistentClaudeMcpClean,
  CLAUDE_CHANNEL_LAUNCH_COMMAND,
  inspectPersistentClaudeMcp,
  formatShellCommand,
  resolveServerCommand,
  type PersistentClaudeMcpInspection,
  type ServerCommand,
} from "./claude-mcp.js";
import { resolveClaudeExecutable } from "./claude-process.js";

export type SetupOptions = {
  resolveServerCommand?: () => Promise<ServerCommand>;
  resolveClaudeExecutable?: () => Promise<string>;
  inspectPersistentClaudeMcp?: () => Promise<PersistentClaudeMcpInspection>;
};

export type SetupResult = {
  serverCommand: ServerCommand;
};

export async function setup(options: SetupOptions = {}): Promise<SetupResult> {
  const inspection = await (options.inspectPersistentClaudeMcp ?? inspectPersistentClaudeMcp)();
  assertPersistentClaudeMcpClean(inspection);
  await (options.resolveClaudeExecutable ?? resolveClaudeExecutable)();

  return {
    serverCommand: await (options.resolveServerCommand ?? resolveServerCommand)(),
  };
}

export function formatSetupResult(result: SetupResult): string {
  return [
    "Claude Channel setup check passed.",
    "",
    "Start Claude Code with:",
    CLAUDE_CHANNEL_LAUNCH_COMMAND,
    "",
    "No persistent Claude MCP registration was written; ordinary `claude` launches are unchanged.",
    `Receiver command: ${formatShellCommand(result.serverCommand.command, result.serverCommand.args)}`,
    "",
  ].join("\n");
}
