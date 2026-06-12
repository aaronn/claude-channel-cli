import { homedir } from "node:os";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CODEX_PLUGIN_NAME = "claude-channel-cli";
export const DEFAULT_CODEX_MARKETPLACE_NAME = "personal";
export const DEFAULT_CODEX_MARKETPLACE_DISPLAY_NAME = "Personal";

export type SetupCodexPluginOptions = {
  homeDir?: string;
  packageRoot?: string;
  dryRun?: boolean;
  force?: boolean;
  platform?: NodeJS.Platform;
};

export type SetupCodexPluginAction = {
  kind:
    | "create_directory"
    | "create_symlink"
    | "replace_symlink"
    | "create_marketplace"
    | "add_marketplace_entry";
  path: string;
  detail: string;
};

export type SetupCodexPluginResult = {
  dryRun: boolean;
  force: boolean;
  changed: boolean;
  homeDir: string;
  packageRoot: string;
  pluginPath: string;
  marketplacePath: string;
  marketplaceName: string;
  pluginSelector: string;
  installCommand: string;
  actions: SetupCodexPluginAction[];
};

type Marketplace = {
  name: string;
  interface?: {
    displayName?: string;
    [key: string]: unknown;
  };
  plugins: unknown[];
  [key: string]: unknown;
};

type MarketplacePluginEntry = {
  name: string;
  source: {
    source: "local";
    path: string;
  };
  policy: {
    installation: "AVAILABLE";
    authentication: "ON_INSTALL";
  };
  category: "Developer Tools";
};

export async function setupCodexPlugin(options: SetupCodexPluginOptions = {}): Promise<SetupCodexPluginResult> {
  const dryRun = options.dryRun === true;
  const force = options.force === true;
  const homeDir = path.resolve(options.homeDir ?? homedir());
  const packageRoot = await resolvePackageRoot(options.packageRoot);
  const pluginPath = path.join(homeDir, "plugins", CODEX_PLUGIN_NAME);
  const marketplacePath = path.join(homeDir, ".agents", "plugins", "marketplace.json");
  const platform = options.platform ?? process.platform;

  await ensurePluginRoot(packageRoot);
  const plannedActions: SetupCodexPluginAction[] = [];
  const plannedMarketplaceName = await runSetupSteps({
    actions: plannedActions,
    dryRun: true,
    force,
    marketplacePath,
    packageRoot,
    platform,
    pluginPath,
  });

  const actions: SetupCodexPluginAction[] = [];
  const marketplaceName = dryRun ? plannedMarketplaceName : await runSetupSteps({
    actions,
    dryRun,
    force,
    marketplacePath,
    packageRoot,
    platform,
    pluginPath,
  });
  const pluginSelector = `${CODEX_PLUGIN_NAME}@${marketplaceName}`;

  return {
    dryRun,
    force,
    changed: (dryRun ? plannedActions : actions).length > 0,
    homeDir,
    packageRoot,
    pluginPath,
    marketplacePath,
    marketplaceName,
    pluginSelector,
    installCommand: `codex plugin add ${pluginSelector}`,
    actions: dryRun ? plannedActions : actions,
  };
}

async function runSetupSteps(options: {
  actions: SetupCodexPluginAction[];
  dryRun: boolean;
  force: boolean;
  marketplacePath: string;
  packageRoot: string;
  platform: NodeJS.Platform;
  pluginPath: string;
}): Promise<string> {
  await ensurePluginSource(options);
  return ensureMarketplaceEntry(options);
}

export function formatSetupCodexPluginResult(result: SetupCodexPluginResult): string {
  const title = result.changed
    ? result.dryRun
      ? `Would configure ${CODEX_PLUGIN_NAME} for Codex Desktop.`
      : `Configured ${CODEX_PLUGIN_NAME} for Codex Desktop.`
    : `${CODEX_PLUGIN_NAME} is already configured for Codex Desktop.`;
  const actionLines = result.actions.length > 0
    ? ["", ...result.actions.map((action) => `- ${action.detail}`)]
    : [];

  return [
    title,
    ...actionLines,
    "",
    `Marketplace: ${result.marketplacePath}`,
    `Plugin source: ${result.pluginPath}`,
    "",
    result.dryRun ? "Then install the plugin with:" : "Next install the plugin with:",
    result.installCommand,
    "",
  ].join("\n");
}

export function desiredMarketplaceEntry(): MarketplacePluginEntry {
  return {
    name: CODEX_PLUGIN_NAME,
    source: {
      source: "local",
      path: `./plugins/${CODEX_PLUGIN_NAME}`,
    },
    policy: {
      installation: "AVAILABLE",
      authentication: "ON_INSTALL",
    },
    category: "Developer Tools",
  };
}

async function resolvePackageRoot(packageRoot: string | undefined): Promise<string> {
  const root = path.resolve(packageRoot ?? fileURLToPath(new URL("../../", import.meta.url)));
  return realpath(root);
}

async function ensurePluginRoot(packageRoot: string): Promise<void> {
  const manifestPath = path.join(packageRoot, ".codex-plugin", "plugin.json");
  try {
    await lstat(manifestPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`Codex plugin manifest not found at ${manifestPath}`, { cause: error });
    }
    throw error;
  }
}

async function ensurePluginSource(options: {
  actions: SetupCodexPluginAction[];
  dryRun: boolean;
  force: boolean;
  packageRoot: string;
  platform: NodeJS.Platform;
  pluginPath: string;
}): Promise<void> {
  const pluginParent = path.dirname(options.pluginPath);
  if (!await pathExists(pluginParent)) {
    options.actions.push({
      kind: "create_directory",
      path: pluginParent,
      detail: `Create ${pluginParent}`,
    });
    if (!options.dryRun) await mkdir(pluginParent, { recursive: true });
  }

  const existing = await lstat(options.pluginPath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  });

  if (!existing) {
    options.actions.push({
      kind: "create_symlink",
      path: options.pluginPath,
      detail: `Link ${options.pluginPath} -> ${options.packageRoot}`,
    });
    if (!options.dryRun) await symlink(options.packageRoot, options.pluginPath, symlinkType(options.platform));
    return;
  }

  const existingTarget = await realpath(options.pluginPath).catch(() => undefined);
  if (existingTarget === options.packageRoot) return;

  if (!existing.isSymbolicLink()) {
    throw new Error(`${options.pluginPath} already exists and does not point to ${options.packageRoot}`);
  }
  if (!options.force) {
    throw new Error(`${options.pluginPath} already points elsewhere; rerun with --force to replace that symlink`);
  }

  options.actions.push({
    kind: "replace_symlink",
    path: options.pluginPath,
    detail: `Replace ${options.pluginPath} -> ${options.packageRoot}`,
  });
  if (!options.dryRun) {
    await unlink(options.pluginPath);
    await symlink(options.packageRoot, options.pluginPath, symlinkType(options.platform));
  }
}

async function ensureMarketplaceEntry(options: {
  actions: SetupCodexPluginAction[];
  dryRun: boolean;
  force: boolean;
  marketplacePath: string;
}): Promise<string> {
  const marketplaceParent = path.dirname(options.marketplacePath);
  if (!await pathExists(marketplaceParent)) {
    options.actions.push({
      kind: "create_directory",
      path: marketplaceParent,
      detail: `Create ${marketplaceParent}`,
    });
    if (!options.dryRun) await mkdir(marketplaceParent, { recursive: true });
  }

  const current = await readMarketplace(options.marketplacePath);
  const desiredEntry = desiredMarketplaceEntry();

  if (!current) {
    const marketplace = createDefaultMarketplace(desiredEntry);
    options.actions.push({
      kind: "create_marketplace",
      path: options.marketplacePath,
      detail: `Create ${options.marketplacePath}`,
    });
    if (!options.dryRun) await writeMarketplace(options.marketplacePath, marketplace);
    return marketplace.name;
  }

  const existingIndex = current.plugins.findIndex((entry) => pluginEntryName(entry) === CODEX_PLUGIN_NAME);
  if (existingIndex === -1) {
    current.plugins.push(desiredEntry);
    options.actions.push({
      kind: "add_marketplace_entry",
      path: options.marketplacePath,
      detail: `Add ${CODEX_PLUGIN_NAME} to marketplace ${current.name}`,
    });
    if (!options.dryRun) await writeMarketplace(options.marketplacePath, current);
    return current.name;
  }

  const existingEntry = current.plugins[existingIndex];
  if (!isDesiredEntry(existingEntry, desiredEntry)) {
    throw new Error(
      [
        `${CODEX_PLUGIN_NAME} already exists in ${options.marketplacePath} but does not match the expected local plugin entry.`,
        `Expected source.path to be ${desiredEntry.source.path}.`,
        "Edit or remove that marketplace entry manually, then rerun setup-codex-plugin.",
      ].join(" "),
    );
  }

  return current.name;
}

async function readMarketplace(marketplacePath: string): Promise<Marketplace | undefined> {
  let content: string;
  try {
    content = await readFile(marketplacePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse ${marketplacePath}: ${detail}`, { cause: error });
  }

  if (!isRecord(parsed)) throw new Error(`${marketplacePath} must contain a JSON object`);
  if (typeof parsed.name !== "string" || parsed.name.trim() === "") {
    throw new Error(`${marketplacePath} must contain a non-empty string name`);
  }
  if (!Array.isArray(parsed.plugins)) {
    throw new Error(`${marketplacePath} must contain a plugins array`);
  }

  return parsed as Marketplace;
}

function createDefaultMarketplace(entry: MarketplacePluginEntry): Marketplace {
  return {
    name: DEFAULT_CODEX_MARKETPLACE_NAME,
    interface: {
      displayName: DEFAULT_CODEX_MARKETPLACE_DISPLAY_NAME,
    },
    plugins: [entry],
  };
}

async function writeMarketplace(marketplacePath: string, marketplace: Marketplace): Promise<void> {
  const tempPath = path.join(
    path.dirname(marketplacePath),
    `.${path.basename(marketplacePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const existing = await lstat(marketplacePath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  });
  const mode = existing ? existing.mode & 0o777 : 0o644;

  try {
    await writeFile(tempPath, `${JSON.stringify(marketplace, null, 2)}\n`, { encoding: "utf8", mode });
    await rename(tempPath, marketplacePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function pluginEntryName(entry: unknown): string | undefined {
  return isRecord(entry) && typeof entry.name === "string" ? entry.name : undefined;
}

function isDesiredEntry(entry: unknown, desired: MarketplacePluginEntry): boolean {
  if (!isRecord(entry)) return false;
  if (entry.name !== desired.name) return false;
  if (!isRecord(entry.source)) return false;
  if (entry.source.source !== desired.source.source || entry.source.path !== desired.source.path) return false;
  if (!isRecord(entry.policy)) return false;
  if (
    entry.policy.installation !== desired.policy.installation ||
    entry.policy.authentication !== desired.policy.authentication
  ) {
    return false;
  }
  return entry.category === desired.category;
}

function symlinkType(platform: NodeJS.Platform): "dir" | "junction" {
  return platform === "win32" ? "junction" : "dir";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
