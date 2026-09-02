#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { relative, resolve, sep } from "node:path";
import {
  compareNativeSdkPaths,
  hasNativeSdkFamily,
  NATIVE_SDK_FAMILIES,
  NATIVE_SDK_HEADER_INVENTORY_SCHEMA_VERSION,
  NATIVE_SDK_HEADER_INVENTORY_SEMANTICS,
} from "./native-sdk-header-inventory-contract.mjs";

function inventoryError(message) {
  const error = new Error(message);
  error.code = "NATIVE_SDK_INVENTORY_INVALID";
  return error;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalRelativePath(value, label) {
  if (typeof value !== "string" || !value || value.includes("\0")) {
    throw inventoryError(`${label} must be a non-empty relative path`);
  }
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").includes("..")) {
    throw inventoryError(`${label} must stay relative to the SDK root`);
  }
  const segments = normalized.split("/");
  if (normalized !== "." && segments.some((segment) => segment === "" || segment === ".")) {
    throw inventoryError(`${label} must use a canonical relative path`);
  }
  return normalized;
}

function stringOption(value, label, maximum = 512) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || value.includes("\0")) {
    throw inventoryError(`${label} must be a non-empty string of at most ${maximum} characters`);
  }
  return value;
}

function assertInside(root, candidate, label) {
  const value = resolve(candidate);
  if (value !== root && !value.startsWith(`${root}${sep}`)) {
    throw inventoryError(`${label} must stay inside the SDK root`);
  }
  return value;
}

async function requiredDirectory(path, label) {
  let value;
  try { value = await stat(path); } catch { throw inventoryError(`${label} does not exist`); }
  if (!value.isDirectory()) throw inventoryError(`${label} must be a directory`);
}

async function requiredFile(path, label) {
  let value;
  try { value = await stat(path); } catch { throw inventoryError(`${label} does not exist`); }
  if (!value.isFile()) throw inventoryError(`${label} must be a file`);
}

async function resolvedPathInside(root, candidate, label) {
  let resolvedPath;
  try { resolvedPath = await realpath(candidate); } catch { throw inventoryError(`${label} does not exist`); }
  return assertInside(root, resolvedPath, label);
}

async function resolvedDirectoryInside(root, candidate, label) {
  const path = await resolvedPathInside(root, candidate, label);
  await requiredDirectory(path, label);
  return path;
}

async function listHeaders(root, includeDirectories) {
  const headers = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareNativeSdkPaths(left.name, right.name));
    for (const entry of entries) {
      const candidate = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw inventoryError(`SDK header inventory refuses symbolic link: ${relative(root, candidate)}`);
      const path = await resolvedPathInside(root, candidate, `SDK entry ${relative(root, candidate)}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && /\.(h|hpp)$/i.test(entry.name)) {
        const content = await readFile(path);
        headers.push({
          path: relative(root, path).split(sep).join("/"),
          bytes: content.length,
          sha256: sha256(content),
        });
      }
    }
  };
  for (const includeDirectory of includeDirectories) {
    const path = await resolvedDirectoryInside(root, resolve(root, includeDirectory), `include directory ${includeDirectory}`);
    await visit(path);
  }
  headers.sort((left, right) => compareNativeSdkPaths(left.path, right.path));
  if (headers.length === 0) throw inventoryError("No C/C++ headers were found in the selected SDK include directories");
  if (new Set(headers.map((header) => header.path)).size !== headers.length) {
    throw inventoryError("SDK include directories overlap and produced duplicate headers");
  }
  return headers;
}

export async function generateNativeSdkHeaderInventory(options) {
  const sdk = options?.sdk;
  const family = hasNativeSdkFamily(sdk) ? NATIVE_SDK_FAMILIES[sdk] : undefined;
  if (!family) throw inventoryError("sdk must be uxp-hybrid or premiere-prsdk");
  const sdkVersion = stringOption(options?.sdkVersion, "sdkVersion", 128);
  const suppliedSdkRoot = resolve(stringOption(options?.sdkRoot, "sdkRoot", 4096));
  const archivePath = resolve(stringOption(options?.archivePath, "archivePath", 4096));
  await requiredDirectory(suppliedSdkRoot, "sdkRoot");
  const sdkRoot = await realpath(suppliedSdkRoot);
  await requiredFile(archivePath, "archivePath");

  const suppliedDirectories = options?.includeDirectories ?? [];
  if (!Array.isArray(suppliedDirectories) || suppliedDirectories.some((value) => typeof value !== "string")) {
    throw inventoryError("includeDirectories must be an array of relative paths");
  }
  const includeDirectories = family.includeDirectories ?? suppliedDirectories.map((value) => normalRelativePath(value, "include directory"));
  if (family.includeDirectories && suppliedDirectories.length > 0) {
    throw inventoryError(`${sdk} has fixed documented include directories; do not pass includeDirectories`);
  }
  if (includeDirectories.length === 0) {
    throw inventoryError("premiere-prsdk requires one or more explicit includeDirectories from the licensed SDK documentation");
  }
  if (new Set(includeDirectories).size !== includeDirectories.length) {
    throw inventoryError("includeDirectories must not contain duplicates");
  }
  const headers = await listHeaders(sdkRoot, includeDirectories);
  for (const requiredHeader of family.requiredHeaders) {
    if (!headers.some((header) => header.path === requiredHeader)) {
      throw inventoryError(`Missing required UXP Hybrid SDK header: ${requiredHeader}`);
    }
  }
  const archive = await readFile(archivePath);
  return {
    schemaVersion: NATIVE_SDK_HEADER_INVENTORY_SCHEMA_VERSION,
    source: {
      sdk,
      sdkVersion,
      authorityUrl: family.authorityUrl,
      archiveSha256: sha256(archive),
      inventoryScope: "header_files_only",
      includeDirectories,
    },
    semantics: NATIVE_SDK_HEADER_INVENTORY_SEMANTICS,
    stats: {
      headers: headers.length,
      bytes: headers.reduce((total, header) => total + header.bytes, 0),
    },
    headers,
  };
}

function parseArguments(argv) {
  const options = { includeDirectories: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") options.check = true;
    else if (argument === "--validate-only") options.validateOnly = true;
    else if (["--sdk", "--sdk-version", "--sdk-root", "--archive", "--output", "--include-dir"].includes(argument)) {
      const value = argv[index + 1];
      if (value == null || value.startsWith("--")) throw inventoryError(`${argument} requires a value`);
      index += 1;
      if (argument === "--sdk") options.sdk = value;
      else if (argument === "--sdk-version") options.sdkVersion = value;
      else if (argument === "--sdk-root") options.sdkRoot = value;
      else if (argument === "--archive") options.archivePath = value;
      else if (argument === "--output") options.outputPath = value;
      else options.includeDirectories.push(value);
    } else {
      throw inventoryError(`Unknown argument: ${argument}`);
    }
  }
  if (options.check && options.validateOnly) throw inventoryError("--check and --validate-only cannot be combined");
  if (!options.validateOnly && !options.outputPath) throw inventoryError("--output is required unless --validate-only is used");
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const inventory = await generateNativeSdkHeaderInventory(options);
  const rendered = `${JSON.stringify(inventory, null, 2)}\n`;
  if (options.validateOnly) {
    process.stdout.write(`Validated ${inventory.stats.headers} ${inventory.source.sdk} header files.\n`);
    return;
  }
  const outputPath = resolve(options.outputPath);
  if (options.check) {
    let current = "";
    try { current = await readFile(outputPath, "utf8"); } catch {}
    if (current.replaceAll("\r\n", "\n") !== rendered) {
      throw inventoryError("Native SDK header inventory is stale; rerun without --check after reviewing the licensed SDK artifact");
    }
    process.stdout.write(`Native SDK header inventory is current: ${inventory.stats.headers} ${inventory.source.sdk} header files.\n`);
    return;
  }
  await writeFile(outputPath, rendered);
  process.stdout.write(`Wrote ${inventory.stats.headers} ${inventory.source.sdk} header files.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
