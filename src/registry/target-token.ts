import { isEndpointId } from "./endpoint-id.js";

export function isListIndexTargetToken(value: string): boolean {
  return /^\d+$/.test(value);
}

export function parseListIndexTargetToken(value: string): number | undefined {
  return isListIndexTargetToken(value) ? Number.parseInt(value, 10) - 1 : undefined;
}

export function isReservedTargetToken(value: string): boolean {
  return isListIndexTargetToken(value) || isEndpointId(value);
}
