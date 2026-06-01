import assert from "node:assert/strict";
import test from "node:test";
import { TargetResolutionError } from "../src/channel-client/target-resolver.js";
import { callCodexChannelTool, listCodexChannelTools, type CodexChannelToolDeps } from "../src/codex-mcp/server.js";

const endpoint = {
  schema_version: 1 as const,
  endpoint_id: "ep_ABC234",
  host: "127.0.0.1",
  port: 8788,
  pid: 123,
  project_dir: "/repo/app",
  display_name: "app",
  started_at: "2026-06-01T00:00:00.000Z",
  last_seen_at: "2026-06-01T00:00:01.000Z",
};

function deps(): CodexChannelToolDeps {
  return {
    list: async () => ({
      targets: [{
        index: 1,
        target: endpoint.endpoint_id,
        endpoint_id: endpoint.endpoint_id,
        display_name: endpoint.display_name,
        project_dir: endpoint.project_dir,
        host: endpoint.host,
        port: endpoint.port,
        pid: endpoint.pid,
        started_at: endpoint.started_at,
        last_seen_at: endpoint.last_seen_at,
        last_seen_seconds: 1,
      }],
    }),
    status: async () => ({
      ok: true,
      report: {
        target: endpoint.endpoint_id,
        endpoint,
        candidates: [],
        reachable: true,
        health: { ok: true },
        endpoints_path: "endpoints",
        token_path: "token",
      },
    }),
    tell: async () => ({ ok: true, target: endpoint.endpoint_id }),
    ask: async () => ({
      ok: true,
      target: endpoint.endpoint_id,
      request_id: "req_abc123",
      status: "answered",
      answer: "review ok",
    }),
  };
}

test("listCodexChannelTools exposes the Codex-facing tool set", () => {
  assert.deepEqual(
    listCodexChannelTools().map((tool) => tool.name),
    ["list_claude_targets", "status_claude_channel", "tell_claude", "ask_claude"],
  );
});

test("list_claude_targets returns structured targets", async () => {
  const result = await callCodexChannelTool("list_claude_targets", {}, deps());

  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent?.targets, [{
    index: 1,
    target: endpoint.endpoint_id,
    endpoint_id: endpoint.endpoint_id,
    display_name: endpoint.display_name,
    project_dir: endpoint.project_dir,
    host: endpoint.host,
    port: endpoint.port,
    pid: endpoint.pid,
    started_at: endpoint.started_at,
    last_seen_at: endpoint.last_seen_at,
    last_seen_seconds: 1,
  }]);
});

test("status_claude_channel returns structured status", async () => {
  const result = await callCodexChannelTool("status_claude_channel", {}, deps());

  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent?.health, { ok: true });
});

test("tell_claude passes message and sender to channel client", async () => {
  const calls: unknown[] = [];
  const testDeps = deps();
  testDeps.tell = async (message, options) => {
    calls.push({ message, options });
    return { ok: true, target: endpoint.endpoint_id };
  };

  const result = await callCodexChannelTool("tell_claude", {
    message: "From Codex: hello",
    sender: "codex-test",
  }, testDeps);

  assert.equal(result.isError, false);
  assert.deepEqual(calls, [
    {
      message: "From Codex: hello",
      options: { target: undefined, sender: "codex-test" },
    },
  ]);
});

test("ask_claude passes timeout and returns structured answer", async () => {
  const calls: unknown[] = [];
  const testDeps = deps();
  testDeps.ask = async (message, options) => {
    calls.push({ message, options });
    return {
      ok: true,
      target: endpoint.endpoint_id,
      request_id: "req_abc123",
      status: "answered",
      answer: "done",
    };
  };

  const result = await callCodexChannelTool("ask_claude", {
    message: "From Codex: review",
    sender: "codex-test",
    timeout_ms: 42,
  }, testDeps);

  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent, {
    ok: true,
    target: endpoint.endpoint_id,
    request_id: "req_abc123",
    status: "answered",
    answer: "done",
  });
  assert.deepEqual(calls, [
    {
      message: "From Codex: review",
      options: { target: undefined, sender: "codex-test", timeoutMs: 42 },
    },
  ]);
});

test("ask_claude passes target through to channel client", async () => {
  const calls: unknown[] = [];
  const testDeps = deps();
  testDeps.ask = async (message, options) => {
    calls.push({ message, options });
    return {
      ok: true,
      target: endpoint.endpoint_id,
      request_id: "req_abc123",
      status: "answered",
      answer: "done",
    };
  };

  await callCodexChannelTool("ask_claude", {
    target: "app",
    message: "From Codex: review",
  }, testDeps);

  assert.deepEqual(calls, [
    {
      message: "From Codex: review",
      options: { target: "app", sender: undefined, timeoutMs: 1_800_000 },
    },
  ]);
});

test("ask_claude defaults to 30 minute timeout", async () => {
  let timeoutMs = 0;
  const testDeps = deps();
  testDeps.ask = async (_message, options) => {
    timeoutMs = options.timeoutMs;
    return {
      ok: true,
      target: endpoint.endpoint_id,
      request_id: "req_abc123",
      status: "answered",
      answer: "done",
    };
  };

  await callCodexChannelTool("ask_claude", { message: "From Codex: review" }, testDeps);

  assert.equal(timeoutMs, 1_800_000);
});

test("tool argument validation returns tool-visible errors", async () => {
  const result = await callCodexChannelTool("ask_claude", {
    message: "From Codex: review",
    timeout_ms: 0,
  }, deps());

  assert.equal(result.isError, true);
  assert.match(String(result.content[0]?.type === "text" ? result.content[0].text : ""), /timeout_ms/);
});

test("target ambiguity returns retry-friendly structured error", async () => {
  const testDeps = deps();
  testDeps.ask = async () => {
    throw new TargetResolutionError("multiple_claude_targets", "Multiple targets", [{
      index: 1,
      target: endpoint.endpoint_id,
      endpoint_id: endpoint.endpoint_id,
      display_name: endpoint.display_name,
      project_dir: endpoint.project_dir,
      host: endpoint.host,
      port: endpoint.port,
      pid: endpoint.pid,
      started_at: endpoint.started_at,
      last_seen_at: endpoint.last_seen_at,
      last_seen_seconds: 1,
    }]);
  };

  const result = await callCodexChannelTool("ask_claude", {
    message: "From Codex: review",
  }, testDeps);

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent?.error, "multiple_claude_targets");
  assert.deepEqual(result.structuredContent?.candidates, [{
    index: 1,
    target: endpoint.endpoint_id,
    endpoint_id: endpoint.endpoint_id,
    display_name: endpoint.display_name,
    project_dir: endpoint.project_dir,
    host: endpoint.host,
    port: endpoint.port,
    pid: endpoint.pid,
    started_at: endpoint.started_at,
    last_seen_at: endpoint.last_seen_at,
    last_seen_seconds: 1,
  }]);
});
