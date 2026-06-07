import { readFile } from "node:fs/promises";

type InputChunk = Buffer | Uint8Array | string;

export async function readPromptInput(
  file: string,
  input: AsyncIterable<InputChunk> = process.stdin,
): Promise<string> {
  if (file !== "-") {
    return readFile(file, "utf8");
  }

  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}
