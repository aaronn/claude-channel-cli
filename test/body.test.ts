import { Readable } from "node:stream";
import test from "node:test";
import assert from "node:assert/strict";
import type http from "node:http";
import { messageFromBody, readBody } from "../src/http/body.js";

function requestWithBody(body: string, headers: http.IncomingHttpHeaders = {}): http.IncomingMessage {
  const req = Readable.from([body]) as http.IncomingMessage;
  req.headers = headers;
  return req;
}

test("readBody returns UTF-8 body within limit", async () => {
  const req = requestWithBody("hello");

  await assert.doesNotReject(async () => {
    assert.equal(await readBody(req, 10), "hello");
  });
});

test("readBody rejects oversized bodies", async () => {
  const req = requestWithBody("too large");

  await assert.rejects(readBody(req, 3), /request body exceeds 3 bytes/);
});

test("messageFromBody preserves text body whitespace", () => {
  const req = requestWithBody("", { "content-type": "text/plain" });

  assert.equal(messageFromBody(req, "\n  hello \n"), "\n  hello \n");
});

test("messageFromBody preserves JSON message whitespace", () => {
  const req = requestWithBody("", { "content-type": "application/json; charset=utf-8" });

  assert.equal(messageFromBody(req, JSON.stringify({ message: "\n  hello \n" })), "\n  hello \n");
});

test("messageFromBody rejects malformed JSON bodies", () => {
  const req = requestWithBody("", { "content-type": "application/json" });

  assert.throws(() => messageFromBody(req, "{"), /invalid JSON request body/);
});

test("messageFromBody rejects JSON without a string message", () => {
  const req = requestWithBody("", { "content-type": "application/json" });

  assert.throws(
    () => messageFromBody(req, JSON.stringify({ message: 123 })),
    /JSON requests must include a string "message" field/,
  );
});
