import { isEndpointId } from "./endpoint-id.js";
import {
  coerceLegacyEndpointDisplayName,
  displayNameForProjectDir,
  type EndpointDisplayName,
  normalizeEndpointDisplayName,
} from "./display-name.js";

export type EndpointRecord = {
  schema_version: 1;
  endpoint_id: string;
  host: string;
  port: number;
  pid: number;
  project_dir: string;
  display_name: EndpointDisplayName;
  started_at: string;
  last_seen_at: string;
};

export type EndpointCandidate = {
  index: number;
  target: string;
  endpoint_id: string;
  display_name: string;
  project_dir: string;
  host: string;
  port: number;
  pid: number;
  started_at: string;
  last_seen_at: string;
  last_seen_seconds: number;
};

export function createEndpointRecord(input: {
  endpointId: string;
  host: string;
  port: number;
  pid: number;
  projectDir: string;
  displayName?: string;
  now?: Date;
}): EndpointRecord {
  const now = input.now ?? new Date();
  return {
    schema_version: 1,
    endpoint_id: input.endpointId,
    host: input.host,
    port: input.port,
    pid: input.pid,
    project_dir: input.projectDir,
    display_name: input.displayName === undefined
      ? displayNameForProjectDir(input.projectDir)
      : normalizeEndpointDisplayName(input.displayName),
    started_at: now.toISOString(),
    last_seen_at: now.toISOString(),
  };
}

export function refreshEndpointRecord(record: EndpointRecord, now = new Date()): EndpointRecord {
  return {
    ...record,
    last_seen_at: now.toISOString(),
  };
}

export function renameEndpointRecord(record: EndpointRecord, displayName: string): EndpointRecord {
  return {
    ...record,
    display_name: normalizeEndpointDisplayName(displayName),
  };
}

export function parseEndpointRecord(raw: string, source = "endpoint record"): EndpointRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${source} is invalid: expected JSON object`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${source} is invalid: expected JSON object`);
  }

  const record = parsed as Partial<EndpointRecord>;
  if (record.schema_version !== 1) {
    throw new Error(`${source} is invalid: schema_version must be 1`);
  }
  if (typeof record.endpoint_id !== "string" || !isEndpointId(record.endpoint_id)) {
    throw new Error(`${source} is invalid: endpoint_id must be an endpoint id`);
  }
  if (typeof record.host !== "string" || record.host.trim().length === 0) {
    throw new Error(`${source} is invalid: host must be a non-empty string`);
  }
  const port = record.port;
  if (typeof port !== "number" || !Number.isInteger(port) || port <= 0) {
    throw new Error(`${source} is invalid: port must be a positive integer`);
  }
  const pid = record.pid;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    throw new Error(`${source} is invalid: pid must be a positive integer`);
  }
  if (typeof record.project_dir !== "string" || record.project_dir.trim().length === 0) {
    throw new Error(`${source} is invalid: project_dir must be a non-empty string`);
  }
  if (typeof record.display_name !== "string") {
    throw new Error(`${source} is invalid: display_name must be a string`);
  }
  let displayName: EndpointDisplayName;
  try {
    displayName = normalizeEndpointDisplayName(record.display_name);
  } catch {
    displayName = coerceLegacyEndpointDisplayName(record.display_name, record.project_dir);
  }
  if (!isValidDate(record.started_at)) {
    throw new Error(`${source} is invalid: started_at must be a valid timestamp`);
  }
  if (!isValidDate(record.last_seen_at)) {
    throw new Error(`${source} is invalid: last_seen_at must be a valid timestamp`);
  }

  return {
    schema_version: 1,
    endpoint_id: record.endpoint_id,
    host: record.host,
    port,
    pid,
    project_dir: record.project_dir,
    display_name: displayName,
    started_at: record.started_at,
    last_seen_at: record.last_seen_at,
  };
}

export function toEndpointCandidates(records: EndpointRecord[], now = new Date()): EndpointCandidate[] {
  return sortEndpointRecords(records).map((record, index) => ({
    index: index + 1,
    target: record.endpoint_id,
    endpoint_id: record.endpoint_id,
    display_name: record.display_name,
    project_dir: record.project_dir,
    host: record.host,
    port: record.port,
    pid: record.pid,
    started_at: record.started_at,
    last_seen_at: record.last_seen_at,
    last_seen_seconds: Math.max(0, Math.round((now.getTime() - Date.parse(record.last_seen_at)) / 1000)),
  }));
}

export function sortEndpointRecords(records: EndpointRecord[]): EndpointRecord[] {
  return [...records].sort((a, b) => {
    const byName = a.display_name.localeCompare(b.display_name);
    if (byName !== 0) return byName;
    const byProject = a.project_dir.localeCompare(b.project_dir);
    if (byProject !== 0) return byProject;
    return a.endpoint_id.localeCompare(b.endpoint_id);
  });
}

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
