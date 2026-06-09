import { isIP } from "node:net";
import type { EndpointRecord } from "./endpoint-record.js";

type EndpointAddress = Pick<EndpointRecord, "host" | "port">;

export function formatEndpointBaseUrl(endpoint: EndpointAddress): string {
  return `http://${hostForUrl(endpoint.host)}:${endpoint.port}`;
}

export function formatChannelUrl(endpoint: EndpointAddress, path: string): string {
  return new URL(path, formatEndpointBaseUrl(endpoint)).toString();
}

function hostForUrl(host: string): string {
  return isIP(host) === 6 && !host.startsWith("[") ? `[${host}]` : host;
}
