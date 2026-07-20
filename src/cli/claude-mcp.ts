import { access, constants, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findExecutableOnPath } from "./claude-process.js";

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

export type ResolveServerCommandOptions = {
  env?: NodeJS.ProcessEnv;
  bundledScriptPath?: string;
};

export type PersistentClaudeMcpScope = "local" | "project" | "user";

export type PersistentClaudeMcpEntry = {
  scope: PersistentClaudeMcpScope;
};

export type PersistentClaudeMcpInspectionError = {
  source: string;
  message: string;
};

export type PersistentClaudeMcpInspection =
  | { ok: true; entries: PersistentClaudeMcpEntry[] }
  | { ok: false; errors: PersistentClaudeMcpInspectionError[] };

export type PersistentClaudeMcpOptions = {
  cwd?: string;
  homeDir?: string;
};

export type ReceiverLaunchOptions = PersistentClaudeMcpOptions & {
  argv?: string[];
  inspectPersistentClaudeMcp?: () => Promise<PersistentClaudeMcpInspection>;
};

export async function resolveServerCommand(options: ResolveServerCommandOptions = {}): Promise<ServerCommand> {
  const env = options.env ?? process.env;
  const bundledScript = options.bundledScriptPath ?? bundledChannelScriptPath();
  try {
    await access(bundledScript, constants.R_OK);
    return {
      command: process.execPath,
      args: [bundledScript],
    };
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not access bundled Claude Channel receiver ${JSON.stringify(bundledScript)}: ${message}`,
        { cause: error },
      );
    }
  }

  const installedBin = await findExecutableOnPath(CLAUDE_CHANNEL_SERVER_BIN, env);
  if (installedBin) return { command: installedBin, args: [] };

  throw new Error("Claude Channel receiver not found. Reinstall claude-channel-cli or run `npm run build` in a development checkout.");
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

  const inspection = await (options.inspectPersistentClaudeMcp ?? (() => inspectPersistentClaudeMcp(options)))();
  assertPersistentClaudeMcpClean(inspection);

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
  const cwdPath = options.cwd ?? process.cwd();
  const canonicalCwd = await canonicalPath(cwdPath);
  if (!canonicalCwd.ok) {
    return {
      ok: false,
      errors: [{
        source: cwdPath,
        message: `current project path ${JSON.stringify(cwdPath)} could not be resolved: ${canonicalCwd.message}`,
      }],
    };
  }

  const cwd = canonicalCwd.path;
  const homeDir = options.homeDir ?? homedir();
  const entries: PersistentClaudeMcpEntry[] = [];
  const errors: PersistentClaudeMcpInspectionError[] = [];

  const claudeConfigPath = path.join(homeDir, ".claude.json");
  const claudeConfig = await readJsonFile(claudeConfigPath);
  if (!claudeConfig.ok) {
    errors.push(claudeConfig.error);
  } else if (claudeConfig.value) {
    const userMcpServers = optionalRecordField(claudeConfig.value, "mcpServers", claudeConfigPath, errors);
    if (hasNamedMcpServer(userMcpServers, CLAUDE_MCP_SERVER_NAME)) {
      entries.push({ scope: "user" });
    }

    const projects = optionalRecordField(claudeConfig.value, "projects", claudeConfigPath, errors);
    for (const [projectPath, projectConfig] of Object.entries(projects ?? {})) {
      const fieldPath = `projects[${JSON.stringify(projectPath)}]`;
      const canonicalProjectPath = await canonicalPath(projectPath);
      if (!canonicalProjectPath.ok) {
        errors.push({
          source: claudeConfigPath,
          message: `${fieldPath} path ${JSON.stringify(projectPath)} could not be resolved: ${canonicalProjectPath.message}`,
        });
        continue;
      }
      if (canonicalProjectPath.path !== cwd) continue;
      const projectRecord = requiredRecordValue(
        projectConfig,
        fieldPath,
        claudeConfigPath,
        errors,
      );
      const localMcpServers = projectRecord
        ? optionalRecordField(
            projectRecord,
            "mcpServers",
            claudeConfigPath,
            errors,
            `${fieldPath}.mcpServers`,
          )
        : undefined;
      if (hasNamedMcpServer(localMcpServers, CLAUDE_MCP_SERVER_NAME)) {
        entries.push({ scope: "local" });
      }
    }
  }

  const projectMcpPath = path.join(cwd, ".mcp.json");
  const projectMcpConfig = await readJsonFile(projectMcpPath);
  if (!projectMcpConfig.ok) {
    errors.push(projectMcpConfig.error);
  } else if (projectMcpConfig.value) {
    const projectMcpServers = optionalRecordField(
      projectMcpConfig.value,
      "mcpServers",
      projectMcpPath,
      errors,
    );
    if (hasNamedMcpServer(projectMcpServers, CLAUDE_MCP_SERVER_NAME)) {
      entries.push({ scope: "project" });
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, entries };
}

export function assertPersistentClaudeMcpClean(inspection: PersistentClaudeMcpInspection): void {
  if (!inspection.ok) {
    throw new Error(formatPersistentClaudeMcpInspectionError(inspection.errors));
  }
  if (inspection.entries.length > 0) {
    throw new Error(formatPersistentClaudeMcpError(inspection.entries));
  }
}

export function formatPersistentClaudeMcpError(entries: PersistentClaudeMcpEntry[]): string {
  const removeCommands = entries.map(({ scope }) => `  ${formatShellCommand(
    "claude",
    ["mcp", "remove", "--scope", scope, CLAUDE_MCP_SERVER_NAME],
  )}`);
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
    "Cleanup cannot be verified while configuration files or referenced paths cannot be inspected:",
    ...errors.map((error) => `  ${error.source}: ${error.message}`),
    "",
    "Fix the listed configuration or path, then rerun the command.",
    "",
  ].join("\n");
}

export function formatShellCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

type JsonReadResult =
  | { ok: true; value: Record<string, unknown> | undefined }
  | { ok: false; error: PersistentClaudeMcpInspectionError };

async function readJsonFile(file: string): Promise<JsonReadResult> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
    const value = readRecord(parsed);
    if (!value) {
      return {
        ok: false,
        error: {
          source: file,
          message: "top-level value must be a JSON object",
        },
      };
    }
    return { ok: true, value };
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

function optionalRecordField(
  owner: Record<string, unknown>,
  key: string,
  source: string,
  errors: PersistentClaudeMcpInspectionError[],
  fieldPath = key,
): Record<string, unknown> | undefined {
  if (!Object.prototype.hasOwnProperty.call(owner, key)) return undefined;
  return requiredRecordValue(owner[key], fieldPath, source, errors);
}

function requiredRecordValue(
  value: unknown,
  fieldPath: string,
  source: string,
  errors: PersistentClaudeMcpInspectionError[],
): Record<string, unknown> | undefined {
  const record = readRecord(value);
  if (record) return record;
  errors.push({ source, message: `${fieldPath} must be a JSON object` });
  return undefined;
}

function hasNamedMcpServer(mcpServers: Record<string, unknown> | undefined, name: string): boolean {
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

type CanonicalPathResult =
  | { ok: true; path: string }
  | { ok: false; message: string };

async function canonicalPath(file: string): Promise<CanonicalPathResult> {
  const resolved = path.resolve(file);
  try {
    return { ok: true, path: await realpath(resolved) };
  } catch (error) {
    if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return { ok: true, path: resolved };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
