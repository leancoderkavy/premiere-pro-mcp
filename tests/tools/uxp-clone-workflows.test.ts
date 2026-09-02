import { describe, expect, it, vi } from "vitest";
import { getUxpCloneWorkflowTools } from "../../src/tools/uxp-clone-workflows.js";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";

const source = { project_item_id: "source-1", start_seconds: 0, end_seconds: 10, in_seconds: 20, out_seconds: 30, duration_seconds: 10, speed: 1, reversed: false };

describe("public guarded append-only track-item duplicate MCP tool", () => {
  it("uses a closed complete source snapshot schema and translates snake_case apply arguments", async () => {
    const request = vi.fn().mockResolvedValue({ outcome: "verified" });
    const tool = getUxpCloneWorkflowTools({ request } as unknown as UxpWebSocketBridge).duplicate_track_item_uxp;
    expect(tool.parameters).toMatchObject({
      additionalProperties: false, required: ["action", "media_type", "track_index", "clip_index"],
      properties: { action: { enum: ["inspect", "apply"] }, expected_snapshot: { additionalProperties: false, required: ["project_guid", "sequence_id", "media_type", "track_index", "clip_index", "track_item_count", "source"] } },
    });
    await tool.handler({
      action: "apply", media_type: "video", track_index: 0, clip_index: 0, confirm_duplicate: true, operation_id: "clone-tool-1",
      expected_snapshot: { project_guid: "project-1", sequence_id: "sequence-1", media_type: "video", track_index: 0, clip_index: 0, track_item_count: 1, source },
    });
    expect(request).toHaveBeenCalledWith("trackItem.clone", {
      mediaType: "video", trackIndex: 0, clipIndex: 0, confirmDuplicate: true, operationId: "clone-tool-1",
      expectedSnapshot: {
        projectGuid: "project-1", sequenceId: "sequence-1", mediaType: "video", trackIndex: 0, clipIndex: 0, trackItemCount: 1,
        source: { projectItemId: "source-1", startSeconds: 0, endSeconds: 10, inSeconds: 20, outSeconds: 30, durationSeconds: 10, speed: 1, reversed: false },
      },
    });
  });

  it("does not silently drop unknown fields from a reviewed source snapshot", async () => {
    const request = vi.fn();
    const tool = getUxpCloneWorkflowTools({ request } as unknown as UxpWebSocketBridge).duplicate_track_item_uxp;
    await expect(tool.handler({
      action: "apply", media_type: "video", track_index: 0, clip_index: 0,
      expected_snapshot: { project_guid: "project-1", sequence_id: "sequence-1", media_type: "video", track_index: 0, clip_index: 0, track_item_count: 1, source: { ...source, unexpected: true } },
    })).rejects.toThrow("expected_snapshot.source has an unknown field: unexpected");
    expect(request).not.toHaveBeenCalled();
  });
});
