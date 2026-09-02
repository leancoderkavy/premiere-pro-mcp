import { describe, expect, it, vi } from "vitest";
import { getUxpSourceProxyWorkflowTools } from "../../src/tools/uxp-source-proxy-workflows.js";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";

describe("public bounded source-proxy MCP tool", () => {
  it("documents a read-only explicit target and translates only a supplied proxy-path opt-in", async () => {
    const request = vi.fn().mockResolvedValue({ projectGuid: "project-1" });
    const tool = getUxpSourceProxyWorkflowTools({ request } as unknown as UxpWebSocketBridge).inspect_source_proxy_uxp;
    expect(tool.parameters).toMatchObject({
      additionalProperties: false,
      required: ["project_item_id"],
      properties: {
        project_item_id: { minLength: 1, maxLength: 512 },
        include_proxy_path: { type: "boolean" },
      },
    });
    expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false });
    await expect(tool.handler({ project_item_id: "clip-1" })).resolves.toMatchObject({ success: true });
    expect(request).toHaveBeenLastCalledWith("source.proxy.inspect", { projectItemId: "clip-1" });
    await expect(tool.handler({ project_item_id: "clip-1", include_proxy_path: true })).resolves.toMatchObject({ success: true });
    expect(request).toHaveBeenLastCalledWith("source.proxy.inspect", { projectItemId: "clip-1", includeProxyPath: true });
    expect(tool.description).toContain("does not enumerate folders");
    expect(tool.description).toContain("does not access the filesystem");
    expect(tool.description).toContain("licensed-host behavior");
  });

  it("returns a truthful bridge error without a fallback backend", async () => {
    const tool = getUxpSourceProxyWorkflowTools({
      request: vi.fn().mockRejectedValue(new Error("source.proxy.inspect unavailable")),
    } as unknown as UxpWebSocketBridge).inspect_source_proxy_uxp;
    await expect(tool.handler({ project_item_id: "clip-1" })).resolves.toEqual({
      success: false, error: "source.proxy.inspect unavailable",
    });
  });
});
