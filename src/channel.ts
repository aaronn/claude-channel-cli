#!/usr/bin/env node
import path from "node:path";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { detectChannelReadiness } from "./channel-readiness.js";
import { readChannelRuntimeConfig } from "./config/env.js";
import { readOrCreateToken } from "./config/paths.js";
import { errorMessage } from "./errors.js";
import { createBridgeHttpServer } from "./http/bridge-server.js";
import { createClaudeChannel } from "./mcp/claude-channel.js";
import { PendingRequests } from "./pending-requests.js";
import type { EndpointRecord } from "./registry/endpoint-record.js";
import { formatEndpointBaseUrl } from "./registry/endpoint-url.js";
import { createUniqueEndpointRecord, refreshEndpoint, removeEndpointRecord, renameEndpoint } from "./registry/endpoint-store.js";

const config = readChannelRuntimeConfig();
const pendingRequests = new PendingRequests();
const channel = createClaudeChannel(pendingRequests);
const projectDir = path.resolve(process.env.CLAUDE_CHANNEL_PROJECT_DIR ?? process.cwd());
let endpointRecord: EndpointRecord | undefined;
let refreshTimer: NodeJS.Timeout | undefined;
let endpointWriteQueue = Promise.resolve();
let httpServerListening = false;
let shuttingDown = false;

const token = await readOrCreateToken();
const httpServer = createBridgeHttpServer({
  host: config.host,
  token,
  maxBodyBytes: config.maxBodyBytes,
  defaultAskTimeoutMs: config.defaultAskTimeoutMs,
  channel,
  endpoint: {
    renameDisplayName,
  },
  pendingRequests,
});

const initialized = waitForInitialized(channel.server);
await channel.server.connect(new StdioServerTransport());
await initialized;

const readiness = detectChannelReadiness(channel.server.getClientCapabilities());
if (!readiness.ready) {
  console.error(
    "claude-channel-cli did not register an endpoint because Claude Code did not enable channel delivery.",
  );
  console.error("Start Claude Code with: claude --dangerously-load-development-channels server:claude-channel-cli");
} else {
  httpServer.listen(config.port, config.host, () => {
    httpServerListening = true;
    const address = httpServer.address();
    const port = typeof address === "object" && address ? address.port : config.port;
    void registerEndpoint(port).catch((error) => {
      console.error(`claude-channel-cli failed to register endpoint: ${errorMessage(error)}`);
      void shutdown().finally(() => process.exit(1));
    });
  });
}

async function registerEndpoint(port: number): Promise<void> {
  endpointRecord = await createUniqueEndpointRecord({
    host: config.host,
    port,
    pid: process.pid,
    projectDir,
    displayName: config.displayName,
  });

  refreshTimer = setInterval(() => {
    if (!endpointRecord) return;
    void refreshCurrentEndpoint();
  }, 30_000);

  console.error(`claude-channel-cli listening on ${formatEndpointBaseUrl(endpointRecord)}`);
  console.error(`claude-channel-cli target: ${endpointRecord.display_name}`);
  console.error(`claude-channel-cli id: ${endpointRecord.endpoint_id}`);
}

async function refreshCurrentEndpoint(): Promise<void> {
  try {
    await updateEndpointRecord(async (record) => refreshEndpoint(record));
  } catch (error) {
    const endpointId = endpointRecord?.endpoint_id ?? "unknown";
    console.error(`claude-channel-cli failed to refresh endpoint ${endpointId}: ${errorMessage(error)}`);
  }
}

async function renameDisplayName(displayName: string): Promise<{ endpoint_id: string; display_name: string }> {
  const renamed = await updateEndpointRecord(async (record) => renameEndpoint(record, displayName));
  return {
    endpoint_id: renamed.endpoint_id,
    display_name: renamed.display_name,
  };
}

async function updateEndpointRecord(
  operation: (record: EndpointRecord) => Promise<EndpointRecord>,
): Promise<EndpointRecord> {
  const update = endpointWriteQueue.then(async () => {
    if (shuttingDown) {
      throw new Error("Claude channel endpoint is shutting down");
    }
    if (!endpointRecord) {
      throw new Error("Claude channel endpoint is not registered yet");
    }
    endpointRecord = await operation(endpointRecord);
    return endpointRecord;
  });
  endpointWriteQueue = update.then(() => undefined, () => undefined);
  return update;
}

async function shutdown(): Promise<void> {
  shuttingDown = true;
  if (refreshTimer) clearInterval(refreshTimer);
  pendingRequests.rejectAll(new Error("claude-channel-cli server stopped"));
  await endpointWriteQueue;
  if (endpointRecord) {
    await removeEndpointRecord(endpointRecord.endpoint_id);
    endpointRecord = undefined;
  }
  if (httpServerListening) {
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  }
}

async function waitForInitialized(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.oninitialized = resolve;
  });
}

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
