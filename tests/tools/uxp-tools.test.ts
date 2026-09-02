import { describe, expect, it, vi } from "vitest";
import { getUxpTools } from "../../src/tools/uxp.js";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";
import { createServer } from "../../src/server.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

describe("UXP MCP tools", () => {
  it("maps MCP arguments to the supported frame export command", async () => {
    const request = vi.fn().mockResolvedValue({ path: "/tmp/frame.png" });
    const bridge = {
      request,
      getState: vi.fn(),
    } as unknown as UxpWebSocketBridge;
    const tools = getUxpTools(bridge);
    const result = await tools.export_frame_uxp.handler({
      output_directory: "/tmp",
      filename: "frame.png",
      seconds: 2.5,
      width: 1920,
      height: 1080,
    });
    expect(request).toHaveBeenCalledWith("frame.export", {
      outputDirectory: "/tmp",
      filename: "frame.png",
      seconds: 2.5,
      width: 1920,
      height: 1080,
    });
    expect(result).toEqual({
      success: true,
      data: { backend: "uxp", result: { path: "/tmp/frame.png" } },
    });
  });

  it("exposes connection discovery without requiring a host request", async () => {
    const state = { status: "listening", connected: false } as const;
    const bridge = {
      request: vi.fn(),
      getState: vi.fn(() => state),
    } as unknown as UxpWebSocketBridge;
    const result = await getUxpTools(bridge).get_uxp_capabilities.handler();
    expect(result).toEqual({ success: true, data: state });
    expect(bridge.request).not.toHaveBeenCalled();
  });

  it("maps verified project and interchange workflows to versioned UXP commands", async () => {
    const request = vi.fn().mockResolvedValue({ outcome: "verified" });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tools = getUxpTools(bridge);
    await tools.create_sequence_with_preset_uxp.handler({
      name: "Delivery",
      preset_path: "/presets/hd.sqpreset",
      operation_id: "sequence-1",
    });
    await tools.export_interchange_uxp.handler({
      format: "otio",
      output_file_path: "/exports/edit.otio",
      operation_id: "export-1",
    });
    expect(request).toHaveBeenNthCalledWith(1, "sequence.createPreset", {
      name: "Delivery", presetPath: "/presets/hd.sqpreset", operationId: "sequence-1",
    });
    expect(request).toHaveBeenNthCalledWith(2, "interchange.export", {
      format: "otio", outputFilePath: "/exports/edit.otio", operationId: "export-1",
    });
  });

  it("maps guarded empty sequence creation only after confirmation and with a replay key", async () => {
    const request = vi.fn().mockResolvedValue({ outcome: "verified" });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tool = getUxpTools(bridge).create_empty_sequence_uxp;
    await expect(tool.handler({
      name: "Empty Assembly", confirm_non_undoable: false, operation_id: "empty-1",
    })).resolves.toEqual({ success: false, error: "create_empty_sequence_uxp requires confirm_non_undoable: true" });
    await expect(tool.handler({
      name: "Empty Assembly", confirm_non_undoable: true, operation_id: "",
    })).resolves.toEqual({ success: false, error: "create_empty_sequence_uxp requires operation_id for safe replay" });
    expect(request).not.toHaveBeenCalled();
    await expect(tool.handler({
      name: "Empty Assembly", confirm_non_undoable: true, operation_id: "empty-1",
    })).resolves.toEqual({ success: true, data: { backend: "uxp", result: { outcome: "verified" } } });
    expect(request).toHaveBeenCalledWith("sequences.createEmpty", {
      name: "Empty Assembly", confirmNonUndoable: true, operationId: "empty-1",
    });
    expect(tool.parameters).toMatchObject({
      additionalProperties: false,
      required: ["name", "confirm_non_undoable", "operation_id"],
    });
  });

  it("maps native caption-track inspection to its documented UXP command", async () => {
    const request = vi.fn().mockResolvedValue({ trackCount: 0, tracks: [] });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    await expect(getUxpTools(bridge).inspect_caption_tracks_uxp.handler()).resolves.toEqual({
      success: true,
      data: { backend: "uxp", result: { trackCount: 0, tracks: [] } },
    });
    expect(request).toHaveBeenCalledWith("captions.inspect", {});
  });

  it("maps guarded native Project-panel insertion-bin inspection to its documented UXP command", async () => {
    const request = vi.fn().mockResolvedValue({ projectGuid: "project-1" });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tool = getUxpTools(bridge).inspect_project_insertion_bin_uxp;
    await expect(tool.handler()).resolves.toEqual({
      success: true,
      data: { backend: "uxp", result: { projectGuid: "project-1" } },
    });
    expect(request).toHaveBeenCalledWith("project.insertionBin.inspect", {});
    expect(tool.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {},
    });
  });

  it("maps guarded sequence-range inspection and updates to documented UXP commands", async () => {
    const request = vi.fn().mockResolvedValue({ outcome: "verified" });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tools = getUxpTools(bridge);
    await tools.manage_sequence_range_uxp.handler({ action: "inspect" });
    await tools.manage_sequence_range_uxp.handler({
      action: "update",
      expected_sequence_guid: "sequence-1",
      expected_range: { in_seconds: 1, out_seconds: 10, zero_point_seconds: 3600, end_seconds: 120 },
      updates: { in_seconds: 2, zero_point_seconds: 7200 },
      operation_id: "range-1",
    });
    expect(request).toHaveBeenNthCalledWith(1, "sequence.range.inspect", {});
    expect(request).toHaveBeenNthCalledWith(2, "sequence.range.update", {
      expectedSequenceGuid: "sequence-1",
      expectedRange: { inSeconds: 1, outSeconds: 10, zeroPointSeconds: 3600, endSeconds: 120 },
      updates: { inSeconds: 2, zeroPointSeconds: 7200 },
      operationId: "range-1",
    });
    expect(tools.manage_sequence_range_uxp.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["inspect", "update"] },
        expected_sequence_guid: { type: "string" },
        expected_range: {
          type: "object",
          additionalProperties: false,
          required: ["in_seconds", "out_seconds", "zero_point_seconds", "end_seconds"],
        },
        updates: { type: "object", additionalProperties: false },
        operation_id: { type: "string" },
      },
    });
  });

  it("maps guarded sequence-playhead inspection and settings to documented UXP commands", async () => {
    const request = vi.fn().mockResolvedValue({ outcome: "verified" });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tools = getUxpTools(bridge);
    await tools.manage_sequence_playhead_uxp.handler({ action: "inspect" });
    await tools.manage_sequence_playhead_uxp.handler({
      action: "set",
      expected_sequence_guid: "sequence-1",
      expected_position_seconds: 3,
      position_seconds: 8,
      operation_id: "playhead-1",
    });
    expect(request).toHaveBeenNthCalledWith(1, "sequence.playhead.inspect", {});
    expect(request).toHaveBeenNthCalledWith(2, "sequence.playhead.set", {
      expectedSequenceGuid: "sequence-1",
      expectedPositionSeconds: 3,
      positionSeconds: 8,
      operationId: "playhead-1",
    });
    expect(tools.manage_sequence_playhead_uxp.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["inspect", "set"] },
        expected_sequence_guid: { type: "string" },
        expected_position_seconds: { type: "number", minimum: 0, maximum: 86400 },
        position_seconds: { type: "number", minimum: 0, maximum: 86400 },
        operation_id: { type: "string" },
      },
    });
  });

  it("maps bounded guarded app-preference inspection and direct writes to documented UXP commands", async () => {
    const request = vi.fn().mockResolvedValue({ outcome: "verified" });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tools = getUxpTools(bridge);
    await tools.manage_app_preferences_uxp.handler({ action: "inspect" });
    await tools.manage_app_preferences_uxp.handler({
      action: "set",
      preference: "auto_peak_generation",
      expected_value: "0",
      value: "1",
      persistence: "persistent",
      confirm_preference_change: true,
      operation_id: "app-preference-1",
    });
    expect(request).toHaveBeenNthCalledWith(1, "preferences.inspect", {});
    expect(request).toHaveBeenNthCalledWith(2, "preferences.set", {
      preference: "auto_peak_generation",
      expectedValue: "0",
      value: "1",
      persistence: "persistent",
      confirmPreferenceChange: true,
      operationId: "app-preference-1",
    });
    expect(tools.manage_app_preferences_uxp.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["inspect", "set"] },
        preference: { enum: ["auto_peak_generation", "import_workspace", "show_quickstart_dialog"] },
        expected_value: { type: "string", maxLength: 1024 },
        value: { type: "string", maxLength: 1024 },
        persistence: { enum: ["persistent", "non_persistent"] },
        confirm_preference_change: { type: "boolean" },
        operation_id: { type: "string", minLength: 1, maxLength: 128 },
      },
    });
  });

  it("rejects incomplete or unconfirmed app-preference writes before bridge access", async () => {
    const request = vi.fn();
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tool = getUxpTools(bridge).manage_app_preferences_uxp;
    await expect(tool.handler({ action: "set", preference: "import_workspace" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("requires preference") });
    await expect(tool.handler({
      action: "set", preference: "import_workspace", expected_value: "1", value: "0", persistence: "persistent", operation_id: "app-preference-unconfirmed",
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("confirm_preference_change") });
    expect(request).not.toHaveBeenCalled();
  });

  it("maps bounded native sequence-timing inspection to its documented UXP command", async () => {
    const request = vi.fn().mockResolvedValue({ outcome: "verified" });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tools = getUxpTools(bridge);
    await tools.inspect_sequence_timing_uxp.handler({});
    expect(request).toHaveBeenCalledWith("sequence.timing.inspect", {});
    expect(tools.inspect_sequence_timing_uxp.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {},
    });
  });

  it("maps bounded native timeline-structure inspection and documents scoped track counts", async () => {
    const request = vi.fn().mockResolvedValue({ outcome: "verified" });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tools = getUxpTools(bridge);
    await tools.inspect_sequence_structure_uxp.handler({
      sequence_id: "sequence-1", expected_sequence_id: "sequence-1", media_type: "video",
      track_indices: [1, 0], include_empty_tracks: true, include_source_project_items: true,
      include_source_project_item_classification: true, include_source_project_item_content_type: true,
      include_source_nested_sequence_identity: true, max_items: 8,
    });
    expect(request).toHaveBeenCalledWith("timeline.structure.inspect", {
      sequenceId: "sequence-1", expectedSequenceId: "sequence-1", mediaType: "video",
      trackIndices: [1, 0], includeEmptyTracks: true, includeSourceProjectItems: true,
      includeSourceProjectItemClassification: true, includeSourceProjectItemContentType: true,
      includeSourceNestedSequenceIdentity: true, maxItems: 8,
    });
    expect(tools.inspect_sequence_structure_uxp.description).toContain(
      "track_counts contains only the requested media types",
    );
    expect(tools.inspect_sequence_structure_uxp.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        sequence_id: { type: "string", minLength: 1, maxLength: 128 },
        expected_sequence_id: { type: "string", minLength: 1, maxLength: 128 },
        media_type: { type: "string", enum: ["all", "video", "audio"] },
        track_indices: { type: "array", minItems: 1, maxItems: 64, uniqueItems: true },
        include_empty_tracks: { type: "boolean" },
        include_source_project_items: { type: "boolean" },
        include_source_project_item_classification: { type: "boolean" },
        include_source_project_item_content_type: { type: "boolean" },
        include_source_nested_sequence_identity: { type: "boolean" },
        max_items: { type: "integer", minimum: 1, maximum: 512 },
      },
    });
  });

  it("maps guarded native transition inspection and mutation arguments to documented UXP commands", async () => {
    const request = vi.fn().mockResolvedValue({ outcome: "committed_unverified" });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tools = getUxpTools(bridge);
    const expectedTarget = {
      sequence_guid: "sequence-1", video_track_index: 2, clip_index: 3, project_item_id: "project-item-1",
      start_seconds: 10, end_seconds: 20, position: "end" as const, transition_present: false,
    };
    await tools.lift_selection_uxp.handler({ expected_sequence_guid: "sequence-1", operation_id: "lift-1" });
    await tools.list_video_transitions_uxp.handler();
    await tools.inspect_video_transition_uxp.handler({ video_track_index: 2, clip_index: 3, position: "end" });
    await tools.add_video_transition_uxp.handler({
      video_track_index: 2, clip_index: 3, match_name: "CrossDissolve", position: "end",
      duration_seconds: 0.5, force_single_sided: true, transition_alignment: 1, expected_target: expectedTarget, operation_id: "transition-add-1",
    });
    await tools.remove_video_transition_uxp.handler({
      video_track_index: 2, clip_index: 3, position: "end", expected_target: { ...expectedTarget, transition_present: true }, operation_id: "transition-remove-1",
    });
    expect(request).toHaveBeenNthCalledWith(1, "timeline.selection.lift", { expectedSequenceGuid: "sequence-1", operationId: "lift-1" });
    expect(request).toHaveBeenNthCalledWith(2, "transition.video.list", {});
    expect(request).toHaveBeenNthCalledWith(3, "transition.video.inspect", {
      videoTrackIndex: 2, clipIndex: 3, position: "end",
    });
    expect(request).toHaveBeenNthCalledWith(4, "transition.video.add", {
      videoTrackIndex: 2, clipIndex: 3, matchName: "CrossDissolve", position: "end", durationSeconds: 0.5,
      forceSingleSided: true, transitionAlignment: 1,
      expectedTarget: {
        sequenceGuid: "sequence-1", videoTrackIndex: 2, clipIndex: 3, projectItemId: "project-item-1",
        startSeconds: 10, endSeconds: 20, position: "end", transitionPresent: false,
      },
      operationId: "transition-add-1",
    });
    expect(request).toHaveBeenNthCalledWith(5, "transition.video.remove", {
      videoTrackIndex: 2, clipIndex: 3, position: "end", operationId: "transition-remove-1",
      expectedTarget: {
        sequenceGuid: "sequence-1", videoTrackIndex: 2, clipIndex: 3, projectItemId: "project-item-1",
        startSeconds: 10, endSeconds: 20, position: "end", transitionPresent: true,
      },
    });
    expect(tools.add_video_transition_uxp.parameters).toMatchObject({ required: expect.arrayContaining(["expected_target"]) });
    expect(tools.remove_video_transition_uxp.parameters).toMatchObject({ required: expect.arrayContaining(["expected_target"]) });
  });

  it("returns transport errors through the normal tool envelope", async () => {
    const bridge = {
      request: vi.fn().mockRejectedValue(new Error("UXP bridge is not connected")),
      getState: vi.fn(),
    } as unknown as UxpWebSocketBridge;
    const result = await getUxpTools(bridge).get_uxp_state.handler();
    expect(result).toEqual({
      success: false,
      error: "UXP bridge is not connected",
    });
  });

  it("registers UXP tools only when an adapter is supplied", async () => {
    const bridge = {
      request: vi.fn(),
      getState: vi.fn(() => ({ status: "listening", connected: false })),
    } as unknown as UxpWebSocketBridge;
    const server = createServer({}, { uxpBridge: bridge });
    const client = new Client({ name: "uxp-tool-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "get_uxp_capabilities",
          "get_uxp_state",
          "inspect_project_uxp",
          "inspect_project_insertion_bin_uxp",
          "inspect_sequence_timing_uxp",
          "inspect_caption_tracks_uxp",
          "manage_sequence_display_format_uxp",
          "manage_sequence_range_uxp",
          "manage_sequence_playhead_uxp",
          "manage_app_preferences_uxp",
          "save_project_uxp",
          "create_sequence_with_preset_uxp",
          "create_empty_sequence_uxp",
          "export_interchange_uxp",
          "get_transcript_languages_uxp",
          "get_clip_transcript_uxp",
          "search_clip_transcript_uxp",
          "preview_transcript_edit_uxp",
          "plan_transcript_rough_cut_uxp",
          "detect_object_masks_uxp",
          "configure_encoder_uxp",
          "rename_track_uxp",
          "create_subclip_uxp",
          "list_markers_uxp",
          "set_source_monitor_position_uxp",
          "has_transcript_uxp",
          "export_aaf_uxp",
          "export_frame_uxp",
          "lift_selection_uxp",
          "list_video_transitions_uxp",
          "inspect_video_transition_uxp",
          "add_video_transition_uxp",
          "remove_video_transition_uxp",
          "inspect_project_panel_metadata_uxp",
          "slide_track_item_uxp",
          "duplicate_track_item_uxp",
          "apply_editorial_organization_plan",
        ]),
      );
      // The default profile excludes two unsafe-script tools. The native
      // transcript workflow and documented Premiere 26.3 tools add nineteen. The
      // two stable workflow expansions, confirmed organization application, four
      // bounded native migration adapters, beat-grid marker application, and
      // guarded sequence-playhead control, native sequence-timing inspection, and
      // guarded sequence-display-format updates and guarded Project-panel
      // insertion-bin inspection, guarded empty-sequence creation, marker web-link
      // inspection, Project-panel metadata inspection and guarded replacement,
      // guarded app-preference control, source-media interpretation overrides,
      // direct track-item identity inspection, guarded three-item slides, and
      // guarded append-only timeline duplication add thirty-nine consolidated
      // UXP tools;
      // connection verification and delivery conformance add two default-profile core tools.
      expect(tools.tools).toHaveLength(404);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
