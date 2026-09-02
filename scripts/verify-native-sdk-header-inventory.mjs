#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  compareNativeSdkPaths,
  hasNativeSdkFamily,
  NATIVE_SDK_FAMILIES,
  NATIVE_SDK_HEADER_INVENTORY_SCHEMA_VERSION,
  NATIVE_SDK_HEADER_INVENTORY_SEMANTICS,
} from "./native-sdk-header-inventory-contract.mjs";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const HEADER_PATH_PATTERN = /\.(h|hpp)$/i;
const MAX_HEADERS = 100_000;
const MAX_PATH_LENGTH = 4_096;

function verificationError(message) {
  const error = new Error(message);
  error.code = "NATIVE_SDK_INVENTORY_INVALID";
  return error;
}

function record(value, label, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw verificationError(`${label} must be an object`);
  }
  const keys = Object.keys(value).sort(compareNativeSdkPaths);
  const expected = [...expectedKeys].sort(compareNativeSdkPaths);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw verificationError(`${label} must contain only the documented receipt fields`);
  }
  return value;
}

function string(value, label, maximum = MAX_PATH_LENGTH) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || value.includes("\0")) {
    throw verificationError(`${label} must be a non-empty string of at most ${maximum} characters`);
  }
  return value;
}

function canonicalRelativePath(value, label) {
  const path = string(value, label).replaceAll("\\", "/");
  const segments = path.split("/");
  if (path !== value || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path !== "." && segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw verificationError(`${label} must be a canonical relative path`);
  }
  return path;
}

function sha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw verificationError(`${label} must be a lowercase SHA-256 hex digest`);
  }
  return value;
}

function nonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw verificationError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function headerIsInsideIncludeDirectory(path, includeDirectory) {
  return includeDirectory === "." || path.startsWith(`${includeDirectory}/`);
}

export function verifyNativeSdkHeaderInventory(inventory) {
  const receipt = record(inventory, "receipt", ["schemaVersion", "source", "semantics", "stats", "headers"]);
  if (receipt.schemaVersion !== NATIVE_SDK_HEADER_INVENTORY_SCHEMA_VERSION) {
    throw verificationError(`schemaVersion must be ${NATIVE_SDK_HEADER_INVENTORY_SCHEMA_VERSION}`);
  }

  const source = record(receipt.source, "source", ["sdk", "sdkVersion", "authorityUrl", "archiveSha256", "inventoryScope", "includeDirectories"]);
  if (!hasNativeSdkFamily(source.sdk)) throw verificationError("source.sdk must be uxp-hybrid or premiere-prsdk");
  const family = NATIVE_SDK_FAMILIES[source.sdk];
  string(source.sdkVersion, "source.sdkVersion", 128);
  if (source.authorityUrl !== family.authorityUrl) throw verificationError("source.authorityUrl does not match the documented SDK family");
  sha256(source.archiveSha256, "source.archiveSha256");
  if (source.inventoryScope !== "header_files_only") throw verificationError("source.inventoryScope must be header_files_only");
  if (!Array.isArray(source.includeDirectories) || source.includeDirectories.length === 0 || source.includeDirectories.length > 64) {
    throw verificationError("source.includeDirectories must contain one to 64 documented relative directories");
  }
  const includeDirectories = source.includeDirectories.map((directory) => canonicalRelativePath(directory, "source.includeDirectories entry"));
  if (new Set(includeDirectories).size !== includeDirectories.length) {
    throw verificationError("source.includeDirectories must not contain duplicates");
  }
  if (family.includeDirectories && (includeDirectories.length !== family.includeDirectories.length || includeDirectories.some((directory, index) => directory !== family.includeDirectories[index]))) {
    throw verificationError(`${source.sdk} must use the documented fixed include directories`);
  }

  const semantics = record(receipt.semantics, "semantics", ["listed", "doesNotEstablish"]);
  if (semantics.listed !== NATIVE_SDK_HEADER_INVENTORY_SEMANTICS.listed || semantics.doesNotEstablish !== NATIVE_SDK_HEADER_INVENTORY_SEMANTICS.doesNotEstablish) {
    throw verificationError("semantics must retain the documented evidence boundary");
  }

  if (!Array.isArray(receipt.headers) || receipt.headers.length === 0 || receipt.headers.length > MAX_HEADERS) {
    throw verificationError(`headers must contain one to ${MAX_HEADERS} entries`);
  }
  const headers = receipt.headers.map((header, index) => {
    const value = record(header, `headers[${index}]`, ["path", "bytes", "sha256"]);
    const path = canonicalRelativePath(value.path, `headers[${index}].path`);
    if (!HEADER_PATH_PATTERN.test(path)) throw verificationError(`headers[${index}].path must name a .h or .hpp file`);
    if (!includeDirectories.some((directory) => headerIsInsideIncludeDirectory(path, directory))) {
      throw verificationError(`headers[${index}].path must stay within source.includeDirectories`);
    }
    return { path, bytes: nonNegativeSafeInteger(value.bytes, `headers[${index}].bytes`), sha256: sha256(value.sha256, `headers[${index}].sha256`) };
  });
  if (headers.some((header, index) => index > 0 && compareNativeSdkPaths(headers[index - 1].path, header.path) >= 0)) {
    throw verificationError("headers must be strictly sorted by canonical path without duplicates");
  }
  for (const requiredHeader of family.requiredHeaders) {
    if (!headers.some((header) => header.path === requiredHeader)) {
      throw verificationError(`Missing required UXP Hybrid SDK header: ${requiredHeader}`);
    }
  }

  const stats = record(receipt.stats, "stats", ["headers", "bytes"]);
  if (stats.headers !== headers.length) throw verificationError("stats.headers does not match headers");
  const totalBytes = headers.reduce((total, header) => total + header.bytes, 0);
  if (!Number.isSafeInteger(totalBytes) || stats.bytes !== totalBytes) throw verificationError("stats.bytes does not match headers");

  return Object.freeze({ sdk: source.sdk, headers: headers.length, bytes: totalBytes });
}

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== "--input" || !argv[1] || argv[1].startsWith("--")) {
    throw verificationError("Usage: node scripts/verify-native-sdk-header-inventory.mjs --input <receipt.json>");
  }
  return resolve(argv[1]);
}

async function main() {
  const inputPath = parseArguments(process.argv.slice(2));
  let inventory;
  try { inventory = JSON.parse(await readFile(inputPath, "utf8")); } catch { throw verificationError("input must be a readable JSON receipt"); }
  const summary = verifyNativeSdkHeaderInventory(inventory);
  process.stdout.write(`Native SDK header receipt is valid: ${summary.headers} ${summary.sdk} header files, ${summary.bytes} bytes.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
