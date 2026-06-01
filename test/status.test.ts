import assert from "node:assert/strict";
import test from "node:test";
import { readChannelStatus } from "../src/cli/status.js";
import type { BridgeState } from "../src/config/paths.js";

const state: BridgeState = {
  schema_version: 1,
  host: "127.0.0.1",
  port: 8788,
  pid: 123,
  started_at: "2026-06-01T00:00:00.000Z",
};

test("readChannelStatus reports healthy channel", async () => {
  const result = await readChannelStatus({
    readState: async () => state,
    fetchFn: async (url, init) => {
      assert.equal(url, "http://127.0.0.1:8788/health");
      assert.deepEqual(init, { method: "GET" });
      return new Response(JSON.stringify({ ok: true, pid: 123 }), { status: 200 });
    },
    statePath: "state.json",
    tokenPath: "token",
  });

  assert.equal(result.ok, true);
  assert.equal(result.report.reachable, true);
  assert.deepEqual(result.report.health, { ok: true, pid: 123 });
});

test("readChannelStatus reports unreachable channel", async () => {
  const result = await readChannelStatus({
    readState: async () => state,
    fetchFn: async () => {
      throw new Error("connect ECONNREFUSED");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.report.reachable, false);
  assert.match(JSON.stringify(result.report.health), /connect ECONNREFUSED/);
});

test("readChannelStatus reports invalid health JSON", async () => {
  const result = await readChannelStatus({
    readState: async () => state,
    fetchFn: async () => new Response("not json", { status: 200 }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.report.reachable, true);
  assert.deepEqual(result.report.health, {
    ok: false,
    error: "channel health response was not valid JSON",
    body: "not json",
  });
});

test("readChannelStatus reports unhealthy JSON", async () => {
  const result = await readChannelStatus({
    readState: async () => state,
    fetchFn: async () => new Response(JSON.stringify({ ok: false }), { status: 200 }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.report.reachable, true);
  assert.deepEqual(result.report.health, { ok: false });
});
