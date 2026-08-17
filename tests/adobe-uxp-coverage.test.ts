import { describe, expect, it } from "vitest";
import {
  ADOBE_UXP_COVERAGE_MANIFEST,
  buildAdobeUxpCoverageReport,
  buildPlatformCapabilityReport,
} from "../src/platform-capabilities.js";
import { resolveCapabilities } from "../src/security/capabilities.js";

describe("Adobe Premiere Pro 26.3 UXP coverage", () => {
  it("pins the official stable 26.3 type baseline", () => {
    expect(ADOBE_UXP_COVERAGE_MANIFEST.source).toEqual({
      apiPackage: "@adobe/premierepro",
      apiVersion: "26.3.0",
      changelogUrl: "https://developer.adobe.com/premiere-pro/uxp/changelog/",
    });
  });

  it("has unique, official, complete capability metadata", () => {
    const entries = ADOBE_UXP_COVERAGE_MANIFEST.entries;
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    expect(entries.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      "action-transaction-discipline",
      "project-sequence-create-preset",
      "track-rename",
      "subclip-create",
      "marker-list-with-guid",
      "source-monitor-set-position",
      "aaf-export",
      "media-encoder-launch",
      "native-effects-pipeline",
      "selection-compound-effect-batch",
      "deterministic-timeline-selection",
      "native-scene-edit-detection",
      "proxy-ingest-controller",
      "offline-media-relink-repair",
      "transactional-metadata-xmp",
      "color-footage-conformance",
      "source-monitor-audition",
      "productions-storage-preflight",
      "least-privilege-uxp-workspace",
      "project-view-selection-resolver",
      "native-marker-crud",
      "transactional-bin-organizer",
      "sequence-settings-profiles",
      "workspace-gated-project-import",
      "typed-parameter-keyframe-automation",
      "track-item-transformations",
      "sequence-editor-timeline-layer",
      "sequence-lifecycle-derivatives",
      "ame-encode-controller",
    ]));
    for (const entry of entries) {
      expect(entry.minimumPremiereVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(entry.backend).toBe("uxp");
      expect(entry.adobeApi.length).toBeGreaterThan(0);
      expect(entry.mcpTools.length).toBeGreaterThan(0);
      expect(entry.documentationUrls.every((url) =>
        url.startsWith("https://developer.adobe.com/premiere-pro/uxp/"),
      )).toBe(true);
    }
  });

  it("keeps unimplemented 26.3 work visibly planned", () => {
    const report = buildAdobeUxpCoverageReport();
    expect(report.summary).toEqual({
      total: 38,
      current: 35,
      planned: 3,
      implemented: 35,
      committedUnverified: 7,
      automatedContractVerified: 28,
      liveHostVerified: 0,
    });
    expect(report.entries.find((entry) => entry.id === "aaf-export")).toMatchObject({
      availability: "current",
      implementationStatus: "implemented",
      verificationStatus: "automated_contract_verified",
      liveHostVerificationStatus: "not_run",
      uxpCommand: "interchange.aaf.export",
    });
    expect(report.entries.every((entry) => entry.liveHostVerificationStatus === "not_run")).toBe(true);
  });

  it("returns detached report data for safe capability reporting", () => {
    const first = buildAdobeUxpCoverageReport();
    first.entries[0].mcpTools.push("should-not-persist");
    const second = buildAdobeUxpCoverageReport();
    expect(second.entries[0].mcpTools).not.toContain("should-not-persist");
  });

  it("surfaces the baseline in the platform capability report", () => {
    const report = buildPlatformCapabilityReport(resolveCapabilities("inspect"), "win32");
    expect(report.backends.uxp.apiCoverage.summary).toMatchObject({
      current: 35,
      planned: 3,
      committedUnverified: 7,
    });
  });
});
