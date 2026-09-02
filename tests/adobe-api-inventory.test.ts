import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const inventory = JSON.parse(readFileSync("src/resources/adobe-api-inventory.json", "utf8"));
const coverage = JSON.parse(readFileSync("src/resources/adobe-uxp-coverage.json", "utf8"));
const betaC2paDrift = JSON.parse(readFileSync("src/resources/adobe-beta-c2pa-drift.json", "utf8"));
const betaMediaDrift = JSON.parse(readFileSync("src/resources/adobe-beta-media-drift.json", "utf8"));
const betaWorkAreaDrift = JSON.parse(readFileSync("src/resources/adobe-beta-work-area-drift.json", "utf8"));

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
    expect(betaMediaDrift).toMatchObject({
      schemaVersion: 1,
      scope: { declaration: "Media" },
      sources: {
        stable: { package: "@adobe/premierepro", version: "26.3.0", mediaDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
        beta: { package: "@adobe/premierepro-beta", version: "26.5.0-beta.73", mediaDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
      },
      diff: {
        betaOnly: [
          { symbol: "Media.getDuration", kind: "method", signature: "() => TickTime" },
          { symbol: "Media.getStart", kind: "method", signature: "() => TickTime" },
        ],
        stableOnly: [],
        changed: [
          { symbol: "Media.duration", stable: { signature: "TickTime" }, beta: { signature: "Promise<TickTime>" } },
          { symbol: "Media.start", stable: { signature: "TickTime" }, beta: { signature: "Promise<TickTime>" } },
        ],
        unchanged: ["Media.createSetStartAction"],
      },
    });
    expect(spawnSync(process.execPath, ["scripts/generate-adobe-beta-media-drift.mjs", "--check"], {
      encoding: "utf8",
    }).status).toBe(0);
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

  it("accounts for the beta-only C2PA declaration surface without advertising an action", () => {
    const stableDeclarations = readFileSync("node_modules/@adobe/premierepro/src/premierepro.d.ts", "utf8");
    const betaDeclarations = readFileSync("node_modules/@adobe/premierepro-beta/src/premierepro.d.ts", "utf8");
    expect(stableDeclarations).not.toContain("C2PAService");
    expect(stableDeclarations).not.toContain("C2PAManifestLocation");
    expect(betaDeclarations).toContain("C2PAService: C2PAServiceStatic;");
    expect(declarationType(betaDeclarations, "C2PAServiceStatic"))
      .toContain("getManifest(");
    expect(betaDeclarations).toContain("export enum C2PAManifestLocation {");
    expect(betaC2paDrift).toMatchObject({
      schemaVersion: 1,
      scope: {
        declarations: [
          "premierepro.C2PAService",
          "C2PAServiceStatic",
          "C2PAService",
          "Constants.C2PAManifestLocation",
        ],
        enumValueBoundary: expect.stringContaining("source order only"),
      },
      sources: {
        stable: { package: "@adobe/premierepro", version: "26.3.0", c2paSurfacePresent: false },
        beta: {
          package: "@adobe/premierepro-beta",
          version: "26.5.0-beta.73",
          c2paSurfacePresent: true,
          rootDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          serviceStaticDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          serviceDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          manifestLocationDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
      diff: {
        betaOnly: expect.arrayContaining([
          { symbol: "premierepro.C2PAService", kind: "property", signature: "C2PAServiceStatic" },
          {
            symbol: "C2PAServiceStatic.getManifest",
            kind: "method",
            signature: "(filePath: string, withValidation: boolean) => { manifest: string; manifestLocation: Constants.C2PAManifestLocation }",
          },
          {
            symbol: "Constants.C2PAManifestLocation.CLOUD",
            kind: "enum_member",
            declarationOrder: 0,
            initializer: "implicit",
          },
          {
            symbol: "Constants.C2PAManifestLocation.SIDE_CAR",
            kind: "enum_member",
            declarationOrder: 3,
            initializer: "implicit",
          },
        ]),
        stableOnly: [],
        changed: [],
      },
    });
    expect(spawnSync(process.execPath, ["scripts/generate-adobe-beta-c2pa-drift.mjs", "--check"], {
      encoding: "utf8",
    }).status).toBe(0);
    expect(coverage.entries.flatMap((entry: { adobeApi: string[] }) => entry.adobeApi))
      .not.toEqual(expect.arrayContaining([
        "premierepro.C2PAService",
        "C2PAServiceStatic.getManifest",
      ]));
  });

  it("accounts for beta WorkAreaUtils without changing legacy work-area coverage", () => {
    const stableDeclarations = readFileSync("node_modules/@adobe/premierepro/src/premierepro.d.ts", "utf8");
    const betaDeclarations = readFileSync("node_modules/@adobe/premierepro-beta/src/premierepro.d.ts", "utf8");
    expect(stableDeclarations).not.toContain("WorkAreaUtils");
    expect(betaDeclarations).toContain("WorkAreaUtils: WorkAreaUtilsStatic;");
    const workAreaStatic = declarationType(betaDeclarations, "WorkAreaUtilsStatic");
    expect(workAreaStatic).toContain("getWorkAreaInPoint(sequence: Sequence): TickTime;");
    expect(workAreaStatic).toContain("getWorkAreaOutPoint(sequence: Sequence): TickTime;");
    expect(workAreaStatic).toContain(
      "setWorkAreaInOutPoints(sequence: Sequence, inTickTime: TickTime, outTickTime: TickTime): boolean;",
    );
    expect(betaWorkAreaDrift).toMatchObject({
      schemaVersion: 1,
      scope: {
        declarations: ["premierepro.WorkAreaUtils", "WorkAreaUtilsStatic", "WorkAreaUtils"],
        existingToolBoundary: expect.stringContaining("legacy host paths"),
      },
      sources: {
        stable: { package: "@adobe/premierepro", version: "26.3.0", workAreaSurfacePresent: false },
        beta: {
          package: "@adobe/premierepro-beta",
          version: "26.5.0-beta.73",
          workAreaSurfacePresent: true,
          rootDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          workAreaStaticDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          workAreaDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
      diff: {
        betaOnly: expect.arrayContaining([
          { symbol: "premierepro.WorkAreaUtils", kind: "property", signature: "WorkAreaUtilsStatic" },
          { symbol: "WorkAreaUtilsStatic.getWorkAreaInPoint", kind: "method", signature: "(sequence: Sequence) => TickTime" },
          { symbol: "WorkAreaUtilsStatic.getWorkAreaOutPoint", kind: "method", signature: "(sequence: Sequence) => TickTime" },
          {
            symbol: "WorkAreaUtilsStatic.setWorkAreaInOutPoints",
            kind: "method",
            signature: "(sequence: Sequence, inTickTime: TickTime, outTickTime: TickTime) => boolean",
          },
        ]),
        stableOnly: [],
        changed: [],
      },
    });
    expect(spawnSync(process.execPath, ["scripts/generate-adobe-beta-work-area-drift.mjs", "--check"], {
      encoding: "utf8",
    }).status).toBe(0);
    expect(coverage.entries.flatMap((entry: { adobeApi: string[] }) => entry.adobeApi))
      .not.toEqual(expect.arrayContaining([
        "premierepro.WorkAreaUtils",
        "WorkAreaUtilsStatic.getWorkAreaInPoint",
        "WorkAreaUtilsStatic.setWorkAreaInOutPoints",
      ]));
  });

  it("fails closed when either pinned declaration does not expose a Media type literal", () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-beta-media-drift-"));
    const stablePath = join(directory, "stable.d.ts");
    const betaPath = join(directory, "beta.d.ts");
    writeFileSync(stablePath, "export declare type Media = { readonly start: TickTime; };\n");
    writeFileSync(betaPath, "export declare type Media = () => TickTime;\n");
    try {
      const result = spawnSync(process.execPath, ["scripts/generate-adobe-beta-media-drift.mjs", "--validate-only"], {
        encoding: "utf8",
        env: {
          ...process.env,
          PREMIERE_BETA_MEDIA_STABLE_DECLARATIONS_PATH: stablePath,
          PREMIERE_BETA_MEDIA_BETA_DECLARATIONS_PATH: betaPath,
        },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("must expose Media as a type literal");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when the beta C2PA root binding no longer has its declared static type", () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-beta-c2pa-drift-"));
    const stablePath = join(directory, "stable.d.ts");
    const betaPath = join(directory, "beta.d.ts");
    const stableDeclarations = readFileSync("node_modules/@adobe/premierepro/src/premierepro.d.ts", "utf8");
    const betaDeclarations = readFileSync("node_modules/@adobe/premierepro-beta/src/premierepro.d.ts", "utf8");
    writeFileSync(stablePath, stableDeclarations);
    writeFileSync(betaPath, betaDeclarations.replace(
      "C2PAService: C2PAServiceStatic;",
      "C2PAService: C2PAService;",
    ));
    try {
      const result = spawnSync(process.execPath, ["scripts/generate-adobe-beta-c2pa-drift.mjs", "--validate-only"], {
        encoding: "utf8",
        env: {
          ...process.env,
          PREMIERE_BETA_C2PA_STABLE_DECLARATIONS_PATH: stablePath,
          PREMIERE_BETA_C2PA_BETA_DECLARATIONS_PATH: betaPath,
        },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("must expose premierepro.C2PAService as C2PAServiceStatic");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when the beta WorkAreaUtils root binding no longer has its declared static type", () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-beta-work-area-drift-"));
    const stablePath = join(directory, "stable.d.ts");
    const betaPath = join(directory, "beta.d.ts");
    const stableDeclarations = readFileSync("node_modules/@adobe/premierepro/src/premierepro.d.ts", "utf8");
    const betaDeclarations = readFileSync("node_modules/@adobe/premierepro-beta/src/premierepro.d.ts", "utf8");
    writeFileSync(stablePath, stableDeclarations);
    writeFileSync(betaPath, betaDeclarations.replace(
      "WorkAreaUtils: WorkAreaUtilsStatic;",
      "WorkAreaUtils: WorkAreaUtils;",
    ));
    try {
      const result = spawnSync(process.execPath, ["scripts/generate-adobe-beta-work-area-drift.mjs", "--validate-only"], {
        encoding: "utf8",
        env: {
          ...process.env,
          PREMIERE_BETA_WORK_AREA_STABLE_DECLARATIONS_PATH: stablePath,
          PREMIERE_BETA_WORK_AREA_BETA_DECLARATIONS_PATH: betaPath,
        },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("must expose premierepro.WorkAreaUtils as WorkAreaUtilsStatic");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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
