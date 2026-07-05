import { access, constants, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CLAUDE_MCP_SERVER_NAME = "claude-channel-cli";
export const CLAUDE_CHANNEL_SERVER_BIN = "claude-channel-server";
export const CLAUDE_CHANNEL_LAUNCH_COMMAND = "claude-channel start";
export const CLAUDE_CHANNEL_DEVELOPMENT_CHANNEL = `server:${CLAUDE_MCP_SERVER_NAME}`;
export const CLAUDE_CHANNEL_LAUNCH_MODE_ENV = "CLAUDE_CHANNEL_LAUNCH_MODE";
export const CLAUDE_CHANNEL_START_LAUNCH_MODE = "start";

export type ServerCommand = {
  command: string;
  args: string[];
};

export type PersistentClaudeMcpScope = "local" | "project" | "user";

export type PersistentClaudeMcpEntry = {
  scope: PersistentClaudeMcpScope;
  source: string;
  removeCommand: string;
};

export type PersistentClaudeMcpOptions = {
  cwd?: string;
  homeDir?: string;
};

export type ReceiverLaunchOptions = PersistentClaudeMcpOptions & {
  env?: NodeJS.ProcessEnv;
  findPersistentEntries?: () => Promise<PersistentClaudeMcpEntry[]>;
};

export async function resolveServerCommand(env: NodeJS.ProcessEnv = process.env): Promise<ServerCommand> {
  const bundledScript = bundledChannelScriptPath();
  if (await exists(bundledScript)) {
    return {
      command: process.execPath,
      args: [bundledScript],
    };
  }

  const installedBin = await findExecutableOnPath(CLAUDE_CHANNEL_SERVER_BIN, env);
  if (installedBin) return { command: CLAUDE_CHANNEL_SERVER_BIN, args: [] };

  return {
    command: process.execPath,
    args: [bundledScript],
  };
}

export function buildSessionMcpConfig(serverCommand: ServerCommand): string {
  return JSON.stringify({
    mcpServers: {
      [CLAUDE_MCP_SERVER_NAME]: {
        command: serverCommand.command,
        args: serverCommand.args,
        env: receiverLaunchEnv(),
      },
    },
  });
}

export function receiverLaunchEnv(): Record<string, string> {
  return {
    [CLAUDE_CHANNEL_LAUNCH_MODE_ENV]: CLAUDE_CHANNEL_START_LAUNCH_MODE,
  };
}

export async function assertClaudeChannelReceiverLaunch(options: ReceiverLaunchOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  if (env[CLAUDE_CHANNEL_LAUNCH_MODE_ENV] === CLAUDE_CHANNEL_START_LAUNCH_MODE) return;

  const entries = await (options.findPersistentEntries ?? (() => findPersistentClaudeMcpEntries(options)))();
  if (entries.length > 0) {
    throw new Error(formatPersistentClaudeMcpError(entries));
  }

  throw new Error([
    `${CLAUDE_MCP_SERVER_NAME} receiver was not started by ${CLAUDE_CHANNEL_LAUNCH_COMMAND}.`,
    "",
    `Start Claude Code with ${CLAUDE_CHANNEL_LAUNCH_COMMAND}.`,
    "If this receiver came from an old persistent MCP registration, run `claude-channel setup` in this project for the cleanup command.",
  ].join("\n"));
}

export async function findPersistentClaudeMcpEntries(
  options: PersistentClaudeMcpOptions = {},
): Promise<PersistentClaudeMcpEntry[]> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const homeDir = options.homeDir ?? homedir();
  const entries: PersistentClaudeMcpEntry[] = [];

  const claudeConfigPath = path.join(homeDir, ".claude.json");
  const claudeConfig = await readJsonIfExists(claudeConfigPath);
  if (claudeConfig) {
    if (hasNamedMcpServer(claudeConfig, CLAUDE_MCP_SERVER_NAME)) {
      entries.push(persistentEntry("user", claudeConfigPath));
    }

    const projects = readRecord(claudeConfig.projects);
    for (const [projectPath, projectConfig] of Object.entries(projects ?? {})) {
      if (path.resolve(projectPath) !== cwd) continue;
      if (hasNamedMcpServer(projectConfig, CLAUDE_MCP_SERVER_NAME)) {
        entries.push(persistentEntry("local", claudeConfigPath));
      }
    }
  }

  const projectMcpPath = path.join(cwd, ".mcp.json");
  const projectMcpConfig = await readJsonIfExists(projectMcpPath);
  if (hasNamedMcpServer(projectMcpConfig, CLAUDE_MCP_SERVER_NAME)) {
    entries.push(persistentEntry("project", projectMcpPath));
  }

  return entries;
}

export function formatPersistentClaudeMcpError(entries: PersistentClaudeMcpEntry[]): string {
  const removeCommands = entries.map((entry) => `  ${entry.removeCommand}`);
  return [
    `Persistent Claude MCP registration for ${CLAUDE_MCP_SERVER_NAME} detected.`,
    "",
    "claude-channel 0.4 uses session-scoped --mcp-config so normal `claude` launches are not polluted.",
    "Remove the old registration, then rerun the command:",
    ...removeCommands,
    "",
  ].join("\n");
}

export function formatShellCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

export async function findExecutableOnPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  const pathValue = env.PATH ?? env.Path ?? env.path;
  if (!pathValue) return undefined;

  const names = executableNames(command, env, platform);
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (await canExecute(candidate, platform)) return candidate;
    }
  }

  return undefined;
}

function persistentEntry(scope: PersistentClaudeMcpScope, source: string): PersistentClaudeMcpEntry {
  return {
    scope,
    source,
    removeCommand: formatShellCommand("claude", ["mcp", "remove", "--scope", scope, CLAUDE_MCP_SERVER_NAME]),
  };
}

async function readJsonIfExists(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function hasNamedMcpServer(value: unknown, name: string): boolean {
  const record = readRecord(value);
  const mcpServers = readRecord(record?.mcpServers);
  return Object.prototype.hasOwnProperty.call(mcpServers ?? {}, name);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function bundledChannelScriptPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../channel.js");
}

async function canExecute(file: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    await access(file, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function executableNames(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  if (platform !== "win32" || path.extname(command)) return [command];
  const pathExt = env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  return pathExt.split(";").filter(Boolean).map((extension) => `${command}${extension.toLowerCase()}`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
