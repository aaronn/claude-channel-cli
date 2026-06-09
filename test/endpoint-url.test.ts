import assert from "node:assert/strict";
import test from "node:test";
import { formatChannelUrl } from "../src/channel-client/endpoint-url.js";

test("formatChannelUrl formats IPv4 and hostname endpoints", () => {
  assert.equal(
    formatChannelUrl({ host: "127.0.0.1", port: 8788 }, "/ask?timeout_ms=42"),
    "http://127.0.0.1:8788/ask?timeout_ms=42",
  );
  assert.equal(
    formatChannelUrl({ host: "localhost", port: 8788 }, "/health"),
    "http://localhost:8788/health",
  );
});

test("formatChannelUrl brackets raw IPv6 hosts", () => {
  assert.equal(
    formatChannelUrl({ host: "::1", port: 8788 }, "/tell"),
    "http://[::1]:8788/tell",
  );
  assert.equal(
    formatChannelUrl({ host: "[::1]", port: 8788 }, "/tell"),
    "http://[::1]:8788/tell",
  );
});
