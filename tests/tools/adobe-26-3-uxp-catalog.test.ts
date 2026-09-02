import { describe, expect, it, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
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
  "inspect_frame_alignment_uxp",
  "calculate_tick_time_uxp",
  "manage_sequence_preview_frame_uxp",
  "inspect_source_media_provenance_uxp",
  "inspect_source_proxy_uxp",
  "manage_source_media_overrides_uxp",
  "inspect_track_item_identity_uxp",
  "slide_track_item_uxp",
  "duplicate_track_item_uxp",
  "ripple_delete_track_item_uxp",
  "create_empty_sequence_uxp",
  "audit_object_masks_uxp",
  "inspect_unique_object_identity_uxp",
  "inspect_effect_parameter_catalog_uxp",
  "has_transcript_uxp",
  "export_aaf_uxp",
] as const;

function catalog(request = vi.fn().mockResolvedValue({ outcome: "verified" })) {
  const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
  return { request, tools: getUxpTools(bridge) as Record<string, UxpTool> };
}

describe("Adobe Premiere 26.3 UXP public MCP catalog", () => {
  it("registers the sampled capability-gated tools only with a UXP bridge", async () => {
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
      expect(listed.tools).toHaveLength(417);
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
        include_web_links: { type: "boolean" },
        include_color_values: { type: "boolean" },
      },
    });
    expect(tools.set_source_monitor_position_uxp.parameters).toMatchObject({
      type: "object",
      required: ["seconds"],
      properties: { seconds: { type: "number" }, operation_id: { type: "string" } },
    });
    expect(tools.inspect_frame_alignment_uxp.parameters).toMatchObject({
      type: "object", additionalProperties: false, required: ["action", "frame_rate"],
      properties: {
        action: { type: "string", enum: ["align", "frame"] },
        frame_rate: { type: "number", minimum: 1, maximum: 240 },
        seconds: { type: "number", minimum: 0, maximum: 86400 },
        frame_count: { type: "integer", minimum: 0, maximum: 20736000 },
      },
    });
    expect(tools.calculate_tick_time_uxp.parameters).toMatchObject({
      type: "object", additionalProperties: false, required: ["operation", "base_ticks"],
      properties: {
        operation: { type: "string", enum: ["add", "subtract", "multiply", "divide"] },
        base_ticks: { type: "string", pattern: "^(?:0|-?[1-9][0-9]{0,17})$" },
        operand_ticks: { type: "string", pattern: "^(?:0|-?[1-9][0-9]{0,17})$" },
        factor: { type: "integer", minimum: -1_000_000, maximum: 1_000_000 },
      },
    });
    expect(tools.manage_sequence_preview_frame_uxp.parameters).toMatchObject({
      type: "object", additionalProperties: false, required: ["action", "sequence_id"],
      properties: {
        action: { type: "string", enum: ["inspect", "update"] },
        sequence_id: { type: "string", minLength: 1, maxLength: 128 },
        preview_width: { type: "integer", minimum: 16, maximum: 10240 },
        preview_height: { type: "integer", minimum: 16, maximum: 8192 },
        expected_snapshot: { type: "object", additionalProperties: false, required: ["project_guid", "sequence_id", "preview_width", "preview_height"] },
        confirm_set_preview_frame: { type: "boolean" }, operation_id: { type: "string" },
      },
    });
    expect(tools.inspect_source_media_provenance_uxp.parameters).toMatchObject({
      type: "object", additionalProperties: false, required: ["project_item_id"],
      properties: {
        project_item_id: { type: "string", minLength: 1, maxLength: 512 },
        include_media_file_path: { type: "boolean" },
        include_originating_project_path: { type: "boolean" },
      },
    });
    expect(tools.inspect_source_proxy_uxp.parameters).toMatchObject({
      type: "object", additionalProperties: false, required: ["project_item_id"],
      properties: {
        project_item_id: { type: "string", minLength: 1, maxLength: 512 },
        include_proxy_path: { type: "boolean" },
      },
    });
    expect(tools.create_empty_sequence_uxp.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["name", "confirm_non_undoable", "operation_id"],
      properties: {
        name: { type: "string" },
        confirm_non_undoable: { type: "boolean" },
        operation_id: { type: "string" },
      },
    });
    expect(tools.audit_object_masks_uxp.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        expected_project_guid: { type: "string", minLength: 1, maxLength: 512 },
        sequence_ids: {
          type: "array", minItems: 1, maxItems: 64, uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 512 },
        },
      },
    });
    expect(tools.inspect_unique_object_identity_uxp.parameters).toMatchObject({
      type: "object", additionalProperties: false,
      properties: {
        project_item_id: { type: "string", minLength: 1, maxLength: 512 },
        sequence_guid: { type: "string", minLength: 1, maxLength: 512 },
        expected_project_guid: { type: "string", minLength: 1, maxLength: 512 },
        expected_unique_id: { type: "string", minLength: 1, maxLength: 512 },
      },
      oneOf: [{ required: ["project_item_id"] }, { required: ["sequence_guid"] }],
    });
    expect(tools.inspect_track_item_identity_uxp.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["media_type", "track_index", "clip_index"],
      properties: {
        media_type: { type: "string", enum: ["video", "audio"] },
        track_index: { type: "integer", minimum: 0 },
        clip_index: { type: "integer", minimum: 0 },
        expected_sequence_guid: { type: "string", maxLength: 512 },
      },
    });
    expect(tools.inspect_effect_parameter_catalog_uxp.parameters).toMatchObject({
      type: "object", additionalProperties: false,
      required: ["media_type", "track_index", "clip_index", "component_index"],
      properties: {
        media_type: { enum: ["video", "audio"] },
        track_index: { maximum: 511 }, clip_index: { maximum: 511 }, component_index: { maximum: 511 },
        expected_sequence_guid: { maxLength: 512 }, expected_component_id: { maxLength: 512 },
      },
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
      scope: "project_item", project_item_id: "clip-17", filters: ["Comment", "Chapter"], include_web_links: true, include_color_values: true,
    });
    await tools.set_source_monitor_position_uxp.handler({ seconds: 12.5, operation_id: "source-1" });
    await tools.inspect_frame_alignment_uxp.handler({ action: "align", frame_rate: 24, seconds: 1.03 });
    await tools.calculate_tick_time_uxp.handler({ operation: "add", base_ticks: "1", operand_ticks: "2" });
    await tools.manage_sequence_preview_frame_uxp.handler({
      action: "update", sequence_id: "sequence-1", preview_width: 1920, preview_height: 1080,
      expected_snapshot: { project_guid: "project-1", sequence_id: "sequence-1", preview_width: 640, preview_height: 360 },
      confirm_set_preview_frame: true, operation_id: "preview-frame-1",
    });
    await tools.inspect_source_media_provenance_uxp.handler({
      project_item_id: "clip-17", include_media_file_path: true, include_originating_project_path: false,
    });
    await tools.inspect_source_proxy_uxp.handler({ project_item_id: "clip-17", include_proxy_path: true });
    await tools.create_empty_sequence_uxp.handler({
      name: "Empty Assembly", confirm_non_undoable: true, operation_id: "empty-1",
    });
    await tools.audit_object_masks_uxp.handler({
      expected_project_guid: "project-1", sequence_ids: ["sequence-2", "sequence-1"],
    });
    await tools.inspect_track_item_identity_uxp.handler({
      media_type: "video", track_index: 1, clip_index: 2, expected_sequence_guid: "sequence-1",
    });
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
      scope: "projectItem", projectItemId: "clip-17", filters: ["Comment", "Chapter"], includeWebLinks: true, includeColorValues: true,
    });
    expect(request).toHaveBeenNthCalledWith(4, "sourceMonitor.position.set", {
      seconds: 12.5, operationId: "source-1",
    });
    expect(request).toHaveBeenNthCalledWith(5, "time.frameAlignment.inspect", {
      action: "align", frameRate: 24, seconds: 1.03,
    });
    expect(request).toHaveBeenNthCalledWith(6, "time.tickArithmetic.inspect", {
      operation: "add", baseTicks: "1", operandTicks: "2",
    });
    expect(request).toHaveBeenNthCalledWith(7, "sequence.previewFrame.update", {
      sequenceId: "sequence-1", previewWidth: 1920, previewHeight: 1080, confirmSetPreviewFrame: true, operationId: "preview-frame-1",
      expectedSnapshot: { projectGuid: "project-1", sequenceId: "sequence-1", previewWidth: 640, previewHeight: 360 },
    });
    expect(request).toHaveBeenNthCalledWith(8, "source.provenance.inspect", {
      projectItemId: "clip-17", includeMediaFilePath: true, includeOriginatingProjectPath: false,
    });
    expect(request).toHaveBeenNthCalledWith(9, "source.proxy.inspect", {
      projectItemId: "clip-17", includeProxyPath: true,
    });
    expect(request).toHaveBeenNthCalledWith(10, "sequences.createEmpty", {
      name: "Empty Assembly", confirmNonUndoable: true, operationId: "empty-1",
    });
    expect(request).toHaveBeenNthCalledWith(11, "objectMask.audit", {
      expectedProjectGuid: "project-1", sequenceIds: ["sequence-2", "sequence-1"],
    });
    expect(request).toHaveBeenNthCalledWith(12, "trackItem.identity.inspect", {
      mediaType: "video", trackIndex: 1, clipIndex: 2, expectedSequenceGuid: "sequence-1",
    });
    expect(request).toHaveBeenNthCalledWith(13, "transcript.has", { projectItemName: "Interview A" });
    expect(request).toHaveBeenNthCalledWith(14, "interchange.aaf.export", {
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
