import type { CodexChannelToolDeps } from "../src/codex-mcp/server.js";
import type { ClaudeChannel } from "../src/mcp/claude-channel.js";
import type { PendingRequests } from "../src/pending-requests.js";
import type { EndpointCandidate, EndpointRecord } from "../src/registry/endpoint-record.js";

export const testEndpoint: EndpointRecord = {
  schema_version: 1,
  endpoint_id: "ep_ABC234",
  host: "127.0.0.1",
  port: 8788,
  pid: 123,
  project_dir: "/repo/app",
  display_name: "app",
  started_at: "2026-06-01T00:00:00.000Z",
  last_seen_at: "2026-06-01T00:00:01.000Z",
};

export const testCandidate: EndpointCandidate = {
  index: 1,
  target: testEndpoint.endpoint_id,
  endpoint_id: testEndpoint.endpoint_id,
  display_name: testEndpoint.display_name,
  project_dir: testEndpoint.project_dir,
  host: testEndpoint.host,
  port: testEndpoint.port,
  pid: testEndpoint.pid,
  started_at: testEndpoint.started_at,
  last_seen_at: testEndpoint.last_seen_at,
  last_seen_seconds: 1,
};

export function createTestClaudeChannel(
  overrides: Partial<Pick<ClaudeChannel, "emitTell" | "emitAsk">> = {},
): ClaudeChannel {
  return {
    server: {} as ClaudeChannel["server"],
    emitTell: async () => {},
    emitAsk: async () => {},
    ...overrides,
  };
}

export function createAutoAnswerChannel(pendingRequests: PendingRequests, answer = "ok"): ClaudeChannel {
  return createTestClaudeChannel({
    emitAsk: async (requestId) => {
      pendingRequests.complete({
        requestId,
        status: "answered",
        answer,
      });
    },
  });
}

export function createCodexToolDeps(overrides: Partial<CodexChannelToolDeps> = {}): CodexChannelToolDeps {
  return {
    list: async () => ({
      targets: [testCandidate],
    }),
    status: async () => ({
      ok: true,
      report: {
        target: testEndpoint.endpoint_id,
        endpoint: testEndpoint,
        candidates: [],
        reachable: true,
        health: { ok: true },
        endpoints_path: "endpoints",
        token_path: "token",
      },
    }),
    tell: async () => ({ ok: true, target: testEndpoint.endpoint_id }),
    ask: async () => ({
      ok: true,
      target: testEndpoint.endpoint_id,
      request_id: "req_abc123",
      status: "answered",
      answer: "review ok",
    }),
    ...overrides,
  };
}
