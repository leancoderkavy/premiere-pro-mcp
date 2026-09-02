import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { NATIVE_SDK_HEADER_INVENTORY_SEMANTICS } from "../scripts/native-sdk-header-inventory-contract.mjs";
import {
  canonicalUxpHybridAddonReceiptSha256,
  verifyUxpHybridAddonReceipt,
} from "../scripts/verify-uxp-hybrid-addon-receipt.mjs";
import { generateUxpHybridAddonReceipt } from "../scripts/generate-uxp-hybrid-addon-receipt.mjs";

const hash = (value: string) => value.repeat(64);

function sdkHeaderReceipt(sdkVersion = "fixture-sdk") {
  return {
    schemaVersion: 1,
    source: {
      sdk: "uxp-hybrid",
      sdkVersion,
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

async function writeDevelopmentBundle(root: string, name = "fixture-addon.uxpaddon") {
  writeFileSync(join(root, "manifest.json"), `${JSON.stringify({
    manifestVersion: 6,
    host: { app: "premierepro", minVersion: "25.6.0" },
    addon: { name },
    requiredPermissions: { enableAddon: true },
  }, null, 2)}\n`);
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("UXP Hybrid addon receipt", () => {
  it("hashes only the documented three-target temporary-bundle layout and binds a verified Hybrid header receipt", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-hybrid-addon-receipt-"));
    const bundle = join(directory, "bundle");
    const headers = sdkHeaderReceipt();
    try {
      await mkdir(bundle, { recursive: true });
      await writeDevelopmentBundle(bundle);
      const receipt = await generateUxpHybridAddonReceipt({ pluginRoot: bundle, sdkHeaderReceipt: headers });
      expect(receipt).toMatchObject({
        schemaVersion: 1,
        source: { sdk: "uxp-hybrid", sdkVersion: "fixture-sdk", sdkHeaderReceiptSha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
        manifest: { manifestVersion: 6, hostApp: "premierepro", hostMinVersion: "25.6.0", addonName: "fixture-addon.uxpaddon", enableAddon: true },
        stats: { artifacts: 3 },
      });
      expect(receipt.artifacts.map((artifact) => artifact.path)).toEqual([
        "mac/x64/fixture-addon.uxpaddon",
        "mac/arm64/fixture-addon.uxpaddon",
        "win/x64/fixture-addon.uxpaddon",
      ]);
      expect(verifyUxpHybridAddonReceipt(receipt, { sdkHeaderReceipt: headers })).toEqual({ addonName: "fixture-addon.uxpaddon", artifacts: 3, bytes: receipt.stats.bytes });
      expect(canonicalUxpHybridAddonReceiptSha256(receipt)).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(receipt)).not.toContain("mac intel fixture");
      expect(JSON.stringify(receipt)).not.toContain(bundle);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed for a non-Hybrid SDK receipt, a non-Hybrid manifest, or a missing required artifact", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-hybrid-addon-receipt-invalid-"));
    const bundle = join(directory, "bundle");
    const headers = sdkHeaderReceipt();
    try {
      await mkdir(bundle, { recursive: true });
      await writeDevelopmentBundle(bundle);
      const prsdk = clone(headers);
      prsdk.source.sdk = "premiere-prsdk";
      prsdk.source.authorityUrl = "https://developer.adobe.com/premiere-pro/";
      prsdk.source.includeDirectories = ["Headers"];
      prsdk.headers = [{ path: "Headers/Fixture.h", bytes: 1, sha256: hash("e") }];
      prsdk.stats = { headers: 1, bytes: 1 };
      await expect(generateUxpHybridAddonReceipt({ pluginRoot: bundle, sdkHeaderReceipt: prsdk })).rejects.toThrow("must identify uxp-hybrid");

      writeFileSync(join(bundle, "manifest.json"), JSON.stringify({ manifestVersion: 5 }));
      await expect(generateUxpHybridAddonReceipt({ pluginRoot: bundle, sdkHeaderReceipt: headers })).rejects.toThrow("manifestVersion 6");

      await writeDevelopmentBundle(bundle);
      rmSync(join(bundle, "win", "x64", "fixture-addon.uxpaddon"));
      await expect(generateUxpHybridAddonReceipt({ pluginRoot: bundle, sdkHeaderReceipt: headers })).rejects.toThrow("addon artifact win-x64 does not exist");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects receipt leakage, wrong layout, changed header provenance, and incorrect totals", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-hybrid-addon-receipt-verifier-"));
    const bundle = join(directory, "bundle");
    const headers = sdkHeaderReceipt();
    try {
      await mkdir(bundle, { recursive: true });
      await writeDevelopmentBundle(bundle);
      const receipt = await generateUxpHybridAddonReceipt({ pluginRoot: bundle, sdkHeaderReceipt: headers });

      const leaked = clone(receipt) as Record<string, unknown>;
      leaked.manifest = { ...(leaked.manifest as object), contents: "private manifest" };
      expect(() => verifyUxpHybridAddonReceipt(leaked)).toThrow("must contain only the documented receipt fields");

      const wrongPath = clone(receipt);
      wrongPath.artifacts[0].path = "C:bundle/addon.uxpaddon";
      expect(() => verifyUxpHybridAddonReceipt(wrongPath)).toThrow("documented mac-x64 addon path");

      const wrongHeader = clone(headers);
      wrongHeader.source.sdkVersion = "other-sdk";
      expect(() => verifyUxpHybridAddonReceipt(receipt, { sdkHeaderReceipt: wrongHeader })).toThrow("source.sdkVersion must match");

      const wrongStats = clone(receipt);
      wrongStats.stats.bytes += 1;
      expect(() => verifyUxpHybridAddonReceipt(wrongStats)).toThrow("stats.bytes does not match artifacts");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("supports deterministic local CLI generation, verification, and stale checks without printing bundle paths", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-hybrid-addon-receipt-cli-"));
    const bundle = join(directory, "bundle");
    const headersPath = join(directory, "headers.json");
    const output = join(directory, "receipt.json");
    try {
      await mkdir(bundle, { recursive: true });
      await writeDevelopmentBundle(bundle);
      writeFileSync(headersPath, `${JSON.stringify(sdkHeaderReceipt(), null, 2)}\n`);
      const args = ["scripts/generate-uxp-hybrid-addon-receipt.mjs", "--plugin-root", bundle, "--sdk-header-receipt", headersPath, "--output", output];
      const generated = spawnSync(process.execPath, args, { encoding: "utf8" });
      expect(generated.status).toBe(0);
      expect(generated.stdout).toContain("Wrote 3 UXP Hybrid addon artifacts.");
      expect(generated.stdout).not.toContain(bundle);
      expect(spawnSync(process.execPath, [...args, "--check"], { encoding: "utf8" }).status).toBe(0);

      const verified = spawnSync(process.execPath, ["scripts/verify-uxp-hybrid-addon-receipt.mjs", "--input", output, "--sdk-header-receipt", headersPath, "--print-canonical-sha256"], { encoding: "utf8" });
      expect(verified.status).toBe(0);
      expect(verified.stdout).toContain("UXP Hybrid addon receipt is valid: 3 addon artifacts");
      expect(verified.stdout).toContain("Canonical receipt SHA-256:");
      expect(verified.stdout).not.toContain(bundle);

      writeFileSync(join(bundle, "mac", "x64", "fixture-addon.uxpaddon"), "changed");
      const stale = spawnSync(process.execPath, [...args, "--check"], { encoding: "utf8" });
      expect(stale.status).not.toBe(0);
      expect(stale.stderr).toContain("UXP Hybrid addon receipt is stale");
      expect(stale.stderr).not.toContain(bundle);

      const unreadable = spawnSync(process.execPath, ["scripts/verify-uxp-hybrid-addon-receipt.mjs", "--input", output, "--sdk-header-receipt", join(directory, "private-location.json")], { encoding: "utf8" });
      expect(unreadable.status).not.toBe(0);
      expect(unreadable.stderr).toContain("sdkHeaderReceipt must be a readable JSON receipt");
      expect(unreadable.stderr).not.toContain(directory);
      expect(JSON.parse(readFileSync(output, "utf8")).artifacts).toHaveLength(3);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
