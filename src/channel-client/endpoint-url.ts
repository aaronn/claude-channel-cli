import { isIP } from "node:net";
import type { EndpointRecord } from "../registry/endpoint-record.js";

export function formatChannelUrl(endpoint: Pick<EndpointRecord, "host" | "port">, path: string): string {
  return new URL(path, `http://${hostForUrl(endpoint.host)}:${endpoint.port}`).toString();
}

function hostForUrl(host: string): string {
  return isIP(host) === 6 && !host.startsWith("[") ? `[${host}]` : host;
}
