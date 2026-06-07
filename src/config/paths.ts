import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export const bridgeDir = join(homedir(), ".claude-channel");
export const tokenPath = join(bridgeDir, "token");

export async function ensureBridgeDir(): Promise<void> {
  await mkdir(bridgeDir, { recursive: true, mode: 0o700 });
}

export async function readOrCreateToken(file = tokenPath): Promise<string> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });

  if (existsSync(file)) {
    return (await readFile(file, "utf8")).trim();
  }

  const token = randomBytes(32).toString("base64url");
  await writeFile(file, `${token}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  return token;
}

export async function readToken(file = tokenPath): Promise<string> {
  return (await readFile(file, "utf8")).trim();
}
