import { randomUUID } from "node:crypto";

const META_KEY_RE = /^[A-Za-z0-9_]+$/;
const REQUEST_ID_RE = /^req_[A-Za-z0-9]+$/;

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
    if (META_KEY_RE.test(key)) out[key] = value;
  }
  return out;
}

export function buildChannelMeta(meta: ChannelEventMeta): ChannelEventMeta {
  return sanitizeMeta({
    sender: "codex",
    received_at: new Date().toISOString(),
    ...meta,
  });
}
