import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function prsdkHeaderReceipt() {
  return {
    schemaVersion: 1,
    source: {
      sdk: "premiere-prsdk",
      sdkVersion: "UXP Hybrid SDK test fixture",
      authorityUrl: "https://developer.adobe.com/premiere-pro/",
      archiveSha256: "c".repeat(64),
      inventoryScope: "header_files_only",
      includeDirectories: ["Headers"],
    },
    semantics: NATIVE_SDK_HEADER_INVENTORY_SEMANTICS,
    stats: { headers: 1, bytes: 7 },
    headers: [
      { path: "Headers/PrSDKFixture.h", bytes: 7, sha256: "d".repeat(64) },
    ],
  };
}

function evidence(headerReceipt = sdkHeaderReceipt()) {
  return {
    schemaVersion: 2,
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

function legacyEvidence() {
  const { sdkHeaderReceiptSha256, ...v1 } = evidence();
  return { ...v1, schemaVersion: 1 };
}

describe("UXP hybrid benchmark evidence verifier", () => {
  it("keeps the frozen v1 schema and verifier path available while making receipt binding v2", () => {
    const v1Schema = JSON.parse(readFileSync("benchmarks/uxp-hybrid/evidence.v1.schema.json", "utf8"));
    const v2Schema = JSON.parse(readFileSync("benchmarks/uxp-hybrid/evidence.schema.json", "utf8"));
    expect(v1Schema.$id).toBe("https://premiere-pro-mcp.com/schemas/uxp-hybrid-benchmark-evidence-v1.json");
    expect(v1Schema.properties.schemaVersion.const).toBe(1);
    expect(v1Schema.required).not.toContain("sdkHeaderReceiptSha256");
    expect(v2Schema.$id).toBe("https://premiere-pro-mcp.com/schemas/uxp-hybrid-benchmark-evidence-v2.json");
    expect(v2Schema.properties.schemaVersion.const).toBe(2);
    expect(v2Schema.required).toContain("sdkHeaderReceiptSha256");
    expect(verifyHybridBenchmarkEvidence(legacyEvidence())).toEqual({
      promotionEligible: true,
      errors: [],
      targets: ["mac-arm64", "mac-x64", "win-x64"],
      thresholds: { minimumSpeedupPercent: 30, maximumMemoryRegressionPercent: 10 },
      verificationBoundary: "submitted_cross_platform_release_build_evidence",
    });
  });

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

    const wrongSdkReceipt = prsdkHeaderReceipt();
    expect(verifyHybridBenchmarkEvidence(value, { sdkHeaderReceipt: wrongSdkReceipt }).errors)
      .toEqual(expect.arrayContaining([
        "SDK header receipt must identify uxp-hybrid.",
        "sdkHeaderReceiptSha256 does not match the verified SDK header receipt.",
      ]));

    const withExtraField = { ...value, privateSdkPath: "C:Headers" };
    expect(verifyHybridBenchmarkEvidence(withExtraField, { sdkHeaderReceipt: receipt }).errors)
      .toContain("Evidence must contain only the documented benchmark receipt fields.");

    const withExtraRunField = {
      ...value,
      runs: [{ ...value.runs[0], localAddonPath: "C:Headers" }, ...value.runs.slice(1)],
    };
    expect(verifyHybridBenchmarkEvidence(withExtraRunField, { sdkHeaderReceipt: receipt }).errors)
      .toContain("runs[0] must contain only the documented benchmark fields.");

    const withExtraMetricField = {
      ...value,
      runs: [{ ...value.runs[0], native: { ...value.runs[0].native, rawSamples: [60] } }, ...value.runs.slice(1)],
    };
    expect(verifyHybridBenchmarkEvidence(withExtraMetricField, { sdkHeaderReceipt: receipt }).errors)
      .toContain("runs[0].native must contain only the documented metric fields.");
  });

  it("requires a local receipt path for v2 without printing it while retaining v1 CLI compatibility", () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-hybrid-benchmark-"));
    const input = join(directory, "evidence.json");
    const receiptPath = join(directory, "receipt.json");
    const receipt = sdkHeaderReceipt();
    try {
      writeFileSync(input, `${JSON.stringify(evidence(receipt), null, 2)}\n`);
      writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
      const missingReceipt = spawnSync(process.execPath, ["scripts/verify-uxp-hybrid-benchmark.mjs", "--input", input], { encoding: "utf8" });
      expect(missingReceipt.status).not.toBe(0);
      expect(missingReceipt.stdout).toContain("A verified UXP Hybrid SDK header receipt is required.");

      writeFileSync(input, `${JSON.stringify(legacyEvidence(), null, 2)}\n`);
      const legacy = spawnSync(process.execPath, ["scripts/verify-uxp-hybrid-benchmark.mjs", "--input", input], { encoding: "utf8" });
      expect(legacy.status).toBe(0);
      expect(legacy.stdout).toContain('"verificationBoundary": "submitted_cross_platform_release_build_evidence"');

      writeFileSync(input, `${JSON.stringify(evidence(receipt), null, 2)}\n`);

      const verified = spawnSync(process.execPath, ["scripts/verify-uxp-hybrid-benchmark.mjs", "--input", input, "--sdk-header-receipt", receiptPath], { encoding: "utf8" });
      expect(verified.status).toBe(0);
      expect(verified.stdout).toContain('"promotionEligible": true');
      expect(verified.stdout).not.toContain("UxpAddonShared.h");

      const unreadableReceipt = join(directory, "do-not-disclose-this-receipt.json");
      const unreadable = spawnSync(process.execPath, ["scripts/verify-uxp-hybrid-benchmark.mjs", "--input", input, "--sdk-header-receipt", unreadableReceipt], { encoding: "utf8" });
      expect(unreadable.status).not.toBe(0);
      expect(unreadable.stderr).toContain("SDK header receipt must be a readable JSON document.");
      expect(unreadable.stderr).not.toContain(unreadableReceipt);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
