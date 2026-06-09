import assert from "node:assert/strict";
import test from "node:test";
import { askClaude, tellClaude } from "../src/channel-client/client.js";
import type { EndpointRecord } from "../src/registry/endpoint-record.js";

const endpoint: EndpointRecord = {
  schema_version: 1,
  endpoint_id: "ep_ABC234",
  host: "::1",
  port: 8788,
  pid: 123,
  project_dir: "/repo/app",
  display_name: "app",
  started_at: "2026-06-01T00:00:00.000Z",
  last_seen_at: "2026-06-01T00:00:01.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function requestHeaders(init: RequestInit | undefined): Record<string, string> {
  const headers = init?.headers;
  assert.equal(typeof headers, "object");
  assert.ok(headers);
  assert.equal(headers instanceof Headers, false);
  assert.equal(Array.isArray(headers), false);
  return headers as Record<string, string>;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

test("tellClaude sends a plain-text request with auth and sender metadata", async () => {
  let request: { url: string; init?: RequestInit } | undefined;

  const result = await tellClaude("\n  hello\n", {
    endpoints: [endpoint],
    token: "secret",
    sender: "reviewer",
    fetchFn: async (url, init) => {
      request = { url: requestUrl(url), init };
      return jsonResponse({ ok: true }, 202);
    },
  });

  assert.deepEqual(result, { ok: true, target: endpoint.endpoint_id });
  assert.equal(request?.url, "http://[::1]:8788/tell");
  assert.equal(request?.init?.method, "POST");
  assert.equal(request?.init?.body, "\n  hello\n");
  assert.deepEqual(requestHeaders(request?.init), {
    authorization: "Bearer secret",
    "content-type": "text/plain; charset=utf-8",
    "x-claude-channel-sender": "reviewer",
  });
});

test("tellClaude resolves sender metadata from environment or default", async () => {
  const senders: string[] = [];
  const fetchFn: typeof fetch = async (_url, init) => {
    senders.push(requestHeaders(init)["x-claude-channel-sender"]);
    return jsonResponse({ ok: true }, 202);
  };

  await tellClaude("hello", {
    endpoints: [endpoint],
    token: "secret",
    env: { CLAUDE_CHANNEL_SENDER: "env-sender" },
    fetchFn,
  });
  await tellClaude("hello", {
    endpoints: [endpoint],
    token: "secret",
    env: {},
    fetchFn,
  });

  assert.deepEqual(senders, ["env-sender", "codex"]);
});

test("askClaude sends timeout_ms and returns the validated response envelope", async () => {
  const result = await askClaude("question", {
    endpoints: [endpoint],
    token: "secret",
    timeoutMs: 42,
    fetchFn: async (url, init) => {
      assert.equal(requestUrl(url), "http://[::1]:8788/ask?timeout_ms=42");
      assert.equal(init?.body, "question");
      return jsonResponse({
        ok: true,
        request_id: "req_abc123",
        status: "answered",
        answer: "done",
      });
    },
  });

  assert.deepEqual(result, {
    ok: true,
    target: endpoint.endpoint_id,
    request_id: "req_abc123",
    status: "answered",
    answer: "done",
  });
});

test("client response validation rejects malformed envelopes", async () => {
  await assert.rejects(
    tellClaude("hello", {
      endpoints: [endpoint],
      token: "secret",
      fetchFn: async () => jsonResponse({ ok: false }),
    }),
    /expected shape/,
  );

  await assert.rejects(
    askClaude("hello", {
      endpoints: [endpoint],
      token: "secret",
      timeoutMs: 1,
      fetchFn: async () => jsonResponse({
        ok: true,
        request_id: "bad",
        status: "answered",
        answer: "done",
      }),
    }),
    /expected shape/,
  );

  await assert.rejects(
    tellClaude("hello", {
      endpoints: [endpoint],
      token: "secret",
      fetchFn: async () => new Response("not json", { status: 200 }),
    }),
    /not valid JSON/,
  );
});
