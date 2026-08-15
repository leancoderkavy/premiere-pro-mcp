import { describe, expect, it, vi } from "vitest";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";
import { getUxpTools } from "../../src/tools/uxp.js";

const ADVANCED_WORKFLOW_TOOLS = [
  "inspect_project_selection_uxp",
  "manage_markers_uxp",
  "organize_project_items_uxp",
  "manage_sequence_settings_uxp",
  "import_project_media_uxp",
  "automate_effect_parameters_uxp",
  "transform_track_item_uxp",
  "edit_timeline_uxp",
  "manage_sequences_uxp",
  "encode_media_uxp",
] as const;

describe("advanced stable UXP workflow MCP catalog", () => {
  it("publishes exactly ten new consolidated tools with closed, bounded schemas", () => {
    const bridge = { request: vi.fn(), getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tools = getUxpTools(bridge) as Record<string, { parameters: Record<string, unknown> }>;

    expect(Object.keys(tools)).toEqual(expect.arrayContaining(ADVANCED_WORKFLOW_TOOLS));
    expect(ADVANCED_WORKFLOW_TOOLS).toHaveLength(10);
    for (const name of ADVANCED_WORKFLOW_TOOLS) {
      expect(tools[name].parameters).toMatchObject({
        type: "object",
        additionalProperties: false,
        required: expect.arrayContaining(["action"]),
      });
    }
    expect(tools.inspect_project_selection_uxp.parameters).toMatchObject({
      properties: { action: { enum: ["views", "selection"] }, view_id: { maxLength: 128 } },
    });
    expect(tools.import_project_media_uxp.parameters).toMatchObject({
      required: ["action", "confirm_non_undoable"],
      properties: { paths: { maxItems: 100 }, confirm_non_undoable: { type: "boolean" } },
    });
    expect(tools.encode_media_uxp.parameters).toMatchObject({
      properties: {
        action: { enum: ["preflight", "sequence", "project_item", "file"] },
        output_file: { maxLength: 4096 },
        confirm_external_write: { type: "boolean" },
      },
    });
  });

  it("maps every consolidated tool to its exact camel-case UXP command contract", async () => {
    const request = vi.fn().mockResolvedValue({ outcome: "verified" });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tools = getUxpTools(bridge);

    await tools.inspect_project_selection_uxp.handler({ action: "selection", view_id: "view-1" });
    await tools.manage_markers_uxp.handler({
      action: "update", owner_type: "project_item", project_item_id: "clip-1",
      marker_guid: "marker-1", expected_name: "Old", name: "New", color_index: 3,
      operation_id: "marker-op",
    });
    await tools.organize_project_items_uxp.handler({
      action: "create_smart_bin", parent_bin_id: "bin-1", name: "Selects",
      search_query: "rating:5", operation_id: "bin-op",
    });
    await tools.manage_sequence_settings_uxp.handler({
      action: "update", sequence_id: "sequence-1",
      updates: { maximum_bit_depth: true, video_frame_rate: 24, video_width: 1920 },
      operation_id: "settings-op",
    });
    await tools.import_project_media_uxp.handler({
      action: "ae_comps", aep_path: "D:/Approved/graphics.aep",
      comp_names: ["Lower Third"], target_bin_id: "bin-1",
      confirm_non_undoable: true, operation_id: "import-op",
    });
    await tools.automate_effect_parameters_uxp.handler({
      action: "add_keyframe", media_type: "video", track_index: 0, clip_index: 1,
      component_index: 2, param_index: 3, expected_component_id: "ADBE Opacity",
      expected_param_name: "Opacity", value: 75, time_seconds: 2.5,
      operation_id: "keyframe-op",
    });
    await tools.transform_track_item_uxp.handler({
      action: "update", media_type: "audio", track_index: 1, clip_index: 2,
      expected_start_seconds: 10, expected_end_seconds: 20, move_by_seconds: 1.5,
      disabled: false, operation_id: "track-op",
    });
    await tools.edit_timeline_uxp.handler({
      action: "insert_mogrt_path", file_path: "D:/Approved/title.mogrt",
      time_seconds: 4, video_track_index: 2, audio_track_index: 0,
      confirm_non_undoable: true, operation_id: "timeline-op",
    });
    await tools.manage_sequences_uxp.handler({
      action: "create_from_media", name: "Assembly", project_item_ids: ["clip-1", "clip-2"],
      target_bin_id: "bin-1", confirm_non_undoable: true, operation_id: "sequence-op",
    });
    await tools.encode_media_uxp.handler({
      action: "file", file_path: "D:/Approved/input.mov", output_file: "D:/Approved/output.mp4",
      preset_file: "D:/Approved/h264.epr", in_seconds: 1, out_seconds: 8, work_area: 0,
      remove_upon_completion: true, start_queue_immediately: false,
      confirm_external_write: true, operation_id: "encode-op",
    });

    expect(request.mock.calls).toEqual([
      ["projectSelection.inspect", { viewId: "view-1" }],
      ["markers.update", {
        ownerType: "projectItem", projectItemId: "clip-1", markerGuid: "marker-1",
        expectedName: "Old", name: "New", colorIndex: 3, operationId: "marker-op",
      }],
      ["bins.createSmart", {
        parentBinId: "bin-1", name: "Selects", searchQuery: "rating:5", operationId: "bin-op",
      }],
      ["sequenceSettings.update", {
        sequenceId: "sequence-1",
        updates: { maximumBitDepth: true, videoFrameRate: 24, videoWidth: 1920 },
        operationId: "settings-op",
      }],
      ["project.import", {
        mode: "aeComps", aepPath: "D:/Approved/graphics.aep", compNames: ["Lower Third"],
        targetBinId: "bin-1", confirmNonUndoable: true, operationId: "import-op",
      }],
      ["parameters.keyframeAdd", {
        mediaType: "video", trackIndex: 0, clipIndex: 1, componentIndex: 2, paramIndex: 3,
        expectedComponentId: "ADBE Opacity", expectedParamName: "Opacity", timeSeconds: 2.5,
        value: 75, operationId: "keyframe-op",
      }],
      ["trackItem.update", {
        mediaType: "audio", trackIndex: 1, clipIndex: 2, expectedStartSeconds: 10,
        expectedEndSeconds: 20, moveBySeconds: 1.5, disabled: false, operationId: "track-op",
      }],
      ["timeline.mogrtPath", {
        timeSeconds: 4, videoTrackIndex: 2, audioTrackIndex: 0,
        filePath: "D:/Approved/title.mogrt", confirmNonUndoable: true,
        operationId: "timeline-op",
      }],
      ["sequences.createFromMedia", {
        name: "Assembly", projectItemIds: ["clip-1", "clip-2"], targetBinId: "bin-1",
        confirmNonUndoable: true, operationId: "sequence-op",
      }],
      ["encoder.file", {
        filePath: "D:/Approved/input.mov", outputFile: "D:/Approved/output.mp4",
        presetFile: "D:/Approved/h264.epr", inSeconds: 1, outSeconds: 8, workArea: 0,
        removeUponCompletion: true, startQueueImmediately: false,
        confirmExternalWrite: true, operationId: "encode-op",
      }],
    ]);
  });

  it("rejects unknown public actions without contacting Premiere", async () => {
    const request = vi.fn();
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tools = getUxpTools(bridge);
    const results = await Promise.all([
      tools.inspect_project_selection_uxp.handler({ action: "destroy_everything" }),
      tools.manage_markers_uxp.handler({ action: "destroy_everything" }),
      tools.organize_project_items_uxp.handler({ action: "destroy_everything" }),
      tools.transform_track_item_uxp.handler({ action: "destroy_everything" }),
    ]);

    expect(results).toEqual(Array.from({ length: 4 }, () => ({
      success: false,
      error: "Unsupported workflow action: destroy_everything",
    })));
    expect(request).not.toHaveBeenCalled();
  });

  it("normalizes Error and non-Error bridge rejections", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error("Premiere unavailable"))
      .mockRejectedValueOnce("transport closed");
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tools = getUxpTools(bridge);

    await expect(tools.inspect_project_selection_uxp.handler({ action: "views" })).resolves.toEqual({
      success: false,
      error: "Premiere unavailable",
    });
    await expect(tools.manage_sequence_settings_uxp.handler({ action: "get" })).resolves.toEqual({
      success: false,
      error: "transport closed",
    });
  });

  it("rejects missing actions in mapped dispatchers before bridge access", async () => {
    const request = vi.fn();
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tools = getUxpTools(bridge);

    const results = await Promise.all([
      tools.import_project_media_uxp.handler({ confirm_non_undoable: true }),
      tools.automate_effect_parameters_uxp.handler({}),
      tools.edit_timeline_uxp.handler({}),
      tools.manage_sequences_uxp.handler({}),
      tools.encode_media_uxp.handler({}),
    ]);

    expect(results).toEqual(Array.from({ length: 5 }, () => ({
      success: false,
      error: "Unsupported workflow action: undefined",
    })));
    expect(request).not.toHaveBeenCalled();
  });
});
