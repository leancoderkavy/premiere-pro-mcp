#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { relative, resolve, sep } from "node:path";
import {
  UXP_HYBRID_ADDON_AUTHORITY_URL,
  UXP_HYBRID_ADDON_RECEIPT_SCHEMA_VERSION,
  UXP_HYBRID_ADDON_RECEIPT_SEMANTICS,
  UXP_HYBRID_ADDON_TARGETS,
  UXP_HYBRID_MIN_PREMIERE_VERSION,
} from "./uxp-hybrid-addon-receipt-contract.mjs";
import {
  canonicalNativeSdkHeaderInventorySha256,
  verifyNativeSdkHeaderInventory,
} from "./verify-native-sdk-header-inventory.mjs";
import { verifyUxpHybridAddonReceipt } from "./verify-uxp-hybrid-addon-receipt.mjs";

const MAX_ARTIFACT_BYTES = 2 ** 31;

function receiptError(message) {
  const error = new Error(message);
  error.code = "UXP_HYBRID_ADDON_RECEIPT_INVALID";
  return error;
}

function stringOption(value, label, maximum = 4096) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || value.includes("\0")) {
    throw receiptError(`${label} must be a non-empty string of at most ${maximum} characters`);
  }
  return value;
}

function assertInside(root, candidate, label) {
  const value = resolve(candidate);
  if (value !== root && !value.startsWith(`${root}${sep}`)) throw receiptError(`${label} must stay inside the plugin root`);
  return value;
}

function versionAtLeast(value, minimum) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) return false;
  const left = value.split(".").map(Number), right = minimum.split(".").map(Number);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

function addonName(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]+\.uxpaddon$/.test(value)) {
    throw receiptError("manifest addon.name must be a simple .uxpaddon filename");
  }
  return value;
}

async function requiredPluginFile(root, candidate, label) {
  const requestedPath = assertInside(root, candidate, label);
  let requestedStat;
  try { requestedStat = await lstat(requestedPath); } catch { throw receiptError(`${label} does not exist`); }
  if (requestedStat.isSymbolicLink()) throw receiptError(`${label} must not be a symbolic link`);
  if (!requestedStat.isFile()) throw receiptError(`${label} must be a file`);
  let canonicalPath;
  try { canonicalPath = await realpath(requestedPath); } catch { throw receiptError(`${label} does not exist`); }
  assertInside(root, canonicalPath, label);
  return { path: canonicalPath, size: requestedStat.size };
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolveHash, rejectHash) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectHash);
    stream.on("end", resolveHash);
  });
  return hash.digest("hex");
}

async function readDevelopmentManifest(root) {
  const file = await requiredPluginFile(root, resolve(root, "manifest.json"), "manifest.json");
  if (file.size > 1024 * 1024) throw receiptError("manifest.json is too large");
  let manifest;
  try { manifest = JSON.parse(await readFile(file.path, "utf8")); } catch { throw receiptError("manifest.json must be readable JSON"); }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw receiptError("manifest.json must be an object");
  if (!Number.isInteger(manifest.manifestVersion) || manifest.manifestVersion < 6) {
    throw receiptError("manifest.json must declare manifestVersion 6 or newer");
  }
  if (manifest.host?.app !== "premierepro") throw receiptError("manifest.json host.app must be premierepro");
  if (!versionAtLeast(String(manifest.host?.minVersion || ""), UXP_HYBRID_MIN_PREMIERE_VERSION)) {
    throw receiptError(`manifest.json host.minVersion must be Premiere ${UXP_HYBRID_MIN_PREMIERE_VERSION} or newer`);
  }
  const name = addonName(manifest.addon?.name);
  if (manifest.requiredPermissions?.enableAddon !== true) throw receiptError("manifest.json requiredPermissions.enableAddon must be true");
  return {
    manifestVersion: manifest.manifestVersion,
    hostApp: manifest.host.app,
    hostMinVersion: manifest.host.minVersion,
    addonName: name,
    enableAddon: true,
  };
}

export async function generateUxpHybridAddonReceipt(options) {
  const suppliedPluginRoot = resolve(stringOption(options?.pluginRoot, "pluginRoot"));
  let pluginRoot;
  try { pluginRoot = await realpath(suppliedPluginRoot); } catch { throw receiptError("pluginRoot does not exist"); }
  let rootStat;
  try { rootStat = await lstat(pluginRoot); } catch { throw receiptError("pluginRoot does not exist"); }
  if (!rootStat.isDirectory()) throw receiptError("pluginRoot must be a directory");

  if (!options?.sdkHeaderReceipt || typeof options.sdkHeaderReceipt !== "object") {
    throw receiptError("sdkHeaderReceipt is required");
  }
  const sdkSummary = verifyNativeSdkHeaderInventory(options.sdkHeaderReceipt);
  if (sdkSummary.sdk !== "uxp-hybrid") throw receiptError("sdkHeaderReceipt must identify uxp-hybrid");

  const manifest = await readDevelopmentManifest(pluginRoot);
  const artifacts = [];
  for (const target of UXP_HYBRID_ADDON_TARGETS) {
    const relativePath = `${target.pathPrefix}/${manifest.addonName}`;
    const file = await requiredPluginFile(pluginRoot, resolve(pluginRoot, relativePath), `addon artifact ${target.target}`);
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_ARTIFACT_BYTES) {
      throw receiptError(`addon artifact ${target.target} must be a non-empty file no larger than ${MAX_ARTIFACT_BYTES} bytes`);
    }
    artifacts.push({ target: target.target, path: relativePath, bytes: file.size, sha256: await sha256File(file.path) });
  }

  const receipt = {
    schemaVersion: UXP_HYBRID_ADDON_RECEIPT_SCHEMA_VERSION,
    source: {
      sdk: "uxp-hybrid",
      sdkVersion: options.sdkHeaderReceipt.source.sdkVersion,
      sdkHeaderReceiptSha256: canonicalNativeSdkHeaderInventorySha256(options.sdkHeaderReceipt),
      authorityUrl: UXP_HYBRID_ADDON_AUTHORITY_URL,
    },
    manifest,
    semantics: UXP_HYBRID_ADDON_RECEIPT_SEMANTICS,
    stats: { artifacts: artifacts.length, bytes: artifacts.reduce((total, artifact) => total + artifact.bytes, 0) },
    artifacts,
  };
  verifyUxpHybridAddonReceipt(receipt, { sdkHeaderReceipt: options.sdkHeaderReceipt });
  return receipt;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--plugin-root", "--sdk-header-receipt", "--output"].includes(argument)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw receiptError(`${argument} requires a value`);
      if (argument === "--plugin-root") options.pluginRoot = value;
      else if (argument === "--sdk-header-receipt") options.sdkHeaderReceiptPath = value;
      else options.outputPath = value;
    } else if (argument === "--check") options.check = true;
    else if (argument === "--validate-only") options.validateOnly = true;
    else throw receiptError(`Unknown argument: ${argument}`);
  }
  if (options.check && options.validateOnly) throw receiptError("--check and --validate-only cannot be combined");
  if (!options.pluginRoot || !options.sdkHeaderReceiptPath) throw receiptError("--plugin-root and --sdk-header-receipt are required");
  if (!options.validateOnly && !options.outputPath) throw receiptError("--output is required unless --validate-only is used");
  return options;
}

async function readSdkHeaderReceipt(path) {
  try { return JSON.parse(await readFile(resolve(path), "utf8")); } catch { throw receiptError("sdkHeaderReceipt must be a readable JSON receipt"); }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const receipt = await generateUxpHybridAddonReceipt({
    pluginRoot: options.pluginRoot,
    sdkHeaderReceipt: await readSdkHeaderReceipt(options.sdkHeaderReceiptPath),
  });
  const rendered = `${JSON.stringify(receipt, null, 2)}\n`;
  if (options.validateOnly) {
    process.stdout.write(`Validated ${receipt.stats.artifacts} UXP Hybrid addon artifacts.\n`);
    return;
  }
  const outputPath = resolve(options.outputPath);
  if (options.check) {
    let current = "";
    try { current = await readFile(outputPath, "utf8"); } catch {}
    if (current.replaceAll("\r\n", "\n") !== rendered) {
      throw receiptError("UXP Hybrid addon receipt is stale; rerun without --check after reviewing the local development bundle");
    }
    process.stdout.write(`UXP Hybrid addon receipt is current: ${receipt.stats.artifacts} artifacts.\n`);
    return;
  }
  await writeFile(outputPath, rendered);
  process.stdout.write(`Wrote ${receipt.stats.artifacts} UXP Hybrid addon artifacts.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
