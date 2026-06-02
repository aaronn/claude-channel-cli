import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const bridgeDir = join(homedir(), ".claude-channel");
export const tokenPath = join(bridgeDir, "token");

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

export async function readToken(): Promise<string> {
  return (await readFile(tokenPath, "utf8")).trim();
}
