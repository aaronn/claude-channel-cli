import { isEndpointId } from "./endpoint-id.js";

export function parseListIndexTargetToken(value: string): number | undefined {
  if (!/^[1-9]\d*$/.test(value)) return undefined;

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed - 1 : undefined;
}

export function isReservedTargetToken(value: string): boolean {
  return isEndpointId(value) || /^\d+$/.test(value);
}
