import { randomUUID } from "node:crypto";

const META_KEY_RE = /^[A-Za-z0-9_]+$/;
const MAX_META_VALUE_LENGTH = 200;
// Metadata is serialized into Claude channel attributes, so control characters are intentionally rejected.
// eslint-disable-next-line no-control-regex
const UNSAFE_META_VALUE_RE = /[\u0000-\u001F\u007F<>"'`]/;
const REQUEST_ID_RE = /^req_[A-Za-z0-9]+$/;
export const DEFAULT_CHANNEL_SENDER = "codex";

export type ChannelEventMeta = Record<string, string>;

export type AskStatus = "answered" | "needs_user" | "declined" | "failed";

export type AskCompletion = {
  requestId: string;
  status: AskStatus;
  answer: string;
};

export type AskResponse = {
  ok: true;
  request_id: string;
  status: AskStatus;
  answer: string;
};

export function createRequestId(): string {
  return `req_${randomUUID().replaceAll("-", "")}`;
}

export function isRequestId(value: string): boolean {
  return REQUEST_ID_RE.test(value);
}

export function sanitizeMeta(meta: ChannelEventMeta): ChannelEventMeta {
  const out: ChannelEventMeta = {};
  for (const [key, value] of Object.entries(meta)) {
    if (META_KEY_RE.test(key) && isSafeMetaValue(value)) out[key] = value;
  }
  return out;
}

export function isSafeMetaValue(value: string): boolean {
  return value.length > 0 &&
    value.length <= MAX_META_VALUE_LENGTH &&
    !UNSAFE_META_VALUE_RE.test(value);
}

export function normalizeChannelSender(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_CHANNEL_SENDER;

  const trimmed = value.trim();
  return isSafeMetaValue(trimmed) ? trimmed : DEFAULT_CHANNEL_SENDER;
}

export function buildChannelMeta(meta: ChannelEventMeta): ChannelEventMeta {
  const sanitized = sanitizeMeta({
    sender: DEFAULT_CHANNEL_SENDER,
    received_at: new Date().toISOString(),
    ...meta,
  });

  if (!sanitized.sender) sanitized.sender = DEFAULT_CHANNEL_SENDER;
  return sanitized;
}
