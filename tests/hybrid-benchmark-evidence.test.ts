import { describe, expect, it } from "vitest";
import {
  REQUIRED_TARGETS,
  verifyHybridBenchmarkEvidence,
} from "../scripts/verify-uxp-hybrid-benchmark.mjs";

const SHA = "a".repeat(40);
const ADDON_SHA = "b".repeat(64);

function evidence() {
  return {
    schemaVersion: 1,
    workloadId: "weighted-energy-v1",
    configuration: { sampleCount: 30, warmupCount: 3, iterations: 4, inputLength: 131072, seed: 1337 },
    memoryMeasurement: "fixture process monitor",
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
    expect(verifyHybridBenchmarkEvidence(evidence())).toEqual({
      promotionEligible: true,
      errors: [],
      targets: ["mac-arm64", "mac-x64", "win-x64"],
      thresholds: { minimumSpeedupPercent: 30, maximumMemoryRegressionPercent: 10 },
      verificationBoundary: "submitted_cross_platform_release_build_evidence",
    });
  });

  it("fails closed when a target is missing or a percentile misses the threshold", () => {
    const value = evidence();
    value.runs.pop();
    value.runs[0].native.p95Ms = 110;
    const result = verifyHybridBenchmarkEvidence(value);
    expect(result.promotionEligible).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("p95 speedup"),
      expect.stringContaining("Missing required mac-arm64 evidence"),
    ]));
  });
});
