export function readRecordObject(args: unknown, message: string): Record<string, unknown> {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new Error(message);
  }
  return args as Record<string, unknown>;
}

export function readRequiredString(
  record: Record<string, unknown>,
  key: string,
  options: { trim?: boolean } = {},
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return options.trim ? value.trim() : value;
}

export function readOptionalString(
  record: Record<string, unknown>,
  key: string,
  options: { trim?: boolean } = {},
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string when provided`);
  }
  return options.trim ? value.trim() : value;
}

export function parsePositiveIntegerString(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

export function parsePositiveIntegerEnv(value: string | undefined, name: string, fallback: number): number {
  if (!value) return fallback;
  try {
    return parsePositiveIntegerString(value, name);
  } catch {
    return fallback;
  }
}

export function readOptionalPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = record[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer when provided`);
  }
  return value;
}
