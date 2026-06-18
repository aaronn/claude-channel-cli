import assert from "node:assert/strict";
import test from "node:test";
import {
  displayNameForProjectDir,
  MAX_ENDPOINT_DISPLAY_NAME_LENGTH,
  normalizeEndpointDisplayName,
} from "../src/registry/display-name.js";

test("normalizeEndpointDisplayName trims and accepts human names", () => {
  assert.equal(normalizeEndpointDisplayName("  review-left  "), "review-left");
  assert.equal(normalizeEndpointDisplayName("Claude Review"), "Claude Review");
});

test("normalizeEndpointDisplayName rejects empty, numeric, control, and long names", () => {
  assert.throws(() => normalizeEndpointDisplayName("   "), /non-empty/);
  assert.throws(() => normalizeEndpointDisplayName("2"), /reserved target name/);
  assert.throws(() => normalizeEndpointDisplayName("001"), /reserved target name/);
  assert.throws(() => normalizeEndpointDisplayName("ep_ABC234"), /reserved target name/);
  assert.throws(() => normalizeEndpointDisplayName("bad\nname"), /control characters/);
  assert.throws(() => normalizeEndpointDisplayName("bad\u0085name"), /control characters/);
  assert.throws(
    () => normalizeEndpointDisplayName("x".repeat(MAX_ENDPOINT_DISPLAY_NAME_LENGTH + 1)),
    /64 characters or fewer/,
  );
});

test("displayNameForProjectDir returns a valid safe default", () => {
  assert.equal(displayNameForProjectDir("/repo/app"), "app");
  assert.equal(displayNameForProjectDir("/repo/bad\nname"), "bad name");
  assert.equal(displayNameForProjectDir("/repo/123"), "123-project");
  assert.equal(displayNameForProjectDir("/repo/ep_ABC234"), "ep_ABC234-project");
  assert.equal(
    normalizeEndpointDisplayName(displayNameForProjectDir(`/repo/${"1".repeat(MAX_ENDPOINT_DISPLAY_NAME_LENGTH + 10)}`)),
    `${"1".repeat(MAX_ENDPOINT_DISPLAY_NAME_LENGTH - "-project".length)}-project`,
  );
  assert.equal(
    displayNameForProjectDir(`/repo/${"x".repeat(MAX_ENDPOINT_DISPLAY_NAME_LENGTH + 10)}`).length,
    MAX_ENDPOINT_DISPLAY_NAME_LENGTH,
  );
});
