import { describe, expect, it, vi } from "vitest";
import { getUxpTools } from "../../src/tools/uxp.js";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";
import { createServer } from "../../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

describe("UXP MCP tools", () => {
  it("maps MCP arguments to the supported frame export command", async () => {
    const request = vi.fn().mockResolvedValue({ path: "/tmp/frame.png" });
    const bridge = {
      request,
      getState: vi.fn(),
    } as unknown as UxpWebSocketBridge;
    const tools = getUxpTools(bridge);
    const result = await tools.export_frame_uxp.handler({
      output_directory: "/tmp",
      filename: "frame.png",
      seconds: 2.5,
      width: 1920,
      height: 1080,
    });
    expect(request).toHaveBeenCalledWith("frame.export", {
      outputDirectory: "/tmp",
      filename: "frame.png",
      seconds: 2.5,
      width: 1920,
      height: 1080,
    });
    expect(result).toEqual({
      success: true,
      data: { backend: "uxp", result: { path: "/tmp/frame.png" } },
    });
  });

  it("exposes connection discovery without requiring a host request", async () => {
    const state = { status: "listening", connected: false } as const;
    const bridge = {
      request: vi.fn(),
      getState: vi.fn(() => state),
    } as unknown as UxpWebSocketBridge;
    const result = await getUxpTools(bridge).get_uxp_capabilities.handler();
    expect(result).toEqual({ success: true, data: state });
    expect(bridge.request).not.toHaveBeenCalled();
  });

  it("returns transport errors through the normal tool envelope", async () => {
    const bridge = {
      request: vi.fn().mockRejectedValue(new Error("UXP bridge is not connected")),
      getState: vi.fn(),
    } as unknown as UxpWebSocketBridge;
    const result = await getUxpTools(bridge).get_uxp_state.handler();
    expect(result).toEqual({
      success: false,
      error: "UXP bridge is not connected",
    });
  });

  it("registers UXP tools only when an adapter is supplied", async () => {
    const bridge = {
      request: vi.fn(),
      getState: vi.fn(() => ({ status: "listening", connected: false })),
    } as unknown as UxpWebSocketBridge;
    const server = createServer({}, { uxpBridge: bridge });
    const client = new Client({ name: "uxp-tool-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "get_uxp_capabilities",
          "get_uxp_state",
          "export_frame_uxp",
        ]),
      );
      // 282 collected minus the 2 unsafe-script tools the default profile
      // withholds from tools/list.
      expect(tools.tools).toHaveLength(280);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
