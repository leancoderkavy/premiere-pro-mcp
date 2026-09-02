import { describe, expect, it, vi } from "vitest";
import { getUxpSlipWorkflowTools } from "../../src/tools/uxp-slip-workflows.js";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";

describe("public guarded track-item slip MCP tool", () => {
  it("uses a closed complete snapshot schema and translates snake_case apply arguments", async () => {
    const request = vi.fn().mockResolvedValue({ outcome: "verified" });
    const bridge = { request } as unknown as UxpWebSocketBridge;
    const tool = getUxpSlipWorkflowTools(bridge).slip_track_item_uxp;
    expect(tool.parameters).toMatchObject({
      additionalProperties: false,
      required: ["action", "media_type", "track_index", "clip_index"],
      properties: {
        action: { enum: ["inspect", "apply"] },
        slip_by_seconds: { minimum: -60, maximum: 60 },
        expected_snapshot: {
          additionalProperties: false,
          required: ["project_guid", "sequence_id", "media_type", "track_index", "clip_index", "start_seconds", "end_seconds", "in_seconds", "out_seconds", "duration_seconds", "speed", "reversed"],
        },
      },
    });
    await tool.handler({
      action: "apply", media_type: "video", track_index: 0, clip_index: 1,
      expected_snapshot: {
        project_guid: "project-1", sequence_id: "sequence-1", media_type: "video", track_index: 0, clip_index: 1,
        start_seconds: 10, end_seconds: 20, in_seconds: 30, out_seconds: 40, duration_seconds: 10, speed: 1, reversed: false,
      },
      slip_by_seconds: -2, confirm_slip: true, operation_id: "slip-tool-1",
    });
    expect(request).toHaveBeenCalledWith("trackItem.slip", {
      mediaType: "video", trackIndex: 0, clipIndex: 1,
      expectedSnapshot: {
        projectGuid: "project-1", sequenceId: "sequence-1", mediaType: "video", trackIndex: 0, clipIndex: 1,
        startSeconds: 10, endSeconds: 20, inSeconds: 30, outSeconds: 40, durationSeconds: 10, speed: 1, reversed: false,
      },
      slipBySeconds: -2, confirmSlip: true, operationId: "slip-tool-1",
    });
  });

  it("does not silently drop malformed or unknown reviewed snapshot fields", async () => {
    const request = vi.fn();
    const bridge = { request } as unknown as UxpWebSocketBridge;
    const tool = getUxpSlipWorkflowTools(bridge).slip_track_item_uxp;
    await expect(tool.handler({
      action: "apply", media_type: "video", track_index: 0, clip_index: 0,
      expected_snapshot: { project_guid: "project-1", unexpected: true },
    })).rejects.toThrow("expected_snapshot has an unknown field: unexpected");
    expect(request).not.toHaveBeenCalled();
  });
});
