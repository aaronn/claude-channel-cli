#!/usr/bin/env node
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readChannelRuntimeConfig } from "./config/env.js";
import { readOrCreateToken } from "./config/paths.js";
import { errorMessage } from "./errors.js";
import { createBridgeHttpServer } from "./http/bridge-server.js";
import { createClaudeChannel } from "./mcp/claude-channel.js";
import { PendingRequests } from "./pending-requests.js";
import type { EndpointRecord } from "./registry/endpoint-record.js";
import { createUniqueEndpointRecord, refreshEndpoint, removeEndpointRecord } from "./registry/endpoint-store.js";

const config = readChannelRuntimeConfig();
const pendingRequests = new PendingRequests();
const channel = createClaudeChannel(pendingRequests);
const projectDir = path.resolve(process.env.CLAUDE_CHANNEL_PROJECT_DIR ?? process.cwd());
let endpointRecord: EndpointRecord | undefined;
let refreshTimer: NodeJS.Timeout | undefined;

const token = await readOrCreateToken();
const httpServer = createBridgeHttpServer({
  host: config.host,
  token,
  maxBodyBytes: config.maxBodyBytes,
  defaultAskTimeoutMs: config.defaultAskTimeoutMs,
  channel,
  pendingRequests,
});

await channel.server.connect(new StdioServerTransport());

httpServer.listen(config.port, config.host, () => {
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  void registerEndpoint(port).catch((error) => {
    console.error(`claude-cli-channel failed to register endpoint: ${errorMessage(error)}`);
    void shutdown().finally(() => process.exit(1));
  });
});

async function registerEndpoint(port: number): Promise<void> {
  endpointRecord = await createUniqueEndpointRecord({
    host: config.host,
    port,
    pid: process.pid,
    projectDir,
  });

  refreshTimer = setInterval(() => {
    if (!endpointRecord) return;
    void refreshCurrentEndpoint();
  }, 30_000);

  console.error(`claude-cli-channel listening on http://${config.host}:${port}`);
  console.error(`claude-cli-channel target: ${endpointRecord.display_name}`);
  console.error(`claude-cli-channel id: ${endpointRecord.endpoint_id}`);
}

async function refreshCurrentEndpoint(): Promise<void> {
  if (!endpointRecord) return;
  try {
    endpointRecord = await refreshEndpoint(endpointRecord);
  } catch (error) {
    console.error(`claude-cli-channel failed to refresh endpoint ${endpointRecord.endpoint_id}: ${errorMessage(error)}`);
  }
}

async function shutdown(): Promise<void> {
  if (refreshTimer) clearInterval(refreshTimer);
  pendingRequests.rejectAll(new Error("claude-cli-channel server stopped"));
  if (endpointRecord) {
    await removeEndpointRecord(endpointRecord.endpoint_id);
  }
  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  });
}

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
