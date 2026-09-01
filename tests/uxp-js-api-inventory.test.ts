import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const inventory = JSON.parse(readFileSync("src/resources/uxp-js-api-inventory.json", "utf8"));
const coverage = JSON.parse(readFileSync("src/resources/uxp-js-coverage.json", "utf8"));

describe("Adobe UXP JavaScript declaration inventory", () => {
  it("accounts for every generated declaration symbol and exact panel mapping", () => {
    expect(inventory.source).toMatchObject({
      package: "@adobe/cc-ext-uxp-types",
      version: "7.3.1",
    });
    expect(inventory.source.declarationsSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(inventory.stats.total).toBe(inventory.entries.length);
    expect(inventory.stats.mapped + inventory.stats.unmapped).toBe(inventory.stats.total);
    expect(inventory.manifestOnly).toEqual([]);
    expect(inventory.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ symbol: "uxp.EntryPoints.setup", kind: "method", coverage: "mapped" }),
      expect.objectContaining({ symbol: "uxp.Host.version", kind: "property", coverage: "mapped" }),
      expect.objectContaining({ symbol: "uxp.storage.FileSystemProvider.getTemporaryFolder", kind: "method" }),
      expect.objectContaining({ symbol: "globalThis.WebSocket.send", kind: "method", coverage: "mapped" }),
      expect.objectContaining({ symbol: "fs.fs.readFile", kind: "method" }),
      expect.objectContaining({ symbol: "os.OS.platform", kind: "method" }),
    ]));
  });

  it("derives manifest-only drift from exact declaration identities", () => {
    const declared = new Set(inventory.entries.map((entry: { symbol: string }) => entry.symbol));
    const mapped = new Set(coverage.entries.flatMap((entry: { uxpApi: string[] }) => entry.uxpApi));
    expect(inventory.manifestOnly).toEqual([...mapped].filter((symbol) => !declared.has(symbol)).sort());
  });

  it.each([
    ["top-level", ";", "Unsupported top-level UXP declaration"],
    ["member", "declare class Unsupported { ; }", "Unsupported anonymous UXP member"],
    ["variable", "declare const { value }: any;", "Unsupported destructured UXP variable declaration"],
    ["syntax", "declare class Unsupported {", "TypeScript declaration parse failed"],
  ])("fails closed for unsupported %s syntax", (_label, declarations, expectedError) => {
    const directory = mkdtempSync(join(tmpdir(), "uxp-js-api-inventory-"));
    const fixture = join(directory, "index.d.ts");
    writeFileSync(fixture, declarations);
    try {
      const result = spawnSync(process.execPath, ["scripts/generate-uxp-js-api-inventory.mjs", "--validate-only"], {
        encoding: "utf8",
        env: { ...process.env, UXP_JS_DECLARATIONS_PATH: fixture },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(expectedError);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
