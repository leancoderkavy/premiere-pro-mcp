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
      "native-ticktime-frame-alignment",
      "native-project-insertion-bin-snapshot",
      "native-installed-mogrt-directory-inspection",
      "transactional-sequence-range",
      "guarded-sequence-playhead-control",
      "guarded-app-preferences",
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
      "bounded-effect-parameter-catalog",
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
      "guarded-empty-sequence-creation",
      "sequence-settings-profiles",
      "guarded-sequence-display-format",
      "workspace-gated-project-import",
      "typed-parameter-keyframe-automation",
      "native-track-item-identity",
      "native-tick-time-arithmetic",
      "track-item-transformations",
      "bounded-native-timeline-structure",
      "sequence-editor-timeline-layer",
      "sequence-lifecycle-derivatives",
      "ame-encode-controller",
      "guarded-source-media-timing",
      "guarded-source-media-overrides",
      "guarded-transcript-json-import",
      "guarded-track-item-append-duplicate",
      "guarded-project-metadata-schema-field-creation",
      "guarded-track-item-contiguous-ripple-delete",
      "guarded-timeline-source-color-label",
      "bounded-unique-serializable-identity",
      "bounded-source-media-provenance",
      "bounded-source-proxy-inspection",
    ]));
    expect(entries.find((entry) => entry.id === "native-marker-crud")?.mcpTools).toEqual(["manage_markers_uxp"]);
    expect(entries.find((entry) => entry.id === "native-ticktime-frame-alignment")).toMatchObject({
      uxpCommand: "time.frameAlignment.inspect",
      mcpTools: ["inspect_frame_alignment_uxp"],
      verificationBoundary: "native_ticktime_value_readback",
      liveHostVerificationStatus: "not_run",
      mutatesProject: false,
    });
    expect(entries.find((entry) => entry.id === "native-ticktime-frame-alignment")?.adobeApi).toEqual(expect.arrayContaining([
      "FrameRate.createWithValue",
      "TickTime.createWithSeconds",
      "TickTime.createWithFrameAndFrameRate",
      "TickTime.alignToFrame",
      "TickTime.alignToNearestFrame",
    ]));
    expect(entries.find((entry) => entry.id === "marker-list-with-guid")?.adobeApi).toEqual(expect.arrayContaining([
      "Marker.guid", "Marker.getColor", "Color.red", "Color.green", "Color.blue", "Color.alpha",
    ]));
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
    expect(entries.find((entry) => entry.id === "guarded-source-media-overrides")).toMatchObject({
      uxpCommand: "source.mediaOverrides.update",
      mcpTools: ["manage_source_media_overrides_uxp"],
      verificationBoundary: "guarded_source_media_effective_interpretation_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "guarded-source-media-overrides")?.adobeApi).toEqual(expect.arrayContaining([
      "ClipProjectItem.getFootageInterpretation",
      "FootageInterpretation.getFrameRate",
      "FootageInterpretation.getPixelAspectRatio",
      "ClipProjectItem.createSetOverrideFrameRateAction",
      "ClipProjectItem.createSetOverridePixelAspectRatioAction",
      "Project.lockedAccess",
      "Project.executeTransaction",
    ]));
    expect(entries.find((entry) => entry.id === "guarded-transcript-json-import")).toMatchObject({
      uxpCommand: "transcript.import",
      mcpTools: ["import_transcript_uxp"],
      verificationBoundary: "guarded_transcript_export_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "guarded-transcript-json-import")?.adobeApi).toEqual(expect.arrayContaining([
      "Project.getActiveProject",
      "Project.getRootItem",
      "Project.lockedAccess",
      "Project.executeTransaction",
      "FolderItem.getItems",
      "ProjectItem.getId",
      "ClipProjectItem.cast",
      "Transcript.hasTranscript",
      "Transcript.exportToJSON",
      "Transcript.importFromJSON",
      "Transcript.createImportTextSegmentsAction",
    ]));
    expect(entries.find((entry) => entry.id === "typed-parameter-keyframe-automation")).toMatchObject({
      uxpCommand: "parameters.keyframeAdd",
      mcpTools: ["automate_effect_parameters_uxp"],
      verificationBoundary: "parameter_value_keyframe_animation_mode_or_lookup_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "typed-parameter-keyframe-automation")?.adobeApi).toEqual(expect.arrayContaining([
      "ComponentParam.areKeyframesSupported",
      "ComponentParam.isTimeVarying",
      "ComponentParam.getKeyframeListAsTickTimes",
      "ComponentParam.createSetTimeVaryingAction",
      "ComponentParam.getKeyframePtr",
      "ComponentParam.findNearestKeyframe",
      "ComponentParam.findNextKeyframe",
      "ComponentParam.findPreviousKeyframe",
      "Keyframe.position",
      "Keyframe.getTemporalInterpolationMode",
    ]));
    expect(entries.find((entry) => entry.id === "bounded-effect-parameter-catalog")).toMatchObject({
      uxpCommand: "parameters.catalog.inspect",
      mcpTools: ["inspect_effect_parameter_catalog_uxp"],
      verificationBoundary: "bounded_effect_parameter_catalog_double_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "bounded-effect-parameter-catalog")?.adobeApi).toEqual(expect.arrayContaining([
      "Component.getParamCount",
      "Component.getParam",
      "ComponentParam.displayName",
      "ComponentParam.areKeyframesSupported",
      "ComponentParam.isTimeVarying",
    ]));
    expect(entries.find((entry) => entry.id === "bounded-unique-serializable-identity")).toMatchObject({
      uxpCommand: "object.uniqueIdentity.inspect",
      mcpTools: ["inspect_unique_object_identity_uxp"],
      verificationBoundary: "bounded_unique_serializable_double_readback",
      liveHostVerificationStatus: "not_run",
      mutatesProject: false,
    });
    expect(entries.find((entry) => entry.id === "bounded-unique-serializable-identity")?.adobeApi).toEqual(expect.arrayContaining([
      "Project.getActiveProject",
      "Project.getRootItem",
      "Project.getSequence",
      "ProjectItem.getId",
      "FolderItem.getItems",
      "UniqueSerializeable.cast",
      "UniqueSerializeable.getUniqueID",
    ]));
    expect(entries.find((entry) => entry.id === "native-track-item-identity")).toMatchObject({
      uxpCommand: "trackItem.identity.inspect",
      mcpTools: ["inspect_track_item_identity_uxp"],
      verificationBoundary: "active_sequence_identity_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "native-track-item-identity")?.adobeApi).toEqual(expect.arrayContaining([
      "VideoClipTrackItem.getMatchName",
      "VideoClipTrackItem.getType",
      "VideoClipTrackItem.getMediaType",
      "VideoClipTrackItem.getTrackIndex",
      "VideoClipTrackItem.getIsSelected",
      "AudioClipTrackItem.getMatchName",
      "AudioClipTrackItem.getType",
      "AudioClipTrackItem.getMediaType",
      "AudioClipTrackItem.getTrackIndex",
      "AudioClipTrackItem.getIsSelected",
    ]));
    expect(entries.find((entry) => entry.id === "guarded-app-preferences")).toMatchObject({
      uxpCommand: "preferences.set",
      mcpTools: ["manage_app_preferences_uxp"],
      verificationBoundary: "app_preference_native_string_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "guarded-app-preferences")?.adobeApi).toEqual(expect.arrayContaining([
      "AppPreference.getValue",
      "AppPreference.setValue",
      "AppPreference.KEY_AUTO_PEAK_GENERATION",
      "AppPreference.KEY_IMPORT_WORKSPACE",
      "AppPreference.KEY_SHOW_QUICKSTART_DIALOG",
      "AppPreference.PROPERTY_PERSISTENT",
      "AppPreference.PROPERTY_NON_PERSISTENT",
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
      verificationBoundary: "sequence_timing_readback_or_targeted_sequence_timing_double_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "native-sequence-timing-snapshot")?.adobeApi).toEqual(expect.arrayContaining([
      "Sequence.getFrameSize",
      "Sequence.getTimebase",
      "Sequence.getSequenceAudioTimeDisplayFormat",
      "Sequence.getSequenceVideoTimeDisplayFormat",
      "Sequence.getProjectItem",
      "Project.getSequence",
      "Guid.fromString",
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
    expect(entries.find((entry) => entry.id === "native-installed-mogrt-directory-inspection")).toMatchObject({
      uxpCommand: "graphics.mogrtPath.inspect",
      mcpTools: ["inspect_installed_mogrt_directory_uxp"],
      verificationBoundary: "documented_sequence_editor_installation_directory_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "native-installed-mogrt-directory-inspection")?.adobeApi).toEqual([
      "SequenceEditor.getInstalledMogrtPath",
    ]);
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
    expect(entries.find((entry) => entry.id === "bounded-native-timeline-structure")?.adobeApi).toEqual(expect.arrayContaining([
      "VideoClipTrackItem.getProjectItem",
      "AudioClipTrackItem.getProjectItem",
      "ProjectItem.getId",
      "ClipProjectItem.cast",
      "ClipProjectItem.isSequence",
      "ClipProjectItem.isMergedClip",
      "ClipProjectItem.isMulticamClip",
      "ClipProjectItem.isOffline",
    ]));
    expect(entries.find((entry) => entry.id === "native-tick-time-arithmetic")).toMatchObject({
      uxpCommand: "time.tickArithmetic.inspect",
      mcpTools: ["calculate_tick_time_uxp"],
      verificationBoundary: "native_tick_time_value_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "native-tick-time-arithmetic")?.adobeApi).toEqual(expect.arrayContaining([
      "TickTime.createWithTicks",
      "TickTime.add",
      "TickTime.subtract",
      "TickTime.multiply",
      "TickTime.divide",
      "TickTime.ticks",
      "TickTime.seconds",
    ]));
    expect(entries.find((entry) => entry.id === "guarded-empty-sequence-creation")).toMatchObject({
      uxpCommand: "sequences.createEmpty",
      mcpTools: ["create_empty_sequence_uxp"],
      verificationBoundary: "sequence_collection_identity_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "guarded-empty-sequence-creation")?.adobeApi).toEqual(expect.arrayContaining([
      "Project.createSequence",
      "Project.getSequences",
      "Sequence.guid",
    ]));
    expect(entries.find((entry) => entry.id === "bounded-project-columns-metadata-inspection")).toMatchObject({
      uxpCommand: "metadata.columns.get",
      mcpTools: ["inspect_project_panel_metadata_uxp"],
      verificationBoundary: "bounded_project_columns_metadata_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "bounded-project-panel-metadata-inspection")).toMatchObject({
      uxpCommand: "metadata.projectPanel.get",
      mcpTools: ["inspect_project_panel_metadata_uxp"],
      verificationBoundary: "bounded_project_panel_metadata_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "guarded-project-panel-metadata-update")).toMatchObject({
      uxpCommand: "metadata.projectPanel.update",
      mcpTools: ["manage_project_panel_metadata_uxp"],
      mutatesProject: true,
      undoable: false,
      idempotency: "operation_id",
      verificationBoundary: "project_panel_metadata_exact_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "guarded-project-metadata-schema-field-creation")).toMatchObject({
      uxpCommand: "metadata.projectSchema.create",
      mcpTools: ["create_project_metadata_field_uxp"],
      mutatesProject: true,
      undoable: false,
      idempotency: "operation_id",
      verificationStatus: "committed_unverified",
      verificationBoundary: "project_panel_metadata_change_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "guarded-project-metadata-schema-field-creation")?.adobeApi).toEqual(expect.arrayContaining([
      "Metadata.addPropertyToProjectMetadataSchema",
      "Metadata.METADATA_TYPE_INTEGER",
      "Metadata.METADATA_TYPE_REAL",
      "Metadata.METADATA_TYPE_TEXT",
      "Metadata.METADATA_TYPE_BOOLEAN",
      "Project.lockedAccess",
    ]));
    expect(entries.find((entry) => entry.id === "guarded-track-item-slip")).toMatchObject({
      uxpCommand: "trackItem.slip",
      mcpTools: ["slip_track_item_uxp"],
      verificationBoundary: "guarded_track_item_source_and_timeline_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "guarded-track-item-slide")).toMatchObject({
      uxpCommand: "trackItem.slide",
      mcpTools: ["slide_track_item_uxp"],
      verificationBoundary: "guarded_three_track_item_source_and_timeline_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "guarded-track-item-slide")?.adobeApi).toEqual(expect.arrayContaining([
      "AudioClipTrackItem.createMoveAction",
      "VideoClipTrackItem.createSetEndAction",
      "Project.lockedAccess",
      "Project.executeTransaction",
    ]));
    expect(entries.find((entry) => entry.id === "guarded-track-item-append-duplicate")).toMatchObject({
      uxpCommand: "trackItem.clone",
      mcpTools: ["duplicate_track_item_uxp"],
      verificationBoundary: "guarded_source_and_appended_track_item_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "guarded-track-item-append-duplicate")?.adobeApi).toEqual(expect.arrayContaining([
      "SequenceEditor.getEditor",
      "SequenceEditor.createCloneTrackItemAction",
      "TickTime.createWithSeconds",
      "Project.lockedAccess",
      "Project.executeTransaction",
    ]));
    expect(entries.find((entry) => entry.id === "guarded-track-item-contiguous-ripple-delete")).toMatchObject({
      uxpCommand: "trackItem.rippleDelete",
      mcpTools: ["ripple_delete_track_item_uxp"],
      verificationBoundary: "guarded_contiguous_successor_track_item_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "guarded-track-item-contiguous-ripple-delete")?.adobeApi).toEqual(expect.arrayContaining([
      "TrackItemSelection.createEmptySelection",
      "TrackItemSelection.addItem",
      "Constants.MediaType.VIDEO",
      "SequenceEditor.getEditor",
      "SequenceEditor.createRemoveItemsAction",
      "Project.lockedAccess",
      "Project.executeTransaction",
    ]));
    expect(entries.find((entry) => entry.id === "guarded-timeline-source-color-label")).toMatchObject({
      uxpCommand: "timeline.sourceLabel.update",
      mcpTools: ["manage_timeline_source_label_uxp"],
      verificationBoundary: "timeline_coordinate_source_color_label_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "guarded-timeline-source-color-label")?.adobeApi).toEqual(expect.arrayContaining([
      "VideoClipTrackItem.getProjectItem",
      "AudioClipTrackItem.getProjectItem",
      "ClipProjectItem.cast",
      "ProjectItem.getColorLabelIndex",
      "ProjectItem.createSetColorLabelAction",
      "Project.lockedAccess",
      "Project.executeTransaction",
    ]));
    expect(entries.find((entry) => entry.id === "guarded-sequence-preview-frame")).toMatchObject({
      uxpCommand: "sequence.previewFrame.update",
      mcpTools: ["manage_sequence_preview_frame_uxp"],
      verificationBoundary: "sequence_preview_frame_readback",
      liveHostVerificationStatus: "not_run",
    });
    expect(entries.find((entry) => entry.id === "guarded-sequence-preview-frame")?.adobeApi).toEqual(expect.arrayContaining([
      "Project.getSequences",
      "Sequence.getSettings",
      "Sequence.createSetSettingsAction",
      "SequenceSettings.getPreviewFrameRect",
      "SequenceSettings.setPreviewFrameRect",
      "RectF.[[construct]]",
      "Project.lockedAccess",
      "Project.executeTransaction",
    ]));
    expect(entries.find((entry) => entry.id === "bounded-source-media-provenance")).toMatchObject({
      uxpCommand: "source.provenance.inspect",
      mcpTools: ["inspect_source_media_provenance_uxp"],
      verificationBoundary: "bounded_opt_in_source_path_double_readback",
      liveHostVerificationStatus: "not_run",
      mutatesProject: false,
    });
    expect(entries.find((entry) => entry.id === "bounded-source-media-provenance")?.adobeApi).toEqual(expect.arrayContaining([
      "Project.getRootItem",
      "ProjectItem.getId",
      "FolderItem.getItems",
      "ClipProjectItem.getMediaFilePath",
      "ClipProjectItem.getOriginatingProjectPath",
    ]));
    expect(entries.find((entry) => entry.id === "bounded-source-proxy-inspection")).toMatchObject({
      uxpCommand: "source.proxy.inspect",
      mcpTools: ["inspect_source_proxy_uxp"],
      verificationBoundary: "bounded_source_proxy_state_double_readback",
      liveHostVerificationStatus: "not_run",
      mutatesProject: false,
    });
    expect(entries.find((entry) => entry.id === "bounded-source-proxy-inspection")?.adobeApi).toEqual(expect.arrayContaining([
      "Project.getRootItem",
      "ProjectItem.getId",
      "FolderItem.getItems",
      "ClipProjectItem.canChangeMediaPath",
      "ClipProjectItem.isOffline",
      "ClipProjectItem.canProxy",
      "ClipProjectItem.hasProxy",
      "ClipProjectItem.getProxyPath",
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
      total: 86,
      current: 83,
      planned: 3,
      implemented: 83,
      committedUnverified: 9,
      automatedContractVerified: 74,
      liveHostVerified: 0,
    });
    expect(report.entries.find((entry) => entry.id === "aaf-export")).toMatchObject({
      availability: "current",
      implementationStatus: "implemented",
      verificationStatus: "automated_contract_verified",
      liveHostVerificationStatus: "not_run",
      uxpCommand: "interchange.aaf.export",
    });
    expect(report.entries.find((entry) => entry.id === "bounded-operation-boundary-event-journal")).toMatchObject({
      availability: "current",
      implementationStatus: "implemented",
      verificationStatus: "automated_contract_verified",
      liveHostVerificationStatus: "not_run",
      uxpCommand: "events.list",
      mcpTools: ["inspect_premiere_events_uxp"],
      verificationBoundary: "bounded_redacted_operation_boundary_event_receipt",
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
      current: 83,
      planned: 3,
      committedUnverified: 9,
    });
  });
});
