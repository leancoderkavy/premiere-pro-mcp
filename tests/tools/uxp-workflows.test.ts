import { describe, expect, it, vi } from "vitest";
import { getUxpTools } from "../../src/tools/uxp.js";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";

const WORKFLOW_TOOLS = [
  "manage_clip_effects_uxp",
  "batch_selected_clips_uxp",
  "detect_scene_edits_uxp",
  "manage_proxy_ingest_uxp",
  "relink_offline_media_uxp",
  "manage_metadata_uxp",
  "manage_color_conformance_uxp",
  "audition_source_monitor_uxp",
  "preflight_production_storage_uxp",
  "get_uxp_workspace_access",
] as const;

describe("stable UXP workflow MCP catalog", () => {
  it("publishes exactly the ten researched workflow entrypoints with bounded schemas", () => {
    const bridge = { request: vi.fn(), getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tools = getUxpTools(bridge) as Record<string, { parameters: Record<string, unknown> }>;
    expect(Object.keys(tools)).toEqual(expect.arrayContaining(WORKFLOW_TOOLS));
    expect(tools.manage_clip_effects_uxp.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { enum: ["catalog", "inspect", "add", "remove"] },
        effect_id: { maxLength: 256 },
        operation_id: { pattern: expect.any(String) },
      },
    });
    expect(tools.manage_metadata_uxp.parameters).toMatchObject({
      properties: {
        project_metadata: { maxLength: 350000, description: expect.stringContaining("900,000-byte") },
        xmp_metadata: { maxLength: 350000, description: expect.stringContaining("900,000-byte") },
        updated_fields: { maxItems: 128 },
      },
    });
    expect(tools.relink_offline_media_uxp.parameters).toMatchObject({
      required: ["new_path", "confirm_non_undoable"],
      properties: { new_path: { maxLength: 4096 }, confirm_non_undoable: { type: "boolean" } },
    });
  });

  it("rejects incomplete storage configuration and preserves explicit empty selectors", async () => {
    const request = vi.fn().mockResolvedValue({ outcome: "verified" });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tools = getUxpTools(bridge);

    await expect(tools.preflight_production_storage_uxp.handler({
      action: "configure_project", folder_types: ["capture"],
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("destination") });
    expect(request).not.toHaveBeenCalled();

    await tools.manage_metadata_uxp.handler({ action: "get", project_item_id: "" });
    expect(request).toHaveBeenCalledWith("metadata.get", { projectItemId: "" });
  });

  it("maps consolidated public actions to exact capability-gated UXP commands", async () => {
    const request = vi.fn().mockResolvedValue({ outcome: "verified" });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tools = getUxpTools(bridge);

    await tools.manage_clip_effects_uxp.handler({
      action: "add", media_type: "video", track_index: 1, clip_index: 2,
      effect_id: "PR.Test", insertion_index: 3, operation_id: "effect-1",
    });
    await tools.batch_selected_clips_uxp.handler({
      action: "remove_effect", media_type: "audio", component_index: 4,
      expected_effect_id: "Dynamics", operation_id: "batch-1",
    });
    await tools.detect_scene_edits_uxp.handler({ mode: "create_markers", operation_id: "scene-1" });
    await tools.manage_proxy_ingest_uxp.handler({ action: "set_ingest", enabled: true, operation_id: "ingest-1" });
    await tools.relink_offline_media_uxp.handler({
      project_item_id: "clip-1", new_path: "D:/Approved/online.mov", expected_current_path: "D:/Approved/missing.mov",
      confirm_non_undoable: true, operation_id: "relink-1",
    });
    await tools.manage_metadata_uxp.handler({
      action: "update", project_item_id: "clip-1", project_metadata: "metadata", updated_fields: ["LogNote"], operation_id: "meta-1",
    });
    await tools.manage_color_conformance_uxp.handler({
      action: "update", project_item_id: "clip-1", frame_rate: 24, input_lut_id: "lut-guid", operation_id: "color-1",
    });
    await tools.audition_source_monitor_uxp.handler({ action: "open_file", file_path: "D:/Approved/take.mov", operation_id: "monitor-1" });
    await tools.preflight_production_storage_uxp.handler({
      action: "configure_project", folder_types: ["capture", "auto_save"], destination: "same_as_project", operation_id: "scratch-1",
    });
    await tools.get_uxp_workspace_access.handler();

    expect(request).toHaveBeenNthCalledWith(1, "effects.chain.add", {
      mediaType: "video", trackIndex: 1, clipIndex: 2, effectId: "PR.Test", insertionIndex: 3, operationId: "effect-1",
    });
    expect(request).toHaveBeenNthCalledWith(2, "effects.selection.remove", {
      mediaType: "audio", componentIndex: 4, expectedEffectId: "Dynamics", operationId: "batch-1",
    });
    expect(request).toHaveBeenNthCalledWith(3, "sceneEdit.detect", { mode: "createMarkers", operationId: "scene-1" });
    expect(request).toHaveBeenNthCalledWith(4, "ingest.configure", { enabled: true, operationId: "ingest-1" });
    expect(request).toHaveBeenNthCalledWith(5, "media.relink", {
      projectItemId: "clip-1", newPath: "D:/Approved/online.mov", expectedCurrentPath: "D:/Approved/missing.mov",
      confirmNonUndoable: true, operationId: "relink-1",
    });
    expect(request).toHaveBeenNthCalledWith(6, "metadata.update", {
      projectItemId: "clip-1", projectMetadata: "metadata", updatedFields: ["LogNote"], operationId: "meta-1",
    });
    expect(request).toHaveBeenNthCalledWith(7, "footage.conform", {
      projectItemId: "clip-1", frameRate: 24, inputLutId: "lut-guid", operationId: "color-1",
    });
    expect(request).toHaveBeenNthCalledWith(8, "sourceMonitor.open", { filePath: "D:/Approved/take.mov", operationId: "monitor-1" });
    expect(request).toHaveBeenNthCalledWith(9, "scratch.configure", {
      folderTypes: ["capture", "autoSave"], destination: "sameAsProject", operationId: "scratch-1",
    });
    expect(request).toHaveBeenNthCalledWith(10, "workspace.status", {});
  });
});
