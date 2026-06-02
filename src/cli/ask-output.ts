import type { AskResponse, AskStatus } from "../protocol.js";

export type AskOutputFormat = "text" | "json";

export const ASK_STATUS_EXIT_CODES: Record<AskStatus, number> = {
  answered: 0,
  needs_user: 3,
  declined: 4,
  failed: 5,
};

export function parseAskOutputFormat(value: string | undefined): AskOutputFormat {
  if (value === undefined || value === "text") return "text";
  if (value === "json") return "json";
  throw new Error("output must be either text or json");
}

export function renderAskResponse(response: AskResponse, format: AskOutputFormat): string {
  if (format === "json") {
    return `${JSON.stringify(response)}\n`;
  }

  return response.answer.endsWith("\n") ? response.answer : `${response.answer}\n`;
}

export function exitCodeForAskStatus(status: AskStatus): number {
  return ASK_STATUS_EXIT_CODES[status];
}

export function statusSummaryForAskStatus(status: AskStatus): string | undefined {
  if (status === "answered") return undefined;
  return `Claude request ended with status: ${status}\n`;
}
