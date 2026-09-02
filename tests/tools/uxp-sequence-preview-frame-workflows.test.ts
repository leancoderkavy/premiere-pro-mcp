import { describe, expect, it, vi } from "vitest";
import { getUxpSequencePreviewFrameWorkflowTools } from "../../src/tools/uxp-sequence-preview-frame-workflows.js";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";

const snapshot = {
  project_guid: "project-1", sequence_id: "sequence-1", preview_width: 640, preview_height: 360,
};

describe("public guarded sequence preview-frame MCP tool", () => {
  it("uses a closed complete snapshot and translates the update arguments", async () => {
    const request = vi.fn().mockResolvedValue({ outcome: "verified" });
    const tool = getUxpSequencePreviewFrameWorkflowTools({ request } as unknown as UxpWebSocketBridge).manage_sequence_preview_frame_uxp;
    expect(tool.parameters).toMatchObject({
      additionalProperties: false, required: ["action", "sequence_id"],
      properties: { action: { enum: ["inspect", "update"] }, expected_snapshot: { additionalProperties: false, required: Object.keys(snapshot) } },
    });
    await tool.handler({
      action: "update", sequence_id: "sequence-1", preview_width: 1920, preview_height: 1080,
      expected_snapshot: snapshot, confirm_set_preview_frame: true, operation_id: "preview-frame-tool-1",
    });
    expect(request).toHaveBeenCalledWith("sequence.previewFrame.update", {
      sequenceId: "sequence-1", previewWidth: 1920, previewHeight: 1080, confirmSetPreviewFrame: true, operationId: "preview-frame-tool-1",
      expectedSnapshot: { projectGuid: "project-1", sequenceId: "sequence-1", previewWidth: 640, previewHeight: 360 },
    });
  });

  it("does not silently drop unknown reviewed fields", async () => {
    const request = vi.fn();
    const tool = getUxpSequencePreviewFrameWorkflowTools({ request } as unknown as UxpWebSocketBridge).manage_sequence_preview_frame_uxp;
    await expect(tool.handler({
      action: "update", sequence_id: "sequence-1", preview_width: 1920, preview_height: 1080,
      expected_snapshot: { ...snapshot, unexpected: true }, confirm_set_preview_frame: true, operation_id: "preview-frame-invalid",
    })).rejects.toThrow("expected_snapshot has an unknown field: unexpected");
    expect(request).not.toHaveBeenCalled();
  });
});
