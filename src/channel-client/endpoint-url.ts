import type { EndpointRecord } from "../registry/endpoint-record.js";

export function formatChannelUrl(endpoint: Pick<EndpointRecord, "host" | "port">, path: string): string {
  return `http://${endpoint.host}:${endpoint.port}${path}`;
}
