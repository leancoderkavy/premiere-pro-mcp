import { describe, expect, it, vi } from "vitest";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";
import { getUxpTools } from "../../src/tools/uxp.js";

function createTools(result: unknown = { accepted: true }) {
  const request = vi.fn().mockResolvedValue(result);
  const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
  return { request, tools: getUxpTools(bridge) };
}

describe("UXP tool optional argument mappings", () => {
  it("keeps an explicitly empty AAF options object distinct from omitted options", async () => {
    const { request, tools } = createTools({ path: "/exports/mix.aaf" });

    await expect(tools.export_aaf_uxp.handler({
      output_file_path: "/exports/mix.aaf",
      options: {},
    })).resolves.toEqual({
      success: true,
      data: { backend: "uxp", result: { path: "/exports/mix.aaf" } },
    });
    expect(request).toHaveBeenCalledWith("interchange.aaf.export", {
      outputFilePath: "/exports/mix.aaf",
      options: {},
    });
  });

  it("maps explicitly false AAF toggles and the optional operation id", async () => {
    const { request, tools } = createTools();

    await tools.export_aaf_uxp.handler({
      output_file_path: "/exports/final.aaf",
      operation_id: "aaf-optional-1",
      options: {
        mixdown_video: false,
        explode_to_mono: false,
        sample_rate: 48_000,
        bits_per_sample: 24,
        embed_audio: false,
        audio_file_format: "wav",
        trim_sources: false,
        handle_frames: 0,
        video_mixdown_preset_path: "/presets/none.epr",
        render_audio_effects: false,
        interleave_without_effects: false,
        preserve_parent_folder: false,
      },
    });

    expect(request).toHaveBeenCalledWith("interchange.aaf.export", {
      outputFilePath: "/exports/final.aaf",
      operationId: "aaf-optional-1",
      options: {
        mixdownVideo: false,
        explodeToMono: false,
        sampleRate: 48_000,
        bitsPerSample: 24,
        embedAudio: false,
        audioFileFormat: "wav",
        trimSources: false,
        handleFrames: 0,
        videoMixdownPresetPath: "/presets/none.epr",
        renderAudioEffects: false,
        interleaveWithoutEffects: false,
        preserveParentFolder: false,
      },
    });
  });

  it("normalizes a non-Error transcript export failure while mapping name selection", async () => {
    const { request, tools } = createTools();
    request.mockRejectedValueOnce("host disconnected");

    await expect(tools.get_clip_transcript_uxp.handler({
      project_item_name: "Interview A",
    })).resolves.toEqual({ success: false, error: "host disconnected" });
    expect(request).toHaveBeenCalledWith("transcript.export", {
      projectItemName: "Interview A",
    });
  });

  it("rejects an invalid transcript before generating a preview token", async () => {
    const { request, tools } = createTools({ projectItemId: "clip-9" });

    await expect(tools.preview_transcript_edit_uxp.handler({
      project_item_id: "clip-9",
      transcript_revision: `sha256:${"a".repeat(64)}`,
      deletions: [{ start_seconds: 1, end_seconds: 2 }],
    })).resolves.toEqual({
      success: false,
      error: "Premiere returned an empty transcript",
    });
    expect(request).toHaveBeenCalledWith("transcript.export", { projectItemId: "clip-9" });
  });

  it("normalizes a non-Error transcript preview export failure", async () => {
    const { request, tools } = createTools();
    request.mockRejectedValueOnce(null);

    await expect(tools.preview_transcript_edit_uxp.handler({
      transcript_revision: `sha256:${"b".repeat(64)}`,
      deletions: [{ start_seconds: 1, end_seconds: 2 }],
    })).resolves.toEqual({ success: false, error: "null" });
  });

  it("maps the explicit sequence marker scope to the wire protocol spelling", async () => {
    const { request, tools } = createTools();

    await tools.list_markers_uxp.handler({ scope: "sequence" });
    expect(request).toHaveBeenCalledWith("marker.list", { scope: "sequence" });
  });
});
