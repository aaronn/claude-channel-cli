import type http from "node:http";
import { HttpError } from "../errors.js";

type BodyChunk = Buffer | Uint8Array | string;

export async function readBody(req: http.IncomingMessage, maxBodyBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;

  for await (const chunk of req as AsyncIterable<BodyChunk>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;

    if (bytes > maxBodyBytes) {
      throw new HttpError(413, `request body exceeds ${maxBodyBytes} bytes`);
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

export function messageFromBody(req: http.IncomingMessage, body: string): string {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.toString().includes("application/json")) {
    return body;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new HttpError(400, "invalid JSON request body");
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "message" in parsed &&
    typeof parsed.message === "string"
  ) {
    return parsed.message;
  }

  throw new HttpError(400, 'JSON requests must include a string "message" field');
}
