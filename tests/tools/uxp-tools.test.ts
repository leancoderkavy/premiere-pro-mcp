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

  it("maps verified project and interchange workflows to versioned UXP commands", async () => {
    const request = vi.fn().mockResolvedValue({ outcome: "verified" });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tools = getUxpTools(bridge);
    await tools.create_sequence_with_preset_uxp.handler({
      name: "Delivery",
      preset_path: "/presets/hd.sqpreset",
      operation_id: "sequence-1",
    });
    await tools.export_interchange_uxp.handler({
      format: "otio",
      output_file_path: "/exports/edit.otio",
      operation_id: "export-1",
    });
    expect(request).toHaveBeenNthCalledWith(1, "sequence.createPreset", {
      name: "Delivery", presetPath: "/presets/hd.sqpreset", operationId: "sequence-1",
    });
    expect(request).toHaveBeenNthCalledWith(2, "interchange.export", {
      format: "otio", outputFilePath: "/exports/edit.otio", operationId: "export-1",
    });
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
          "inspect_project_uxp",
          "save_project_uxp",
          "create_sequence_with_preset_uxp",
          "export_interchange_uxp",
          "get_transcript_languages_uxp",
          "get_clip_transcript_uxp",
          "search_clip_transcript_uxp",
          "preview_transcript_edit_uxp",
          "detect_object_masks_uxp",
          "configure_encoder_uxp",
          "rename_track_uxp",
          "create_subclip_uxp",
          "list_markers_uxp",
          "set_source_monitor_position_uxp",
          "has_transcript_uxp",
          "export_aaf_uxp",
          "export_frame_uxp",
        ]),
      );
      // The default profile excludes two unsafe-script tools. The native
      // transcript workflow and documented Premiere 26.3 tools add nineteen,
      // and the two stable workflow expansions add twenty-one consolidated UXP tools;
      // connection verification adds one default-profile core tool.
      expect(tools.tools).toHaveLength(320);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
