import { describe, expect, it, vi } from "vitest";
import { getUxpSlideWorkflowTools } from "../../src/tools/uxp-slide-workflows.js";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";

const item = { start_seconds: 0, end_seconds: 10, in_seconds: 0, out_seconds: 10, duration_seconds: 10, speed: 1, reversed: false };

describe("public guarded track-item slide MCP tool", () => {
  it("uses a closed complete three-item snapshot schema and translates snake_case apply arguments", async () => {
    const request = vi.fn().mockResolvedValue({ outcome: "verified" });
    const tool = getUxpSlideWorkflowTools({ request } as unknown as UxpWebSocketBridge).slide_track_item_uxp;
    expect(tool.parameters).toMatchObject({
      additionalProperties: false, required: ["action", "media_type", "track_index", "clip_index"],
      properties: { action: { enum: ["inspect", "apply"] }, slide_by_seconds: { minimum: -60, maximum: 60 }, expected_snapshot: { additionalProperties: false, required: ["project_guid", "sequence_id", "media_type", "track_index", "clip_index", "previous", "target", "following"] } },
    });
    await tool.handler({
      action: "apply", media_type: "video", track_index: 0, clip_index: 1, slide_by_seconds: 2, confirm_slide: true, operation_id: "slide-tool-1",
      expected_snapshot: { project_guid: "project-1", sequence_id: "sequence-1", media_type: "video", track_index: 0, clip_index: 1, previous: item, target: { ...item, start_seconds: 10, end_seconds: 20, in_seconds: 20, out_seconds: 30 }, following: { ...item, start_seconds: 20, end_seconds: 30, in_seconds: 30, out_seconds: 40 } },
    });
    expect(request).toHaveBeenCalledWith("trackItem.slide", {
      mediaType: "video", trackIndex: 0, clipIndex: 1, slideBySeconds: 2, confirmSlide: true, operationId: "slide-tool-1",
      expectedSnapshot: {
        projectGuid: "project-1", sequenceId: "sequence-1", mediaType: "video", trackIndex: 0, clipIndex: 1,
        previous: { startSeconds: 0, endSeconds: 10, inSeconds: 0, outSeconds: 10, durationSeconds: 10, speed: 1, reversed: false },
        target: { startSeconds: 10, endSeconds: 20, inSeconds: 20, outSeconds: 30, durationSeconds: 10, speed: 1, reversed: false },
        following: { startSeconds: 20, endSeconds: 30, inSeconds: 30, outSeconds: 40, durationSeconds: 10, speed: 1, reversed: false },
      },
    });
  });

  it("does not silently drop unknown fields from a reviewed neighbour snapshot", async () => {
    const request = vi.fn();
    const tool = getUxpSlideWorkflowTools({ request } as unknown as UxpWebSocketBridge).slide_track_item_uxp;
    await expect(tool.handler({
      action: "apply", media_type: "video", track_index: 0, clip_index: 1,
      expected_snapshot: { project_guid: "project-1", sequence_id: "sequence-1", media_type: "video", track_index: 0, clip_index: 1, previous: { ...item, unexpected: true }, target: item, following: item },
    })).rejects.toThrow("expected_snapshot.previous has an unknown field: unexpected");
    expect(request).not.toHaveBeenCalled();
  });
});
