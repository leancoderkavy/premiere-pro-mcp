import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { getUxpTools } from "../../src/tools/uxp.js";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";

type UxpTool = {
  parameters: {
    type?: string;
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

const ADOBE_26_3_TOOLS = [
  "rename_track_uxp",
  "create_subclip_uxp",
  "list_markers_uxp",
  "set_source_monitor_position_uxp",
  "has_transcript_uxp",
  "export_aaf_uxp",
] as const;

function catalog(request = vi.fn().mockResolvedValue({ outcome: "verified" })) {
  const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
  return { request, tools: getUxpTools(bridge) as Record<string, UxpTool> };
}

describe("Adobe Premiere 26.3 UXP public MCP catalog", () => {
  it("registers the six capability-gated tools only with a UXP bridge", async () => {
    const bridge = {
      request: vi.fn(),
      getState: vi.fn(() => ({ status: "listening", connected: false })),
    } as unknown as UxpWebSocketBridge;
    const server = createServer({}, { uxpBridge: bridge });
    const client = new Client({ name: "adobe-26-3-catalog-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(ADOBE_26_3_TOOLS),
      );
      expect(listed.tools).toHaveLength(332);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("publishes bounded schemas for Adobe's documented 26.3 APIs", () => {
    const { tools } = catalog();
    expect(Object.keys(tools)).toEqual(expect.arrayContaining(ADOBE_26_3_TOOLS));

    expect(tools.rename_track_uxp.parameters).toMatchObject({
      type: "object",
      required: ["track_type", "track_index", "name"],
      properties: {
        track_type: { type: "string", enum: ["audio", "video", "caption"] },
        track_index: { type: "integer" },
        name: { type: "string" },
        operation_id: { type: "string" },
      },
    });
    expect(tools.create_subclip_uxp.parameters).toMatchObject({
      type: "object",
      required: ["name", "start_seconds", "end_seconds"],
      properties: {
        project_item_id: { type: "string" },
        project_item_name: { type: "string" },
        name: { type: "string" },
        start_seconds: { type: "number" },
        end_seconds: { type: "number" },
        hard_boundaries: { type: "boolean" },
        take_video: { type: "boolean" },
        take_audio: { type: "boolean" },
        operation_id: { type: "string" },
      },
    });
    expect(tools.list_markers_uxp.parameters).toMatchObject({
      type: "object",
      properties: {
        scope: { type: "string", enum: ["sequence", "project_item"] },
        project_item_id: { type: "string" },
        project_item_name: { type: "string" },
        filters: { type: "array", items: { type: "string" } },
      },
    });
    expect(tools.set_source_monitor_position_uxp.parameters).toMatchObject({
      type: "object",
      required: ["seconds"],
      properties: { seconds: { type: "number" }, operation_id: { type: "string" } },
    });
    expect(tools.has_transcript_uxp.parameters).toMatchObject({
      type: "object",
      properties: {
        project_item_id: { type: "string" },
        project_item_name: { type: "string" },
      },
    });
    expect(tools.export_aaf_uxp.parameters).toMatchObject({
      type: "object",
      required: ["output_file_path"],
      properties: {
        output_file_path: { type: "string" },
        operation_id: { type: "string" },
        options: {
          type: "object",
          properties: {
            mixdown_video: { type: "boolean" },
            explode_to_mono: { type: "boolean" },
            embed_audio: { type: "boolean" },
            trim_sources: { type: "boolean" },
            render_audio_effects: { type: "boolean" },
            interleave_without_effects: { type: "boolean" },
            preserve_parent_folder: { type: "boolean" },
            sample_rate: { type: "integer", enum: [32000, 44100, 48000, 88200, 96000] },
            bits_per_sample: { type: "integer", enum: [16, 24, 32] },
            audio_file_format: { type: "string", enum: ["aiff", "wav"] },
            handle_frames: { type: "integer" },
            video_mixdown_preset_path: { type: "string" },
          },
        },
      },
    });
  });

  it("translates the public snake_case arguments to protocol arguments", async () => {
    const request = vi.fn().mockResolvedValue({ outcome: "verified" });
    const { tools } = catalog(request);

    await tools.rename_track_uxp.handler({
      track_type: "caption", track_index: 2, name: "Dialogue", operation_id: "track-1",
    });
    await tools.create_subclip_uxp.handler({
      project_item_id: "clip-17", name: "Sentence", start_seconds: 1.25, end_seconds: 4.75,
      hard_boundaries: true, take_video: false, take_audio: true, operation_id: "subclip-1",
    });
    await tools.list_markers_uxp.handler({
      scope: "project_item", project_item_id: "clip-17", filters: ["Comment", "Chapter"],
    });
    await tools.set_source_monitor_position_uxp.handler({ seconds: 12.5, operation_id: "source-1" });
    await tools.has_transcript_uxp.handler({ project_item_name: "Interview A" });
    await tools.export_aaf_uxp.handler({
      output_file_path: "/exports/turnover.aaf",
      options: {
        mixdown_video: true, explode_to_mono: true, embed_audio: false, trim_sources: true,
        render_audio_effects: true, interleave_without_effects: false, preserve_parent_folder: true,
        sample_rate: 48000, bits_per_sample: 24, audio_file_format: "wav", handle_frames: 12,
        video_mixdown_preset_path: "/presets/prores.epr",
      },
      operation_id: "aaf-1",
    });

    expect(request).toHaveBeenNthCalledWith(1, "track.rename", {
      trackType: "caption", trackIndex: 2, name: "Dialogue", operationId: "track-1",
    });
    expect(request).toHaveBeenNthCalledWith(2, "subclip.create", {
      projectItemId: "clip-17", name: "Sentence", startSeconds: 1.25, endSeconds: 4.75,
      hasHardBoundaries: true, takeVideo: false, takeAudio: true, operationId: "subclip-1",
    });
    expect(request).toHaveBeenNthCalledWith(3, "marker.list", {
      scope: "projectItem", projectItemId: "clip-17", filters: ["Comment", "Chapter"],
    });
    expect(request).toHaveBeenNthCalledWith(4, "sourceMonitor.position.set", {
      seconds: 12.5, operationId: "source-1",
    });
    expect(request).toHaveBeenNthCalledWith(5, "transcript.has", { projectItemName: "Interview A" });
    expect(request).toHaveBeenNthCalledWith(6, "interchange.aaf.export", {
      outputFilePath: "/exports/turnover.aaf",
      options: {
        mixdownVideo: true, explodeToMono: true, embedAudio: false, trimSources: true,
        renderAudioEffects: true, interleaveWithoutEffects: false, preserveParentFolder: true,
        sampleRate: 48000, bitsPerSample: 24, audioFileFormat: "wav", handleFrames: 12,
        videoMixdownPresetPath: "/presets/prores.epr",
      },
      operationId: "aaf-1",
    });
  });
});
