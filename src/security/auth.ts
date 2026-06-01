import type http from "node:http";

export function isAuthorized(req: http.IncomingMessage, token: string): boolean {
  return req.headers.authorization === `Bearer ${token}`;
}
