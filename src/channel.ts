#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readChannelRuntimeConfig } from "./config/env.js";
import { readOrCreateToken, writeState } from "./config/paths.js";
import { createBridgeHttpServer } from "./http/bridge-server.js";
import { createClaudeChannel } from "./mcp/claude-channel.js";
import { PendingRequests } from "./pending-requests.js";

const config = readChannelRuntimeConfig();
const pendingRequests = new PendingRequests();
const channel = createClaudeChannel(pendingRequests);

const token = process.env.CLAUDE_CHANNEL_TOKEN ?? (await readOrCreateToken());
const httpServer = createBridgeHttpServer({
  host: config.host,
  token,
  maxBodyBytes: config.maxBodyBytes,
  defaultAskTimeoutMs: config.defaultAskTimeoutMs,
  channel,
  pendingRequests,
});

await channel.server.connect(new StdioServerTransport());

httpServer.listen(config.port, config.host, async () => {
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : config.port;

  await writeState({
    schema_version: 1,
    host: config.host,
    port,
    pid: process.pid,
    started_at: new Date().toISOString(),
  });

  console.error(`claude-cli-channel listening on http://${config.host}:${port}`);
});

process.on("SIGINT", () => {
  pendingRequests.rejectAll(new Error("claude-cli-channel server stopped"));
  httpServer.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  pendingRequests.rejectAll(new Error("claude-cli-channel server stopped"));
  httpServer.close();
  process.exit(0);
});
