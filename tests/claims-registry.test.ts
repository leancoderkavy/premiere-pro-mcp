import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const readJson = (path: string) => JSON.parse(read(path)) as Record<string, unknown>;

// The published npm manifest is generated from release-metadata.json at release
// time, so template fields must exist there. The website repository syncs the
// published values from npm and guards its own copy.
const sourceRelease = readJson("release-metadata.json");
const registry = readJson("docs/claims-registry.json") as {
  schemaVersion: number;
  authoritativeReleaseMetadata: string;
  authoritativeSourceMetadata: string;
  claims: Array<{
    id: string;
    status: string;
    claim: string;
    fields?: string[];
    boundary: string;
  }>;
  prohibitedUntilEvidenceExists: string[];
};

describe("product claims registry", () => {
  it("is a unique, versioned registry with explicit boundaries", () => {
    expect(registry.schemaVersion).toBe(1);
    expect(registry.authoritativeReleaseMetadata).toContain("premiere-pro-mcp-site");
    expect(registry.authoritativeReleaseMetadata).toContain("public-product-manifest.json");
    expect(registry.authoritativeSourceMetadata).toBe("release-metadata.json");
    expect(registry.claims.map((claim) => claim.id)).toHaveLength(
      new Set(registry.claims.map((claim) => claim.id)).size,
    );
    expect(registry.claims.every((claim) => claim.boundary.trim().length > 0)).toBe(true);
    expect(registry.prohibitedUntilEvidenceExists.length).toBeGreaterThan(0);
  });

  it("derives every release-backed claim from release metadata fields", () => {
    const releaseClaims = registry.claims.filter((claim) => claim.status === "release_metadata");
    expect(releaseClaims).toHaveLength(2);

    for (const claim of releaseClaims) {
      expect(claim.fields?.length).toBeGreaterThan(0);
      for (const field of claim.fields ?? []) {
        expect(sourceRelease).toHaveProperty(field);
        expect(claim.claim).toContain(`{${field}}`);
      }
    }
  });

  it("labels commercial pricing as a hypothesis", () => {
    const pricing = registry.claims.find((claim) => claim.id === "commercial-companion-pricing");

    expect(pricing?.status).toBe("hypothesis");
    expect(pricing?.claim.toLowerCase()).toContain("hypotheses");
    expect(registry.prohibitedUntilEvidenceExists).toContain(
      "Current Adobe Marketplace approval or publication",
    );
  });

  it("rejects known stale or unsupported marketing phrases in the README", () => {
    const readme = read("README.md");

    expect(readme).not.toMatch(/49 (?:documented, )?capability-gated tools/i);
    expect(readme).not.toMatch(/editor approved/i);
  });
});
