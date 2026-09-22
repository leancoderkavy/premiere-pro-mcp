import { describe, expect, it, vi } from "vitest";
import { getUxpTimelineSourceLabelWorkflowTools } from "../../src/tools/uxp-timeline-source-label-workflows.js";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";

const snapshot = {
  project_guid: "project-1", sequence_id: "sequence-1", media_type: "video" as const, track_index: 0, clip_index: 0,
  track_item_count: 1, source_project_item_id: "source-1", source_color_label_index: 3, start_seconds: 12, end_seconds: 20,
};

describe("public guarded timeline source-label MCP tool", () => {
  it("uses a closed complete source snapshot and translates update arguments", async () => {
    const request = vi.fn().mockResolvedValue({ outcome: "verified" });
    const tool = getUxpTimelineSourceLabelWorkflowTools({ request } as unknown as UxpWebSocketBridge).manage_timeline_source_label_uxp;
    expect(tool.parameters).toMatchObject({
      additionalProperties: false, required: ["action", "media_type", "track_index", "clip_index"],
      properties: { action: { enum: ["inspect", "update"] }, expected_snapshot: { additionalProperties: false, required: Object.keys(snapshot) } },
    });
    await tool.handler({
      action: "update", media_type: "video", track_index: 0, clip_index: 0, color_index: 9,
      expected_snapshot: snapshot, confirm_set_label: true, operation_id: "source-label-tool-1",
    });
    expect(request).toHaveBeenCalledWith("timeline.sourceLabel.update", {
      mediaType: "video", trackIndex: 0, clipIndex: 0, colorIndex: 9, confirmSetLabel: true, operationId: "source-label-tool-1",
      expectedSnapshot: {
        projectGuid: "project-1", sequenceId: "sequence-1", mediaType: "video", trackIndex: 0, clipIndex: 0,
        trackItemCount: 1, sourceProjectItemId: "source-1", sourceColorLabelIndex: 3, startSeconds: 12, endSeconds: 20,
      },
    });
  });

  it("forwards an explicit sequence_id for inspect and update (issue #590)", async () => {
    const request = vi.fn().mockResolvedValue({ outcome: "verified" });
    const tool = getUxpTimelineSourceLabelWorkflowTools({ request } as unknown as UxpWebSocketBridge).manage_timeline_source_label_uxp;
    expect(tool.parameters.properties.sequence_id).toMatchObject({ type: "string", minLength: 1, maxLength: 128 });
    await tool.handler({ action: "inspect", media_type: "video", track_index: 0, clip_index: 0, sequence_id: "sequence-2" });
    expect(request).toHaveBeenLastCalledWith("timeline.sourceLabel.inspect", { mediaType: "video", trackIndex: 0, clipIndex: 0, sequenceId: "sequence-2" });
    await tool.handler({ action: "inspect", media_type: "video", track_index: 0, clip_index: 0 });
    expect(request).toHaveBeenLastCalledWith("timeline.sourceLabel.inspect", { mediaType: "video", trackIndex: 0, clipIndex: 0 });
    await tool.handler({
      action: "update", media_type: "video", track_index: 0, clip_index: 0, sequence_id: "sequence-1", color_index: 9,
      expected_snapshot: snapshot, confirm_set_label: true, operation_id: "source-label-tool-seq",
    });
    expect(request).toHaveBeenLastCalledWith("timeline.sourceLabel.update", expect.objectContaining({ sequenceId: "sequence-1" }));
  });

  it("rejects an update whose sequence_id differs from the reviewed snapshot without calling the bridge", async () => {
    const request = vi.fn();
    const tool = getUxpTimelineSourceLabelWorkflowTools({ request } as unknown as UxpWebSocketBridge).manage_timeline_source_label_uxp;
    await expect(tool.handler({
      action: "update", media_type: "video", track_index: 0, clip_index: 0, sequence_id: "sequence-2", color_index: 9,
      expected_snapshot: snapshot, confirm_set_label: true, operation_id: "source-label-tool-mismatch",
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("sequence_id must exactly match") });
    expect(request).not.toHaveBeenCalled();
  });

  it("does not silently drop unknown reviewed source fields", async () => {
    const request = vi.fn();
    const tool = getUxpTimelineSourceLabelWorkflowTools({ request } as unknown as UxpWebSocketBridge).manage_timeline_source_label_uxp;
    await expect(tool.handler({
      action: "update", media_type: "video", track_index: 0, clip_index: 0, color_index: 9,
      expected_snapshot: { ...snapshot, unexpected: true }, confirm_set_label: true, operation_id: "source-label-tool-invalid",
    })).rejects.toThrow("expected_snapshot has an unknown field: unexpected");
    expect(request).not.toHaveBeenCalled();
  });
});
