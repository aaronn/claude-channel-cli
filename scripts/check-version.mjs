import { readFile } from "node:fs/promises";

const packageJson = await readJson("package.json");
const expected = packageJson.version;

const checks = [
  ["src/version.ts", await readVersionConstant("src/version.ts")],
  [".codex-plugin/plugin.json", (await readJson(".codex-plugin/plugin.json")).version],
];

const mismatches = checks.filter(([, version]) => version !== expected);
if (mismatches.length > 0) {
  for (const [file, version] of mismatches) {
    console.error(`${file} version ${String(version)} does not match package.json version ${expected}`);
  }
  process.exit(1);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function readVersionConstant(file) {
  const source = await readFile(file, "utf8");
  const match = /^export const VERSION = "([^"]+)";$/m.exec(source);
  if (!match) {
    throw new Error(`${file} must export VERSION as a string literal`);
  }
  return match[1];
}
