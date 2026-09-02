#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  UXP_HYBRID_ADDON_AUTHORITY_URL,
  UXP_HYBRID_ADDON_RECEIPT_SCHEMA_VERSION,
  UXP_HYBRID_ADDON_RECEIPT_SEMANTICS,
  UXP_HYBRID_ADDON_TARGETS,
  compareUxpHybridPaths,
} from "./uxp-hybrid-addon-receipt-contract.mjs";
import {
  canonicalNativeSdkHeaderInventorySha256,
  verifyNativeSdkHeaderInventory,
} from "./verify-native-sdk-header-inventory.mjs";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_PATH_LENGTH = 512;
const MAX_ARTIFACT_BYTES = 2 ** 31;

function receiptError(message) {
  const error = new Error(message);
  error.code = "UXP_HYBRID_ADDON_RECEIPT_INVALID";
  return error;
}

function record(value, label, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw receiptError(`${label} must be an object`);
  const keys = Object.keys(value).sort(compareUxpHybridPaths);
  const expected = [...expectedKeys].sort(compareUxpHybridPaths);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw receiptError(`${label} must contain only the documented receipt fields`);
  }
  return value;
}

function nonEmptyString(value, label, maximum = MAX_PATH_LENGTH) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || value.includes("\0")) {
    throw receiptError(`${label} must be a non-empty string of at most ${maximum} characters`);
  }
  return value;
}

function sha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw receiptError(`${label} must be a lowercase SHA-256 hex digest`);
  }
  return value;
}

function safePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_ARTIFACT_BYTES) {
    throw receiptError(`${label} must be a positive safe integer no larger than ${MAX_ARTIFACT_BYTES}`);
  }
  return value;
}

function addonName(value) {
  const name = nonEmptyString(value, "manifest.addonName", 128);
  if (!/^[A-Za-z0-9._-]+\.uxpaddon$/.test(name)) {
    throw receiptError("manifest.addonName must be a simple .uxpaddon filename");
  }
  return name;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort(compareUxpHybridPaths).map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function expectedArtifactPath(target, name) {
  return `${target.pathPrefix}/${name}`;
}

export function verifyUxpHybridAddonReceipt(document, options = {}) {
  const receipt = record(document, "receipt", ["schemaVersion", "source", "manifest", "semantics", "stats", "artifacts"]);
  if (receipt.schemaVersion !== UXP_HYBRID_ADDON_RECEIPT_SCHEMA_VERSION) {
    throw receiptError(`schemaVersion must be ${UXP_HYBRID_ADDON_RECEIPT_SCHEMA_VERSION}`);
  }

  const source = record(receipt.source, "source", ["sdk", "sdkVersion", "sdkHeaderReceiptSha256", "authorityUrl"]);
  if (source.sdk !== "uxp-hybrid") throw receiptError("source.sdk must be uxp-hybrid");
  nonEmptyString(source.sdkVersion, "source.sdkVersion", 128);
  sha256(source.sdkHeaderReceiptSha256, "source.sdkHeaderReceiptSha256");
  if (source.authorityUrl !== UXP_HYBRID_ADDON_AUTHORITY_URL) {
    throw receiptError("source.authorityUrl must match the documented Hybrid addon build guide");
  }

  const manifest = record(receipt.manifest, "manifest", ["manifestVersion", "hostApp", "hostMinVersion", "addonName", "enableAddon"]);
  if (!Number.isInteger(manifest.manifestVersion) || manifest.manifestVersion < 6) {
    throw receiptError("manifest.manifestVersion must be 6 or newer");
  }
  if (manifest.hostApp !== "premierepro") throw receiptError("manifest.hostApp must be premierepro");
  if (!/^\d+\.\d+\.\d+$/.test(String(manifest.hostMinVersion || ""))) {
    throw receiptError("manifest.hostMinVersion must be a semantic version");
  }
  const name = addonName(manifest.addonName);
  if (manifest.enableAddon !== true) throw receiptError("manifest.enableAddon must be true");

  const semantics = record(receipt.semantics, "semantics", ["listed", "doesNotEstablish"]);
  if (semantics.listed !== UXP_HYBRID_ADDON_RECEIPT_SEMANTICS.listed || semantics.doesNotEstablish !== UXP_HYBRID_ADDON_RECEIPT_SEMANTICS.doesNotEstablish) {
    throw receiptError("semantics must retain the documented evidence boundary");
  }

  if (!Array.isArray(receipt.artifacts) || receipt.artifacts.length !== UXP_HYBRID_ADDON_TARGETS.length) {
    throw receiptError(`artifacts must contain exactly ${UXP_HYBRID_ADDON_TARGETS.length} required target entries`);
  }
  const artifacts = receipt.artifacts.map((entry, index) => {
    const artifact = record(entry, `artifacts[${index}]`, ["target", "path", "bytes", "sha256"]);
    const expectedTarget = UXP_HYBRID_ADDON_TARGETS[index];
    if (artifact.target !== expectedTarget.target) throw receiptError(`artifacts[${index}].target must be ${expectedTarget.target}`);
    const path = nonEmptyString(artifact.path, `artifacts[${index}].path`, MAX_PATH_LENGTH);
    if (path !== expectedArtifactPath(expectedTarget, name)) throw receiptError(`artifacts[${index}].path must be the documented ${expectedTarget.target} addon path`);
    return { target: artifact.target, path, bytes: safePositiveInteger(artifact.bytes, `artifacts[${index}].bytes`), sha256: sha256(artifact.sha256, `artifacts[${index}].sha256`) };
  });

  const stats = record(receipt.stats, "stats", ["artifacts", "bytes"]);
  if (stats.artifacts !== artifacts.length) throw receiptError("stats.artifacts does not match artifacts");
  const bytes = artifacts.reduce((total, artifact) => total + artifact.bytes, 0);
  if (!Number.isSafeInteger(bytes) || stats.bytes !== bytes) throw receiptError("stats.bytes does not match artifacts");

  if (options.sdkHeaderReceipt !== undefined) {
    const summary = verifyNativeSdkHeaderInventory(options.sdkHeaderReceipt);
    if (summary.sdk !== "uxp-hybrid") throw receiptError("sdkHeaderReceipt must identify uxp-hybrid");
    if (options.sdkHeaderReceipt.source.sdkVersion !== source.sdkVersion) {
      throw receiptError("source.sdkVersion must match sdkHeaderReceipt.source.sdkVersion");
    }
    if (canonicalNativeSdkHeaderInventorySha256(options.sdkHeaderReceipt) !== source.sdkHeaderReceiptSha256) {
      throw receiptError("source.sdkHeaderReceiptSha256 does not match sdkHeaderReceipt");
    }
  }

  return Object.freeze({ addonName: name, artifacts: artifacts.length, bytes });
}

export function canonicalUxpHybridAddonReceiptSha256(document) {
  verifyUxpHybridAddonReceipt(document);
  return createHash("sha256").update(JSON.stringify(canonicalize(document))).digest("hex");
}

function parseArguments(argv) {
  const options = { input: null, sdkHeaderReceipt: null, printCanonicalSha256: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--print-canonical-sha256") options.printCanonicalSha256 = true;
    else if (["--input", "--sdk-header-receipt"].includes(argument)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw receiptError(`${argument} requires a receipt path`);
      if (argument === "--input") options.input = value;
      else options.sdkHeaderReceipt = value;
    } else throw receiptError(`Unknown argument: ${argument}`);
  }
  if (!options.input || !options.sdkHeaderReceipt) {
    throw receiptError("Usage: node scripts/verify-uxp-hybrid-addon-receipt.mjs --input <receipt.json> --sdk-header-receipt <sdk-header-receipt.json> [--print-canonical-sha256]");
  }
  return { inputPath: resolve(options.input), sdkHeaderReceiptPath: resolve(options.sdkHeaderReceipt), printCanonicalSha256: options.printCanonicalSha256 };
}

async function readJson(path, label) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { throw receiptError(`${label} must be a readable JSON receipt`); }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const [receipt, sdkHeaderReceipt] = await Promise.all([
    readJson(options.inputPath, "input"),
    readJson(options.sdkHeaderReceiptPath, "sdkHeaderReceipt"),
  ]);
  const summary = verifyUxpHybridAddonReceipt(receipt, { sdkHeaderReceipt });
  process.stdout.write(`UXP Hybrid addon receipt is valid: ${summary.artifacts} addon artifacts, ${summary.bytes} bytes.\n`);
  if (options.printCanonicalSha256) process.stdout.write(`Canonical receipt SHA-256: ${canonicalUxpHybridAddonReceiptSha256(receipt)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
