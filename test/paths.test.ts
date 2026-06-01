import assert from "node:assert/strict";
import test from "node:test";
import { parseBridgeState } from "../src/config/paths.js";

test("parseBridgeState accepts current state shape", () => {
  assert.deepEqual(
    parseBridgeState(
      JSON.stringify({
        schema_version: 1,
        host: "127.0.0.1",
        port: 8788,
        pid: 123,
        started_at: "2026-06-01T00:00:00.000Z",
      }),
      "test-state",
    ),
    {
      schema_version: 1,
      host: "127.0.0.1",
      port: 8788,
      pid: 123,
      started_at: "2026-06-01T00:00:00.000Z",
    },
  );
});

test("parseBridgeState accepts legacy startedAt", () => {
  assert.equal(
    parseBridgeState(
      JSON.stringify({
        host: "127.0.0.1",
        port: 8788,
        pid: 123,
        startedAt: "2026-06-01T00:00:00.000Z",
      }),
      "test-state",
    ).started_at,
    "2026-06-01T00:00:00.000Z",
  );
});

test("parseBridgeState rejects malformed JSON", () => {
  assert.throws(() => parseBridgeState("{", "test-state"), /expected JSON object/);
});

test("parseBridgeState validates endpoint fields", () => {
  assert.throws(
    () =>
      parseBridgeState(
        JSON.stringify({
          host: "",
          port: 8788,
          pid: 123,
          started_at: "2026-06-01T00:00:00.000Z",
        }),
        "test-state",
      ),
    /host must be a non-empty string/,
  );

  assert.throws(
    () =>
      parseBridgeState(
        JSON.stringify({
          host: "127.0.0.1",
          port: 0,
          pid: 123,
          started_at: "2026-06-01T00:00:00.000Z",
        }),
        "test-state",
      ),
    /port must be a positive integer/,
  );
});
