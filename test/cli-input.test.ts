import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { readPromptInput } from "../src/cli/input.js";

test("readPromptInput reads normal file paths", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-channel-input-"));
  try {
    const file = path.join(dir, "prompt.md");
    await writeFile(file, "file prompt\nwith newline", "utf8");

    assert.equal(await readPromptInput(file), "file prompt\nwith newline");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readPromptInput reads stdin when file is dash", async () => {
  const input = Readable.from(["line one\n", Buffer.from("line two\n")]);

  assert.equal(await readPromptInput("-", input), "line one\nline two\n");
});

test("readPromptInput preserves long multiline stdin content", async () => {
  const content = Array.from({ length: 200 }, (_, index) => `review point ${index}`).join("\n");

  assert.equal(await readPromptInput("-", Readable.from([content])), content);
});
