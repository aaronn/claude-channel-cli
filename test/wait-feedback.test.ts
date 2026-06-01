import assert from "node:assert/strict";
import test from "node:test";
import { formatDuration, startWaitFeedback } from "../src/cli/wait-feedback.js";

test("formatDuration keeps progress output compact", () => {
  assert.equal(formatDuration(4_000), "4s");
  assert.equal(formatDuration(240_000), "4m");
  assert.equal(formatDuration(245_000), "4m 5s");
  assert.equal(formatDuration(1_800_000), "30m");
});

test("startWaitFeedback writes progress to configured output and clears interval", () => {
  const lines: string[] = [];
  let tick: (() => void) | undefined;
  let cleared = false;
  let now = 0;
  const interval = {} as ReturnType<typeof setInterval>;

  const feedback = startWaitFeedback({
    timeoutMs: 1_800_000,
    intervalMs: 30_000,
    now: () => now,
    output: {
      write: (line: string) => {
        lines.push(line);
        return true;
      },
    },
    setIntervalFn: (callback: () => void, ms: number) => {
      assert.equal(ms, 30_000);
      tick = callback;
      return interval;
    },
    clearIntervalFn: (value) => {
      assert.equal(value, interval);
      cleared = true;
    },
  });

  now = 240_000;
  tick?.();
  feedback.stop();

  assert.deepEqual(lines, ["waiting for Claude reply... 4m elapsed, timeout 30m\n"]);
  assert.equal(cleared, true);
});
