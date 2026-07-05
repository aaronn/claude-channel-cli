import type { ChildProcess, SpawnOptions } from "node:child_process";
import { foregroundChild } from "foreground-child";
import {
  assertNoPersistentClaudeMcpProblems,
  buildSessionMcpConfig,
  CLAUDE_CHANNEL_DEVELOPMENT_CHANNEL,
  findExecutableOnPath,
  inspectPersistentClaudeMcp,
  resolveServerCommand,
  type PersistentClaudeMcpInspection,
  type ServerCommand,
} from "./claude-mcp.js";

const CLAUDE_COMMAND = "claude";

type ForegroundChildFn = (program: string, args: string[], spawnOptions: SpawnOptions) => ChildProcess;

export type StartClaudeOptions = {
  env?: NodeJS.ProcessEnv;
  resolveServerCommand?: () => Promise<ServerCommand>;
  inspectPersistentEntries?: () => Promise<PersistentClaudeMcpInspection>;
  launchClaude?: (args: string[]) => Promise<never>;
};

export type LaunchClaudeForegroundOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  findExecutable?: typeof findExecutableOnPath;
  foregroundChild?: ForegroundChildFn;
};

export function buildClaudeStartArgs(
  serverCommand: ServerCommand,
  args: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return [
    `--mcp-config=${buildSessionMcpConfig(serverCommand, env)}`,
    "--dangerously-load-development-channels",
    CLAUDE_CHANNEL_DEVELOPMENT_CHANNEL,
    ...args,
  ];
}

export async function startClaude(args: string[] = [], options: StartClaudeOptions = {}): Promise<never> {
  const env = options.env ?? process.env;
  assertNoPersistentClaudeMcpProblems(
    await (options.inspectPersistentEntries ?? inspectPersistentClaudeMcp)(),
  );

  const serverCommand = await (options.resolveServerCommand ?? resolveServerCommand)();
  const claudeArgs = buildClaudeStartArgs(serverCommand, args, env);
  return await (options.launchClaude ?? ((args) => launchClaudeForeground(args, { env })))(claudeArgs);
}

export async function launchClaudeForeground(
  args: string[],
  options: LaunchClaudeForegroundOptions = {},
): Promise<never> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const executable = await (options.findExecutable ?? findExecutableOnPath)(CLAUDE_COMMAND, env, platform);
  if (!executable) {
    throw new Error("Claude Code CLI (`claude`) not found on PATH.");
  }

  const spawnOptions: SpawnOptions = {
    env,
    shell: shouldUseWindowsCommandShell(executable, platform),
    stdio: "inherit",
  };

  return new Promise<never>((_resolve, reject) => {
    let child: ChildProcess;
    try {
      child = (options.foregroundChild ?? foregroundChild)(executable, args, spawnOptions);
    } catch (error) {
      reject(formatClaudeLaunchError(error));
      return;
    }

    child.once("error", (error) => {
      reject(formatClaudeLaunchError(error));
    });
  });
}

function shouldUseWindowsCommandShell(executable: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" && /\.(?:cmd|bat)$/i.test(executable);
}

function formatClaudeLaunchError(error: unknown): Error {
  if (isNodeError(error) && error.code === "ENOENT") {
    return new Error("Claude Code CLI (`claude`) not found on PATH.");
  }

  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Failed to start Claude Code CLI (\`claude\`): ${message}`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
