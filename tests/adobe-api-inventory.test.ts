import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const inventory = JSON.parse(readFileSync("src/resources/adobe-api-inventory.json", "utf8"));
const coverage = JSON.parse(readFileSync("src/resources/adobe-uxp-coverage.json", "utf8"));

describe("Adobe declaration API inventory", () => {
  it("accounts for every generated entry and retains exact symbol identities", () => {
    expect(inventory.source.version).toBe("26.3.0");
    expect(inventory.stats.total).toBe(inventory.entries.length);
    expect(inventory.stats.mapped + inventory.stats.unmapped).toBe(inventory.stats.total);
    expect(inventory.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ symbol: "Project.lockedAccess", kind: "method", coverage: "mapped" }),
      expect.objectContaining({ symbol: "Sequence.setSelection", kind: "method" }),
      expect.objectContaining({ symbol: "Constants.MediaType", kind: "enum" }),
    ]));
  });

  it("makes declaration drift and manifest-only aliases explicit", () => {
    const declared = new Set(inventory.entries.map((entry: { symbol: string }) => entry.symbol));
    const manifestApis = new Set(coverage.entries.flatMap((entry: { adobeApi: string[] }) => entry.adobeApi));
    const expectedManifestOnly = [...manifestApis].filter((symbol) => !declared.has(symbol)).sort();
    expect(inventory.manifestOnly).toEqual(expectedManifestOnly);
    expect(inventory.stats.manifestOnly).toBe(expectedManifestOnly.length);
  });

  it("fails closed when the declaration file contains an unknown top-level form", () => {
    const script = readFileSync("scripts/generate-adobe-api-inventory.mjs", "utf8");
    expect(script).toContain("Unsupported top-level Adobe declaration");
    expect(script).toContain("Unsupported declaration in namespace");
    expect(spawnSync(process.execPath, ["scripts/generate-adobe-api-inventory.mjs", "--check"]).status).toBe(0);
  });
});
