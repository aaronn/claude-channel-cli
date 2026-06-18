import path from "node:path";
import { isEndpointId } from "./endpoint-id.js";

export const MAX_ENDPOINT_DISPLAY_NAME_LENGTH = 64;

const DEFAULT_DISPLAY_NAME = "Claude Code";
const RESERVED_TARGET_SUFFIX = "-project";

export function normalizeEndpointDisplayName(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error("display_name must be a non-empty string");
  }
  if (hasControlCharacter(normalized)) {
    throw new Error("display_name must not contain control characters");
  }
  if (isReservedTargetName(normalized)) {
    throw new Error("display_name must not be a reserved target name");
  }
  if (displayNameLength(normalized) > MAX_ENDPOINT_DISPLAY_NAME_LENGTH) {
    throw new Error(`display_name must be ${MAX_ENDPOINT_DISPLAY_NAME_LENGTH} characters or fewer`);
  }
  return normalized;
}

export function displayNameForProjectDir(projectDir: string): string {
  const raw = path.basename(projectDir) || projectDir || DEFAULT_DISPLAY_NAME;
  return safeDisplayNameDefault(raw);
}

export function coerceLegacyEndpointDisplayName(value: string, projectDir: string): string {
  const sanitized = replaceControlCharacters(value).trim();
  return sanitized ? safeDisplayNameDefault(sanitized) : displayNameForProjectDir(projectDir);
}

function safeDisplayNameDefault(value: string): string {
  const fallback = replaceControlCharacters(value).trim() || DEFAULT_DISPLAY_NAME;
  const truncated = displayNameLength(fallback) <= MAX_ENDPOINT_DISPLAY_NAME_LENGTH
    ? fallback
    : [...fallback].slice(0, MAX_ENDPOINT_DISPLAY_NAME_LENGTH).join("").trim() || DEFAULT_DISPLAY_NAME;
  return isReservedTargetName(truncated) ? displayNameForReservedTargetName(truncated) : truncated;
}

function displayNameLength(value: string): number {
  return [...value].length;
}

function isListIndex(value: string): boolean {
  return /^\d+$/.test(value);
}

function isReservedTargetName(value: string): boolean {
  return isListIndex(value) || isEndpointId(value);
}

function displayNameForReservedTargetName(value: string): string {
  const prefixLength = MAX_ENDPOINT_DISPLAY_NAME_LENGTH - RESERVED_TARGET_SUFFIX.length;
  const prefix = [...value].slice(0, prefixLength).join("").trim() || DEFAULT_DISPLAY_NAME;
  return `${prefix}${RESERVED_TARGET_SUFFIX}`;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    if (isControlCharacter(character)) return true;
  }
  return false;
}

function replaceControlCharacters(value: string): string {
  return [...value]
    .map((character) => isControlCharacter(character) ? " " : character)
    .join("");
}

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined &&
    (codePoint <= 0x1f || codePoint === 0x7f || (codePoint >= 0x80 && codePoint <= 0x9f));
}
