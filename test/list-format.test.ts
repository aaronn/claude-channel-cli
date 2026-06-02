import assert from "node:assert/strict";
import test from "node:test";
import { formatAmbiguousTargets, formatEndpointList } from "../src/cli/list-format.js";

const candidates = [
  {
    index: 1,
    target: "ep_ABC234",
    endpoint_id: "ep_ABC234",
    display_name: "app",
    project_dir: "/repo/app",
    host: "127.0.0.1",
    port: 49152,
    pid: 123,
    started_at: "2026-06-01T00:00:00.000Z",
    last_seen_at: "2026-06-01T00:00:05.000Z",
    last_seen_seconds: 5,
  },
];

test("formatEndpointList renders numbered targets", () => {
  const output = formatEndpointList(candidates);

  assert.match(output, /# {2}TARGET/);
  assert.match(output, /1 {2}ep_ABC234/);
  assert.match(output, /\/repo\/app/);
});

test("formatEndpointList handles empty endpoint lists", () => {
  assert.equal(formatEndpointList([]), "No live Claude Code channel endpoints found.\n");
});

test("formatAmbiguousTargets renders a safe targeting error", () => {
  assert.match(formatAmbiguousTargets(candidates), /Multiple Claude Code channel endpoints/);
});
