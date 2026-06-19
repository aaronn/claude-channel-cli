import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createEndpointId, isEndpointId } from "../src/registry/endpoint-id.js";
import {
  createEndpointRecord,
  parseEndpointRecord,
  renameEndpointRecord,
  toEndpointCandidates,
  type EndpointRecord,
} from "../src/registry/endpoint-record.js";
import {
  createUniqueEndpointRecord,
  listLiveEndpoints,
  refreshEndpoint,
  removeEndpointRecord,
  renameEndpoint,
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

test("createEndpointRecord accepts an explicit display name", () => {
  const record = createEndpointRecord({
    endpointId: "ep_ABC234",
    host: "127.0.0.1",
    port: 49152,
    pid: process.pid,
    projectDir: "/repo/app",
    displayName: "  review-left  ",
    now: new Date("2026-06-01T00:00:00.000Z"),
  });

  assert.equal(record.display_name, "review-left");
});

test("createEndpointRecord rejects explicitly empty display names", () => {
  assert.throws(
    () => createEndpointRecord({
      endpointId: "ep_ABC234",
      host: "127.0.0.1",
      port: 49152,
      pid: process.pid,
      projectDir: "/repo/app",
      displayName: "",
      now: new Date("2026-06-01T00:00:00.000Z"),
    }),
    /non-empty/,
  );
});

test("parseEndpointRecord rejects malformed records", () => {
  assert.throws(() => parseEndpointRecord("{}", "endpoint"), /schema_version must be 1/);
  assert.throws(() => parseEndpointRecord("{", "endpoint"), /expected JSON object/);
});

test("parseEndpointRecord preserves legacy records with now-reserved display names", () => {
  assert.equal(
    parseEndpointRecord(JSON.stringify({ ...appRecord(), display_name: " " })).display_name,
    "app",
  );
  assert.equal(
    parseEndpointRecord(JSON.stringify({ ...appRecord(), project_dir: "/repo/123", display_name: "123" })).display_name,
    "123-project",
  );
  assert.equal(
    parseEndpointRecord(JSON.stringify({ ...appRecord(), display_name: "ep_DEF567" })).display_name,
    "ep_DEF567-project",
  );
  assert.equal(
    parseEndpointRecord(JSON.stringify({ ...appRecord(), display_name: "bad\u0085name" })).display_name,
    "bad name",
  );
  assert.equal(
    parseEndpointRecord(JSON.stringify({ ...appRecord(), display_name: "Claude Code" })).display_name,
    "Claude Code",
  );
});

test("renameEndpointRecord updates display name without changing endpoint identity", () => {
  const record = createEndpointRecord({
    endpointId: "ep_ABC234",
    host: "127.0.0.1",
    port: 49152,
    pid: process.pid,
    projectDir: "/repo/app",
    now: new Date("2026-06-01T00:00:00.000Z"),
  });
  const renamed = renameEndpointRecord(record, "review-left");

  assert.equal(renamed.endpoint_id, record.endpoint_id);
  assert.equal(renamed.display_name, "review-left");
  assert.equal(record.display_name, "app");
});

test("endpoint store writes, lists, prunes invalid or stale records, and removes endpoints", async () => {
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
    await writeFile(path.join(dir, "invalid.json"), "{", "utf8");

    assert.equal(await endpointFileCount(dir), 3);
    assert.deepEqual(await listLiveEndpoints({ dir, now: new Date("2026-06-01T00:00:30.000Z") }), [live]);
    assert.equal(await endpointFileCount(dir), 1);

    await removeEndpointRecord(live.endpoint_id, { dir });
    assert.deepEqual(await listLiveEndpoints({ dir, now: new Date("2026-06-01T00:00:30.000Z") }), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("endpoint store renames and persists endpoint records", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-channel-endpoints-"));
  try {
    const record = await createUniqueEndpointRecord({
      host: "127.0.0.1",
      port: 49152,
      pid: process.pid,
      projectDir: "/repo/app",
      now: new Date("2026-06-01T00:00:00.000Z"),
    }, { dir });

    const renamed = await renameEndpoint(record, "review-left", { dir });

    assert.equal(renamed.display_name, "review-left");
    assert.deepEqual(await listLiveEndpoints({ dir, now: new Date("2026-06-01T00:00:05.000Z") }), [renamed]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("endpoint store refresh preserves a renamed display name", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-channel-endpoints-"));
  try {
    const record = await createUniqueEndpointRecord({
      host: "127.0.0.1",
      port: 49152,
      pid: process.pid,
      projectDir: "/repo/app",
      now: new Date("2026-06-01T00:00:00.000Z"),
    }, { dir });

    const renamed = await renameEndpoint(record, "review-left", { dir });
    const refreshed = await refreshEndpoint(renamed, { dir, now: new Date("2026-06-01T00:00:10.000Z") });

    assert.equal(refreshed.display_name, "review-left");
    assert.deepEqual(await listLiveEndpoints({ dir, now: new Date("2026-06-01T00:00:15.000Z") }), [refreshed]);
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

function appRecord(): EndpointRecord {
  return createEndpointRecord({
    endpointId: "ep_ABC234",
    host: "127.0.0.1",
    port: 49152,
    pid: process.pid,
    projectDir: "/repo/app",
    now: new Date("2026-06-01T00:00:00.000Z"),
  });
}

async function endpointFileCount(dir: string): Promise<number> {
  return (await readdir(dir)).filter((name) => name.endsWith(".json")).length;
}
