import { access, constants, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CLAUDE_MCP_SERVER_NAME = "claude-channel-cli";
export const CLAUDE_CHANNEL_SERVER_BIN = "claude-channel-server";
export const CLAUDE_CHANNEL_LAUNCH_COMMAND = "claude-channel start";
export const CLAUDE_CHANNEL_DEVELOPMENT_CHANNEL = `server:${CLAUDE_MCP_SERVER_NAME}`;
export const CLAUDE_CHANNEL_RECEIVER_LAUNCH_ARG = "--claude-channel-receiver-launch=start";

const RECEIVER_RUNTIME_ENV_KEYS = [
  "CLAUDE_CHANNEL_HOST",
  "CLAUDE_CHANNEL_PORT",
  "CLAUDE_CHANNEL_MAX_BODY_BYTES",
  "CLAUDE_CHANNEL_ASK_TIMEOUT_MS",
  "CLAUDE_CHANNEL_DISPLAY_NAME",
  "CLAUDE_CHANNEL_PROJECT_DIR",
] as const;

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

export type PersistentClaudeMcpInspectionError = {
  source: string;
  message: string;
};

export type PersistentClaudeMcpInspection = {
  entries: PersistentClaudeMcpEntry[];
  errors: PersistentClaudeMcpInspectionError[];
};

export type PersistentClaudeMcpOptions = {
  cwd?: string;
  homeDir?: string;
};

export type ReceiverLaunchOptions = PersistentClaudeMcpOptions & {
  argv?: string[];
  inspectPersistentEntries?: () => Promise<PersistentClaudeMcpInspection>;
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

export function buildSessionMcpConfig(
  serverCommand: ServerCommand,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return JSON.stringify({
    mcpServers: {
      [CLAUDE_MCP_SERVER_NAME]: {
        command: serverCommand.command,
        args: receiverLaunchArgs(serverCommand.args),
        env: receiverRuntimeEnv(env),
      },
    },
  });
}

export function receiverLaunchArgs(args: string[] = []): string[] {
  return [...args, CLAUDE_CHANNEL_RECEIVER_LAUNCH_ARG];
}

export function receiverRuntimeEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const runtimeEnv: Record<string, string> = {};
  for (const key of RECEIVER_RUNTIME_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined) runtimeEnv[key] = value;
  }
  return runtimeEnv;
}

export async function assertClaudeChannelReceiverLaunch(options: ReceiverLaunchOptions = {}): Promise<void> {
  const argv = options.argv ?? process.argv.slice(2);
  if (argv.includes(CLAUDE_CHANNEL_RECEIVER_LAUNCH_ARG)) return;

  const inspection = await (options.inspectPersistentEntries ?? (() => inspectPersistentClaudeMcp(options)))();
  assertNoPersistentClaudeMcpProblems(inspection);

  throw new Error([
    `${CLAUDE_MCP_SERVER_NAME} receiver was not started by ${CLAUDE_CHANNEL_LAUNCH_COMMAND}.`,
    "",
    `Start Claude Code with ${CLAUDE_CHANNEL_LAUNCH_COMMAND}.`,
    "If this receiver came from an old persistent MCP registration, run `claude-channel setup` in this project for the cleanup command.",
  ].join("\n"));
}

export async function inspectPersistentClaudeMcp(
  options: PersistentClaudeMcpOptions = {},
): Promise<PersistentClaudeMcpInspection> {
  const cwd = await canonicalPath(options.cwd ?? process.cwd());
  const homeDir = options.homeDir ?? homedir();
  const entries: PersistentClaudeMcpEntry[] = [];
  const errors: PersistentClaudeMcpInspectionError[] = [];

  const claudeConfigPath = path.join(homeDir, ".claude.json");
  const claudeConfig = await readJsonFile(claudeConfigPath);
  if (!claudeConfig.ok) {
    errors.push(claudeConfig.error);
  } else if (claudeConfig.value) {
    if (hasNamedMcpServer(claudeConfig.value, CLAUDE_MCP_SERVER_NAME)) {
      entries.push(persistentEntry("user", claudeConfigPath));
    }

    const projects = readRecord(claudeConfig.value.projects);
    for (const [projectPath, projectConfig] of Object.entries(projects ?? {})) {
      if (await canonicalPath(projectPath) !== cwd) continue;
      if (hasNamedMcpServer(projectConfig, CLAUDE_MCP_SERVER_NAME)) {
        entries.push(persistentEntry("local", claudeConfigPath));
      }
    }
  }

  const projectMcpPath = path.join(cwd, ".mcp.json");
  const projectMcpConfig = await readJsonFile(projectMcpPath);
  if (!projectMcpConfig.ok) {
    errors.push(projectMcpConfig.error);
  } else if (hasNamedMcpServer(projectMcpConfig.value, CLAUDE_MCP_SERVER_NAME)) {
    entries.push(persistentEntry("project", projectMcpPath));
  }

  return { entries, errors };
}

export async function findPersistentClaudeMcpEntries(
  options: PersistentClaudeMcpOptions = {},
): Promise<PersistentClaudeMcpEntry[]> {
  const inspection = await inspectPersistentClaudeMcp(options);
  if (inspection.errors.length > 0) {
    throw new Error(formatPersistentClaudeMcpInspectionError(inspection.errors));
  }
  return inspection.entries;
}

export function assertNoPersistentClaudeMcpProblems(inspection: PersistentClaudeMcpInspection): void {
  if (inspection.errors.length > 0) {
    throw new Error(formatPersistentClaudeMcpInspectionError(inspection.errors));
  }
  if (inspection.entries.length > 0) {
    throw new Error(formatPersistentClaudeMcpError(inspection.entries));
  }
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

export function formatPersistentClaudeMcpInspectionError(errors: PersistentClaudeMcpInspectionError[]): string {
  return [
    `Could not inspect Claude MCP configuration for stale ${CLAUDE_MCP_SERVER_NAME} registrations.`,
    "",
    "claude-channel 0.4 uses session-scoped --mcp-config so normal `claude` launches are not polluted.",
    "Cleanup cannot be verified while these files cannot be read or parsed:",
    ...errors.map((error) => `  ${error.source}: ${error.message}`),
    "",
    "Fix or remove the listed file, then rerun the command.",
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

type JsonReadResult =
  | { ok: true; value: Record<string, unknown> | undefined }
  | { ok: false; error: PersistentClaudeMcpInspectionError };

async function readJsonFile(file: string): Promise<JsonReadResult> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
    return { ok: true, value: readRecord(parsed) ?? {} };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { ok: true, value: undefined };
    return {
      ok: false,
      error: {
        source: file,
        message: error instanceof Error ? error.message : String(error),
      },
    };
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

async function canonicalPath(file: string): Promise<string> {
  const resolved = path.resolve(file);
  try {
    return await realpath(resolved);
  } catch {
    return resolved;
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
