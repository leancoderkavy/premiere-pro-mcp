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
      "transactional-sequence-range",
      "guarded-sequence-playhead-control",
      "native-sequence-timing-snapshot",
      "native-caption-track-inventory",
      "track-rename",
      "subclip-create",
      "single-source-silence-stringout",
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
      "native-beat-grid-markers",
      "native-marker-batch-removal",
      "transactional-bin-organizer",
      "sequence-settings-profiles",
      "workspace-gated-project-import",
      "typed-parameter-keyframe-automation",
      "track-item-transformations",
      "sequence-editor-timeline-layer",
      "sequence-lifecycle-derivatives",
      "ame-encode-controller",
    ]));
    expect(entries.find((entry) => entry.id === "native-marker-crud")?.mcpTools).toEqual(["manage_markers_uxp"]);
    expect(entries.find((entry) => entry.id === "native-beat-grid-markers")).toMatchObject({
      uxpCommand: "markers.addBeatGrid",
      mcpTools: ["apply_beat_markers_uxp"],
      verificationBoundary: "beat_marker_guid_and_time_readback",
    });
    expect(entries.find((entry) => entry.id === "bounded-media-health-maintenance")?.adobeApi).toEqual(expect.arrayContaining([
      "ClipProjectItem.getMedia",
      "Media.start",
      "Media.duration",
    ]));
    expect(entries.find((entry) => entry.id === "bounded-media-health-maintenance")?.adobeApi).not.toEqual(expect.arrayContaining([
      "Media.getStart",
      "Media.getDuration",
    ]));
    expect(entries.find((entry) => entry.id === "native-marker-batch-removal")).toMatchObject({
      uxpCommand: "markers.removeMany",
      mcpTools: ["manage_markers_uxp"],
      verificationBoundary: "marker_guid_absence_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "native-marker-batch-removal")?.adobeApi).toEqual(expect.arrayContaining([
      "Marker.getName",
      "Marker.getStart",
      "Marker.getDuration",
    ]));
    expect(entries.find((entry) => entry.id === "native-sequence-timing-snapshot")).toMatchObject({
      uxpCommand: "sequence.timing.inspect",
      mcpTools: ["inspect_sequence_timing_uxp"],
      verificationBoundary: "sequence_timing_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "native-sequence-timing-snapshot")?.adobeApi).toEqual(expect.arrayContaining([
      "Sequence.getFrameSize",
      "Sequence.getTimebase",
      "Sequence.getSequenceAudioTimeDisplayFormat",
      "Sequence.getSequenceVideoTimeDisplayFormat",
      "Sequence.getProjectItem",
      "Sequence.guid",
      "Sequence.name",
      "ProjectItem.getId",
      "ProjectItem.name",
      "RectF",
      "RectF.width",
      "RectF.height",
      "TimeDisplay",
      "TimeDisplay.type",
    ]));
    for (const entry of entries) {
      expect(entry.minimumPremiereVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(entry.backend).toBe("uxp");
      expect(entry.adobeApi.length).toBeGreaterThan(0);
      expect(new Set(entry.adobeApi).size).toBe(entry.adobeApi.length);
      expect(entry.mcpTools.length).toBeGreaterThan(0);
      expect(entry.documentationUrls.every((url) =>
        url.startsWith("https://developer.adobe.com/premiere-pro/uxp/"),
      )).toBe(true);
    }
  });

  it("keeps unimplemented 26.3 work visibly planned", () => {
    const report = buildAdobeUxpCoverageReport();
    expect(report.summary).toEqual({
      total: 54,
      current: 51,
      planned: 3,
      implemented: 51,
      committedUnverified: 8,
      automatedContractVerified: 43,
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
      current: 51,
      planned: 3,
      committedUnverified: 8,
    });
  });
});
