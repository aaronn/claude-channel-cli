import assert from "node:assert/strict";
import test from "node:test";
import { resolveClaudeTarget, TargetResolutionError } from "../src/channel-client/target-resolver.js";
import { createEndpointRecord } from "../src/registry/endpoint-record.js";

const app = createEndpointRecord({
  endpointId: "ep_ABC234",
  host: "127.0.0.1",
  port: 49152,
  pid: process.pid,
  projectDir: "/repo/app",
  now: new Date("2026-06-01T00:00:00.000Z"),
});

const lib = createEndpointRecord({
  endpointId: "ep_DEF567",
  host: "127.0.0.1",
  port: 49153,
  pid: process.pid,
  projectDir: "/repo/lib",
  now: new Date("2026-06-01T00:00:00.000Z"),
});

test("resolveClaudeTarget uses explicit endpoint id", async () => {
  const result = await resolveClaudeTarget({ target: "ep_DEF567", endpoints: [app, lib] });

  assert.equal(result.endpoint.endpoint_id, "ep_DEF567");
  assert.equal(result.reason, "explicit");
});

test("resolveClaudeTarget gives endpoint ids precedence over legacy display-name collisions", async () => {
  const renamed = { ...app, display_name: lib.endpoint_id };
  const result = await resolveClaudeTarget({ target: lib.endpoint_id, endpoints: [renamed, lib] });

  assert.equal(result.endpoint.endpoint_id, lib.endpoint_id);
});

test("resolveClaudeTarget uses unique display name", async () => {
  const result = await resolveClaudeTarget({ target: "app", endpoints: [app, lib] });

  assert.equal(result.endpoint.endpoint_id, "ep_ABC234");
});

test("resolveClaudeTarget uses list index for interactive selection", async () => {
  const result = await resolveClaudeTarget({ target: "2", endpoints: [app, lib] });

  assert.equal(result.endpoint.endpoint_id, "ep_DEF567");
});

test("resolveClaudeTarget uses environment target", async () => {
  const result = await resolveClaudeTarget({
    endpoints: [app, lib],
    env: { CLAUDE_CHANNEL_TARGET: "ep_DEF567" },
  });

  assert.equal(result.endpoint.endpoint_id, "ep_DEF567");
  assert.equal(result.reason, "env");
});

test("resolveClaudeTarget selects exactly one endpoint", async () => {
  const result = await resolveClaudeTarget({ endpoints: [app] });

  assert.equal(result.endpoint.endpoint_id, "ep_ABC234");
  assert.equal(result.reason, "single");
});

test("resolveClaudeTarget selects unique workspace match", async () => {
  const result = await resolveClaudeTarget({ endpoints: [app, lib], cwd: "/repo/app/src" });

  assert.equal(result.endpoint.endpoint_id, "ep_ABC234");
  assert.equal(result.reason, "workspace");
});

test("resolveClaudeTarget fails closed when multiple endpoints are plausible", async () => {
  await assert.rejects(
    resolveClaudeTarget({ endpoints: [app, lib], cwd: "/repo" }),
    (error) => error instanceof TargetResolutionError &&
      error.code === "multiple_claude_targets" &&
      error.candidates.length === 2,
  );
});

test("resolveClaudeTarget fails closed when a display name matches multiple endpoints", async () => {
  const left = { ...app, display_name: "review" };
  const right = { ...lib, display_name: "review" };

  await assert.rejects(
    resolveClaudeTarget({ target: "review", endpoints: [left, right] }),
    (error) => error instanceof TargetResolutionError &&
      error.code === "multiple_claude_targets" &&
      error.candidates.length === 2,
  );

  const result = await resolveClaudeTarget({ target: right.endpoint_id, endpoints: [left, right] });
  assert.equal(result.endpoint.endpoint_id, right.endpoint_id);
});

test("resolveClaudeTarget reports unknown explicit target with candidates", async () => {
  await assert.rejects(
    resolveClaudeTarget({ target: "missing", endpoints: [app, lib] }),
    (error) => error instanceof TargetResolutionError &&
      error.code === "unknown_claude_target" &&
      error.candidates.length === 2,
  );
});
