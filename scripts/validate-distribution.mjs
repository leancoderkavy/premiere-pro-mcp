#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MCPB_SCHEMA =
  "https://raw.githubusercontent.com/modelcontextprotocol/mcpb/main/schemas/mcpb-manifest-v0.4.schema.json";
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ADOBE_VERSION = /^\d+\.\d+\.\d+$/;

function fail(message) {
  throw new Error(`Distribution validation failed: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`Distribution validation failed: could not read ${file}: ${error.message}`);
  }
}

async function assertFile(file, message) {
  try {
    await access(file);
  } catch {
    fail(message ?? `missing ${file}`);
  }
}

export function validateClaudeManifest(manifest, packageJson) {
  assert(manifest.$schema === MCPB_SCHEMA, "Claude manifest must reference the MCPB v0.4 schema");
  assert(manifest.manifest_version === "0.4", "Claude manifest must use manifest_version 0.4");
  assert(!("dxt_version" in manifest), "Claude manifest must not use deprecated dxt_version");
  assert(manifest.name === packageJson.name, "Claude manifest name must match package.json");
  assert(
    manifest.version === packageJson.version,
    "Claude manifest version must match package.json",
  );
  assert(SEMVER.test(manifest.version), "Claude manifest version must be SemVer");
  assert(typeof manifest.description === "string" && manifest.description.length > 0, "Claude manifest needs a description");
  assert(
    manifest.author && typeof manifest.author.name === "string" && manifest.author.name.length > 0,
    "Claude manifest needs an author name",
  );
  assert(manifest.server?.type === "node", "Claude bundle must declare a Node server");
  assert(
    manifest.server?.entry_point === "server/dist/index.js",
    "Claude bundle entry point must be server/dist/index.js",
  );
  assert(
    manifest.server?.mcp_config?.command === "node",
    "Claude bundle must launch with Claude Desktop's Node runtime",
  );
  assert(
    JSON.stringify(manifest.server?.mcp_config?.args) ===
      JSON.stringify(["${__dirname}/server/dist/index.js"]),
    "Claude bundle command arguments must use a bundle-relative entry point",
  );
  const tokenConfig = manifest.user_config?.premiere_uxp_token;
  assert(
    tokenConfig?.type === "string" &&
      tokenConfig?.sensitive === true &&
      tokenConfig?.required === true,
    "Claude bundle must require a sensitive Premiere UXP token configuration",
  );
  assert(
    manifest.server?.mcp_config?.env?.PREMIERE_UXP_TOKEN ===
      "${user_config.premiere_uxp_token}",
    "Claude bundle must map the configured Premiere UXP token into the server environment",
  );
  assert(
    Array.isArray(manifest.compatibility?.platforms) &&
      manifest.compatibility.platforms.length === 2 &&
      manifest.compatibility.platforms.includes("darwin") &&
      manifest.compatibility.platforms.includes("win32"),
    "Claude bundle must target supported Premiere platforms only (darwin and win32)",
  );
  assert(
    manifest.compatibility?.runtimes?.node === packageJson.engines?.node,
    "Claude bundle Node compatibility must match package.json engines.node",
  );
}

export async function validateClaudeSource({ projectRoot = root } = {}) {
  const packageJson = await readJson(path.join(projectRoot, "package.json"));
  const manifest = await readJson(path.join(projectRoot, "claude-desktop", "manifest.json"));
  validateClaudeManifest(manifest, packageJson);
  return { manifest, packageJson };
}

export async function validateClaudeStage(stage) {
  const manifest = await readJson(path.join(stage, "manifest.json"));
  const packageJson = await readJson(path.join(stage, "package.json"));
  validateClaudeManifest(manifest, packageJson);
  await assertFile(
    path.join(stage, "server", "dist", "index.js"),
    "Claude bundle stage is missing server/dist/index.js; run the TypeScript build first",
  );
  for (const dependency of Object.keys(packageJson.dependencies ?? {})) {
    await assertFile(
      path.join(stage, "node_modules", dependency, "package.json"),
      `Claude bundle stage is missing production dependency ${dependency}`,
    );
  }
  return { manifest, packageJson };
}

export function validateUxpManifest(manifest, packageJson, { expectedId } = {}) {
  assert(manifest.manifestVersion === 5, "UXP manifestVersion must be 5");
  assert(typeof manifest.id === "string" && manifest.id.trim().length > 0, "UXP manifest needs a plugin id");
  assert(!/\s/.test(manifest.id), "UXP plugin id must not contain whitespace");
  if (expectedId) {
    assert(manifest.id === expectedId, "staged UXP plugin id did not match the requested distribution channel");
  }
  assert(manifest.version === packageJson.version, "UXP manifest version must match package.json");
  assert(ADOBE_VERSION.test(manifest.version), "UXP manifest version must use Adobe's major.minor.patch format");
  assert(manifest.host?.app === "premierepro", "UXP package must target Premiere Pro");
  assert(manifest.host?.minVersion === "25.6.0", "UXP package must keep the documented 25.6.0 minimum host version");
  assert(manifest.main === "index.html", "UXP package main entry must be index.html");
  assert(
    Array.isArray(manifest.entrypoints) &&
      manifest.entrypoints.some(
        (entrypoint) => entrypoint.type === "panel" && entrypoint.id === "mcpBridgePanel",
      ),
    "UXP package must include the MCP for Adobe Premiere Pro panel entry point",
  );
  assert(
    manifest.requiredPermissions?.localFileSystem === "request",
    "UXP package must use operator-requested local file access",
  );
  const domains = manifest.requiredPermissions?.network?.domains;
  assert(
    domains === "all",
    "UXP package must use Adobe's compatible network permission; runtime code remains the loopback-only authority",
  );
}

export async function validateUxpSource({ projectRoot = root, expectedId } = {}) {
  const packageJson = await readJson(path.join(projectRoot, "package.json"));
  const pluginRoot = path.join(projectRoot, "uxp-plugin");
  const manifest = await readJson(path.join(pluginRoot, "manifest.json"));
  validateUxpManifest(manifest, packageJson, { expectedId });
  await assertFile(path.join(pluginRoot, manifest.main), "UXP package is missing its main entry file");
  return { manifest, packageJson, pluginRoot };
}

async function main() {
  const requested = new Set(process.argv.slice(2));
  const valid = new Set(["--all", "--claude", "--uxp"]);
  for (const argument of requested) {
    assert(valid.has(argument), `unknown argument ${argument}; use --all, --claude, or --uxp`);
  }
  const validateAll = requested.size === 0 || requested.has("--all");
  if (validateAll || requested.has("--claude")) {
    await validateClaudeSource();
    console.log("Validated Claude Desktop MCPB source manifest.");
  }
  if (validateAll || requested.has("--uxp")) {
    await validateUxpSource();
    console.log("Validated UXP CCX source manifest.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
