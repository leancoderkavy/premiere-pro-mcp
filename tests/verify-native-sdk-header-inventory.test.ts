import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { NATIVE_SDK_HEADER_INVENTORY_SEMANTICS } from "../scripts/native-sdk-header-inventory-contract.mjs";
import { verifyNativeSdkHeaderInventory } from "../scripts/verify-native-sdk-header-inventory.mjs";

const hash = (character: string) => character.repeat(64);

function hybridReceipt() {
  return {
    schemaVersion: 1,
    source: {
      sdk: "uxp-hybrid",
      sdkVersion: "fixture",
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("native SDK header receipt verifier", () => {
  it("accepts a complete hash-only Hybrid receipt and a PrSDK receipt with explicit roots", () => {
    expect(verifyNativeSdkHeaderInventory(hybridReceipt())).toEqual({ sdk: "uxp-hybrid", headers: 3, bytes: 24 });
    const prsdk = hybridReceipt();
    prsdk.source = {
      sdk: "premiere-prsdk",
      sdkVersion: "fixture",
      authorityUrl: "https://developer.adobe.com/premiere-pro/",
      archiveSha256: hash("e"),
      inventoryScope: "header_files_only",
      includeDirectories: ["Headers"],
    };
    prsdk.headers = [{ path: "Headers/PrSDKFixture.hpp", bytes: 3, sha256: hash("f") }];
    prsdk.stats = { headers: 1, bytes: 3 };
    expect(verifyNativeSdkHeaderInventory(prsdk)).toEqual({ sdk: "premiere-prsdk", headers: 1, bytes: 3 });
  });

  it("rejects receipt fields that could leak SDK material or rewrite the evidence boundary", () => {
    const leaked = clone(hybridReceipt());
    leaked.headers[0] = { ...leaked.headers[0], contents: "typedef void* addon_value;" };
    expect(() => verifyNativeSdkHeaderInventory(leaked)).toThrow("must contain only the documented receipt fields");

    const rewrittenBoundary = clone(hybridReceipt());
    rewrittenBoundary.semantics.doesNotEstablish = "This proves native support.";
    expect(() => verifyNativeSdkHeaderInventory(rewrittenBoundary)).toThrow("must retain the documented evidence boundary");
  });

  it("rejects malformed provenance, header paths, ordering, totals, and missing public Hybrid headers", () => {
    const absolutePath = clone(hybridReceipt());
    absolutePath.headers[0].path = "C:/sdk/UxpAddonShared.h";
    expect(() => verifyNativeSdkHeaderInventory(absolutePath)).toThrow("must be a canonical relative path");

    const unsorted = clone(hybridReceipt());
    [unsorted.headers[0], unsorted.headers[1]] = [unsorted.headers[1], unsorted.headers[0]];
    expect(() => verifyNativeSdkHeaderInventory(unsorted)).toThrow("must be strictly sorted");

    const incorrectStats = clone(hybridReceipt());
    incorrectStats.stats.bytes = 25;
    expect(() => verifyNativeSdkHeaderInventory(incorrectStats)).toThrow("stats.bytes does not match headers");

    const missingExpectedHeader = clone(hybridReceipt());
    missingExpectedHeader.headers = missingExpectedHeader.headers.slice(1);
    missingExpectedHeader.stats = { headers: 2, bytes: 17 };
    expect(() => verifyNativeSdkHeaderInventory(missingExpectedHeader)).toThrow("Missing required UXP Hybrid SDK header");
  });

  it("validates JSON through the CLI without printing receipt contents", () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-native-sdk-receipt-"));
    const input = join(directory, "receipt.json");
    try {
      writeFileSync(input, `${JSON.stringify(hybridReceipt(), null, 2)}\n`);
      const result = spawnSync(process.execPath, ["scripts/verify-native-sdk-header-inventory.mjs", "--input", input], { encoding: "utf8" });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Native SDK header receipt is valid: 3 uxp-hybrid header files, 24 bytes.");
      expect(result.stdout).not.toContain("UxpAddonShared.h");

      const malformed = clone(hybridReceipt());
      malformed.headers[0].contents = "private SDK header";
      writeFileSync(input, `${JSON.stringify(malformed, null, 2)}\n`);
      const rejected = spawnSync(process.execPath, ["scripts/verify-native-sdk-header-inventory.mjs", "--input", input], { encoding: "utf8" });
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain("must contain only the documented receipt fields");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
