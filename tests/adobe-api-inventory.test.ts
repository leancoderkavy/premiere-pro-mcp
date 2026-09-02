import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const inventory = JSON.parse(readFileSync("src/resources/adobe-api-inventory.json", "utf8"));
const coverage = JSON.parse(readFileSync("src/resources/adobe-uxp-coverage.json", "utf8"));

function declarationType(declarations: string, name: string): string {
  const match = declarations.match(new RegExp(`export declare type ${name} = \\{([\\s\\S]*?)^\\};`, "m"));
  if (!match) throw new Error(`Missing ${name} declaration`);
  return match[1];
}

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

  it("pins beta Media declarations for drift audit while coverage remains stable-only", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    const lockfile = JSON.parse(readFileSync("package-lock.json", "utf8"));
    expect(manifest.devDependencies["@adobe/premierepro"]).toBe("26.3.0");
    expect(manifest.devDependencies["@adobe/premierepro-beta"])
      .toBe("npm:@adobe/premierepro@26.5.0-beta.73");
    expect(lockfile.packages["node_modules/@adobe/premierepro-beta"]).toMatchObject({
      name: "@adobe/premierepro",
      version: "26.5.0-beta.73",
      integrity: expect.stringMatching(/^sha512-/),
    });

    const stableMedia = declarationType(
      readFileSync("node_modules/@adobe/premierepro/src/premierepro.d.ts", "utf8"), "Media",
    );
    expect(stableMedia).toContain("readonly start: TickTime;");
    expect(stableMedia).toContain("readonly duration: TickTime;");
    expect(stableMedia).not.toContain("getStart(): TickTime;");
    expect(stableMedia).not.toContain("getDuration(): TickTime;");

    const betaMedia = declarationType(
      readFileSync("node_modules/@adobe/premierepro-beta/src/premierepro.d.ts", "utf8"), "Media",
    );
    expect(betaMedia).toContain("getStart(): TickTime;");
    expect(betaMedia).toContain("getDuration(): TickTime;");
    expect(betaMedia).toMatch(/@deprecated Use getStart\(\) instead\.[\s\S]*?readonly start: Promise<TickTime>;/);
    expect(betaMedia).toMatch(/@deprecated Use getDuration\(\) instead\.[\s\S]*?readonly duration: Promise<TickTime>;/);
    const mediaHealthCoverage = coverage.entries.find((entry: { id: string }) => entry.id === "bounded-media-health-maintenance");
    expect(mediaHealthCoverage.adobeApi).toEqual(expect.arrayContaining([
      "ClipProjectItem.getMedia",
      "Media.start",
      "Media.duration",
    ]));
    expect(mediaHealthCoverage.adobeApi).not.toEqual(expect.arrayContaining([
      "Media.getStart",
      "Media.getDuration",
    ]));
    const sourceTimingCoverage = coverage.entries.find((entry: { id: string }) => entry.id === "guarded-source-media-timing");
    expect(sourceTimingCoverage.adobeApi).toEqual(expect.arrayContaining([
      "ClipProjectItem.getMedia",
      "Media.start",
      "Media.duration",
      "Media.createSetStartAction",
    ]));
    expect(sourceTimingCoverage.adobeApi).not.toEqual(expect.arrayContaining([
      "Media.getStart",
      "Media.getDuration",
    ]));
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
