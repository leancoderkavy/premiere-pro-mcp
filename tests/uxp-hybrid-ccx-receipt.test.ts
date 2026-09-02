import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { NATIVE_SDK_HEADER_INVENTORY_SEMANTICS } from "../scripts/native-sdk-header-inventory-contract.mjs";
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

function createZip(entries: Array<{ path: string; contents: Buffer }>, prefix = "", deflate = true, localNameOverride?: string) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(`${prefix}${entry.path}`, "utf8");
    const compressed = deflate ? deflateRawSync(entry.contents) : entry.contents;
    const method = deflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(entry.contents), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.contents.length, 22);
    local.writeUInt16LE(name.length, 26);
    const localName = Buffer.from(localNameOverride && entry.path === "main.js" ? `${prefix}${localNameOverride}` : `${prefix}${entry.path}`, "utf8");
    local.writeUInt16LE(localName.length, 26);
    locals.push(local, localName, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(entry.contents), 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.contents.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centrals.push(central, name);
    localOffset += local.length + localName.length + compressed.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, central, end]);
}

function writeCcx(bundle: string, archive: string, options: { prefix?: string; deflate?: boolean; main?: string; manifest?: Record<string, unknown>; duplicateMain?: boolean; localMainName?: string } = {}) {
  const name = "fixture-addon.uxpaddon";
  const manifest = { ...JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8")), ...(options.manifest ?? {}) };
  const entries = [
    { path: "manifest.json", contents: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) },
    { path: "main.js", contents: Buffer.from(options.main ?? readFileSync(join(bundle, "main.js"))) },
    { path: `mac/x64/${name}`, contents: readFileSync(join(bundle, "mac", "x64", name)) },
    { path: `mac/arm64/${name}`, contents: readFileSync(join(bundle, "mac", "arm64", name)) },
    { path: `win/x64/${name}`, contents: readFileSync(join(bundle, "win", "x64", name)) },
  ];
  if (options.duplicateMain) entries.push({ path: "main.js", contents: Buffer.from("duplicate") });
  writeFileSync(archive, createZip(entries, options.prefix ?? "", options.deflate ?? true, options.localMainName));
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
      writeCcx(bundle, archive, { prefix: "fixture-hybrid-plugin/" });
      const receipt = await buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers });

      expect(receipt).toMatchObject({
        schemaVersion: 1,
        source: { sdk: "uxp-hybrid", addonReceiptSha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
        archive: { format: "zip", bytes: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
        manifest: { idLength: "fixture-hybrid-plugin".length, idSha256: expect.stringMatching(/^[a-f0-9]{64}$/), addonName: "fixture-addon.uxpaddon" },
        stats: { artifacts: 3, entrypoints: 1 },
      });
      expect(verifyUxpHybridCcxReceipt(receipt, { addonReceipt, sdkHeaderReceipt: headers })).toEqual({
        artifacts: 3,
        addonBytes: addonReceipt.stats.addonBytes,
        entrypoints: 1,
        entrypointBytes: addonReceipt.stats.entrypointBytes,
      });
      expect(canonicalUxpHybridCcxReceiptSha256(receipt)).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(receipt)).not.toContain("fixture-hybrid-plugin");
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

  it("fails closed for a missing manifest ID, duplicate or inconsistent entrypoint, or content that differs from the addon receipt", async () => {
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
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("exactly one main.js entry");

      writeCcx(bundle, archive, { localMainName: "renamed-main.js" });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("local entry name is inconsistent");

      writeCcx(bundle, archive, { main: "changed entrypoint" });
      await expect(buildUxpHybridCcxReceipt({ ccxPath: archive, addonReceipt, sdkHeaderReceipt: headers })).rejects.toThrow("CCX archive main.js must match the addon-layout receipt");
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
