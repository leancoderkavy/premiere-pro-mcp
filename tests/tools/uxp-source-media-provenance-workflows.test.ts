import { describe, expect, it, vi } from "vitest";
import { getUxpSourceMediaProvenanceWorkflowTools } from "../../src/tools/uxp-source-media-provenance-workflows.js";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";

describe("public bounded source-media provenance MCP tool", () => {
  it("requires an explicit path opt-in schema and translates only supplied flags", async () => {
    const request = vi.fn().mockResolvedValue({ projectGuid: "project-1" });
    const tool = getUxpSourceMediaProvenanceWorkflowTools({
      request,
    } as unknown as UxpWebSocketBridge).inspect_source_media_provenance_uxp;
    expect(tool.parameters).toMatchObject({
      additionalProperties: false,
      required: ["project_item_id"],
      properties: {
        project_item_id: { minLength: 1, maxLength: 512 },
        include_media_file_path: { type: "boolean" },
        include_originating_project_path: { type: "boolean" },
      },
    });
    await tool.handler({
      project_item_id: "clip-1", include_media_file_path: true,
    });
    expect(request).toHaveBeenCalledWith("source.provenance.inspect", {
      projectItemId: "clip-1", includeMediaFilePath: true,
    });
  });

  it("preserves an explicit false flag so the host can enforce the paired opt-in", async () => {
    const request = vi.fn().mockResolvedValue({});
    const tool = getUxpSourceMediaProvenanceWorkflowTools({
      request,
    } as unknown as UxpWebSocketBridge).inspect_source_media_provenance_uxp;
    await tool.handler({
      project_item_id: "clip-1", include_media_file_path: false, include_originating_project_path: true,
    });
    expect(request).toHaveBeenCalledWith("source.provenance.inspect", {
      projectItemId: "clip-1", includeMediaFilePath: false, includeOriginatingProjectPath: true,
    });
  });
});
