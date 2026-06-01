import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export type BridgeState = {
  schema_version: 1;
  host: string;
  port: number;
  pid: number;
  started_at: string;
};

type LegacyBridgeState = {
  host: string;
  port: number;
  pid: number;
  startedAt?: string;
  started_at?: string;
};

export const bridgeDir = join(homedir(), ".claude-channel");
export const tokenPath = join(bridgeDir, "token");
export const statePath = join(bridgeDir, "state.json");

export async function ensureBridgeDir(): Promise<void> {
  await mkdir(bridgeDir, { recursive: true, mode: 0o700 });
}

export async function readOrCreateToken(): Promise<string> {
  await ensureBridgeDir();

  if (existsSync(tokenPath)) {
    return (await readFile(tokenPath, "utf8")).trim();
  }

  const token = randomBytes(32).toString("base64url");
  await writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
  await chmod(tokenPath, 0o600);
  return token;
}

export async function writeState(state: BridgeState): Promise<void> {
  await ensureBridgeDir();
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await chmod(statePath, 0o600);
}

export async function readState(): Promise<BridgeState> {
  let raw: string;
  try {
    raw = await readFile(statePath, "utf8");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") {
      throw new Error(`channel state not found at ${statePath}; start Claude Code with claude-cli-channel enabled`);
    }
    throw error;
  }

  return parseBridgeState(raw, statePath);
}

export function parseBridgeState(raw: string, source = "channel state"): BridgeState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`channel state is invalid at ${source}: expected JSON object`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`channel state is invalid at ${source}: expected JSON object`);
  }

  const state = parsed as LegacyBridgeState;
  if (typeof state.host !== "string" || state.host.trim().length === 0) {
    throw new Error(`channel state is invalid at ${source}: host must be a non-empty string`);
  }

  if (!Number.isInteger(state.port) || state.port <= 0) {
    throw new Error(`channel state is invalid at ${source}: port must be a positive integer`);
  }

  if (!Number.isInteger(state.pid) || state.pid <= 0) {
    throw new Error(`channel state is invalid at ${source}: pid must be a positive integer`);
  }

  const startedAt = state.started_at ?? state.startedAt;
  if (typeof startedAt !== "string" || startedAt.trim().length === 0) {
    throw new Error(`channel state is invalid at ${source}: started_at must be a non-empty string`);
  }

  return {
    schema_version: 1,
    host: state.host,
    port: state.port,
    pid: state.pid,
    started_at: startedAt,
  };
}

export async function readToken(): Promise<string> {
  return (await readFile(tokenPath, "utf8")).trim();
}
