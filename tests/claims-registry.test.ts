import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const readJson = (path: string) => JSON.parse(read(path)) as Record<string, unknown>;

const release = readJson("landing/lib/published-release.json");
const registry = readJson("docs/claims-registry.json") as {
  schemaVersion: number;
  authoritativeReleaseMetadata: string;
  claims: Array<{
    id: string;
    status: string;
    claim: string;
    fields?: string[];
    boundary: string;
  }>;
  prohibitedUntilEvidenceExists: string[];
};

const renderReleaseClaim = (claim: string) =>
  claim.replaceAll(/\{([^}]+)\}/g, (_match, field: string) => String(release[field]));

describe("product claims registry", () => {
  it("is a unique, versioned registry with explicit boundaries", () => {
    expect(registry.schemaVersion).toBe(1);
    expect(registry.authoritativeReleaseMetadata).toBe("landing/lib/published-release.json");
    expect(registry.claims.map((claim) => claim.id)).toHaveLength(
      new Set(registry.claims.map((claim) => claim.id)).size,
    );
    expect(registry.claims.every((claim) => claim.boundary.trim().length > 0)).toBe(true);
    expect(registry.prohibitedUntilEvidenceExists.length).toBeGreaterThan(0);
  });

  it("derives every release-backed claim from canonical release metadata", () => {
    const releaseClaims = registry.claims.filter((claim) => claim.status === "release_metadata");
    expect(releaseClaims).toHaveLength(2);

    for (const claim of releaseClaims) {
      expect(claim.fields?.length).toBeGreaterThan(0);
      for (const field of claim.fields ?? []) {
        expect(release).toHaveProperty(field);
        expect(claim.claim).toContain(`{${field}}`);
      }
    }
  });

  it("keeps the product-marketing context aligned with the rendered release facts", () => {
    const marketingContext = read(".agents/product-marketing.md");
    const releaseSurface = registry.claims.find((claim) => claim.id === "release-capability-surface");
    const compatibility = registry.claims.find((claim) => claim.id === "release-compatibility");

    expect(releaseSurface).toBeDefined();
    expect(compatibility).toBeDefined();
    expect(marketingContext).toContain(renderReleaseClaim(releaseSurface!.claim));
    expect(marketingContext).toContain(renderReleaseClaim(compatibility!.claim));
  });

  it("labels commercial pricing as a hypothesis and records evidence-gated boundaries", () => {
    const pricing = registry.claims.find((claim) => claim.id === "commercial-companion-pricing");
    const marketingContext = read(".agents/product-marketing.md");

    expect(pricing?.status).toBe("hypothesis");
    expect(pricing?.claim.toLowerCase()).toContain("hypotheses");
    expect(marketingContext).toContain("unvalidated pricing hypotheses");
    expect(marketingContext).toContain("No approved customer-logo claims, adoption claims, case studies, or public testimonials are currently documented.");
    expect(marketingContext).toContain("Current production activation, retention, support, conversion, and revenue metrics have not been queried");
    expect(marketingContext).toContain("Do not claim current Adobe Marketplace approval");
  });

  it("rejects known stale or unsupported marketing phrases on governed public surfaces", () => {
    const governedSurfaces = [
      ".agents/product-marketing.md",
      "README.md",
      "landing/lib/articles.ts",
    ].map(read);
    const governedContent = governedSurfaces.join("\n");

    expect(governedContent).not.toMatch(/49 (?:documented, )?capability-gated tools/i);
    expect(read("landing/components/sections/hero.tsx")).not.toMatch(/editor approved/i);
  });
});
