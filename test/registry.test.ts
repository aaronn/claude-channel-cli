import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createEndpointId, isEndpointId } from "../src/registry/endpoint-id.js";
import { createEndpointRecord, parseEndpointRecord, toEndpointCandidates, type EndpointRecord } from "../src/registry/endpoint-record.js";
import {
  createUniqueEndpointRecord,
  listLiveEndpoints,
  removeEndpointRecord,
} from "../src/registry/endpoint-store.js";

test("createEndpointId returns a short local endpoint id", () => {
  assert.match(createEndpointId(), /^ep_[A-Z2-9]{6}$/);
  assert.equal(isEndpointId("ep_ABC234"), true);
  assert.equal(isEndpointId("req_ABC234"), false);
});

test("parseEndpointRecord accepts valid records", () => {
  const record = createEndpointRecord({
    endpointId: "ep_ABC234",
    host: "127.0.0.1",
    port: 49152,
    pid: process.pid,
    projectDir: "/repo/app",
    now: new Date("2026-06-01T00:00:00.000Z"),
  });

  assert.deepEqual(parseEndpointRecord(JSON.stringify(record), "endpoint"), record);
});

test("parseEndpointRecord rejects malformed records", () => {
  assert.throws(() => parseEndpointRecord("{}", "endpoint"), /schema_version must be 1/);
  assert.throws(() => parseEndpointRecord("{", "endpoint"), /expected JSON object/);
});

test("endpoint store writes, lists, prunes stale records, and removes endpoints", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-channel-endpoints-"));
  try {
    const live = await createUniqueEndpointRecord({
      host: "127.0.0.1",
      port: 49152,
      pid: process.pid,
      projectDir: "/repo/app",
      now: new Date("2026-06-01T00:00:00.000Z"),
    }, { dir });
    const stale = createEndpointRecord({
      endpointId: "ep_DEF567",
      host: "127.0.0.1",
      port: 49153,
      pid: process.pid,
      projectDir: "/repo/lib",
      now: new Date("2026-05-31T23:00:00.000Z"),
    });

    await writeEndpointFixture(dir, stale);

    assert.equal(await endpointFileCount(dir), 2);
    assert.deepEqual(await listLiveEndpoints({ dir, now: new Date("2026-06-01T00:00:30.000Z") }), [live]);
    assert.equal(await endpointFileCount(dir), 1);

    await removeEndpointRecord(live.endpoint_id, { dir });
    assert.deepEqual(await listLiveEndpoints({ dir, now: new Date("2026-06-01T00:00:30.000Z") }), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("endpoint store allocates a unique live endpoint record", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-channel-endpoints-"));
  try {
    const record = await createUniqueEndpointRecord({
      host: "127.0.0.1",
      port: 49152,
      pid: process.pid,
      projectDir: "/repo/app",
      now: new Date("2026-06-01T00:00:00.000Z"),
    }, { dir });

    assert.equal(isEndpointId(record.endpoint_id), true);
    assert.deepEqual(await listLiveEndpoints({ dir, now: new Date("2026-06-01T00:00:05.000Z") }), [record]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("toEndpointCandidates produces numbered display candidates", () => {
  const record = createEndpointRecord({
    endpointId: "ep_ABC234",
    host: "127.0.0.1",
    port: 49152,
    pid: process.pid,
    projectDir: "/repo/app",
    now: new Date("2026-06-01T00:00:00.000Z"),
  });

  assert.deepEqual(toEndpointCandidates([record], new Date("2026-06-01T00:00:05.000Z")), [{
    index: 1,
    target: "ep_ABC234",
    endpoint_id: "ep_ABC234",
    display_name: "app",
    project_dir: "/repo/app",
    host: "127.0.0.1",
    port: 49152,
    pid: process.pid,
    started_at: "2026-06-01T00:00:00.000Z",
    last_seen_at: "2026-06-01T00:00:00.000Z",
    last_seen_seconds: 5,
  }]);
});

async function writeEndpointFixture(dir: string, record: EndpointRecord): Promise<void> {
  await writeFile(
    path.join(dir, `${record.endpoint_id}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
  );
}

async function endpointFileCount(dir: string): Promise<number> {
  return (await readdir(dir)).filter((name) => name.endsWith(".json")).length;
}
