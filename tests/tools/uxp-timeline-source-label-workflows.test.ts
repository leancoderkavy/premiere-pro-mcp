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
