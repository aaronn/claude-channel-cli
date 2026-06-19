import path from "node:path";
import { isReservedTargetToken } from "./target-token.js";

export const MAX_ENDPOINT_DISPLAY_NAME_LENGTH = 64;
declare const endpointDisplayNameBrand: unique symbol;

export type EndpointDisplayName = string & { readonly [endpointDisplayNameBrand]: true };

const DEFAULT_DISPLAY_NAME = "Claude Code";
const RESERVED_TARGET_SUFFIX = "-project";
const UNSAFE_BASE_DISPLAY_CHARACTER_RE = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const FORMAT_CHARACTER_RE = /\p{Cf}/u;
// ZWNJ is meaningful in scripts such as Persian and Indic languages.
const ZERO_WIDTH_NON_JOINER = 0x200c;
// ZWJ is meaningful for emoji sequences and script shaping.
const ZERO_WIDTH_JOINER = 0x200d;

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
  const raw = path.basename(projectDir) || projectDir || DEFAULT_DISPLAY_NAME;
  return safeDisplayNameDefault(raw);
}

export function coerceLegacyEndpointDisplayName(value: string, projectDir: string): EndpointDisplayName {
  const sanitized = replaceUnsafeDisplayCharacters(value).trim();
  return sanitized ? safeDisplayNameDefault(sanitized) : displayNameForProjectDir(projectDir);
}

function safeDisplayNameDefault(value: string): EndpointDisplayName {
  const fallback = replaceUnsafeDisplayCharacters(value).trim() || DEFAULT_DISPLAY_NAME;
  const truncated = displayNameLength(fallback) <= MAX_ENDPOINT_DISPLAY_NAME_LENGTH
    ? fallback
    : [...fallback].slice(0, MAX_ENDPOINT_DISPLAY_NAME_LENGTH).join("").trim() || DEFAULT_DISPLAY_NAME;
  return (
    isReservedTargetToken(truncated)
      ? displayNameForReservedTargetToken(truncated)
      : truncated
  ) as EndpointDisplayName;
}

function displayNameLength(value: string): number {
  return [...value].length;
}

function displayNameForReservedTargetToken(value: string): string {
  const prefixLength = MAX_ENDPOINT_DISPLAY_NAME_LENGTH - RESERVED_TARGET_SUFFIX.length;
  const prefix = [...value].slice(0, prefixLength).join("").trim() || DEFAULT_DISPLAY_NAME;
  return `${prefix}${RESERVED_TARGET_SUFFIX}`;
}

function replaceUnsafeDisplayCharacters(value: string): string {
  return [...value]
    .map((character) => isUnsafeDisplayCharacter(character) ? " " : character)
    .join("");
}

function hasUnsafeDisplayCharacter(value: string): boolean {
  return [...value].some(isUnsafeDisplayCharacter);
}

function isUnsafeDisplayCharacter(character: string): boolean {
  if (UNSAFE_BASE_DISPLAY_CHARACTER_RE.test(character)) return true;
  if (!FORMAT_CHARACTER_RE.test(character)) return false;

  const codePoint = character.codePointAt(0);
  return codePoint !== ZERO_WIDTH_NON_JOINER && codePoint !== ZERO_WIDTH_JOINER;
}
