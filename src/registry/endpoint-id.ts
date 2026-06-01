import { randomBytes } from "node:crypto";

const ENDPOINT_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ENDPOINT_ID_LENGTH = 6;

export function createEndpointId(): string {
  const bytes = randomBytes(ENDPOINT_ID_LENGTH);
  let suffix = "";
  for (const byte of bytes) {
    suffix += ENDPOINT_ID_ALPHABET[byte % ENDPOINT_ID_ALPHABET.length];
  }
  return `ep_${suffix}`;
}

export function isEndpointId(value: string): boolean {
  return /^ep_[A-Z2-9]{6}$/.test(value);
}
