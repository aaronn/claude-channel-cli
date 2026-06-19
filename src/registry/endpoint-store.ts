import { randomUUID } from "node:crypto";
import { chmod, link as linkFile, mkdir, readFile, readdir, rename as renameFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { bridgeDir, ensureBridgeDir } from "../config/paths.js";
import { createEndpointId } from "./endpoint-id.js";
import {
  createEndpointRecord,
  type EndpointRecord,
  parseEndpointRecord,
  refreshEndpointRecord,
  renameEndpointRecord,
  sortEndpointRecords,
} from "./endpoint-record.js";
import { isEndpointLive } from "./liveness.js";

export const endpointsDir = path.join(bridgeDir, "endpoints");
const TEMP_ENDPOINT_STALE_MS = 5 * 60_000;

export type EndpointStoreOptions = {
  dir?: string;
  now?: Date;
};

type EndpointFileResult = {
  path: string;
  record?: EndpointRecord;
};

type EndpointWriteOptions = EndpointStoreOptions & {
  exclusive?: boolean;
};

async function ensureEndpointsDir(dir = endpointsDir): Promise<void> {
  if (dir === endpointsDir) {
    await ensureBridgeDir();
  }
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

function endpointPath(endpointId: string, dir = endpointsDir): string {
  return path.join(dir, `${endpointId}.json`);
}

export async function createUniqueEndpointRecord(input: {
  host: string;
  port: number;
  pid: number;
  projectDir: string;
  displayName?: string;
  now?: Date;
}, options: EndpointStoreOptions = {}): Promise<EndpointRecord> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const record = createEndpointRecord({
      endpointId: createEndpointId(),
      host: input.host,
      port: input.port,
      pid: input.pid,
      projectDir: input.projectDir,
      displayName: input.displayName,
      now: input.now,
    });

    try {
      await writeEndpointRecord(record, { ...options, exclusive: true });
      return record;
    } catch (error) {
      if (isFileExistsError(error)) continue;
      throw error;
    }
  }

  throw new Error("failed to allocate a unique Claude channel endpoint id");
}

async function writeEndpointRecord(record: EndpointRecord, options: EndpointWriteOptions = {}): Promise<void> {
  const dir = options.dir ?? endpointsDir;
  await ensureEndpointsDir(dir);
  const file = endpointPath(record.endpoint_id, dir);
  const content = `${JSON.stringify(record, null, 2)}\n`;

  const tempFile = path.join(dir, `.${record.endpoint_id}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempFile, content, { mode: 0o600, flag: "wx" });
    await chmod(tempFile, 0o600);
    if (options.exclusive) {
      await linkFile(tempFile, file);
    } else {
      await renameFile(tempFile, file);
    }
  } finally {
    await rm(tempFile, { force: true });
  }
}

export async function refreshEndpoint(
  record: EndpointRecord,
  options: EndpointStoreOptions = {},
): Promise<EndpointRecord> {
  const refreshed = refreshEndpointRecord(record, options.now ?? new Date());
  await writeEndpointRecord(refreshed, options);
  return refreshed;
}

export async function renameEndpoint(
  record: EndpointRecord,
  displayName: string,
  options: EndpointStoreOptions = {},
): Promise<EndpointRecord> {
  const renamed = renameEndpointRecord(record, displayName);
  await writeEndpointRecord(renamed, options);
  return renamed;
}

export async function removeEndpointRecord(endpointId: string, options: EndpointStoreOptions = {}): Promise<void> {
  await rm(endpointPath(endpointId, options.dir ?? endpointsDir), { force: true });
}

async function readEndpointRecords(options: EndpointStoreOptions = {}): Promise<EndpointFileResult[]> {
  const dir = options.dir ?? endpointsDir;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") return [];
    throw error;
  }

  const now = options.now ?? new Date();
  await Promise.all(names.map((name) => pruneStaleTempEndpointFile(dir, name, now)));

  const jsonNames = names.filter((name) => name.endsWith(".json"));
  const results = await Promise.all(jsonNames.map(async (name) => {
    const file = path.join(dir, name);
    try {
      return {
        path: file,
        record: parseEndpointRecord(await readFile(file, "utf8"), file),
      };
    } catch {
      return {
        path: file,
      };
    }
  }));

  return results;
}

export async function listLiveEndpoints(options: EndpointStoreOptions = {}): Promise<EndpointRecord[]> {
  const now = options.now ?? new Date();
  const results = await readEndpointRecords(options);
  const live: EndpointRecord[] = [];

  for (const result of results) {
    if (!result.record) {
      await rm(result.path, { force: true });
      continue;
    }
    if (isEndpointLive(result.record, now)) {
      live.push(result.record);
    } else {
      await rm(result.path, { force: true });
    }
  }

  return sortEndpointRecords(live);
}

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST";
}

async function pruneStaleTempEndpointFile(dir: string, name: string, now = new Date()): Promise<void> {
  if (!name.startsWith(".") || !name.endsWith(".tmp")) return;

  const file = path.join(dir, name);
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(file);
  } catch {
    return;
  }

  if (now.getTime() - fileStat.mtime.getTime() >= TEMP_ENDPOINT_STALE_MS) {
    await rm(file, { force: true });
  }
}
