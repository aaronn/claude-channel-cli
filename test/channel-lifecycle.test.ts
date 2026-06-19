import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createEndpointLifecycle } from "../src/channel-lifecycle.js";
import { HttpError } from "../src/errors.js";
import { PendingRequests } from "../src/pending-requests.js";
import { createUniqueEndpointRecord, listLiveEndpoints } from "../src/registry/endpoint-store.js";

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

test("endpoint lifecycle registers and removes its endpoint on shutdown", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-channel-lifecycle-"));
  let closeCount = 0;
  try {
    const lifecycle = createEndpointLifecycle({
      host: "127.0.0.1",
      projectDir: "/repo/app",
      pendingRequests: new PendingRequests(),
      closeHttpServer: async () => {
        closeCount += 1;
      },
      endpointStoreOptions: { dir },
      refreshIntervalMs: 60_000,
    });

    const record = await lifecycle.register(49152);
    assert.deepEqual(await listLiveEndpoints({ dir, now: new Date() }), [record]);

    await lifecycle.shutdown();
    await lifecycle.shutdown();

    assert.deepEqual(await listLiveEndpoints({ dir, now: new Date() }), []);
    assert.equal(closeCount, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("endpoint lifecycle rejects rename before registration or after shutdown", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-channel-lifecycle-"));
  try {
    const lifecycle = createEndpointLifecycle({
      host: "127.0.0.1",
      projectDir: "/repo/app",
      pendingRequests: new PendingRequests(),
      closeHttpServer: async () => {},
      endpointStoreOptions: { dir },
      refreshIntervalMs: 60_000,
    });

    await assert.rejects(
      lifecycle.renameDisplayName("review-left"),
      (error) => error instanceof HttpError && error.status === 503,
    );

    await lifecycle.register(49152);
    await lifecycle.shutdown();

    await assert.rejects(
      lifecycle.renameDisplayName("review-left"),
      (error) => error instanceof HttpError && error.status === 503,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("endpoint lifecycle removes records created after shutdown starts", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-channel-lifecycle-"));
  const createStarted = deferred();
  const allowCreate = deferred();
  try {
    const lifecycle = createEndpointLifecycle({
      host: "127.0.0.1",
      projectDir: "/repo/app",
      pendingRequests: new PendingRequests(),
      closeHttpServer: async () => {},
      endpointStoreOptions: { dir },
      refreshIntervalMs: 60_000,
      store: {
        createUniqueEndpointRecord: async (input, options) => {
          createStarted.resolve();
          await allowCreate.promise;
          return createUniqueEndpointRecord(input, options);
        },
      },
    });

    const register = lifecycle.register(49152);
    await createStarted.promise;
    const shutdown = lifecycle.shutdown();
    allowCreate.resolve();

    await assert.rejects(register, (error) => error instanceof HttpError && error.status === 503);
    await shutdown;

    assert.deepEqual(await listLiveEndpoints({ dir, now: new Date() }), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
