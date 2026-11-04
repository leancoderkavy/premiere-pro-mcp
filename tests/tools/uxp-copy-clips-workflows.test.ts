import { describe, expect, it, vi } from "vitest";
import { getUxpCopyClipsWorkflowTools } from "../../src/tools/uxp-copy-clips-workflows.js";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";

const clip = {
  media_type: "video", source_track_index: 0, source_clip_index: 2, target_track_index: 1, name: "Camera.MXF", project_item_id: "cam",
  start_ticks: "2540160000000", end_ticks: "3048192000000", in_ticks: "508032000000", out_ticks: "1016064000000",
  trim_head_ticks: "254016000000", trim_tail_ticks: "0", disabled: false,
};
const snapshot = {
  project_guid: "project-1", source_sequence_id: "seq-backup", source_sequence_name: "Backup",
  destination_sequence_id: "seq-segment", destination_sequence_name: "Segment",
  source_start_ticks: "254016000000", source_end_ticks: "762048000000", destination_start_ticks: "2540160000000",
  clips: [clip],
};
const panelClip = {
  mediaType: "video", sourceTrackIndex: 0, sourceClipIndex: 2, targetTrackIndex: 1, name: "Camera.MXF", projectItemId: "cam",
  startTicks: "2540160000000", endTicks: "3048192000000", inTicks: "508032000000", outTicks: "1016064000000",
  trimHeadTicks: "254016000000", trimTailTicks: "0", disabled: false,
};
const panelSnapshot = {
  projectGuid: "project-1", sourceSequenceId: "seq-backup", sourceSequenceName: "Backup",
  destinationSequenceId: "seq-segment", destinationSequenceName: "Segment",
  sourceStartTicks: "254016000000", sourceEndTicks: "762048000000", destinationStartTicks: "2540160000000",
  clips: [panelClip],
};

describe("public clone-based copy-clips MCP tool", () => {
  it("uses a closed plan schema and translates the snake_case request and plan for the panel", async () => {
    const request = vi.fn().mockResolvedValue({ outcome: "verified" });
    const tool = getUxpCopyClipsWorkflowTools({ request } as unknown as UxpWebSocketBridge).copy_clips_between_sequences_uxp;
    expect(tool.parameters).toMatchObject({
      additionalProperties: false, required: ["action", "source_sequence_id", "destination_sequence_id"],
      properties: { action: { enum: ["inspect", "apply"] }, expected_snapshot: { additionalProperties: false } },
    });
    await tool.handler({
      action: "apply", source_sequence_id: "seq-backup", destination_sequence_id: "seq-segment",
      source_start_ticks: "254016000000", source_end_ticks: "762048000000", destination_start_ticks: "2540160000000",
      video_tracks: [0], audio_tracks: [], video_track_offset: 1,
      confirm_copy: true, operation_id: "copy-tool-1", expected_snapshot: snapshot,
    });
    expect(request).toHaveBeenCalledWith("sequence.copyClips", {
      sourceSequenceId: "seq-backup", destinationSequenceId: "seq-segment",
      sourceStartTicks: "254016000000", sourceEndTicks: "762048000000", destinationStartTicks: "2540160000000",
      videoTracks: [0], audioTracks: [], videoTrackOffset: 1,
      confirmCopy: true, operationId: "copy-tool-1",
      expectedSnapshot: panelSnapshot,
    });
  });

  it("returns an apply-ready snake_case plan from inspect, passing seconds through", async () => {
    const request = vi.fn().mockResolvedValue(panelSnapshot);
    const tool = getUxpCopyClipsWorkflowTools({ request } as unknown as UxpWebSocketBridge).copy_clips_between_sequences_uxp;
    const result = await tool.handler({
      action: "inspect", source_sequence_id: "seq-backup", destination_sequence_id: "seq-segment",
      source_start_seconds: 1, source_end_seconds: 3, destination_start_seconds: 10,
    }) as { success: boolean; data: { expected_snapshot?: unknown } };
    expect(request).toHaveBeenCalledWith("sequence.copyClips.inspect", {
      sourceSequenceId: "seq-backup", destinationSequenceId: "seq-segment",
      sourceStartSeconds: 1, sourceEndSeconds: 3, destinationStartSeconds: 10,
    });
    expect(result.success).toBe(true);
    expect(JSON.stringify(result.data)).toContain("expected_snapshot");
  });

  it("does not silently drop unknown fields from a reviewed plan", async () => {
    const request = vi.fn();
    const tool = getUxpCopyClipsWorkflowTools({ request } as unknown as UxpWebSocketBridge).copy_clips_between_sequences_uxp;
    await expect(tool.handler({
      action: "apply", source_sequence_id: "seq-backup", destination_sequence_id: "seq-segment",
      source_start_ticks: "254016000000", source_end_ticks: "762048000000", destination_start_ticks: "2540160000000",
      confirm_copy: true, operation_id: "x",
      expected_snapshot: { ...snapshot, clips: [{ ...clip, unexpected: true }] },
    })).rejects.toThrow("expected_snapshot.clips[0] has an unknown field: unexpected");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a plan with a missing required field", async () => {
    const request = vi.fn();
    const tool = getUxpCopyClipsWorkflowTools({ request } as unknown as UxpWebSocketBridge).copy_clips_between_sequences_uxp;
    const { trim_tail_ticks: _dropped, ...incomplete } = clip;
    await expect(tool.handler({
      action: "apply", source_sequence_id: "seq-backup", destination_sequence_id: "seq-segment",
      source_start_ticks: "254016000000", source_end_ticks: "762048000000", destination_start_ticks: "2540160000000",
      confirm_copy: true, operation_id: "x",
      expected_snapshot: { ...snapshot, clips: [incomplete] },
    })).rejects.toThrow("expected_snapshot.clips[0].trim_tail_ticks is required");
    expect(request).not.toHaveBeenCalled();
  });

  it("requires the plan for apply", async () => {
    const request = vi.fn();
    const tool = getUxpCopyClipsWorkflowTools({ request } as unknown as UxpWebSocketBridge).copy_clips_between_sequences_uxp;
    await expect(tool.handler({ action: "apply", source_sequence_id: "seq-backup", destination_sequence_id: "seq-segment" }))
      .rejects.toThrow("expected_snapshot is required");
    expect(request).not.toHaveBeenCalled();
  });
});
