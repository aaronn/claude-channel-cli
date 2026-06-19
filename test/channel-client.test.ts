import assert from "node:assert/strict";
import test from "node:test";
import { askClaude, askTransportTimeoutMs, renameClaudeDisplayName } from "../src/channel-client/client.js";
import { ASK_TRANSPORT_TIMEOUT_GRACE_MS, DEFAULT_RENAME_TRANSPORT_TIMEOUT_MS } from "../src/config/defaults.js";
import { normalizeEndpointDisplayName } from "../src/registry/display-name.js";
import type { EndpointRecord } from "../src/registry/endpoint-record.js";

const endpoint: EndpointRecord = {
  schema_version: 1,
  endpoint_id: "ep_ABC234",
  host: "::1",
  port: 8788,
  pid: 123,
  project_dir: "/repo/app",
  display_name: normalizeEndpointDisplayName("app"),
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

test("askClaude sends a plain-text request with auth, sender metadata, and timeout_ms", async () => {
  let request: { url: string; init?: RequestInit } | undefined;

  const result = await askClaude("question", {
    endpoints: [endpoint],
    cwd: "/repo/app",
    token: "secret",
    sender: "reviewer",
    timeoutMs: 42,
    fetchFn: async (url, init) => {
      request = { url: requestUrl(url), init };
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
  assert.equal(request?.url, "http://[::1]:8788/ask?timeout_ms=42");
  assert.equal(request?.init?.method, "POST");
  assert.equal(request?.init?.body, "question");
  assert.deepEqual(requestHeaders(request?.init), {
    authorization: "Bearer secret",
    "content-type": "text/plain; charset=utf-8",
    "x-claude-channel-sender": "reviewer",
  });
});

test("askClaude resolves sender metadata from environment or default", async () => {
  const senders: string[] = [];
  const fetchFn: typeof fetch = async (_url, init) => {
    senders.push(requestHeaders(init)["x-claude-channel-sender"]);
    return jsonResponse({
      ok: true,
      request_id: "req_abc123",
      status: "answered",
      answer: "done",
    });
  };

  await askClaude("hello", {
    endpoints: [endpoint],
    cwd: "/repo/app",
    token: "secret",
    env: { CLAUDE_CHANNEL_SENDER: "env-sender" },
    timeoutMs: 1,
    fetchFn,
  });
  await askClaude("hello", {
    endpoints: [endpoint],
    cwd: "/repo/app",
    token: "secret",
    env: {},
    timeoutMs: 1,
    fetchFn,
  });

  assert.deepEqual(senders, ["env-sender", "codex"]);
});

test("askTransportTimeoutMs adds transport margin outside the app timeout", () => {
  assert.equal(askTransportTimeoutMs(1_800_000), 1_800_000 + ASK_TRANSPORT_TIMEOUT_GRACE_MS);
});

test("renameClaudeDisplayName sends an authenticated JSON PATCH", async () => {
  let request: { url: string; init?: RequestInit } | undefined;

  const result = await renameClaudeDisplayName("  review-left  ", {
    endpoints: [endpoint],
    cwd: "/repo/app",
    token: "secret",
    fetchFn: async (url, init) => {
      request = { url: requestUrl(url), init };
      return jsonResponse({
        ok: true,
        endpoint_id: endpoint.endpoint_id,
        display_name: "review-left",
      });
    },
  });

  assert.deepEqual(result, {
    ok: true,
    target: endpoint.endpoint_id,
    endpoint_id: endpoint.endpoint_id,
    display_name: "review-left",
  });
  assert.equal(request?.url, "http://[::1]:8788/display-name");
  assert.equal(request?.init?.method, "PATCH");
  assert.equal(request?.init?.body, JSON.stringify({ display_name: "review-left" }));
  assert.ok(request?.init?.signal instanceof AbortSignal);
  assert.deepEqual(requestHeaders(request?.init), {
    authorization: "Bearer secret",
    "content-type": "application/json; charset=utf-8",
  });
});

test("renameClaudeDisplayName uses a bounded transport timeout", async () => {
  let signal: AbortSignal | null = null;

  await renameClaudeDisplayName("review-left", {
    endpoints: [endpoint],
    cwd: "/repo/app",
    token: "secret",
    transportTimeoutMs: DEFAULT_RENAME_TRANSPORT_TIMEOUT_MS,
    fetchFn: async (_url, init) => {
      signal = init?.signal instanceof AbortSignal ? init.signal : null;
      return jsonResponse({
        ok: true,
        endpoint_id: endpoint.endpoint_id,
        display_name: "review-left",
      });
    },
  });

  const capturedSignal = signal as AbortSignal | null;
  assert.ok(capturedSignal);
  assert.equal(capturedSignal.aborted, false);
});

test("client response validation rejects malformed envelopes", async () => {
  await assert.rejects(
    askClaude("hello", {
      endpoints: [endpoint],
      cwd: "/repo/app",
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
    askClaude("hello", {
      endpoints: [endpoint],
      cwd: "/repo/app",
      token: "secret",
      timeoutMs: 1,
      fetchFn: async () => new Response("not json", { status: 200 }),
    }),
    /not valid JSON/,
  );

  await assert.rejects(
    renameClaudeDisplayName("review-left", {
      endpoints: [endpoint],
      cwd: "/repo/app",
      token: "secret",
      fetchFn: async () => jsonResponse({
        ok: true,
        endpoint_id: "ep_DEF567",
        display_name: "review-left",
      }),
    }),
    /expected shape/,
  );
});
