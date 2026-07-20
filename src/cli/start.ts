import {
  assertPersistentClaudeMcpClean,
  buildSessionMcpConfig,
  CLAUDE_CHANNEL_DEVELOPMENT_CHANNEL,
  inspectPersistentClaudeMcp,
  resolveServerCommand,
  type PersistentClaudeMcpInspection,
  type ServerCommand,
} from "./claude-mcp.js";
import { launchClaudeForeground } from "./claude-process.js";

export type StartClaudeOptions = {
  env?: NodeJS.ProcessEnv;
  resolveServerCommand?: () => Promise<ServerCommand>;
  inspectPersistentClaudeMcp?: () => Promise<PersistentClaudeMcpInspection>;
  launchClaude?: (args: string[]) => Promise<never>;
};

export function buildClaudeStartArgs(
  serverCommand: ServerCommand,
  args: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return [
    `--mcp-config=${buildSessionMcpConfig(serverCommand, env)}`,
    `--dangerously-load-development-channels=${CLAUDE_CHANNEL_DEVELOPMENT_CHANNEL}`,
    ...args,
  ];
}

export async function startClaude(args: string[] = [], options: StartClaudeOptions = {}): Promise<never> {
  const env = options.env ?? process.env;
  const inspection = await (options.inspectPersistentClaudeMcp ?? inspectPersistentClaudeMcp)();
  assertPersistentClaudeMcpClean(inspection);

  const serverCommand = await (options.resolveServerCommand ?? resolveServerCommand)();
  const claudeArgs = buildClaudeStartArgs(serverCommand, args, env);
  return await (options.launchClaude ?? ((args) => launchClaudeForeground(args, { env })))(claudeArgs);
}
