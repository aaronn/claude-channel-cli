import { isEndpointId } from "./endpoint-id.js";

export function isListIndexTargetToken(value: string): boolean {
  return /^\d+$/.test(value);
}

export function isReservedTargetToken(value: string): boolean {
  return isListIndexTargetToken(value) || isEndpointId(value);
}
