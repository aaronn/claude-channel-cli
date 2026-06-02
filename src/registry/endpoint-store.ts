import { chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { bridgeDir, ensureBridgeDir } from "../config/paths.js";
import { createEndpointId } from "./endpoint-id.js";
import {
  createEndpointRecord,
  type EndpointRecord,
  parseEndpointRecord,
  refreshEndpointRecord,
  sortEndpointRecords,
} from "./endpoint-record.js";
import { isEndpointLive } from "./liveness.js";

export const endpointsDir = path.join(bridgeDir, "endpoints");

export type EndpointStoreOptions = {
  dir?: string;
  now?: Date;
  exclusive?: boolean;
};

export type EndpointFileResult = {
  path: string;
  record?: EndpointRecord;
  error?: string;
};

export async function ensureEndpointsDir(dir = endpointsDir): Promise<void> {
  await ensureBridgeDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

export function endpointPath(endpointId: string, dir = endpointsDir): string {
  return path.join(dir, `${endpointId}.json`);
}

export async function createUniqueEndpointRecord(input: {
  host: string;
  port: number;
  pid: number;
  projectDir: string;
  now?: Date;
}, options: EndpointStoreOptions = {}): Promise<EndpointRecord> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const record = createEndpointRecord({
      endpointId: createEndpointId(),
      host: input.host,
      port: input.port,
      pid: input.pid,
      projectDir: input.projectDir,
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

export async function writeEndpointRecord(record: EndpointRecord, options: EndpointStoreOptions = {}): Promise<void> {
  const dir = options.dir ?? endpointsDir;
  await ensureEndpointsDir(dir);
  const file = endpointPath(record.endpoint_id, dir);
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
    flag: options.exclusive ? "wx" : "w",
  });
  await chmod(file, 0o600);
}

export async function refreshEndpoint(
  record: EndpointRecord,
  options: EndpointStoreOptions = {},
): Promise<EndpointRecord> {
  const refreshed = refreshEndpointRecord(record, options.now ?? new Date());
  await writeEndpointRecord(refreshed, options);
  return refreshed;
}

export async function removeEndpointRecord(endpointId: string, options: EndpointStoreOptions = {}): Promise<void> {
  await rm(endpointPath(endpointId, options.dir ?? endpointsDir), { force: true });
}

export async function readEndpointRecords(options: EndpointStoreOptions = {}): Promise<EndpointFileResult[]> {
  const dir = options.dir ?? endpointsDir;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") return [];
    throw error;
  }

  const jsonNames = names.filter((name) => name.endsWith(".json"));
  const results = await Promise.all(jsonNames.map(async (name) => {
    const file = path.join(dir, name);
    try {
      return {
        path: file,
        record: parseEndpointRecord(await readFile(file, "utf8"), file),
      };
    } catch (error) {
      return {
        path: file,
        error: error instanceof Error ? error.message : String(error),
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
    if (!result.record) continue;
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
