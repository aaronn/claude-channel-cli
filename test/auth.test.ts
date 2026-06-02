import assert from "node:assert/strict";
import type http from "node:http";
import test from "node:test";
import { isAuthorized } from "../src/security/auth.js";

function requestWithAuthorization(authorization: unknown): http.IncomingMessage {
  return { headers: { authorization } } as unknown as http.IncomingMessage;
}

test("isAuthorized accepts an exact bearer token", () => {
  assert.equal(isAuthorized(requestWithAuthorization("Bearer secret"), "secret"), true);
});

test("isAuthorized rejects missing, malformed, array, and wrong bearer tokens", () => {
  assert.equal(isAuthorized(requestWithAuthorization(undefined), "secret"), false);
  assert.equal(isAuthorized(requestWithAuthorization("secret"), "secret"), false);
  assert.equal(isAuthorized(requestWithAuthorization(["Bearer secret"]), "secret"), false);
  assert.equal(isAuthorized(requestWithAuthorization("Bearer wrong"), "secret"), false);
});
