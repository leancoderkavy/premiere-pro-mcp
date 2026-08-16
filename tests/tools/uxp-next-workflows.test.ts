import { describe, expect, it, vi } from "vitest";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";
import { getUxpNextWorkflowTools } from "../../src/tools/uxp-next-workflows.js";

describe("next-wave UXP MCP tools", () => {
  it("publishes a closed and bounded event receipt schema", () => {
    const bridge = { request: vi.fn(), getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tool = getUxpNextWorkflowTools(bridge).inspect_premiere_events_uxp;
    expect(tool.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { enum: ["list", "wait"] },
        categories: { maxItems: 32 },
        event_names: { maxItems: 32 },
        limit: { maximum: 256 },
        timeout_ms: { maximum: 60000 },
      },
    });
  });

  it("maps snake-case event queries to the exact bridge commands", async () => {
    const request = vi.fn().mockResolvedValue({ events: [] });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tool = getUxpNextWorkflowTools(bridge).inspect_premiere_events_uxp;
    await tool.handler({
      action: "wait", after_revision: 7, categories: ["encoder"],
      event_names: ["encoder.complete"], limit: 4, timeout_ms: 5000,
    });
    expect(request).toHaveBeenCalledWith("events.wait", {
      afterRevision: 7,
      categories: ["encoder"],
      eventNames: ["encoder.complete"],
      limit: 4,
      timeoutMs: 5000,
    });
  });
});
