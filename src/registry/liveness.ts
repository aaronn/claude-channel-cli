import type { EndpointRecord } from "./endpoint-record.js";

export const ENDPOINT_STALE_MS = 90_000;

export function isEndpointFresh(record: EndpointRecord, now = new Date(), staleMs = ENDPOINT_STALE_MS): boolean {
  const lastSeen = Date.parse(record.last_seen_at);
  return Number.isFinite(lastSeen) && now.getTime() - lastSeen <= staleMs;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
    return code === "EPERM";
  }
}

export function isEndpointLive(record: EndpointRecord, now = new Date()): boolean {
  return isEndpointFresh(record, now) && isProcessAlive(record.pid);
}
