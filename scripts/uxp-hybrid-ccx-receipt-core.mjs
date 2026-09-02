import { createHash } from "node:crypto";
import {
  hashZipEntry,
  inspectZipArchive,
  readZipEntry,
  sha256File,
} from "./read-zip-archive.mjs";
import {
  UXP_HYBRID_ADDON_ENTRYPOINT_PATH,
  UXP_HYBRID_ADDON_RECEIPT_SCHEMA_VERSION,
  UXP_HYBRID_ADDON_TARGETS,
  compareUxpHybridPaths,
} from "./uxp-hybrid-addon-receipt-contract.mjs";
import {
  UXP_HYBRID_CCX_AUTHORITY_URL,
  UXP_HYBRID_CCX_RECEIPT_SCHEMA_VERSION,
  UXP_HYBRID_CCX_RECEIPT_SEMANTICS,
  compareUxpHybridCcxPaths,
} from "./uxp-hybrid-ccx-receipt-contract.mjs";
import {
  canonicalNativeSdkHeaderInventorySha256,
  verifyNativeSdkHeaderInventory,
} from "./verify-native-sdk-header-inventory.mjs";
import {
  canonicalUxpHybridAddonReceiptSha256,
  verifyUxpHybridAddonReceipt,
} from "./verify-uxp-hybrid-addon-receipt.mjs";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_ARCHIVE_BYTES = 0xffff_ffff;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ENTRYPOINT_BYTES = 16 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 2 ** 31;
const MAX_MANIFEST_ID_LENGTH = 512;

function receiptError(message) {
  const error = new Error(message);
  error.code = "UXP_HYBRID_CCX_RECEIPT_INVALID";
  return error;
}

function record(value, label, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw receiptError(`${label} must be an object`);
  const keys = Object.keys(value).sort(compareUxpHybridCcxPaths);
  const expected = [...expectedKeys].sort(compareUxpHybridCcxPaths);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw receiptError(`${label} must contain only the documented receipt fields`);
  }
  return value;
}

function nonEmptyString(value, label, maximum = MAX_MANIFEST_ID_LENGTH) {
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

function positiveInteger(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw receiptError(`${label} must be a positive safe integer no larger than ${maximum}`);
  }
  return value;
}

function addonName(value, label = "manifest.addonName") {
  const name = nonEmptyString(value, label, 128);
  if (!/^[A-Za-z0-9._-]+\.uxpaddon$/.test(name)) throw receiptError(`${label} must be a simple .uxpaddon filename`);
  return name;
}

function validateManifestFacts(value, label, includeArchiveIdentity) {
  const fields = includeArchiveIdentity
    ? ["bytes", "sha256", "idSha256", "idLength", "manifestVersion", "hostApp", "hostMinVersion", "addonName", "enableAddon"]
    : ["manifestVersion", "hostApp", "hostMinVersion", "addonName", "enableAddon"];
  const manifest = record(value, label, fields);
  if (includeArchiveIdentity) {
    positiveInteger(manifest.bytes, `${label}.bytes`, MAX_MANIFEST_BYTES);
    sha256(manifest.sha256, `${label}.sha256`);
    sha256(manifest.idSha256, `${label}.idSha256`);
    positiveInteger(manifest.idLength, `${label}.idLength`, MAX_MANIFEST_ID_LENGTH);
  }
  if (!Number.isInteger(manifest.manifestVersion) || manifest.manifestVersion < 6) {
    throw receiptError(`${label}.manifestVersion must be 6 or newer`);
  }
  if (manifest.hostApp !== "premierepro") throw receiptError(`${label}.hostApp must be premierepro`);
  if (!/^\d+\.\d+\.\d+$/.test(String(manifest.hostMinVersion || ""))) {
    throw receiptError(`${label}.hostMinVersion must be a semantic version`);
  }
  const name = addonName(manifest.addonName, `${label}.addonName`);
  if (manifest.enableAddon !== true) throw receiptError(`${label}.enableAddon must be true`);
  return Object.freeze({
    manifestVersion: manifest.manifestVersion,
    hostApp: manifest.hostApp,
    hostMinVersion: manifest.hostMinVersion,
    addonName: name,
    enableAddon: true,
  });
}

function sameManifestFacts(left, right, label) {
  for (const key of ["manifestVersion", "hostApp", "hostMinVersion", "addonName", "enableAddon"]) {
    if (left[key] !== right[key]) throw receiptError(`${label}.${key} must match the addon-layout receipt`);
  }
}

function verifyCurrentAddonReceipt(addonReceipt, sdkHeaderReceipt) {
  if (!addonReceipt || addonReceipt.schemaVersion !== UXP_HYBRID_ADDON_RECEIPT_SCHEMA_VERSION) {
    throw receiptError(`addonReceipt must use schemaVersion ${UXP_HYBRID_ADDON_RECEIPT_SCHEMA_VERSION}`);
  }
  const addon = verifyUxpHybridAddonReceipt(addonReceipt, sdkHeaderReceipt === undefined ? {} : { sdkHeaderReceipt });
  if (!("addonBytes" in addon) || addon.entrypoints !== 1) {
    throw receiptError("addonReceipt must contain the current root main.js entrypoint accounting");
  }
  return addon;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort(compareUxpHybridCcxPaths).map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function expectedArchivePaths(addonReceipt) {
  return ["manifest.json", UXP_HYBRID_ADDON_ENTRYPOINT_PATH, ...addonReceipt.artifacts.map((artifact) => artifact.path)];
}

function archiveManifest(buffer) {
  let parsed;
  try { parsed = JSON.parse(buffer.toString("utf8")); } catch { throw receiptError("CCX archive manifest.json must be readable JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw receiptError("CCX archive manifest.json must be an object");
  const id = nonEmptyString(parsed.id, "CCX archive manifest.json id");
  if (id.trim() !== id) throw receiptError("CCX archive manifest.json id must not have surrounding whitespace");
  const facts = validateManifestFacts({
    bytes: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    idSha256: createHash("sha256").update(id).digest("hex"),
    idLength: id.length,
    manifestVersion: parsed.manifestVersion,
    hostApp: parsed.host?.app,
    hostMinVersion: parsed.host?.minVersion,
    addonName: parsed.addon?.name,
    enableAddon: parsed.requiredPermissions?.enableAddon,
  }, "manifest", true);
  return Object.freeze({
    bytes: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    idSha256: createHash("sha256").update(id).digest("hex"),
    idLength: id.length,
    ...facts,
  });
}

function verifyArchiveReceiptAgainstAddon(receipt, addonReceipt, sdkHeaderReceipt) {
  const addon = verifyCurrentAddonReceipt(addonReceipt, sdkHeaderReceipt);
  const manifest = validateManifestFacts(receipt.manifest, "manifest", true);
  sameManifestFacts(manifest, addonReceipt.manifest, "manifest");
  if (receipt.source.sdkVersion !== addonReceipt.source.sdkVersion) throw receiptError("source.sdkVersion must match the addon-layout receipt");
  if (receipt.source.sdkHeaderReceiptSha256 !== addonReceipt.source.sdkHeaderReceiptSha256) {
    throw receiptError("source.sdkHeaderReceiptSha256 must match the addon-layout receipt");
  }
  if (receipt.source.addonReceiptSha256 !== canonicalUxpHybridAddonReceiptSha256(addonReceipt)) {
    throw receiptError("source.addonReceiptSha256 must match the addon-layout receipt");
  }
  if (receipt.stats.artifacts !== addon.artifacts || receipt.stats.addonBytes !== addon.addonBytes ||
      receipt.stats.entrypoints !== addon.entrypoints || receipt.stats.entrypointBytes !== addon.entrypointBytes) {
    throw receiptError("stats must match the addon-layout receipt");
  }
  return addon;
}

export function verifyUxpHybridCcxReceipt(document, options = {}) {
  const receipt = record(document, "receipt", ["schemaVersion", "source", "archive", "manifest", "semantics", "stats"]);
  if (receipt.schemaVersion !== UXP_HYBRID_CCX_RECEIPT_SCHEMA_VERSION) {
    throw receiptError(`schemaVersion must be ${UXP_HYBRID_CCX_RECEIPT_SCHEMA_VERSION}`);
  }
  const source = record(receipt.source, "source", ["sdk", "sdkVersion", "sdkHeaderReceiptSha256", "addonReceiptSha256", "authorityUrl"]);
  if (source.sdk !== "uxp-hybrid") throw receiptError("source.sdk must be uxp-hybrid");
  nonEmptyString(source.sdkVersion, "source.sdkVersion", 128);
  sha256(source.sdkHeaderReceiptSha256, "source.sdkHeaderReceiptSha256");
  sha256(source.addonReceiptSha256, "source.addonReceiptSha256");
  if (source.authorityUrl !== UXP_HYBRID_CCX_AUTHORITY_URL) {
    throw receiptError("source.authorityUrl must match the documented CCX packaging guide");
  }

  const archive = record(receipt.archive, "archive", ["format", "bytes", "sha256"]);
  if (archive.format !== "zip") throw receiptError("archive.format must be zip");
  positiveInteger(archive.bytes, "archive.bytes", MAX_ARCHIVE_BYTES);
  sha256(archive.sha256, "archive.sha256");

  validateManifestFacts(receipt.manifest, "manifest", true);

  const semantics = record(receipt.semantics, "semantics", ["listed", "doesNotEstablish"]);
  if (semantics.listed !== UXP_HYBRID_CCX_RECEIPT_SEMANTICS.listed || semantics.doesNotEstablish !== UXP_HYBRID_CCX_RECEIPT_SEMANTICS.doesNotEstablish) {
    throw receiptError("semantics must retain the documented evidence boundary");
  }

  const stats = record(receipt.stats, "stats", ["artifacts", "addonBytes", "entrypoints", "entrypointBytes"]);
  if (stats.artifacts !== UXP_HYBRID_ADDON_TARGETS.length) throw receiptError(`stats.artifacts must be ${UXP_HYBRID_ADDON_TARGETS.length}`);
  positiveInteger(stats.addonBytes, "stats.addonBytes", MAX_ARTIFACT_BYTES * UXP_HYBRID_ADDON_TARGETS.length);
  if (stats.entrypoints !== 1) throw receiptError("stats.entrypoints must be 1");
  positiveInteger(stats.entrypointBytes, "stats.entrypointBytes", MAX_ENTRYPOINT_BYTES);

  if (options.addonReceipt !== undefined) verifyArchiveReceiptAgainstAddon(receipt, options.addonReceipt, options.sdkHeaderReceipt);
  return Object.freeze({ artifacts: stats.artifacts, addonBytes: stats.addonBytes, entrypoints: stats.entrypoints, entrypointBytes: stats.entrypointBytes });
}

export function canonicalUxpHybridCcxReceiptSha256(document) {
  verifyUxpHybridCcxReceipt(document);
  return createHash("sha256").update(JSON.stringify(canonicalize(document))).digest("hex");
}

export async function buildUxpHybridCcxReceipt(options) {
  if (!options?.addonReceipt || typeof options.addonReceipt !== "object") throw receiptError("addonReceipt is required");
  if (!options?.sdkHeaderReceipt || typeof options.sdkHeaderReceipt !== "object") throw receiptError("sdkHeaderReceipt is required");
  if (typeof options.ccxPath !== "string" || !options.ccxPath.trim() || options.ccxPath.includes("\0")) {
    throw receiptError("ccxPath must be a non-empty path");
  }
  const addon = verifyCurrentAddonReceipt(options.addonReceipt, options.sdkHeaderReceipt);
  const archive = await inspectZipArchive(options.ccxPath, expectedArchivePaths(options.addonReceipt));
  const manifestEntry = archive.selected.get("manifest.json");
  const entrypointEntry = archive.selected.get(UXP_HYBRID_ADDON_ENTRYPOINT_PATH);
  const manifestContents = await readZipEntry(options.ccxPath, archive.bytes, manifestEntry, MAX_MANIFEST_BYTES);
  const manifest = archiveManifest(manifestContents.buffer);
  sameManifestFacts(manifest, options.addonReceipt.manifest, "manifest");

  const entrypoint = await hashZipEntry(options.ccxPath, archive.bytes, entrypointEntry, MAX_ENTRYPOINT_BYTES);
  if (entrypoint.bytes !== options.addonReceipt.entrypoint.bytes || entrypoint.sha256 !== options.addonReceipt.entrypoint.sha256) {
    throw receiptError("CCX archive main.js must match the addon-layout receipt");
  }
  for (const artifact of options.addonReceipt.artifacts) {
    const entry = archive.selected.get(artifact.path);
    const observed = await hashZipEntry(options.ccxPath, archive.bytes, entry, MAX_ARTIFACT_BYTES);
    if (observed.bytes !== artifact.bytes || observed.sha256 !== artifact.sha256) {
      throw receiptError(`CCX archive addon artifact ${artifact.target} must match the addon-layout receipt`);
    }
  }

  const receipt = {
    schemaVersion: UXP_HYBRID_CCX_RECEIPT_SCHEMA_VERSION,
    source: {
      sdk: "uxp-hybrid",
      sdkVersion: options.addonReceipt.source.sdkVersion,
      sdkHeaderReceiptSha256: canonicalNativeSdkHeaderInventorySha256(options.sdkHeaderReceipt),
      addonReceiptSha256: canonicalUxpHybridAddonReceiptSha256(options.addonReceipt),
      authorityUrl: UXP_HYBRID_CCX_AUTHORITY_URL,
    },
    archive: { format: "zip", bytes: archive.bytes, sha256: await sha256File(options.ccxPath) },
    manifest,
    semantics: UXP_HYBRID_CCX_RECEIPT_SEMANTICS,
    stats: {
      artifacts: addon.artifacts,
      addonBytes: addon.addonBytes,
      entrypoints: addon.entrypoints,
      entrypointBytes: addon.entrypointBytes,
    },
  };
  verifyUxpHybridCcxReceipt(receipt, { addonReceipt: options.addonReceipt, sdkHeaderReceipt: options.sdkHeaderReceipt });
  return receipt;
}
