import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CODEX_PLUGIN_NAME,
  desiredMarketplaceEntry,
  formatSetupCodexPluginResult,
  setupCodexPlugin,
} from "../src/cli/setup-codex-plugin.js";

test("setupCodexPlugin creates the personal marketplace entry and plugin symlink", async () => {
  await withFixture(async ({ homeDir, packageRoot }) => {
    const result = await setupCodexPlugin({ homeDir, packageRoot });

    assert.equal(result.changed, true);
    assert.equal(result.marketplaceName, "personal");
    assert.equal(result.pluginSelector, "claude-channel-cli@personal");
    assert.equal(result.installCommand, "codex plugin add claude-channel-cli@personal");
    assert.equal(await realpath(path.join(homeDir, "plugins", CODEX_PLUGIN_NAME)), packageRoot);
    assert.deepEqual(await readMarketplace(homeDir), {
      name: "personal",
      interface: {
        displayName: "Personal",
      },
      plugins: [desiredMarketplaceEntry()],
    });
  });
});

test("setupCodexPlugin is idempotent when the marketplace already points at this package", async () => {
  await withFixture(async ({ homeDir, packageRoot }) => {
    await setupCodexPlugin({ homeDir, packageRoot });
    const second = await setupCodexPlugin({ homeDir, packageRoot });

    assert.equal(second.changed, false);
    assert.deepEqual(second.actions, []);
    assert.match(formatSetupCodexPluginResult(second), /already configured/);
  });
});

test("setupCodexPlugin preserves existing marketplace name and unrelated entries", async () => {
  await withFixture(async ({ homeDir, packageRoot }) => {
    await mkdir(path.join(homeDir, ".agents", "plugins"), { recursive: true });
    const otherEntry = {
      name: "other-plugin",
      source: { source: "local", path: "./plugins/other-plugin" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Productivity",
    };
    await writeMarketplace(homeDir, {
      name: "team-local",
      interface: {
        displayName: "Team Local",
      },
      plugins: [otherEntry],
    });

    const result = await setupCodexPlugin({ homeDir, packageRoot });
    const marketplace = await readMarketplace(homeDir);

    assert.equal(result.pluginSelector, "claude-channel-cli@team-local");
    assert.equal(result.installCommand, "codex plugin add claude-channel-cli@team-local");
    assert.equal(marketplace.name, "team-local");
    assert.deepEqual(marketplace.plugins, [otherEntry, desiredMarketplaceEntry()]);
  });
});

test("setupCodexPlugin dry run reports actions without writing files", async () => {
  await withFixture(async ({ homeDir, packageRoot }) => {
    const result = await setupCodexPlugin({ homeDir, packageRoot, dryRun: true });

    assert.equal(result.dryRun, true);
    assert.equal(result.changed, true);
    assert.match(formatSetupCodexPluginResult(result), /Would configure/);
    assert.equal(await exists(path.join(homeDir, "plugins")), false);
    assert.equal(await exists(path.join(homeDir, ".agents", "plugins", "marketplace.json")), false);
  });
});

test("setupCodexPlugin rejects a conflicting plugin symlink unless force is set", async () => {
  await withFixture(async ({ homeDir, packageRoot, tempDir }) => {
    const otherRoot = await createPackageRoot(path.join(tempDir, "other-package"));
    const pluginParent = path.join(homeDir, "plugins");
    const pluginPath = path.join(pluginParent, CODEX_PLUGIN_NAME);
    await mkdir(pluginParent, { recursive: true });
    await symlink(otherRoot, pluginPath, "dir");

    await assert.rejects(
      setupCodexPlugin({ homeDir, packageRoot }),
      /already points elsewhere/,
    );

    const result = await setupCodexPlugin({ homeDir, packageRoot, force: true });

    assert.equal(result.changed, true);
    assert.equal(await realpath(pluginPath), packageRoot);
  });
});

test("setupCodexPlugin rejects a conflicting marketplace entry even when force is set", async () => {
  await withFixture(async ({ homeDir, packageRoot }) => {
    await mkdir(path.join(homeDir, "plugins"), { recursive: true });
    await symlink(packageRoot, path.join(homeDir, "plugins", CODEX_PLUGIN_NAME), "dir");
    await mkdir(path.join(homeDir, ".agents", "plugins"), { recursive: true });
    await writeMarketplace(homeDir, {
      name: "personal",
      plugins: [
        {
          name: CODEX_PLUGIN_NAME,
          source: { source: "local", path: "./plugins/something-else" },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Developer Tools",
        },
      ],
    });

    await assert.rejects(
      setupCodexPlugin({ homeDir, packageRoot }),
      /already exists.*does not match/,
    );
    await assert.rejects(
      setupCodexPlugin({ homeDir, packageRoot, force: true }),
      /Edit or remove that marketplace entry manually/,
    );
  });
});

test("setupCodexPlugin preserves a matching marketplace entry with extra metadata", async () => {
  await withFixture(async ({ homeDir, packageRoot }) => {
    await mkdir(path.join(homeDir, "plugins"), { recursive: true });
    await symlink(packageRoot, path.join(homeDir, "plugins", CODEX_PLUGIN_NAME), "dir");
    await mkdir(path.join(homeDir, ".agents", "plugins"), { recursive: true });
    const entry = {
      ...desiredMarketplaceEntry(),
      policy: {
        ...desiredMarketplaceEntry().policy,
        products: ["codex"],
      },
      notes: "keep me",
    };
    await writeMarketplace(homeDir, {
      name: "personal",
      plugins: [entry],
    });

    const result = await setupCodexPlugin({ homeDir, packageRoot });
    const marketplace = await readMarketplace(homeDir);

    assert.equal(result.changed, false);
    assert.deepEqual(marketplace.plugins, [entry]);
  });
});

async function withFixture(
  callback: (fixture: { tempDir: string; homeDir: string; packageRoot: string }) => Promise<void>,
): Promise<void> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "claude-channel-codex-plugin-"));
  try {
    const homeDir = path.join(tempDir, "home");
    const packageRoot = await createPackageRoot(path.join(tempDir, "package"));
    await mkdir(homeDir, { recursive: true });
    await callback({ tempDir, homeDir, packageRoot });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function createPackageRoot(packageRoot: string): Promise<string> {
  await mkdir(path.join(packageRoot, ".codex-plugin"), { recursive: true });
  await writeFile(path.join(packageRoot, ".codex-plugin", "plugin.json"), "{}\n", "utf8");
  return realpath(packageRoot);
}

async function readMarketplace(homeDir: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(
    await readFile(path.join(homeDir, ".agents", "plugins", "marketplace.json"), "utf8"),
  );
  assert.equal(typeof parsed, "object");
  assert.notEqual(parsed, null);
  assert.equal(Array.isArray(parsed), false);
  return parsed as Record<string, unknown>;
}

async function writeMarketplace(homeDir: string, marketplace: Record<string, unknown>): Promise<void> {
  await writeFile(
    path.join(homeDir, ".agents", "plugins", "marketplace.json"),
    `${JSON.stringify(marketplace, null, 2)}\n`,
    "utf8",
  );
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
  }
}
