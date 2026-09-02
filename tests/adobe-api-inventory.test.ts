import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const inventory = JSON.parse(readFileSync("src/resources/adobe-api-inventory.json", "utf8"));
const coverage = JSON.parse(readFileSync("src/resources/adobe-uxp-coverage.json", "utf8"));
const betaAafExportOptionsDrift = JSON.parse(readFileSync("src/resources/adobe-beta-aaf-export-options-drift.json", "utf8"));
const betaProjectOptionsDrift = JSON.parse(readFileSync("src/resources/adobe-beta-project-options-drift.json", "utf8"));
const betaTransitionOptionsDrift = JSON.parse(readFileSync("src/resources/adobe-beta-transition-options-drift.json", "utf8"));
const betaRectFDrift = JSON.parse(readFileSync("src/resources/adobe-beta-rectf-drift.json", "utf8"));
const betaColorDrift = JSON.parse(readFileSync("src/resources/adobe-beta-color-drift.json", "utf8"));
const betaC2paDrift = JSON.parse(readFileSync("src/resources/adobe-beta-c2pa-drift.json", "utf8"));
const betaMediaDrift = JSON.parse(readFileSync("src/resources/adobe-beta-media-drift.json", "utf8"));
const betaMediaManagerDrift = JSON.parse(readFileSync("src/resources/adobe-beta-media-manager-drift.json", "utf8"));
const betaTranscriptDrift = JSON.parse(readFileSync("src/resources/adobe-beta-transcript-drift.json", "utf8"));
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

  it("maps the documented stable SnapEvent journal constants without advertising host execution", () => {
    const snapCoverage = coverage.entries.find((entry: { id: string }) => entry.id === "bounded-timeline-snap-event-journal");
    expect(snapCoverage).toMatchObject({
      backend: "uxp",
      uxpCommand: "events.list",
      mcpTools: ["inspect_premiere_events_uxp"],
      minimumPremiereVersion: "26.3.0",
      mutatesProject: false,
      undoable: false,
      verificationStatus: "automated_contract_verified",
      liveHostVerificationStatus: "not_run",
      verificationBoundary: "bounded_redacted_timeline_snap_event_receipt",
    });
    expect(snapCoverage.adobeApi).toEqual([
      "SnapEvent.EVENT_SNAP_TO_KEYFRAME",
      "SnapEvent.EVENT_SNAP_TO_TRACKITEM",
      "SnapEvent.EVENT_SNAP_TO_GUIDES",
      "SnapEvent.EVENT_SNAP_RAZOR_TO_PLAYHEAD",
      "SnapEvent.EVENT_SNAP_RAZOR_TO_MARKER",
      "SnapEvent.EVENT_SNAP_PLAYHEAD_TO_TRACKITEM_EDGE",
    ]);
    for (const symbol of snapCoverage.adobeApi) {
      expect(inventory.entries).toContainEqual(expect.objectContaining({ symbol, coverage: "mapped" }));
    }
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

  it("accounts for the beta AAFExportOptions factory-type migration without advertising an export action", () => {
    const stableDeclarations = readFileSync("node_modules/@adobe/premierepro/src/premierepro.d.ts", "utf8");
    const betaDeclarations = readFileSync("node_modules/@adobe/premierepro-beta/src/premierepro.d.ts", "utf8");
    expect(stableDeclarations).toContain("AAFExportOptions: AAFExportOptions;");
    expect(stableDeclarations).not.toContain("export declare type AAFExportOptionsStatic");
    expect(declarationType(stableDeclarations, "AAFExportOptions")).toContain("new (): AAFExportOptions;");
    expect(betaDeclarations).toContain("AAFExportOptions: AAFExportOptionsStatic;");
    expect(declarationType(betaDeclarations, "AAFExportOptions"))
      .not.toContain("new (): AAFExportOptions;");
    const betaStatic = declarationType(betaDeclarations, "AAFExportOptionsStatic");
    expect(betaStatic).toContain("new (): AAFExportOptions;");
    expect(betaStatic).toContain("(): AAFExportOptions;");
    expect(betaAafExportOptionsDrift).toMatchObject({
      schemaVersion: 1,
      scope: {
        declarations: ["premierepro.AAFExportOptions", "AAFExportOptions", "AAFExportOptionsStatic"],
        mutationBoundary: expect.stringContaining("does not construct options"),
      },
      sources: {
        stable: {
          package: "@adobe/premierepro",
          version: "26.3.0",
          staticFactoryPresent: false,
          rootDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          optionsDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        beta: {
          package: "@adobe/premierepro-beta",
          version: "26.5.0-beta.73",
          staticFactoryPresent: true,
          rootDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          optionsDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          staticDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
      diff: {
        betaOnly: [
          {
            symbol: "AAFExportOptionsStatic",
            kind: "type",
            signature: expect.stringContaining("new (): AAFExportOptions"),
          },
          {
            symbol: "AAFExportOptionsStatic.call",
            kind: "call_signature",
            signature: "() => AAFExportOptions",
          },
          {
            symbol: "AAFExportOptionsStatic.new",
            kind: "construct_signature",
            signature: "() => AAFExportOptions",
          },
        ],
        stableOnly: [],
        changed: [
          {
            symbol: "premierepro.AAFExportOptions",
            stable: { signature: "AAFExportOptions" },
            beta: { signature: "AAFExportOptionsStatic" },
          },
          {
            symbol: "AAFExportOptions.factorySignatures",
            stable: { owner: "AAFExportOptions" },
            beta: { owner: "AAFExportOptionsStatic" },
          },
        ],
      },
    });
    expect(spawnSync(process.execPath, ["scripts/generate-adobe-beta-aaf-export-options-drift.mjs", "--check"], {
      encoding: "utf8",
    }).status).toBe(0);
    expect(coverage.entries.flatMap((entry: { adobeApi: string[] }) => entry.adobeApi))
      .not.toEqual(expect.arrayContaining([
        "premierepro.AAFExportOptions",
        "AAFExportOptionsStatic.new",
      ]));
  });

  it("accounts for beta project-option factory migrations without advertising lifecycle actions", () => {
    const stableDeclarations = readFileSync("node_modules/@adobe/premierepro/src/premierepro.d.ts", "utf8");
    const betaDeclarations = readFileSync("node_modules/@adobe/premierepro-beta/src/premierepro.d.ts", "utf8");
    for (const name of ["OpenProjectOptions", "CloseProjectOptions"]) {
      expect(stableDeclarations).toContain(`${name}: ${name};`);
      expect(stableDeclarations).not.toContain(`export declare type ${name}Static`);
      expect(declarationType(stableDeclarations, name)).toContain(`new (): ${name};`);
      expect(betaDeclarations).toContain(`${name}: ${name}Static;`);
      expect(declarationType(betaDeclarations, name)).not.toContain(`new (): ${name};`);
      expect(declarationType(betaDeclarations, `${name}Static`)).toContain(`new (): ${name};`);
    }
    expect(betaProjectOptionsDrift).toMatchObject({
      schemaVersion: 1,
      scope: {
        declarations: [
          "premierepro.OpenProjectOptions", "OpenProjectOptions", "OpenProjectOptionsStatic",
          "premierepro.CloseProjectOptions", "CloseProjectOptions", "CloseProjectOptionsStatic",
        ],
        mutationBoundary: expect.stringContaining("does not construct options"),
      },
      sources: {
        stable: { package: "@adobe/premierepro", version: "26.3.0", staticFactoriesPresent: false },
        beta: { package: "@adobe/premierepro-beta", version: "26.5.0-beta.73", staticFactoriesPresent: true },
      },
      diff: {
        stableOnly: [],
      },
    });
    expect(betaProjectOptionsDrift.diff.betaOnly).toEqual(expect.arrayContaining([
      { symbol: "OpenProjectOptionsStatic.new", kind: "construct_signature", signature: "() => OpenProjectOptions" },
      { symbol: "CloseProjectOptionsStatic.call", kind: "call_signature", signature: "() => CloseProjectOptions" },
    ]));
    expect(betaProjectOptionsDrift.diff.changed.some((entry: { symbol: string; beta: { signature: string } }) => (
      entry.symbol === "premierepro.OpenProjectOptions" && entry.beta.signature === "OpenProjectOptionsStatic"
    ))).toBe(true);
    expect(betaProjectOptionsDrift.diff.changed.some((entry: { symbol: string; beta: { signature: string } }) => (
      entry.symbol === "premierepro.CloseProjectOptions" && entry.beta.signature === "CloseProjectOptionsStatic"
    ))).toBe(true);
    expect(spawnSync(process.execPath, ["scripts/generate-adobe-beta-project-options-drift.mjs", "--check"], { encoding: "utf8" }).status).toBe(0);
    expect(coverage.entries.flatMap((entry: { adobeApi: string[] }) => entry.adobeApi)).not.toEqual(expect.arrayContaining([
      "premierepro.OpenProjectOptions", "premierepro.CloseProjectOptions",
    ]));
  });

  it("accounts for beta transition-option factory migration without advertising a transition action", () => {
    const stableDeclarations = readFileSync("node_modules/@adobe/premierepro/src/premierepro.d.ts", "utf8");
    const betaDeclarations = readFileSync("node_modules/@adobe/premierepro-beta/src/premierepro.d.ts", "utf8");
    expect(stableDeclarations).toContain("AddTransitionOptions: AddTransitionOptions;");
    expect(stableDeclarations).not.toContain("export declare type AddTransitionOptionsStatic");
    expect(declarationType(stableDeclarations, "AddTransitionOptions")).toContain("new (): AddTransitionOptions;");
    expect(betaDeclarations).toContain("AddTransitionOptions: AddTransitionOptionsStatic;");
    expect(declarationType(betaDeclarations, "AddTransitionOptions")).not.toContain("new (): AddTransitionOptions;");
    expect(declarationType(betaDeclarations, "AddTransitionOptionsStatic")).toContain("new (): AddTransitionOptions;");
    expect(betaTransitionOptionsDrift).toMatchObject({
      schemaVersion: 1,
      scope: {
        declarations: ["premierepro.AddTransitionOptions", "AddTransitionOptions", "AddTransitionOptionsStatic"],
        mutationBoundary: expect.stringContaining("does not construct options"),
      },
      sources: {
        stable: { package: "@adobe/premierepro", version: "26.3.0", staticFactoryPresent: false },
        beta: { package: "@adobe/premierepro-beta", version: "26.5.0-beta.73", staticFactoryPresent: true },
      },
      diff: { stableOnly: [] },
    });
    expect(betaTransitionOptionsDrift.diff.betaOnly).toEqual(expect.arrayContaining([
      { symbol: "AddTransitionOptionsStatic.new", kind: "construct_signature", signature: "() => AddTransitionOptions" },
      { symbol: "AddTransitionOptionsStatic.call", kind: "call_signature", signature: "() => AddTransitionOptions" },
    ]));
    expect(betaTransitionOptionsDrift.diff.changed.some((entry: { symbol: string; beta: { signature: string } }) => (
      entry.symbol === "premierepro.AddTransitionOptions" && entry.beta.signature === "AddTransitionOptionsStatic"
    ))).toBe(true);
    expect(spawnSync(process.execPath, ["scripts/generate-adobe-beta-transition-options-drift.mjs", "--check"], { encoding: "utf8" }).status).toBe(0);
    expect(coverage.entries.flatMap((entry: { adobeApi: string[] }) => entry.adobeApi)).not.toEqual(expect.arrayContaining([
      "premierepro.AddTransitionOptions", "AddTransitionOptionsStatic.new",
    ]));
  });

  it("accounts for beta RectF factory migration without advertising geometry support", () => {
    const stableDeclarations = readFileSync("node_modules/@adobe/premierepro/src/premierepro.d.ts", "utf8");
    const betaDeclarations = readFileSync("node_modules/@adobe/premierepro-beta/src/premierepro.d.ts", "utf8");
    expect(stableDeclarations).toContain("RectF: RectF;");
    expect(stableDeclarations).not.toContain("export declare type RectFStatic");
    expect(declarationType(stableDeclarations, "RectF")).toContain("new (): RectF;");
    expect(betaDeclarations).toContain("RectF: RectFStatic;");
    expect(declarationType(betaDeclarations, "RectF")).not.toContain("new (): RectF;");
    expect(declarationType(betaDeclarations, "RectFStatic")).toContain("new (): RectF;");
    expect(betaRectFDrift).toMatchObject({
      schemaVersion: 1,
      scope: {
        declarations: ["premierepro.RectF", "RectF", "RectFStatic"],
        doesNotEstablish: expect.stringContaining("does not prove"),
      },
      sources: {
        stable: {
          package: "@adobe/premierepro",
          version: "26.3.0",
          staticFactoryPresent: false,
          rectDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        beta: {
          package: "@adobe/premierepro-beta",
          version: "26.5.0-beta.73",
          staticFactoryPresent: true,
          rectDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          staticDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
      diff: { stableOnly: [] },
    });
    expect(betaRectFDrift.diff.betaOnly).toEqual(expect.arrayContaining([
      { symbol: "RectFStatic.new", kind: "construct_signature", signature: "() => RectF" },
      { symbol: "RectFStatic.call", kind: "call_signature", signature: "() => RectF" },
    ]));
    expect(betaRectFDrift.diff.changed.some((entry: { symbol: string; beta: { signature: string } }) => (
      entry.symbol === "premierepro.RectF" && entry.beta.signature === "RectFStatic"
    ))).toBe(true);
    expect(spawnSync(process.execPath, ["scripts/generate-adobe-beta-rectf-drift.mjs", "--check"], { encoding: "utf8" }).status).toBe(0);
    expect(coverage.entries.flatMap((entry: { adobeApi: string[] }) => entry.adobeApi)).not.toEqual(expect.arrayContaining([
      "premierepro.RectF", "RectFStatic.new",
    ]));
  });

  it("rejects an unexpected RectF root binding before writing a receipt", () => {
    const temporary = mkdtempSync(join(tmpdir(), "premiere-beta-rectf-drift-"));
    try {
      const betaPath = join(temporary, "premierepro.d.ts");
      writeFileSync(betaPath, readFileSync("node_modules/@adobe/premierepro-beta/src/premierepro.d.ts", "utf8").replace("RectF: RectFStatic;", "RectF: RectF;"));
      const result = spawnSync(process.execPath, ["scripts/generate-adobe-beta-rectf-drift.mjs", "--validate-only"], {
        encoding: "utf8",
        env: { ...process.env, PREMIERE_BETA_RECTF_BETA_DECLARATIONS_PATH: betaPath },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("must move premierepro.RectF to RectFStatic");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("accounts for beta Color factory migration without advertising a beta Color path", () => {
    const stableDeclarations = readFileSync("node_modules/@adobe/premierepro/src/premierepro.d.ts", "utf8");
    const betaDeclarations = readFileSync("node_modules/@adobe/premierepro-beta/src/premierepro.d.ts", "utf8");
    const colorFactory = "new (red?: number, green?: number, blue?: number, alpha?: number): Color;";
    expect(stableDeclarations).toContain("Color: Color;");
    expect(stableDeclarations).not.toContain("export declare type ColorStatic");
    expect(declarationType(stableDeclarations, "Color")).toContain(colorFactory);
    expect(betaDeclarations).toContain("Color: ColorStatic;");
    expect(declarationType(betaDeclarations, "Color")).not.toContain(colorFactory);
    expect(declarationType(betaDeclarations, "ColorStatic")).toContain(colorFactory);
    expect(betaColorDrift).toMatchObject({
      schemaVersion: 1,
      scope: {
        declarations: ["premierepro.Color", "Color", "ColorStatic"],
        doesNotEstablish: expect.stringContaining("does not prove"),
      },
      sources: {
        stable: {
          package: "@adobe/premierepro",
          version: "26.3.0",
          staticFactoryPresent: false,
          colorDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        beta: {
          package: "@adobe/premierepro-beta",
          version: "26.5.0-beta.73",
          staticFactoryPresent: true,
          colorDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          staticDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
      diff: { stableOnly: [] },
    });
    expect(betaColorDrift.diff.betaOnly).toEqual(expect.arrayContaining([
      { symbol: "ColorStatic.new", kind: "construct_signature", signature: "(red?: number, green?: number, blue?: number, alpha?: number) => Color" },
      { symbol: "ColorStatic.call", kind: "call_signature", signature: "(red?: number, green?: number, blue?: number, alpha?: number) => Color" },
    ]));
    expect(betaColorDrift.diff.changed.some((entry: { symbol: string; beta: { signature: string } }) => (
      entry.symbol === "premierepro.Color" && entry.beta.signature === "ColorStatic"
    ))).toBe(true);
    expect(spawnSync(process.execPath, ["scripts/generate-adobe-beta-color-drift.mjs", "--check"], { encoding: "utf8" }).status).toBe(0);
    const claimedApis = coverage.entries.flatMap((entry: { adobeApi: string[] }) => entry.adobeApi);
    expect(claimedApis).toContain("Color.[[construct]]");
    expect(claimedApis).not.toEqual(expect.arrayContaining([
      "premierepro.Color", "ColorStatic.new", "ColorStatic.call",
    ]));
  });

  it("rejects an unexpected Color root binding before writing a receipt", () => {
    const temporary = mkdtempSync(join(tmpdir(), "premiere-beta-color-drift-"));
    try {
      const betaPath = join(temporary, "premierepro.d.ts");
      writeFileSync(betaPath, readFileSync("node_modules/@adobe/premierepro-beta/src/premierepro.d.ts", "utf8").replace("Color: ColorStatic;", "Color: Color;"));
      const result = spawnSync(process.execPath, ["scripts/generate-adobe-beta-color-drift.mjs", "--validate-only"], {
        encoding: "utf8",
        env: { ...process.env, PREMIERE_BETA_COLOR_BETA_DECLARATIONS_PATH: betaPath },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("must move premierepro.Color to ColorStatic");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
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

  it("accounts for beta MediaManager without exposing its cache mutation", () => {
    const stableDeclarations = readFileSync("node_modules/@adobe/premierepro/src/premierepro.d.ts", "utf8");
    const betaDeclarations = readFileSync("node_modules/@adobe/premierepro-beta/src/premierepro.d.ts", "utf8");
    expect(stableDeclarations).not.toContain("MediaManager");
    expect(betaDeclarations).toContain("MediaManager: MediaManagerStatic;");
    expect(declarationType(betaDeclarations, "MediaManagerStatic"))
      .toContain("purgeMediaCache(): Promise<boolean>;");
    expect(betaMediaManagerDrift).toMatchObject({
      schemaVersion: 1,
      scope: {
        declarations: ["premierepro.MediaManager", "MediaManagerStatic", "MediaManager"],
        mutationBoundary: expect.stringContaining("no production call"),
      },
      sources: {
        stable: { package: "@adobe/premierepro", version: "26.3.0", mediaManagerSurfacePresent: false },
        beta: {
          package: "@adobe/premierepro-beta",
          version: "26.5.0-beta.73",
          mediaManagerSurfacePresent: true,
          rootDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          mediaManagerStaticDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          mediaManagerDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
      diff: {
        betaOnly: [
          { symbol: "MediaManager", kind: "type", signature: "{}" },
          { symbol: "MediaManagerStatic.purgeMediaCache", kind: "method", signature: "() => Promise<boolean>" },
          { symbol: "premierepro.MediaManager", kind: "property", signature: "MediaManagerStatic" },
        ],
        stableOnly: [],
        changed: [],
      },
    });
    expect(spawnSync(process.execPath, ["scripts/generate-adobe-beta-media-manager-drift.mjs", "--check"], {
      encoding: "utf8",
    }).status).toBe(0);
    expect(coverage.entries.flatMap((entry: { adobeApi: string[] }) => entry.adobeApi))
      .not.toEqual(expect.arrayContaining([
        "premierepro.MediaManager",
        "MediaManagerStatic.purgeMediaCache",
      ]));
  });

  it("accounts for additive beta TranscriptStatic members without starting transcription", () => {
    const stableTranscript = declarationType(
      readFileSync("node_modules/@adobe/premierepro/src/premierepro.d.ts", "utf8"), "TranscriptStatic",
    );
    const betaTranscript = declarationType(
      readFileSync("node_modules/@adobe/premierepro-beta/src/premierepro.d.ts", "utf8"), "TranscriptStatic",
    );
    expect(stableTranscript).not.toContain("isLanguagePackAvailable");
    expect(stableTranscript).not.toContain("transcribeClipProjectItem");
    expect(betaTranscript).toContain("isLanguagePackAvailable(language: string): boolean;");
    expect(betaTranscript).toContain("transcribeClipProjectItem(");
    expect(betaTranscript).toContain("options?: { languageCode?: string }");
    expect(betaTranscript).toContain("): Promise<boolean>;");
    expect(betaTranscriptDrift).toMatchObject({
      schemaVersion: 1,
      scope: {
        declaration: "TranscriptStatic",
        mutationBoundary: expect.stringContaining("no production call"),
      },
      sources: {
        stable: { package: "@adobe/premierepro", version: "26.3.0", transcriptDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
        beta: { package: "@adobe/premierepro-beta", version: "26.5.0-beta.73", transcriptDeclarationSha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
      },
      diff: {
        betaOnly: [
          { symbol: "TranscriptStatic.isLanguagePackAvailable", kind: "method", signature: "(language: string) => boolean" },
          {
            symbol: "TranscriptStatic.transcribeClipProjectItem",
            kind: "method",
            signature: "(clipProjectItem: ClipProjectItem, options?: { languageCode?: string }) => Promise<boolean>",
          },
        ],
        stableOnly: [],
        changed: [],
      },
    });
    expect(spawnSync(process.execPath, ["scripts/generate-adobe-beta-transcript-drift.mjs", "--check"], {
      encoding: "utf8",
    }).status).toBe(0);
    expect(coverage.entries.flatMap((entry: { adobeApi: string[] }) => entry.adobeApi))
      .not.toEqual(expect.arrayContaining([
        "TranscriptStatic.isLanguagePackAvailable",
        "TranscriptStatic.transcribeClipProjectItem",
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

  it("fails closed when the beta AAFExportOptions root binding no longer has its declared static type", () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-beta-aaf-export-options-drift-"));
    const stablePath = join(directory, "stable.d.ts");
    const betaPath = join(directory, "beta.d.ts");
    const stableDeclarations = readFileSync("node_modules/@adobe/premierepro/src/premierepro.d.ts", "utf8");
    const betaDeclarations = readFileSync("node_modules/@adobe/premierepro-beta/src/premierepro.d.ts", "utf8");
    writeFileSync(stablePath, stableDeclarations);
    writeFileSync(betaPath, betaDeclarations.replace(
      "AAFExportOptions: AAFExportOptionsStatic;",
      "AAFExportOptions: AAFExportOptions;",
    ));
    try {
      const result = spawnSync(process.execPath, ["scripts/generate-adobe-beta-aaf-export-options-drift.mjs", "--validate-only"], {
        encoding: "utf8",
        env: {
          ...process.env,
          PREMIERE_BETA_AAF_EXPORT_OPTIONS_STABLE_DECLARATIONS_PATH: stablePath,
          PREMIERE_BETA_AAF_EXPORT_OPTIONS_BETA_DECLARATIONS_PATH: betaPath,
        },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("must expose premierepro.AAFExportOptions as AAFExportOptionsStatic");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when the beta MediaManager root binding no longer has its declared static type", () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-beta-media-manager-drift-"));
    const stablePath = join(directory, "stable.d.ts");
    const betaPath = join(directory, "beta.d.ts");
    const stableDeclarations = readFileSync("node_modules/@adobe/premierepro/src/premierepro.d.ts", "utf8");
    const betaDeclarations = readFileSync("node_modules/@adobe/premierepro-beta/src/premierepro.d.ts", "utf8");
    writeFileSync(stablePath, stableDeclarations);
    writeFileSync(betaPath, betaDeclarations.replace(
      "MediaManager: MediaManagerStatic;",
      "MediaManager: MediaManager;",
    ));
    try {
      const result = spawnSync(process.execPath, ["scripts/generate-adobe-beta-media-manager-drift.mjs", "--validate-only"], {
        encoding: "utf8",
        env: {
          ...process.env,
          PREMIERE_BETA_MEDIA_MANAGER_STABLE_DECLARATIONS_PATH: stablePath,
          PREMIERE_BETA_MEDIA_MANAGER_BETA_DECLARATIONS_PATH: betaPath,
        },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("must expose premierepro.MediaManager as MediaManagerStatic");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when beta TranscriptStatic is no longer a type literal", () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-beta-transcript-drift-"));
    const stablePath = join(directory, "stable.d.ts");
    const betaPath = join(directory, "beta.d.ts");
    const stableDeclarations = readFileSync("node_modules/@adobe/premierepro/src/premierepro.d.ts", "utf8");
    const betaDeclarations = readFileSync("node_modules/@adobe/premierepro-beta/src/premierepro.d.ts", "utf8");
    writeFileSync(stablePath, stableDeclarations);
    const betaWithoutTranscriptStatic = betaDeclarations.replace(
      /export declare type TranscriptStatic = \{[\s\S]*?\r?\n\};(\r?\n\r?\nexport declare type Transcript = \{\};)/,
      "export declare type TranscriptStatic = () => boolean;$1",
    );
    expect(betaWithoutTranscriptStatic).not.toBe(betaDeclarations);
    writeFileSync(betaPath, betaWithoutTranscriptStatic);
    try {
      const result = spawnSync(process.execPath, ["scripts/generate-adobe-beta-transcript-drift.mjs", "--validate-only"], {
        encoding: "utf8",
        env: {
          ...process.env,
          PREMIERE_BETA_TRANSCRIPT_STABLE_DECLARATIONS_PATH: stablePath,
          PREMIERE_BETA_TRANSCRIPT_BETA_DECLARATIONS_PATH: betaPath,
        },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("must expose TranscriptStatic as a type literal");
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
