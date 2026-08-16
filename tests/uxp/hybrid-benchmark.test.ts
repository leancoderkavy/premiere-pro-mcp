import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const HybridBenchmark = require("../../uxp-plugin/hybrid-benchmark.cjs");

describe("UXP hybrid benchmark harness", () => {
  it("keeps the production panel free of native addon permissions and declarations", () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "uxp-plugin", "manifest.json"), "utf8"));
    expect(manifest.manifestVersion).toBe(5);
    expect(manifest).not.toHaveProperty("addon");
    expect(manifest.requiredPermissions).not.toHaveProperty("enableAddon");
  });

  it("runs identical bounded JavaScript and injected-addon workloads", () => {
    let clock = 0;
    const result = HybridBenchmark.run({
      sampleCount: 5,
      warmupCount: 1,
      iterations: 1,
      inputLength: 1024,
      seed: 7,
      now: vi.fn(() => clock++),
      readMemory: vi.fn(() => 1024),
      requireAddon: true,
      loadAddon: vi.fn(() => ({
        runBenchmarkKernel: (values: Float64Array, iterations: number) =>
          HybridBenchmark.weightedEnergy(values, iterations),
      })),
    });

    expect(result).toMatchObject({
      schemaVersion: 1,
      workloadId: "weighted-energy-v1",
      addon: { name: "premiere-mcp-benchmark.uxpaddon", loaded: true, error: null },
      javascript: { sampleCount: 5, p50Ms: 1, p95Ms: 1, checksum: expect.any(Number) },
      native: { sampleCount: 5, p50Ms: 1, p95Ms: 1, checksum: expect.any(Number) },
      checksumMatch: true,
      promotionEligible: false,
    });
  });

  it("reports an unavailable addon without turning a local JavaScript run into promotion evidence", () => {
    let clock = 0;
    const result = HybridBenchmark.run({
      sampleCount: 5,
      warmupCount: 0,
      iterations: 1,
      inputLength: 1024,
      now: () => clock++,
      loadAddon: () => { throw new Error("not installed"); },
    });
    expect(result).toMatchObject({
      addon: { loaded: false, error: "not installed" },
      native: null,
      checksumMatch: null,
      promotionEligible: false,
    });
  });

  it("rejects an addon that does not implement the benchmark adapter contract", () => {
    expect(() => HybridBenchmark.run({
      sampleCount: 5,
      warmupCount: 0,
      iterations: 1,
      inputLength: 1024,
      loadAddon: () => ({}),
    })).toThrow("runBenchmarkKernel");
  });
});
