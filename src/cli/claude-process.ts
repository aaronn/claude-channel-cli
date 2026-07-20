import type { ChildProcess, SpawnOptions } from "node:child_process";
import { access, constants } from "node:fs/promises";
import path from "node:path";
import { foregroundChild } from "foreground-child";

const CLAUDE_COMMAND = "claude";

type ForegroundChildFn = (program: string, args: string[], spawnOptions: SpawnOptions) => ChildProcess;

export type ClaudeExecutableOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  findExecutable?: typeof findExecutableOnPath;
};

export type LaunchClaudeForegroundOptions = ClaudeExecutableOptions & {
  foregroundChild?: ForegroundChildFn;
};

export async function resolveClaudeExecutable(options: ClaudeExecutableOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const executable = await (options.findExecutable ?? findExecutableOnPath)(CLAUDE_COMMAND, env, platform);
  if (!executable) {
    throw new Error("Claude Code CLI (`claude`) not found on PATH.");
  }
  return executable;
}

export async function launchClaudeForeground(
  args: string[],
  options: LaunchClaudeForegroundOptions = {},
): Promise<never> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const executable = await resolveClaudeExecutable(options);
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

function executableNames(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
