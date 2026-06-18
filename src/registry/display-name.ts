import path from "node:path";

export const MAX_ENDPOINT_DISPLAY_NAME_LENGTH = 64;

const DEFAULT_DISPLAY_NAME = "Claude Code";

export function normalizeEndpointDisplayName(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error("display_name must be a non-empty string");
  }
  if (hasControlCharacter(normalized)) {
    throw new Error("display_name must not contain control characters");
  }
  if (isListIndex(normalized)) {
    throw new Error("display_name must not be only digits");
  }
  if (displayNameLength(normalized) > MAX_ENDPOINT_DISPLAY_NAME_LENGTH) {
    throw new Error(`display_name must be ${MAX_ENDPOINT_DISPLAY_NAME_LENGTH} characters or fewer`);
  }
  return normalized;
}

export function displayNameForProjectDir(projectDir: string): string {
  const raw = path.basename(projectDir) || projectDir || DEFAULT_DISPLAY_NAME;
  const withoutControls = replaceControlCharacters(raw).trim();
  const fallback = withoutControls || DEFAULT_DISPLAY_NAME;
  return displayNameLength(fallback) <= MAX_ENDPOINT_DISPLAY_NAME_LENGTH
    ? fallback
    : [...fallback].slice(0, MAX_ENDPOINT_DISPLAY_NAME_LENGTH).join("").trim() || DEFAULT_DISPLAY_NAME;
}

function displayNameLength(value: string): number {
  return [...value].length;
}

function isListIndex(value: string): boolean {
  return /^\d+$/.test(value);
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
  return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
}
