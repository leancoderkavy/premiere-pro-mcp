import { describe, expect, it, vi } from "vitest";
import { getUxpUnnestWorkflowTools } from "../../src/tools/uxp-unnest-workflows.js";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";

const placement = {
  media_type: "video", source_track_index: 0, target_track_index: 0, name: "Camera.MXF", project_item_id: "cam",
  start_ticks: "0", end_ticks: "508032000000", in_ticks: "2540160000000", out_ticks: "3048192000000", disabled: false,
};
const snapshot = {
  project_guid: "project-1", sequence_id: "seq-segment", nested_sequence_id: "seq-hook", nested_sequence_name: "Hook",
  references: [{ media_type: "video", track_index: 0, clip_index: 0, start_ticks: "0", end_ticks: "1016064000000", in_ticks: "0", out_ticks: "1016064000000" }],
  offset_ticks: "0",
  clones: [placement],
};

describe("public clone-based unnest MCP tool", () => {
  it("uses a closed plan schema and translates the snake_case plan for the panel", async () => {
    const request = vi.fn().mockResolvedValue({ outcome: "verified" });
    const tool = getUxpUnnestWorkflowTools({ request } as unknown as UxpWebSocketBridge).unnest_sequence_uxp;
    expect(tool.parameters).toMatchObject({
      additionalProperties: false, required: ["action", "media_type", "track_index", "clip_index"],
      properties: { action: { enum: ["inspect", "apply"] }, expected_snapshot: { additionalProperties: false } },
    });
    await tool.handler({ action: "apply", media_type: "video", track_index: 0, clip_index: 0, confirm_unnest: true, operation_id: "unnest-tool-1", expected_snapshot: snapshot });
    expect(request).toHaveBeenCalledWith("sequence.unnest", {
      mediaType: "video", trackIndex: 0, clipIndex: 0, confirmUnnest: true, operationId: "unnest-tool-1",
      expectedSnapshot: {
        projectGuid: "project-1", sequenceId: "seq-segment", nestedSequenceId: "seq-hook", nestedSequenceName: "Hook",
        references: [{ mediaType: "video", trackIndex: 0, clipIndex: 0, startTicks: "0", endTicks: "1016064000000", inTicks: "0", outTicks: "1016064000000" }],
        offsetTicks: "0",
        clones: [{ mediaType: "video", sourceTrackIndex: 0, targetTrackIndex: 0, name: "Camera.MXF", projectItemId: "cam", startTicks: "0", endTicks: "508032000000", inTicks: "2540160000000", outTicks: "3048192000000", disabled: false }],
      },
    });
  });

  it("returns an apply-ready snake_case plan from inspect", async () => {
    const request = vi.fn().mockResolvedValue({
      projectGuid: "project-1", sequenceId: "seq-segment", nestedSequenceId: "seq-hook", nestedSequenceName: "Hook",
      references: [{ mediaType: "video", trackIndex: 0, clipIndex: 0, startTicks: "0", endTicks: "1016064000000", inTicks: "0", outTicks: "1016064000000" }],
      offsetTicks: "0",
      clones: [{ mediaType: "video", sourceTrackIndex: 0, targetTrackIndex: 0, name: "Camera.MXF", projectItemId: "cam", startTicks: "0", endTicks: "508032000000", inTicks: "2540160000000", outTicks: "3048192000000", disabled: false }],
    });
    const tool = getUxpUnnestWorkflowTools({ request } as unknown as UxpWebSocketBridge).unnest_sequence_uxp;
    const result = await tool.handler({ action: "inspect", media_type: "video", track_index: 0, clip_index: 0 }) as { success: boolean; data: { expected_snapshot?: unknown } };
    expect(request).toHaveBeenCalledWith("sequence.unnest.inspect", { mediaType: "video", trackIndex: 0, clipIndex: 0 });
    expect(result.success).toBe(true);
    expect(JSON.stringify(result.data)).toContain("expected_snapshot");
  });

  it("does not silently drop unknown fields from a reviewed plan", async () => {
    const request = vi.fn();
    const tool = getUxpUnnestWorkflowTools({ request } as unknown as UxpWebSocketBridge).unnest_sequence_uxp;
    await expect(tool.handler({
      action: "apply", media_type: "video", track_index: 0, clip_index: 0, confirm_unnest: true, operation_id: "x",
      expected_snapshot: { ...snapshot, clones: [{ ...placement, unexpected: true }] },
    })).rejects.toThrow("expected_snapshot.clones[0] has an unknown field: unexpected");
    expect(request).not.toHaveBeenCalled();
  });

  it("requires the plan for apply", async () => {
    const request = vi.fn();
    const tool = getUxpUnnestWorkflowTools({ request } as unknown as UxpWebSocketBridge).unnest_sequence_uxp;
    await expect(tool.handler({ action: "apply", media_type: "video", track_index: 0, clip_index: 0 })).rejects.toThrow("expected_snapshot is required");
    expect(request).not.toHaveBeenCalled();
  });
});
