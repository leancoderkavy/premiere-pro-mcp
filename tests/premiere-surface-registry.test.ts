import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Surface = {
  id: string;
  kind: string;
  authorityUrls: string[];
  communityReferenceUrls?: string[];
  versionSource: string;
  inventoryArtifact: string | null;
  inventoryState: string;
  implementationState: string;
  inventoryCommand?: string;
  inventoryVerificationCommand?: string;
  inventoryDocumentation?: string;
  benchmarkEvidenceCommand?: string;
  benchmarkEvidenceSchema?: string;
  addonReceiptCommand?: string;
  addonReceiptVerificationCommand?: string;
  addonReceiptDocumentation?: string;
  ccxReceiptCommand?: string;
  ccxReceiptVerificationCommand?: string;
  ccxReceiptDocumentation?: string;
  ccxReceiptSchemaVersion?: number;
  notes: string;
};

type Competitor = {
  repository: string;
  commit: string;
  observedAt: string;
  featureFamilies: string[];
  adoptionBoundary: string;
};

const registry = JSON.parse(readFileSync("src/resources/premiere-surface-registry.json", "utf8")) as {
  schemaVersion: number;
  researchedAt: string;
  completionPolicy: string;
  integrationSurfaces: Surface[];
  competitorSources: Competitor[];
};

describe("Premiere API and competitor surface registry", () => {
  it("enumerates every official surface family without overstating completion", () => {
    expect(registry.schemaVersion).toBe(1);
    expect(registry.researchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(registry.completionPolicy).toContain("every item is classified");
    expect(registry.integrationSurfaces.map((surface) => surface.id)).toEqual([
      "premiere-dom",
      "uxp-javascript",
      "uxp-html",
      "uxp-css",
      "spectrum-web-components",
      "uxp-plugin-guides",
      "uxp-hybrid-cpp",
      "premiere-cpp-sdk",
      "cep-extendscript",
      "cep-platform",
      "qe-dom",
    ]);
    expect(new Set(registry.integrationSurfaces.map((surface) => surface.id)).size)
      .toBe(registry.integrationSurfaces.length);

    const inventoryStates = new Set([
      "complete",
      "partial",
      "not_started",
      "blocked_external_artifact",
      "unavailable_authoritative_source",
    ]);
    const implementationStates = new Set(["partial", "gated", "not_started", "experimental"]);
    for (const surface of registry.integrationSurfaces) {
      if (surface.kind === "undocumented_api") {
        expect(surface.authorityUrls).toEqual([]);
      } else {
        expect(surface.authorityUrls.length).toBeGreaterThan(0);
        for (const url of surface.authorityUrls) expect(url).toMatch(/^https:\/\//);
      }
      for (const url of surface.communityReferenceUrls ?? []) expect(url).toMatch(/^https:\/\//);
      expect(surface.versionSource.length).toBeGreaterThan(0);
      expect(surface.notes.length).toBeGreaterThan(20);
      expect(inventoryStates.has(surface.inventoryState)).toBe(true);
      expect(implementationStates.has(surface.implementationState)).toBe(true);
      if (surface.inventoryState === "complete") {
        expect(surface.inventoryArtifact).toBeTruthy();
      }
    }
    expect(registry.integrationSurfaces.find((surface) => surface.id === "premiere-dom"))
      .toMatchObject({ inventoryState: "complete", implementationState: "partial" });
    expect(registry.integrationSurfaces.find((surface) => surface.id === "uxp-javascript"))
      .toMatchObject({
        versionSource: "@adobe/cc-ext-uxp-types@7.3.1",
        inventoryArtifact: "dist/resources/uxp-js-api-inventory.json",
        inventoryState: "complete",
        implementationState: "partial",
      });
    expect(registry.integrationSurfaces.find((surface) => surface.id === "cep-extendscript"))
      .toMatchObject({
        authorityUrls: ["https://github.com/Adobe-CEP/Samples/tree/master/PProPanel"],
        communityReferenceUrls: [
          "https://ppro-scripting.docsforadobe.dev/",
          "https://github.com/docsforadobe/premiere-scripting-guide",
        ],
        inventoryArtifact: "dist/resources/extendscript-api-inventory.json",
        inventoryState: "complete",
        implementationState: "partial",
      });
    expect(registry.integrationSurfaces.find((surface) => surface.id === "cep-platform"))
      .toMatchObject({
        inventoryArtifact: "dist/resources/cep-reference-inventory.json",
        inventoryState: "complete",
        implementationState: "partial",
      });
    expect(registry.integrationSurfaces.filter((surface) => surface.inventoryState === "complete"))
      .toHaveLength(8);
    for (const id of ["uxp-hybrid-cpp", "premiere-cpp-sdk"]) {
      expect(registry.integrationSurfaces.find((surface) => surface.id === id)).toMatchObject({
        inventoryArtifact: null,
        inventoryState: "blocked_external_artifact",
        inventoryCommand: "npm run native:sdk-header-inventory",
        inventoryVerificationCommand: "npm run native:sdk-header-inventory:verify",
        inventoryDocumentation: "docs/native-sdk-header-inventory.md",
      });
    }
    expect(registry.integrationSurfaces.find((surface) => surface.id === "uxp-hybrid-cpp"))
      .toMatchObject({
        benchmarkEvidenceCommand: "npm run benchmark:uxp-hybrid:verify",
        benchmarkEvidenceSchema: "benchmarks/uxp-hybrid/evidence.schema.json",
        addonReceiptCommand: "npm run native:hybrid-addon-receipt",
        addonReceiptVerificationCommand: "npm run native:hybrid-addon-receipt:verify",
        addonReceiptDocumentation: "docs/uxp-hybrid-addon-receipt.md",
        ccxReceiptCommand: "npm run native:hybrid-ccx-receipt",
        ccxReceiptVerificationCommand: "npm run native:hybrid-ccx-receipt:verify",
        ccxReceiptDocumentation: "docs/uxp-hybrid-ccx-receipt.md",
        ccxReceiptSchemaVersion: 2,
      });
    expect(registry.integrationSurfaces.find((surface) => surface.id === "uxp-hybrid-cpp")?.notes)
      .toContain("root main.js entrypoint and three-target bundle layout");
    expect(registry.integrationSurfaces.find((surface) => surface.id === "uxp-hybrid-cpp")?.notes)
      .toContain("schema-v2 local CCX archive receipt can bind that current layout receipt to the byte-identical required files, a full safe ZIP entry-name-set digest, matching local ZIP headers, and any required streamed data-descriptor CRC/sizes");
    expect(registry.integrationSurfaces.find((surface) => surface.id === "uxp-hybrid-cpp")?.notes)
      .toContain("schema-v3 candidate benchmark");
  });

  it("pins reviewed competitor sources and explicit safe-adoption boundaries", () => {
    expect(registry.competitorSources).toHaveLength(4);
    expect(new Set(registry.competitorSources.map((source) => source.repository)).size)
      .toBe(registry.competitorSources.length);
    for (const source of registry.competitorSources) {
      expect(source.repository).toMatch(/^[\w.-]+\/[\w.-]+$/);
      expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(source.observedAt).toBe(registry.researchedAt);
      expect(source.featureFamilies.length).toBeGreaterThan(0);
      expect(source.adoptionBoundary.length).toBeGreaterThan(40);
    }
  });
});
