import { access, constants } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CLAUDE_MCP_SERVER_NAME = "claude-channel-cli";
export const CLAUDE_CHANNEL_SERVER_BIN = "claude-channel-server";
export const CLAUDE_CHANNEL_LAUNCH_COMMAND =
  `claude --dangerously-load-development-channels server:${CLAUDE_MCP_SERVER_NAME}`;

export type SetupMcpScope = "local" | "user";

export type ServerCommand = {
  command: string;
  args: string[];
};

export type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export type SetupMcpOptions = {
  scope?: string;
  dryRun?: boolean;
  force?: boolean;
  claudeCommand?: string;
  commandRunner?: CommandRunner;
  resolveServerCommand?: () => Promise<ServerCommand>;
};

export type SetupMcpResult = {
  dryRun: boolean;
  force: boolean;
  scope: SetupMcpScope;
  claudeCommand: string;
  serverCommand: ServerCommand;
  commands: Array<{ command: string; args: string[] }>;
  addResult?: CommandResult;
  removeResult?: CommandResult;
};

export async function setupMcp(options: SetupMcpOptions = {}): Promise<SetupMcpResult> {
  const scope = parseSetupMcpScope(options.scope);
  const claudeCommand = options.claudeCommand ?? "claude";
  const serverCommand = await (options.resolveServerCommand ?? resolveServerCommand)();
  const force = options.force === true;
  const dryRun = options.dryRun === true;
  const removeArgs = buildClaudeMcpRemoveArgs(scope);
  const addArgs = buildClaudeMcpAddArgs(scope, serverCommand);
  const commands = [
    ...(force ? [{ command: claudeCommand, args: removeArgs }] : []),
    { command: claudeCommand, args: addArgs },
  ];

  if (dryRun) {
    return { dryRun, force, scope, claudeCommand, serverCommand, commands };
  }

  const commandRunner = options.commandRunner ?? runCommand;
  const removeResult = force ? await commandRunner(claudeCommand, removeArgs) : undefined;
  const addResult = await commandRunner(claudeCommand, addArgs);
  if (addResult.code !== 0) {
    throw new Error(formatCommandFailure(claudeCommand, addArgs, addResult));
  }

  return {
    dryRun,
    force,
    scope,
    claudeCommand,
    serverCommand,
    commands,
    addResult,
    removeResult,
  };
}

export function parseSetupMcpScope(value: string | undefined): SetupMcpScope {
  const scope = value?.trim() || "local";
  if (scope === "local" || scope === "user") return scope;
  throw new Error("scope must be either local or user");
}

export function buildClaudeMcpAddArgs(scope: SetupMcpScope, serverCommand: ServerCommand): string[] {
  return [
    "mcp",
    "add",
    "--scope",
    scope,
    CLAUDE_MCP_SERVER_NAME,
    "--",
    serverCommand.command,
    ...serverCommand.args,
  ];
}

export function buildClaudeMcpRemoveArgs(scope: SetupMcpScope): string[] {
  return ["mcp", "remove", "--scope", scope, CLAUDE_MCP_SERVER_NAME];
}

export async function resolveServerCommand(env: NodeJS.ProcessEnv = process.env): Promise<ServerCommand> {
  const installedBin = await findExecutableOnPath(CLAUDE_CHANNEL_SERVER_BIN, env);
  if (installedBin) return { command: CLAUDE_CHANNEL_SERVER_BIN, args: [] };

  return {
    command: process.execPath,
    args: [bundledChannelScriptPath()],
  };
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

export function formatSetupMcpResult(result: SetupMcpResult): string {
  const startLine = result.scope === "local"
    ? "Then start Claude Code from this project with:"
    : "Then start Claude Code with:";

  if (result.dryRun) {
    return [
      "Would run:",
      ...result.commands.map((command) => `  ${formatShellCommand(command.command, command.args)}`),
      "",
      startLine,
      CLAUDE_CHANNEL_LAUNCH_COMMAND,
      "",
    ].join("\n");
  }

  const addOutput = result.addResult?.stdout.trim();
  return [
    ...(addOutput ? [addOutput, ""] : []),
    `Configured ${CLAUDE_MCP_SERVER_NAME} at ${result.scope} MCP scope.`,
    "",
    startLine,
    CLAUDE_CHANNEL_LAUNCH_COMMAND,
    "",
  ].join("\n");
}

export function formatShellCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });

  return { code, stdout, stderr };
}

function bundledChannelScriptPath(): string {
  return fileURLToPath(new URL("../channel.js", import.meta.url));
}

function executableNames(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string[] {
  if (platform !== "win32" || path.extname(command)) return [command];
  const pathExt = env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  return pathExt.split(";").filter(Boolean).map((extension) => `${command}${extension.toLowerCase()}`);
}

async function canExecute(file: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    await access(file, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function formatCommandFailure(command: string, args: string[], result: CommandResult): string {
  const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
  const suffix = details ? `\n${details}` : "";
  return `command failed: ${formatShellCommand(command, args)}${suffix}`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}
