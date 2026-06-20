import path from "node:path";
import { isReservedTargetToken } from "./target-token.js";

export const MAX_ENDPOINT_DISPLAY_NAME_LENGTH = 64;

declare const endpointDisplayNameBrand: unique symbol;

export type EndpointDisplayName = string & { readonly [endpointDisplayNameBrand]: true };

const DEFAULT_DISPLAY_NAME = "Claude Code";
const RESERVED_DISPLAY_NAME_SUFFIX = "-project";
const INVISIBLE_OR_CONTROL_DISPLAY_CHARACTER_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export function normalizeEndpointDisplayName(value: string, label = "display_name"): EndpointDisplayName {
  if (hasUnsafeDisplayCharacter(value)) {
    throw new Error(`${label} must not contain control or formatting characters`);
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (isReservedTargetToken(normalized)) {
    throw new Error(`${label} must not be a reserved target name`);
  }
  if (displayNameLength(normalized) > MAX_ENDPOINT_DISPLAY_NAME_LENGTH) {
    throw new Error(`${label} must be ${MAX_ENDPOINT_DISPLAY_NAME_LENGTH} characters or fewer`);
  }

  return normalized as EndpointDisplayName;
}

export function displayNameForProjectDir(projectDir: string): EndpointDisplayName {
  const projectName = path.basename(projectDir) || projectDir || DEFAULT_DISPLAY_NAME;
  return toDefaultDisplayName(projectName);
}

function toDefaultDisplayName(value: string): EndpointDisplayName {
  const safe = replaceUnsafeDisplayCharacters(value).trim() || DEFAULT_DISPLAY_NAME;
  const candidate = truncateDisplayName(safe, MAX_ENDPOINT_DISPLAY_NAME_LENGTH) || DEFAULT_DISPLAY_NAME;
  if (!isReservedTargetToken(candidate)) return candidate as EndpointDisplayName;

  const prefixLength = MAX_ENDPOINT_DISPLAY_NAME_LENGTH - RESERVED_DISPLAY_NAME_SUFFIX.length;
  const prefix = truncateDisplayName(candidate, prefixLength) || DEFAULT_DISPLAY_NAME;
  return `${prefix}${RESERVED_DISPLAY_NAME_SUFFIX}` as EndpointDisplayName;
}

function truncateDisplayName(value: string, maxLength: number): string {
  if (displayNameLength(value) <= maxLength) return value;
  return [...value].slice(0, maxLength).join("").trim();
}

function replaceUnsafeDisplayCharacters(value: string): string {
  return [...value]
    .map((character) => hasUnsafeDisplayCharacter(character) ? " " : character)
    .join("");
}

function hasUnsafeDisplayCharacter(value: string): boolean {
  return INVISIBLE_OR_CONTROL_DISPLAY_CHARACTER_RE.test(value);
}

function displayNameLength(value: string): number {
  return [...value].length;
}
