import assert from "node:assert/strict";
import test from "node:test";
import {
  displayNameForProjectDir,
  MAX_ENDPOINT_DISPLAY_NAME_LENGTH,
  normalizeEndpointDisplayName,
} from "../src/registry/display-name.js";

test("normalizeEndpointDisplayName trims human labels", () => {
  assert.equal(normalizeEndpointDisplayName("  review-left  "), "review-left");
});

test("normalizeEndpointDisplayName rejects empty, reserved, and invisible labels", () => {
  assert.throws(() => normalizeEndpointDisplayName("   "), /non-empty string/);
  assert.throws(() => normalizeEndpointDisplayName("2"), /reserved target name/);
  assert.throws(() => normalizeEndpointDisplayName("001"), /reserved target name/);
  assert.throws(() => normalizeEndpointDisplayName("ep_ABC234"), /reserved target name/);
  assert.throws(() => normalizeEndpointDisplayName("bad\u202Ename"), /control or formatting characters/);
});

test("normalizeEndpointDisplayName rejects labels longer than the display limit", () => {
  assert.throws(
    () => normalizeEndpointDisplayName("x".repeat(MAX_ENDPOINT_DISPLAY_NAME_LENGTH + 1)),
    /64 characters or fewer/,
  );
});

test("displayNameForProjectDir creates safe default labels", () => {
  assert.equal(displayNameForProjectDir("/repo/app"), "app");
  assert.equal(displayNameForProjectDir("/repo/2"), "2-project");
  assert.equal(displayNameForProjectDir("/repo/ep_ABC234"), "ep_ABC234-project");
  assert.equal(displayNameForProjectDir(`/repo/${"x".repeat(MAX_ENDPOINT_DISPLAY_NAME_LENGTH + 1)}`).length, 64);
  assert.match(displayNameForProjectDir(`/repo/${"1".repeat(MAX_ENDPOINT_DISPLAY_NAME_LENGTH + 1)}`), /-project$/);
});
