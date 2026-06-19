import type { PendingRequests } from "./pending-requests.js";
import type { EndpointDisplayName } from "./registry/display-name.js";
import type { EndpointRecord } from "./registry/endpoint-record.js";
import {
  createUniqueEndpointRecord,
  type EndpointStoreOptions,
  refreshEndpoint,
  removeEndpointRecord,
  renameEndpoint,
} from "./registry/endpoint-store.js";
import { HttpError, errorMessage } from "./errors.js";

const DEFAULT_REFRESH_INTERVAL_MS = 30_000;
const DEFAULT_REFRESH_FAILURE_LIMIT = 3;
const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS = 2_000;

export type ChannelEndpointLifecycle = {
  register: (port: number) => Promise<EndpointRecord>;
  renameDisplayName: (displayName: string) => Promise<{ endpoint_id: string; display_name: string }>;
  shutdown: (reason?: Error) => Promise<void>;
};

export type ChannelEndpointLifecycleOptions = {
  host: string;
  projectDir: string;
  displayName?: EndpointDisplayName;
  pendingRequests: PendingRequests;
  closeHttpServer: () => Promise<void>;
  endpointStoreOptions?: EndpointStoreOptions;
  refreshIntervalMs?: number;
  refreshFailureLimit?: number;
  shutdownDrainTimeoutMs?: number;
  log?: (message: string) => void;
  store?: Partial<EndpointLifecycleStore>;
};

type EndpointLifecycleStore = {
  createUniqueEndpointRecord: typeof createUniqueEndpointRecord;
  refreshEndpoint: typeof refreshEndpoint;
  removeEndpointRecord: typeof removeEndpointRecord;
  renameEndpoint: typeof renameEndpoint;
};

export function createEndpointLifecycle(options: ChannelEndpointLifecycleOptions): ChannelEndpointLifecycle {
  let endpointRecord: EndpointRecord | undefined;
  let refreshTimer: NodeJS.Timeout | undefined;
  let endpointWriteQueue = Promise.resolve();
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | undefined;
  let consecutiveRefreshFailures = 0;

  const log = options.log ?? console.error;
  const refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
  const refreshFailureLimit = options.refreshFailureLimit ?? DEFAULT_REFRESH_FAILURE_LIMIT;
  const shutdownDrainTimeoutMs = options.shutdownDrainTimeoutMs ?? DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS;
  const store: EndpointLifecycleStore = {
    createUniqueEndpointRecord,
    refreshEndpoint,
    removeEndpointRecord,
    renameEndpoint,
    ...options.store,
  };

  async function register(port: number): Promise<EndpointRecord> {
    if (shuttingDown) {
      throw new HttpError(503, "Claude channel endpoint is shutting down");
    }

    const registered = await store.createUniqueEndpointRecord({
      host: options.host,
      port,
      pid: process.pid,
      projectDir: options.projectDir,
      displayName: options.displayName,
    }, options.endpointStoreOptions);

    if (shuttingDown) {
      await store.removeEndpointRecord(registered.endpoint_id, options.endpointStoreOptions);
      throw new HttpError(503, "Claude channel endpoint is shutting down");
    }

    endpointRecord = registered;

    refreshTimer = setInterval(() => {
      void refreshCurrentEndpoint();
    }, refreshIntervalMs);

    return endpointRecord;
  }

  async function refreshCurrentEndpoint(): Promise<void> {
    try {
      await updateEndpointRecord((record) => store.refreshEndpoint(record, options.endpointStoreOptions));
      consecutiveRefreshFailures = 0;
    } catch (error) {
      consecutiveRefreshFailures += 1;
      const endpointId = endpointRecord?.endpoint_id ?? "unknown";
      log(`claude-channel-cli failed to refresh endpoint ${endpointId}: ${errorMessage(error)}`);
      if (consecutiveRefreshFailures >= refreshFailureLimit) {
        log(`claude-channel-cli is shutting down after ${consecutiveRefreshFailures} endpoint refresh failures.`);
        await shutdown(new Error("claude-channel-cli endpoint refresh failed"));
      }
    }
  }

  async function renameDisplayName(displayName: string): Promise<{ endpoint_id: string; display_name: string }> {
    const renamed = await updateEndpointRecord((record) => store.renameEndpoint(record, displayName, options.endpointStoreOptions));
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
        throw new HttpError(503, "Claude channel endpoint is shutting down");
      }
      if (!endpointRecord) {
        throw new HttpError(503, "Claude channel endpoint is not registered yet");
      }

      const updated = await operation(endpointRecord);
      if (shuttingDown) {
        await store.removeEndpointRecord(updated.endpoint_id, options.endpointStoreOptions);
        throw new HttpError(503, "Claude channel endpoint is shutting down");
      }

      endpointRecord = updated;
      return endpointRecord;
    });
    endpointWriteQueue = update.then(() => undefined, () => undefined);
    return update;
  }

  async function shutdown(reason = new Error("claude-channel-cli server stopped")): Promise<void> {
    shutdownPromise ??= runShutdown(reason);
    return shutdownPromise;
  }

  async function runShutdown(reason: Error): Promise<void> {
    shuttingDown = true;
    if (refreshTimer) clearInterval(refreshTimer);
    options.pendingRequests.rejectAll(reason);
    await drainEndpointWrites(endpointWriteQueue, shutdownDrainTimeoutMs, log);

    if (endpointRecord) {
      await store.removeEndpointRecord(endpointRecord.endpoint_id, options.endpointStoreOptions);
      endpointRecord = undefined;
    }

    await options.closeHttpServer();
  }

  return {
    register,
    renameDisplayName,
    shutdown,
  };
}

async function drainEndpointWrites(
  queue: Promise<void>,
  timeoutMs: number,
  log: (message: string) => void,
): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  let timedOut = false;
  try {
    await Promise.race([
      queue,
      new Promise<void>((resolve) => {
        timeout = setTimeout(() => {
          timedOut = true;
          resolve();
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  if (timedOut) {
    log(`claude-channel-cli continued shutdown after endpoint writes did not drain within ${timeoutMs}ms.`);
  }
}
