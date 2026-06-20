import assert from "node:assert/strict";
import test from "node:test";
import { readChannelStatus } from "../src/channel-client/status.js";
import { normalizeEndpointDisplayName } from "../src/registry/display-name.js";
import type { EndpointRecord } from "../src/registry/endpoint-record.js";

const endpoint: EndpointRecord = {
  schema_version: 1,
  endpoint_id: "ep_ABC234",
  host: "127.0.0.1",
  port: 8788,
  pid: 123,
  project_dir: "/repo/app",
  display_name: normalizeEndpointDisplayName("app"),
  started_at: "2026-06-01T00:00:00.000Z",
  last_seen_at: "2026-06-01T00:00:01.000Z",
};

function healthError(health: unknown): string {
  if (typeof health !== "object" || health === null || Array.isArray(health)) {
    assert.fail("health must be an object");
  }

  const { error } = health as Record<string, unknown>;
  if (typeof error !== "string") {
    assert.fail("health.error must be a string");
  }
  return error;
}

test("readChannelStatus reports healthy channel", async () => {
  const result = await readChannelStatus({
    endpoints: [endpoint],
    fetchFn: async (url, init) => {
      assert.equal(url, "http://127.0.0.1:8788/health");
      assert.deepEqual(init, { method: "GET" });
      return new Response(JSON.stringify({ ok: true, pid: 123 }), { status: 200 });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.report.reachable, true);
  assert.deepEqual(result.report.health, { ok: true, pid: 123 });
});

test("readChannelStatus reports unreachable channel", async () => {
  const result = await readChannelStatus({
    endpoints: [endpoint],
    fetchFn: async () => {
      throw new Error("connect ECONNREFUSED");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.report.reachable, false);
  assert.match(healthError(result.report.health), /connect ECONNREFUSED/);
});

test("readChannelStatus reports invalid health JSON", async () => {
  const result = await readChannelStatus({
    endpoints: [endpoint],
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
    endpoints: [endpoint],
    fetchFn: async () => new Response(JSON.stringify({ ok: false }), { status: 200 }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.report.reachable, true);
  assert.deepEqual(result.report.health, { ok: false });
});
