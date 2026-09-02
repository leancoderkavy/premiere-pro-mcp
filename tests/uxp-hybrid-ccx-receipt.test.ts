import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { NATIVE_SDK_HEADER_INVENTORY_SEMANTICS } from "../scripts/native-sdk-header-inventory-contract.mjs";
import { UXP_HYBRID_CCX_RECEIPT_LEGACY_SEMANTICS } from "../scripts/uxp-hybrid-ccx-receipt-contract.mjs";
import {
  buildUxpHybridCcxReceipt,
  canonicalUxpHybridCcxReceiptSha256,
  verifyUxpHybridCcxReceipt,
} from "../scripts/uxp-hybrid-ccx-receipt-core.mjs";
import { generateUxpHybridAddonReceipt } from "../scripts/generate-uxp-hybrid-addon-receipt.mjs";
import { canonicalUxpHybridAddonReceiptSha256 } from "../scripts/verify-uxp-hybrid-addon-receipt.mjs";
import { canonicalNativeSdkHeaderInventorySha256 } from "../scripts/verify-native-sdk-header-inventory.mjs";
import { verifyHybridBenchmarkEvidenceWithLocalCcx } from "../scripts/verify-uxp-hybrid-benchmark.mjs";

const hash = (value: string) => value.repeat(64);

function sdkHeaderReceipt() {
  return {
    schemaVersion: 1,
    source: {
      sdk: "uxp-hybrid",
      sdkVersion: "fixture-sdk",
      authorityUrl: "https://developer.adobe.com/premiere-pro/uxp/plugins/hybrid-plugins/",
      archiveSha256: hash("a"),
      inventoryScope: "header_files_only",
      includeDirectories: ["src/api", "src/utilities"],
    },
    semantics: NATIVE_SDK_HEADER_INVENTORY_SEMANTICS,
    stats: { headers: 3, bytes: 24 },
    headers: [
      { path: "src/api/UxpAddonShared.h", bytes: 7, sha256: hash("b") },
      { path: "src/api/UxpAddonTypes.h", bytes: 8, sha256: hash("c") },
      { path: "src/utilities/UxpAddon.h", bytes: 9, sha256: hash("d") },
    ],
  };
}

async function writeDevelopmentBundle(root: string, additions: Record<string, unknown> = {}) {
  const name = "fixture-addon.uxpaddon";
  writeFileSync(join(root, "manifest.json"), `${JSON.stringify({
    id: "fixture-hybrid-plugin",
    manifestVersion: 6,
    host: { app: "premierepro", minVersion: "25.6.0" },
    addon: { name },
    requiredPermissions: { enableAddon: true },
    ...additions,
  }, null, 2)}\n`);
  writeFileSync(join(root, "main.js"), "const addon = require(\"fixture-addon.uxpaddon\");\n");
  for (const [path, contents] of [
    [`mac/x64/${name}`, "mac intel fixture"],
    [`mac/arm64/${name}`, "mac arm fixture"],
    [`win/x64/${name}`, "windows fixture"],
  ]) {
    const target = join(root, ...path.split("/"));
    await mkdir(join(target, ".."), { recursive: true });
    writeFileSync(target, contents);
  }
}

function crc32(buffer: Buffer) {
  let value = 0xffff_ffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb8_8320 : 0);
  }
  return (value ^ 0xffff_ffff) >>> 0;
}

type DataDescriptorMetadata = false | { signature?: boolean; crc32?: number; compressedBytes?: number; uncompressedBytes?: number };

type ZipOptions = {
  flags?: number;
  method?: number;
  localPreamble?: Buffer;
  localSuffix?: Buffer;
  centralSuffix?: Buffer;
  localNames?: Record<string, string>;
  localMetadata?: Record<string, { versionNeeded?: number; flags?: number; method?: number; crc32?: number; compressedBytes?: number; uncompressedBytes?: number }>;
  centralMetadata?: Record<string, { versionMadeBy?: number; versionNeeded?: number; flags?: number; compressedBytes?: number; uncompressedBytes?: number; externalAttributes?: number; localOffset?: number }>;
  crc32Adjustments?: Record<string, number>;
  compressedDataSuffixes?: Record<string, Buffer>;
  compressedByteAdjustments?: Record<string, number>;
  dataDescriptors?: Record<string, DataDescriptorMetadata>;
};

function createZip(entries: Array<{ path: string; contents: Buffer }>, prefix = "", deflate = true, localNameOverride?: string, options: ZipOptions = {}) {
  const locals: Buffer[] = options.localPreamble ? [options.localPreamble] : [];
  const centrals: Buffer[] = [];
  let localOffset = options.localPreamble?.length ?? 0;
  for (const entry of entries) {
    const name = Buffer.from(`${prefix}${entry.path}`, "utf8");
    const method = options.method ?? (deflate ? 8 : 0);
    const compressed = method === 8 ? deflateRawSync(entry.contents) : entry.contents;
    const compressedPayload = options.compressedDataSuffixes?.[entry.path]
      ? Buffer.concat([compressed, options.compressedDataSuffixes[entry.path]])
      : compressed;
    const flags = 0x800 | (options.flags ?? 0);
    const declaredCrc32 = (crc32(entry.contents) + (options.crc32Adjustments?.[entry.path] ?? 0)) >>> 0;
    const declaredCompressedBytes = compressedPayload.length + (options.compressedByteAdjustments?.[entry.path] ?? 0);
    const localMetadata = options.localMetadata?.[entry.path] ?? {};
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(localMetadata.versionNeeded ?? 20, 4);
    local.writeUInt16LE(localMetadata.flags ?? flags, 6);
    local.writeUInt16LE(localMetadata.method ?? method, 8);
    local.writeUInt32LE(localMetadata.crc32 ?? declaredCrc32, 14);
    local.writeUInt32LE(localMetadata.compressedBytes ?? declaredCompressedBytes, 18);
    local.writeUInt32LE(localMetadata.uncompressedBytes ?? entry.contents.length, 22);
    local.writeUInt16LE(name.length, 26);
    const localNamePath = options.localNames?.[entry.path] ?? (localNameOverride && entry.path === "main.js" ? localNameOverride : entry.path);
    const localName = Buffer.from(`${prefix}${localNamePath}`, "utf8");
    local.writeUInt16LE(localName.length, 26);
    locals.push(local, localName, compressedPayload);
    const descriptorMetadata = flags & 0x8 ? options.dataDescriptors?.[entry.path] ?? {} : false;
    const descriptor = descriptorMetadata === false ? undefined : Buffer.alloc(descriptorMetadata.signature === false ? 12 : 16);
    if (descriptor) {
      const offset = descriptor.length === 16 ? 4 : 0;
      if (offset) descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(descriptorMetadata.crc32 ?? declaredCrc32, offset);
      descriptor.writeUInt32LE(descriptorMetadata.compressedBytes ?? declaredCompressedBytes, offset + 4);
      descriptor.writeUInt32LE(descriptorMetadata.uncompressedBytes ?? entry.contents.length, offset + 8);
      locals.push(descriptor);
    }

    const central = Buffer.alloc(46);
    const centralMetadata = options.centralMetadata?.[entry.path] ?? {};
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(centralMetadata.versionMadeBy ?? 20, 4);
    central.writeUInt16LE(centralMetadata.versionNeeded ?? 20, 6);
    central.writeUInt16LE(centralMetadata.flags ?? flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(declaredCrc32, 16);
    central.writeUInt32LE(centralMetadata.compressedBytes ?? declaredCompressedBytes, 20);
    central.writeUInt32LE(centralMetadata.uncompressedBytes ?? entry.contents.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(centralMetadata.externalAttributes ?? 0, 38);
    central.writeUInt32LE(centralMetadata.localOffset ?? localOffset, 42);
    centrals.push(central, name);
    localOffset += local.length + localName.length + compressedPayload.length + (descriptor?.length ?? 0);
  }
  if (options.localSuffix) {
    locals.push(options.localSuffix);
    localOffset += options.localSuffix.length;
  }
  const central = Buffer.concat(centrals);
  const centralSuffix = options.centralSuffix ?? Buffer.alloc(0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, central, centralSuffix, end]);
}

function writeCcx(bundle: string, archive: string, options: { prefix?: string; deflate?: boolean; main?: string; manifest?: Record<string, unknown>; duplicateMain?: boolean; localMainName?: string; extra?: Array<{ path: string; contents: Buffer }>; zipFlags?: number; compressionMethod?: number; localPreamble?: Buffer; localSuffix?: Buffer; centralSuffix?: Buffer; localNames?: Record<string, string>; localMetadata?: Record<string, { versionNeeded?: number; flags?: number; method?: number; crc32?: number; compressedBytes?: number; uncompressedBytes?: number }>; centralMetadata?: Record<string, { versionMadeBy?: number; versionNeeded?: number; flags?: number; compressedBytes?: number; uncompressedBytes?: number; externalAttributes?: number; localOffset?: number }>; crc32Adjustments?: Record<string, number>; compressedDataSuffixes?: Record<string, Buffer>; compressedByteAdjustments?: Record<string, number>; dataDescriptors?: Record<string, DataDescriptorMetadata> } = {}) {
  const name = "fixture-addon.uxpaddon";
  const manifest = { ...JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")), ...(options.manifest ?? {}) };
  const entries = [
    { path: "manifest.json", contents: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) },
    { path: "main.js", contents: Buffer.from(options.main ?? readFileSync(join(bundle, "main.js"))) },
    { path: `mac/x64/${name}`, contents: readFileSync(join(bundle, "mac", "x64", name)) },
    { path: `mac/arm64/${name}`, contents: readFileSync(join(bundle, "mac", "arm64", name)) },
    { path: `win/x64/${name}`, contents: readFileSync(join(bundle, "win", "x64", name)) },
  ];
  entries.push(...(options.extra ?? []));
  if (options.duplicateMain) entries.push({ path: "main.js", contents: Buffer.from("duplicate") });
  writeFileSync(archive, createZip(entries, options.prefix ?? "", options.deflate ?? true, options.localMainName, {
    flags: options.zipFlags,
    method: options.compressionMethod,
    localPreamble: options.localPreamble,
    localSuffix: options.localSuffix,
    centralSuffix: options.centralSuffix,
    localNames: options.localNames,
    localMetadata: options.localMetadata,
    centralMetadata: options.centralMetadata,
    crc32Adjustments: options.crc32Adjustments,
    compressedDataSuffixes: options.compressedDataSuffixes,
    compressedByteAdjustments: options.compressedByteAdjustments,
    dataDescriptors: options.dataDescriptors,
  }));
}

describe("UXP Hybrid CCX receipt", () => {
  it("binds a wrapped, deflated CCX ZIP to a v2 addon receipt without copying archive contents", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-hybrid-ccx-receipt-"));
    const bundle = join(directory, "bundle");
    const archive = join(directory, "fixture.ccx");
    const headers = sdkHeaderReceipt();
    try {
      await mkdir(bundle, { recursive: true });
      await writeDevelopmentBundle(bundle);
      const addonReceipt = await generateUxpHybridAddonReceipt({ pluginRoot: bundle, sdkHeaderReceipt: headers });
      writeCcx(bundle, archive, {
        prefix: "fixture-hybrid-plugin/",
        zipFlags: 0x8,
        dataDescriptors: { "main.js": { signature: false } },
      });
      const receipt = await buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers });

      expect(receipt).toMatchObject({
        schemaVersion: 2,
        source: { sdk: "uxp-hybrid", addonReceiptSha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
        archive: { format: "zip", bytes: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
        contents: { entries: 5, files: 5, directories: 0, pathSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
        manifest: { idLength: "fixture-hybrid-plugin".length, idSha256: expect.stringMatching(/^[a-f0-9]{64}$/), addonName: "fixture-addon.uxpaddon" },
        stats: { artifacts: 3, entrypoints: 1 },
      });
      expect(verifyUxpHybridCcxReceipt(receipt, { addonReceipt, sdkHeaderReceipt: headers })).toEqual({
        artifacts: 3,
        addonBytes: addonReceipt.stats.addonBytes,
        entrypoints: 1,
        entrypointBytes: addonReceipt.stats.entrypointBytes,
      });
      const { contents: ignoredContents, ...legacyReceipt } = receipt;
      expect(ignoredContents).toBeDefined();
      expect(verifyUxpHybridCcxReceipt({
        ...legacyReceipt,
        schemaVersion: 1,
        semantics: UXP_HYBRID_CCX_RECEIPT_LEGACY_SEMANTICS,
      }, { addonReceipt, sdkHeaderReceipt: headers })).toEqual({
        artifacts: 3,
        addonBytes: addonReceipt.stats.addonBytes,
        entrypoints: 1,
        entrypointBytes: addonReceipt.stats.entrypointBytes,
      });
      const legacyPath = join(directory, "legacy-ccx-receipt.json");
      const legacyHeadersPath = join(directory, "legacy-headers.json");
      const legacyAddonPath = join(directory, "legacy-addon-receipt.json");
      writeFileSync(legacyPath, `${JSON.stringify({
        ...legacyReceipt,
        schemaVersion: 1,
        semantics: UXP_HYBRID_CCX_RECEIPT_LEGACY_SEMANTICS,
      }, null, 2)}\n`);
      writeFileSync(legacyHeadersPath, `${JSON.stringify(headers, null, 2)}\n`);
      writeFileSync(legacyAddonPath, `${JSON.stringify(addonReceipt, null, 2)}\n`);
      const legacyVerified = spawnSync(process.execPath, [
        "scripts/verify-uxp-hybrid-ccx-receipt.mjs",
        "--input", legacyPath,
        "--ccx", archive,
        "--addon-receipt", legacyAddonPath,
        "--sdk-header-receipt", legacyHeadersPath,
      ], { encoding: "utf8" });
      expect(legacyVerified.status).toBe(0);
      expect(legacyVerified.stdout).toContain("UXP Hybrid CCX receipt is valid");
      expect(() => verifyUxpHybridCcxReceipt({
        ...receipt,
        contents: { ...receipt.contents, files: receipt.contents.files - 1 },
      })).toThrow("contents file and directory totals must match entries");
      expect(canonicalUxpHybridCcxReceiptSha256(receipt)).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(receipt)).not.toContain("fixture-hybrid-plugin");
      expect(JSON.stringify(receipt)).not.toContain("mac/x64");
      expect(JSON.stringify(receipt)).not.toContain("const addon");
      expect(JSON.stringify(receipt)).not.toContain("mac intel fixture");
      expect(JSON.stringify(receipt)).not.toContain(directory);

      const benchmarkEvidence = {
        schemaVersion: 3,
        workloadId: "weighted-energy-v1",
        configuration: { sampleCount: 30, warmupCount: 3, iterations: 4, inputLength: 131072, seed: 1337 },
        memoryMeasurement: "fixture process monitor",
        sdkHeaderReceiptSha256: canonicalNativeSdkHeaderInventorySha256(headers),
        addonReceiptSha256: canonicalUxpHybridAddonReceiptSha256(addonReceipt),
        ccxReceiptSha256: canonicalUxpHybridCcxReceiptSha256(receipt),
        runs: addonReceipt.artifacts.map((artifact) => {
          const [platform, arch] = artifact.target.split("-");
          return {
            platform,
            arch,
            hostVersion: "26.3.0",
            sdkVersion: "fixture-sdk",
            buildMode: "Release",
            addonLoaded: true,
            addonSha256: artifact.sha256,
            sourceCommit: "a".repeat(40),
            checksumMatch: true,
            codeSigned: platform === "mac",
            notarized: platform === "mac",
            javascript: { sampleCount: 30, p50Ms: 100, p95Ms: 140, peakWorkingSetBytes: 1000 },
            native: { sampleCount: 30, p50Ms: 60, p95Ms: 80, peakWorkingSetBytes: 1050 },
          };
        }),
      };
      await expect(verifyHybridBenchmarkEvidenceWithLocalCcx(benchmarkEvidence, {
        ccxPath: archive,
        addonReceipt,
        sdkHeaderReceipt: headers,
        ccxReceipt: receipt,
      })).resolves.toMatchObject({ promotionEligible: true, errors: [] });

      const evidencePath = join(directory, "benchmark-evidence.json");
      const headersPath = join(directory, "headers.json");
      const addonPath = join(directory, "addon-receipt.json");
      const ccxReceiptPath = join(directory, "ccx-receipt.json");
      writeFileSync(evidencePath, `${JSON.stringify(benchmarkEvidence, null, 2)}\n`);
      writeFileSync(headersPath, `${JSON.stringify(headers, null, 2)}\n`);
      writeFileSync(addonPath, `${JSON.stringify(addonReceipt, null, 2)}\n`);
      writeFileSync(ccxReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
      const benchmarkVerified = spawnSync(process.execPath, [
        "scripts/verify-uxp-hybrid-benchmark.mjs",
        "--input", evidencePath,
        "--sdk-header-receipt", headersPath,
        "--addon-receipt", addonPath,
        "--ccx-receipt", ccxReceiptPath,
        "--ccx", archive,
      ], { encoding: "utf8" });
      expect(benchmarkVerified.status).toBe(0);
      expect(benchmarkVerified.stdout).toContain('"promotionEligible": true');
      expect(benchmarkVerified.stdout).not.toContain(directory);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed for malformed manifest, ZIP, entrypoint, and addon content", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-hybrid-ccx-receipt-invalid-"));
    const bundle = join(directory, "bundle");
    const archive = join(directory, "fixture.ccx");
    const headers = sdkHeaderReceipt();
    try {
      await mkdir(bundle, { recursive: true });
      await writeDevelopmentBundle(bundle);
      const addonReceipt = await generateUxpHybridAddonReceipt({ pluginRoot: bundle, sdkHeaderReceipt: headers });

      writeCcx(bundle, archive, { manifest: { id: "" } });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("manifest.json id must be a non-empty string");

      writeCcx(bundle, archive, { duplicateMain: true });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("duplicate ZIP entry names");

      writeCcx(bundle, archive, { localMainName: "renamed-main.js" });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("local entry name is inconsistent");

      writeCcx(bundle, archive, {
        extra: [{ path: "docs/readme.txt", contents: Buffer.from("unselected entry") }],
        localMetadata: { "docs/readme.txt": { compressedBytes: 1 } },
      });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("local entry metadata is inconsistent");

      writeCcx(bundle, archive, {
        extra: [{ path: "docs/readme.txt", contents: Buffer.from("unselected entry") }],
        centralMetadata: { "docs/readme.txt": { versionNeeded: 45 } },
      });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("local entry metadata is inconsistent");

      writeCcx(bundle, archive, {
        extra: [{ path: "docs/readme.txt", contents: Buffer.from("unselected entry") }],
        localMetadata: { "docs/readme.txt": { flags: 0x810 } },
        centralMetadata: { "docs/readme.txt": { flags: 0x810 } },
      });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("entries use unsupported ZIP flags");

      const asciiPath = "docs/legacy.txt";
      writeCcx(bundle, archive, {
        extra: [{ path: asciiPath, contents: Buffer.from("unflagged ASCII entry") }],
        localMetadata: { [asciiPath]: { flags: 0 } },
        centralMetadata: { [asciiPath]: { flags: 0 } },
      });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).resolves.toMatchObject({
        contents: { entries: 6 },
      });

      const nonAsciiPath = "docs/résumé.txt";
      writeCcx(bundle, archive, { extra: [{ path: nonAsciiPath, contents: Buffer.from("declared UTF-8 entry") }] });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).resolves.toMatchObject({
        contents: { entries: 6 },
      });

      writeCcx(bundle, archive, {
        extra: [{ path: nonAsciiPath, contents: Buffer.from("undeclared legacy entry") }],
        localMetadata: { [nonAsciiPath]: { flags: 0 } },
        centralMetadata: { [nonAsciiPath]: { flags: 0 } },
      });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("non-ASCII ZIP entry names must declare UTF-8");

      const unixVersionMadeBy = 0x0314;
      const unixFileAttributes = (fileType: number) => (fileType << 16) >>> 0;
      const regularPath = "docs/regular.txt";
      writeCcx(bundle, archive, {
        extra: [{ path: regularPath, contents: Buffer.from("declared Unix regular file") }],
        centralMetadata: { [regularPath]: { versionMadeBy: unixVersionMadeBy, externalAttributes: unixFileAttributes(0o100000) } },
      });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).resolves.toMatchObject({
        contents: { entries: 6 },
      });

      const directoryPath = "docs/unix-directory/";
      writeCcx(bundle, archive, {
        deflate: false,
        extra: [{ path: directoryPath, contents: Buffer.alloc(0) }],
        centralMetadata: { [directoryPath]: { versionMadeBy: unixVersionMadeBy, externalAttributes: unixFileAttributes(0o040000) } },
      });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).resolves.toMatchObject({
        contents: { entries: 6, directories: 1 },
      });

      writeCcx(bundle, archive, { extra: [{ path: "docs/nonempty-directory/", contents: Buffer.from("unexpected directory data") }] });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("directory entries must not contain file data");

      for (const unixSpecialFileType of [0o010000, 0o020000, 0o060000, 0o120000, 0o140000]) {
        writeCcx(bundle, archive, {
          extra: [{ path: "docs/unsupported-type", contents: Buffer.from("declared Unix special file") }],
          centralMetadata: { "docs/unsupported-type": { versionMadeBy: unixVersionMadeBy, externalAttributes: unixFileAttributes(unixSpecialFileType) } },
        });
        await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("Unix entries must be regular files or directories");
      }

      writeCcx(bundle, archive, {
        zipFlags: 0x8,
        dataDescriptors: { "main.js": false },
      });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("data descriptor is missing or truncated");

      writeCcx(bundle, archive, {
        extra: [{ path: "docs/readme.txt", contents: Buffer.from("unselected entry") }],
        zipFlags: 0x8,
        dataDescriptors: { "docs/readme.txt": { crc32: 0 } },
      });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("data descriptor is inconsistent");

      writeCcx(bundle, archive, { crc32Adjustments: { "main.js": 1 } });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("required entry checksum is inconsistent");

      writeCcx(bundle, archive, { compressedDataSuffixes: { "main.js": Buffer.from([0x00]) } });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("required entry has trailing compressed data");

      writeCcx(bundle, archive, { compressedByteAdjustments: { "manifest.json": 1 } });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("local entries overlap");

      writeCcx(bundle, archive, { localPreamble: Buffer.from("unexpected ZIP prefix") });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("local records have unaccounted bytes");

      const orphanName = Buffer.from("unreferenced-local-entry.txt");
      const orphanLocal = Buffer.alloc(30);
      orphanLocal.writeUInt32LE(0x04034b50, 0);
      orphanLocal.writeUInt16LE(20, 4);
      orphanLocal.writeUInt16LE(0x800, 6);
      orphanLocal.writeUInt16LE(orphanName.length, 26);
      writeCcx(bundle, archive, { localSuffix: Buffer.concat([orphanLocal, orphanName]) });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("local records have unaccounted bytes");

      writeCcx(bundle, archive, { centralSuffix: Buffer.from("unexpected central-directory suffix") });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("unaccounted bytes between the central directory and ZIP end record");

      writeCcx(bundle, archive, {
        extra: [{ path: "docs/readme.txt", contents: Buffer.from("unselected entry") }],
        localNames: { "docs/readme.txt": "docs/renamed.txt" },
      });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("local entry name is inconsistent");

      writeCcx(bundle, archive, { main: "changed entrypoint" });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("CCX archive main.js must match the addon-layout receipt");

      writeCcx(bundle, archive, { extra: [{ path: "C:Headers", contents: Buffer.from("unsafe") }] });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("unsafe ZIP entry name");

      writeCcx(bundle, archive, { zipFlags: 0x1 });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("entries must not be encrypted");

      writeCcx(bundle, archive, { zipFlags: 0x2000 });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("entries must not be encrypted");

      writeCcx(bundle, archive, { compressionMethod: 12 });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("stored or deflate compression");

      for (const zip64Metadata of [
        { compressedBytes: 0xffff_ffff },
        { uncompressedBytes: 0xffff_ffff },
        { localOffset: 0xffff_ffff },
      ]) {
        writeCcx(bundle, archive, {
          extra: [{ path: "docs/readme.txt", contents: Buffer.from("unselected ZIP64 sentinel") }],
          centralMetadata: { "docs/readme.txt": zip64Metadata },
        });
        await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("ZIP64 entry metadata is not supported");
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("supports deterministic CLI generation, archive re-verification, and stale checks without printing local paths", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-hybrid-ccx-receipt-cli-"));
    const bundle = join(directory, "bundle");
    const archive = join(directory, "fixture.ccx");
    const headersPath = join(directory, "headers.json");
    const addonPath = join(directory, "addon.json");
    const output = join(directory, "ccx-receipt.json");
    const headers = sdkHeaderReceipt();
    try {
      await mkdir(bundle, { recursive: true });
      await writeDevelopmentBundle(bundle);
      const addonReceipt = await generateUxpHybridAddonReceipt({ pluginRoot: bundle, sdkHeaderReceipt: headers });
      writeFileSync(headersPath, `${JSON.stringify(headers, null, 2)}\n`);
      writeFileSync(addonPath, `${JSON.stringify(addonReceipt, null, 2)}\n`);
      writeCcx(bundle, archive, { deflate: true });
      const args = ["scripts/generate-uxp-hybrid-ccx-receipt.mjs", "--ccx", archive, "--addon-receipt", addonPath, "--sdk-header-receipt", headersPath, "--output", output];
      const generated = spawnSync(process.execPath, args, { encoding: "utf8" });
      expect(generated.status).toBe(0);
      expect(generated.stdout).toContain("Wrote UXP Hybrid CCX receipt: 3 artifacts and 1 entrypoint.");
      expect(generated.stdout).not.toContain(directory);
      expect(spawnSync(process.execPath, [...args, "--check"], { encoding: "utf8" }).status).toBe(0);

      const verified = spawnSync(process.execPath, ["scripts/verify-uxp-hybrid-ccx-receipt.mjs", "--input", output, "--ccx", archive, "--addon-receipt", addonPath, "--sdk-header-receipt", headersPath, "--print-canonical-sha256"], { encoding: "utf8" });
      expect(verified.status).toBe(0);
      expect(verified.stdout).toContain("UXP Hybrid CCX receipt is valid: 3 addon artifacts and 1 entrypoint.");
      expect(verified.stdout).toContain("Canonical receipt SHA-256:");
      expect(verified.stdout).not.toContain(directory);

      writeCcx(bundle, archive, { deflate: false });
      const stale = spawnSync(process.execPath, [...args, "--check"], { encoding: "utf8" });
      expect(stale.status).not.toBe(0);
      expect(stale.stderr).toContain("UXP Hybrid CCX receipt is stale");
      expect(stale.stderr).not.toContain(directory);
      expect(JSON.parse(readFileSync(output, "utf8")).manifest).not.toHaveProperty("id");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
