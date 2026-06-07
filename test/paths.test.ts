import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readOrCreateToken, readToken } from "../src/config/paths.js";

test("readOrCreateToken creates a private token file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-channel-token-"));
  const file = path.join(dir, "token");

  try {
    const token = await readOrCreateToken(file);

    assert.match(token, /^[A-Za-z0-9_-]+$/);
    assert.equal(await readToken(file), token);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readOrCreateToken reuses an existing token file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-channel-token-"));
  const file = path.join(dir, "token");

  try {
    await writeFile(file, "existing-token\n", { mode: 0o600 });

    assert.equal(await readOrCreateToken(file), "existing-token");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readOrCreateToken handles concurrent creation", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-channel-token-"));
  const file = path.join(dir, "token");

  try {
    const tokens = await Promise.all(Array.from({ length: 5 }, () => readOrCreateToken(file)));

    assert.equal(new Set(tokens).size, 1);
    assert.equal(await readToken(file), tokens[0]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
