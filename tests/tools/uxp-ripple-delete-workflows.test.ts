import { describe, expect, it, vi } from "vitest";
import { getUxpRippleDeleteWorkflowTools } from "../../src/tools/uxp-ripple-delete-workflows.js";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";

const target = { project_item_id: "target-1", start_seconds: 0, end_seconds: 10, in_seconds: 20, out_seconds: 30, duration_seconds: 10, speed: 1, reversed: false };
const following = { project_item_id: "following-1", start_seconds: 10, end_seconds: 20, in_seconds: 40, out_seconds: 50, duration_seconds: 10, speed: 1, reversed: false };

describe("public guarded contiguous track-item ripple-delete MCP tool", () => {
  it("uses closed target and successor snapshot schemas and translates snake_case apply arguments", async () => {
    const request = vi.fn().mockResolvedValue({ outcome: "verified" });
    const tool = getUxpRippleDeleteWorkflowTools({ request } as unknown as UxpWebSocketBridge).ripple_delete_track_item_uxp;
    expect(tool.parameters).toMatchObject({
      additionalProperties: false, required: ["action", "media_type", "track_index", "clip_index"],
      properties: { action: { enum: ["inspect", "apply"] }, expected_snapshot: { additionalProperties: false, required: ["project_guid", "sequence_id", "media_type", "track_index", "clip_index", "track_item_count", "target", "following"] } },
    });
    await tool.handler({
      action: "apply", media_type: "video", track_index: 0, clip_index: 0, confirm_ripple_delete: true, operation_id: "ripple-tool-1",
      expected_snapshot: { project_guid: "project-1", sequence_id: "sequence-1", media_type: "video", track_index: 0, clip_index: 0, track_item_count: 2, target, following },
    });
    expect(request).toHaveBeenCalledWith("trackItem.rippleDelete", {
      mediaType: "video", trackIndex: 0, clipIndex: 0, confirmRippleDelete: true, operationId: "ripple-tool-1",
      expectedSnapshot: {
        projectGuid: "project-1", sequenceId: "sequence-1", mediaType: "video", trackIndex: 0, clipIndex: 0, trackItemCount: 2,
        target: { projectItemId: "target-1", startSeconds: 0, endSeconds: 10, inSeconds: 20, outSeconds: 30, durationSeconds: 10, speed: 1, reversed: false },
        following: { projectItemId: "following-1", startSeconds: 10, endSeconds: 20, inSeconds: 40, outSeconds: 50, durationSeconds: 10, speed: 1, reversed: false },
      },
    });
  });

  it("does not silently drop unknown fields from a reviewed successor snapshot", async () => {
    const request = vi.fn();
    const tool = getUxpRippleDeleteWorkflowTools({ request } as unknown as UxpWebSocketBridge).ripple_delete_track_item_uxp;
    await expect(tool.handler({
      action: "apply", media_type: "video", track_index: 0, clip_index: 0,
      expected_snapshot: { project_guid: "project-1", sequence_id: "sequence-1", media_type: "video", track_index: 0, clip_index: 0, track_item_count: 2, target, following: { ...following, unexpected: true } },
    })).rejects.toThrow("expected_snapshot.following has an unknown field: unexpected");
    expect(request).not.toHaveBeenCalled();
  });
});
