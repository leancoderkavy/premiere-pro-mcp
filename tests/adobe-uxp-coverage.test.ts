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
      "native-project-insertion-bin-snapshot",
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
      "bounded-native-project-tree",
      "sequence-settings-profiles",
      "guarded-sequence-display-format",
      "workspace-gated-project-import",
      "typed-parameter-keyframe-automation",
      "track-item-transformations",
      "bounded-native-timeline-structure",
      "sequence-editor-timeline-layer",
      "sequence-lifecycle-derivatives",
      "ame-encode-controller",
      "guarded-source-media-timing",
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
    expect(entries.find((entry) => entry.id === "guarded-source-media-timing")).toMatchObject({
      uxpCommand: "source.mediaTiming.setStart",
      mcpTools: ["manage_source_media_timing_uxp"],
      verificationBoundary: "guarded_source_media_timing_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "guarded-source-media-timing")?.adobeApi).toEqual(expect.arrayContaining([
      "ClipProjectItem.getMedia",
      "Media.start",
      "Media.duration",
      "Media.createSetStartAction",
      "Project.lockedAccess",
      "Project.executeTransaction",
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
    expect(entries.find((entry) => entry.id === "native-project-insertion-bin-snapshot")).toMatchObject({
      uxpCommand: "project.insertionBin.inspect",
      mcpTools: ["inspect_project_insertion_bin_uxp"],
      verificationBoundary: "project_insertion_bin_identity_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "native-project-insertion-bin-snapshot")?.adobeApi).toEqual(expect.arrayContaining([
      "Project.getInsertionBin",
      "ProjectItem.getId",
      "ProjectItem.name",
      "ProjectItem.type",
    ]));
    expect(entries.find((entry) => entry.id === "guarded-sequence-display-format")).toMatchObject({
      uxpCommand: "sequence.displayFormat.update",
      mcpTools: ["manage_sequence_display_format_uxp"],
      verificationBoundary: "sequence_display_format_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "guarded-sequence-display-format")?.adobeApi).toEqual(expect.arrayContaining([
      "Sequence.getSettings",
      "Sequence.createSetSettingsAction",
      "SequenceSettings.getAudioDisplayFormat",
      "SequenceSettings.setAudioDisplayFormat",
      "SequenceSettings.getVideoDisplayFormat",
      "SequenceSettings.setVideoDisplayFormat",
    ]));
    expect(entries.find((entry) => entry.id === "bounded-native-project-tree")).toMatchObject({
      uxpCommand: "projectTree.inspect",
      mcpTools: ["inspect_project_tree_uxp"],
      verificationBoundary: "bounded_project_tree_item_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "bounded-native-project-tree")?.adobeApi).toEqual(expect.arrayContaining([
      "Project.getRootItem",
      "FolderItem.getItems",
      "ProjectItem.getId",
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
      total: 59,
      current: 56,
      planned: 3,
      implemented: 56,
      committedUnverified: 8,
      automatedContractVerified: 48,
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
      current: 56,
      planned: 3,
      committedUnverified: 8,
    });
  });
});
