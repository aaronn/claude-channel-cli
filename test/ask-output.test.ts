import assert from "node:assert/strict";
import test from "node:test";
import {
  exitCodeForAskStatus,
  parseAskOutputFormat,
  renderAskResponse,
  statusSummaryForAskStatus,
} from "../src/cli/ask-output.js";
import type { AskResponse } from "../src/protocol.js";

const response: AskResponse & { target: string } = {
  ok: true,
  request_id: "req_abc123",
  status: "answered",
  answer: "review complete",
  target: "ep_ABC234",
};

test("parseAskOutputFormat defaults to text and accepts json", () => {
  assert.equal(parseAskOutputFormat(undefined), "text");
  assert.equal(parseAskOutputFormat("text"), "text");
  assert.equal(parseAskOutputFormat("json"), "json");
  assert.throws(() => parseAskOutputFormat("yaml"), /output must be either text or json/);
});

test("renderAskResponse defaults to terminal-friendly answer text", () => {
  assert.equal(renderAskResponse(response, "text"), "review complete\n");
});

test("renderAskResponse preserves existing trailing newline in text mode", () => {
  assert.equal(
    renderAskResponse({ ...response, answer: "review complete\n" }, "text"),
    "review complete\n",
  );
});

test("renderAskResponse preserves leading whitespace in text mode", () => {
  assert.equal(renderAskResponse({ ...response, answer: "\n  indented" }, "text"), "\n  indented\n");
});

test("renderAskResponse emits the structured envelope in JSON mode", () => {
  const output = renderAskResponse(response, "json");

  assert.deepEqual(JSON.parse(output) as unknown, response);
  assert.equal(output.endsWith("\n"), true);
});

test("exitCodeForAskStatus maps Claude completion statuses", () => {
  assert.equal(exitCodeForAskStatus("answered"), 0);
  assert.equal(exitCodeForAskStatus("needs_user"), 3);
  assert.equal(exitCodeForAskStatus("declined"), 4);
  assert.equal(exitCodeForAskStatus("failed"), 5);
});

test("statusSummaryForAskStatus reports only non-answered statuses", () => {
  assert.equal(statusSummaryForAskStatus("answered"), undefined);
  assert.equal(statusSummaryForAskStatus("needs_user"), "Claude request ended with status: needs_user\n");
});
