import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_TARGETS,
  verifyHybridBenchmarkEvidence,
} from "../scripts/verify-uxp-hybrid-benchmark.mjs";
import { NATIVE_SDK_HEADER_INVENTORY_SEMANTICS } from "../scripts/native-sdk-header-inventory-contract.mjs";
import { canonicalNativeSdkHeaderInventorySha256 } from "../scripts/verify-native-sdk-header-inventory.mjs";

const SHA = "a".repeat(40);
const ADDON_SHA = "b".repeat(64);

function sdkHeaderReceipt(sdkVersion = "UXP Hybrid SDK test fixture") {
  return {
    schemaVersion: 1,
    source: {
      sdk: "uxp-hybrid",
      sdkVersion,
      authorityUrl: "https://developer.adobe.com/premiere-pro/uxp/plugins/hybrid-plugins/",
      archiveSha256: "c".repeat(64),
      inventoryScope: "header_files_only",
      includeDirectories: ["src/api", "src/utilities"],
    },
    semantics: NATIVE_SDK_HEADER_INVENTORY_SEMANTICS,
    stats: { headers: 3, bytes: 24 },
    headers: [
      { path: "src/api/UxpAddonShared.h", bytes: 7, sha256: "d".repeat(64) },
      { path: "src/api/UxpAddonTypes.h", bytes: 8, sha256: "e".repeat(64) },
      { path: "src/utilities/UxpAddon.h", bytes: 9, sha256: "f".repeat(64) },
    ],
  };
}

function evidence(headerReceipt = sdkHeaderReceipt()) {
  return {
    schemaVersion: 1,
    workloadId: "weighted-energy-v1",
    configuration: { sampleCount: 30, warmupCount: 3, iterations: 4, inputLength: 131072, seed: 1337 },
    memoryMeasurement: "fixture process monitor",
    sdkHeaderReceiptSha256: canonicalNativeSdkHeaderInventorySha256(headerReceipt),
    runs: REQUIRED_TARGETS.map((target) => {
      const [platform, arch] = target.split("-");
      return {
        platform,
        arch,
        hostVersion: "26.3.0",
        sdkVersion: "UXP Hybrid SDK test fixture",
        buildMode: "Release",
        addonLoaded: true,
        addonSha256: ADDON_SHA,
        sourceCommit: SHA,
        checksumMatch: true,
        codeSigned: platform === "mac",
        notarized: platform === "mac",
        javascript: { sampleCount: 30, p50Ms: 100, p95Ms: 140, peakWorkingSetBytes: 1000 },
        native: { sampleCount: 30, p50Ms: 60, p95Ms: 80, peakWorkingSetBytes: 1050 },
      };
    }),
  };
}

describe("UXP hybrid benchmark evidence verifier", () => {
  it("requires all release targets, matching output, speed, memory, signing, and one commit", () => {
    const receipt = sdkHeaderReceipt();
    expect(verifyHybridBenchmarkEvidence(evidence(receipt), { sdkHeaderReceipt: receipt })).toEqual({
      promotionEligible: true,
      errors: [],
      targets: ["mac-arm64", "mac-x64", "win-x64"],
      thresholds: { minimumSpeedupPercent: 30, maximumMemoryRegressionPercent: 10 },
      verificationBoundary: "submitted_cross_platform_release_build_and_verified_sdk_receipt_evidence",
    });
  });

  it("fails closed when a target is missing or a percentile misses the threshold", () => {
    const receipt = sdkHeaderReceipt();
    const value = evidence(receipt);
    value.runs.pop();
    value.runs[0].native.p95Ms = 110;
    const result = verifyHybridBenchmarkEvidence(value, { sdkHeaderReceipt: receipt });
    expect(result.promotionEligible).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("p95 speedup"),
      expect.stringContaining("Missing required mac-arm64 evidence"),
    ]));
  });

  it("requires a structurally verified matching Hybrid receipt and rejects undocumented fields", () => {
    const receipt = sdkHeaderReceipt();
    const value = evidence(receipt);
    expect(verifyHybridBenchmarkEvidence(value).errors).toContain("A verified UXP Hybrid SDK header receipt is required.");

    const mismatchedDigest = { ...value, sdkHeaderReceiptSha256: "0".repeat(64) };
    expect(verifyHybridBenchmarkEvidence(mismatchedDigest, { sdkHeaderReceipt: receipt }).errors)
      .toContain("sdkHeaderReceiptSha256 does not match the verified SDK header receipt.");

    const mismatchedVersionReceipt = sdkHeaderReceipt("UXP Hybrid SDK other fixture");
    expect(verifyHybridBenchmarkEvidence(value, { sdkHeaderReceipt: mismatchedVersionReceipt }).errors)
      .toEqual(expect.arrayContaining([
        "SDK header receipt sdkVersion must match all benchmark runs.",
        "sdkHeaderReceiptSha256 does not match the verified SDK header receipt.",
      ]));

    const withExtraField = { ...value, privateSdkPath: "C:Headers" };
    expect(verifyHybridBenchmarkEvidence(withExtraField, { sdkHeaderReceipt: receipt }).errors)
      .toContain("Evidence must contain only the documented benchmark receipt fields.");
  });

  it("requires the local receipt path from the command-line verifier without printing it", () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-hybrid-benchmark-"));
    const input = join(directory, "evidence.json");
    const receiptPath = join(directory, "receipt.json");
    const receipt = sdkHeaderReceipt();
    try {
      writeFileSync(input, `${JSON.stringify(evidence(receipt), null, 2)}\n`);
      writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
      const missingReceipt = spawnSync(process.execPath, ["scripts/verify-uxp-hybrid-benchmark.mjs", "--input", input], { encoding: "utf8" });
      expect(missingReceipt.status).not.toBe(0);
      expect(missingReceipt.stderr).toContain("--input <evidence.json> and --sdk-header-receipt <receipt.json> are required.");

      const verified = spawnSync(process.execPath, ["scripts/verify-uxp-hybrid-benchmark.mjs", "--input", input, "--sdk-header-receipt", receiptPath], { encoding: "utf8" });
      expect(verified.status).toBe(0);
      expect(verified.stdout).toContain('"promotionEligible": true');
      expect(verified.stdout).not.toContain("UxpAddonShared.h");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
