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
    expect(registry.integrationSurfaces.find((surface) => surface.id === "cep-extendscript"))
      .toMatchObject({
        authorityUrls: ["https://github.com/Adobe-CEP/Samples/tree/master/PProPanel"],
        communityReferenceUrls: ["https://ppro-scripting.docsforadobe.dev/"],
      });
    expect(registry.integrationSurfaces.filter((surface) => surface.inventoryState === "complete"))
      .toHaveLength(1);
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
