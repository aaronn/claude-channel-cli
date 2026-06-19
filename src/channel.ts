#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createEndpointLifecycle, type ChannelEndpointLifecycle } from "./channel-lifecycle.js";
import { isChannelReady } from "./channel-readiness.js";
import { DEFAULT_CHANNEL_INITIALIZE_TIMEOUT_MS } from "./config/defaults.js";
import { readChannelRuntimeConfig } from "./config/env.js";
import { readOrCreateToken } from "./config/paths.js";
import { errorMessage } from "./errors.js";
import { createBridgeHttpServer } from "./http/bridge-server.js";
import { createClaudeChannel } from "./mcp/claude-channel.js";
import { PendingRequests } from "./pending-requests.js";
import { formatEndpointBaseUrl } from "./registry/endpoint-url.js";

void main().catch((error) => {
  console.error(errorMessage(error));
  process.exit(1);
});

async function main(): Promise<void> {
  const config = readChannelRuntimeConfig();
  const pendingRequests = new PendingRequests();
  const channel = createClaudeChannel(pendingRequests);
  const projectDir = path.resolve(process.env.CLAUDE_CHANNEL_PROJECT_DIR ?? process.cwd());
  const token = await readOrCreateToken();

  const httpServer = createBridgeHttpServer({
    host: config.host,
    token,
    maxBodyBytes: config.maxBodyBytes,
    defaultAskTimeoutMs: config.defaultAskTimeoutMs,
    channel,
    endpoint: {
      renameDisplayName: (displayName) => lifecycle.renameDisplayName(displayName),
    },
    pendingRequests,
  });

  const lifecycle = createEndpointLifecycle({
    host: config.host,
    projectDir,
    displayName: config.displayName,
    pendingRequests,
    closeHttpServer: () => closeHttpServer(httpServer),
  });

  wireShutdownHandlers(channel.server, lifecycle);

  try {
    const initialized = waitForInitialized(channel.server, DEFAULT_CHANNEL_INITIALIZE_TIMEOUT_MS);
    await channel.server.connect(new StdioServerTransport());
    await initialized;

    if (!isChannelReady(channel.server.getClientCapabilities())) {
      console.error(
        "claude-channel-cli did not register an endpoint because Claude Code did not enable channel delivery.",
      );
      console.error("Start Claude Code with: claude --dangerously-load-development-channels server:claude-channel-cli");
      await channel.server.close();
      await lifecycle.shutdown();
      return;
    }

    const port = await listen(httpServer, config.port, config.host);
    const endpointRecord = await lifecycle.register(port);
    console.error(`claude-channel-cli listening on ${formatEndpointBaseUrl(endpointRecord)}`);
    console.error(`claude-channel-cli target: ${endpointRecord.display_name}`);
    console.error(`claude-channel-cli id: ${endpointRecord.endpoint_id}`);
  } catch (error) {
    await lifecycle.shutdown(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

function wireShutdownHandlers(server: Server, lifecycle: ChannelEndpointLifecycle): void {
  const shutdown = (): void => {
    void lifecycle.shutdown();
  };
  const shutdownAndExit = (): void => {
    void lifecycle.shutdown().finally(() => process.exit(0));
  };

  server.onclose = shutdown;
  process.stdin.once("end", shutdown);
  process.stdin.once("close", shutdown);
  process.on("SIGINT", shutdownAndExit);
  process.on("SIGTERM", shutdownAndExit);
}

async function waitForInitialized(server: Server, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const previousInitialized = server.oninitialized;
    const previousClose = server.onclose;
    const timeout = setTimeout(() => {
      settle(new Error(`timed out waiting ${timeoutMs}ms for Claude Code MCP initialization`));
    }, timeoutMs);

    const settle = (error?: Error): void => {
      clearTimeout(timeout);
      server.oninitialized = previousInitialized;
      server.onclose = previousClose;
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    server.oninitialized = () => {
      previousInitialized?.();
      settle();
    };
    server.onclose = () => {
      previousClose?.();
      settle(new Error("Claude Code closed the MCP connection before initialization completed"));
    };
  });
}

async function listen(server: http.Server, port: number, host: string): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  return typeof address === "object" && address ? address.port : port;
}

async function closeHttpServer(server: http.Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}
