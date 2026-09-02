import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const inventory = JSON.parse(readFileSync("src/resources/adobe-api-inventory.json", "utf8"));
const coverage = JSON.parse(readFileSync("src/resources/adobe-uxp-coverage.json", "utf8"));

describe("Adobe declaration API inventory", () => {
  it("accounts for every generated entry and retains exact symbol identities", () => {
    expect(inventory.source.version).toBe("26.3.0");
    expect(inventory.source.declarationsSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(inventory.stats.total).toBe(inventory.entries.length);
    expect(inventory.stats.mapped + inventory.stats.unmapped).toBe(inventory.stats.total);
    expect(inventory.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ symbol: "Project.lockedAccess", kind: "method", coverage: "mapped" }),
      expect.objectContaining({ symbol: "Project.createProject", declarationSymbol: "ProjectStatic.createProject" }),
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

  it.each([
    ["top-level", "export interface Unsupported {}", "Unsupported top-level Adobe declaration"],
    ["namespace", "export declare namespace Constants { interface Unsupported {} }", "Unsupported declaration in namespace"],
    ["member", "export declare type Unsupported = { get value(): string };", "Unsupported type member"],
    ["type expression", "export declare type Unsupported = () => string;", "Unsupported type expression"],
    ["syntax error", "export declare type Unsupported = { value: string", "TypeScript declaration parse failed"],
  ])("fails closed for an unsupported %s declaration form", (_label, declarations, expectedError) => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-api-inventory-"));
    const fixturePath = join(directory, "premierepro.d.ts");
    writeFileSync(fixturePath, `export declare type premierepro = {};\n${declarations}`);
    try {
      const result = spawnSync(process.execPath, ["scripts/generate-adobe-api-inventory.mjs", "--validate-only"], {
        encoding: "utf8",
        env: { ...process.env, PREMIERE_API_DECLARATIONS_PATH: fixturePath },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(expectedError);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
