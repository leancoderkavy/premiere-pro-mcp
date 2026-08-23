import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getCompetitorGapTools } from "../../src/tools/competitor-gaps.js";

const bridgeOptions: BridgeOptions = { tempDir: "/tmp/competitor-gap-tests", timeoutMs: 5000 };
const mockedSendCommand = vi.mocked(sendCommand);

describe("competitor-gap default-profile tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exposes the requested competitor-parity names", () => {
    const tools = getCompetitorGapTools(bridgeOptions);
    expect(Object.keys(tools)).toEqual(expect.arrayContaining([
      "import_edl",
      "add_to_timeline_batch",
      "crop_clip",
      "setup_ducking",
      "validate_project_for_export",
      "read_sequence_captions",
      "set_clip_properties_batch",
      "detect_scene_edits",
    ]));
  });

  it("does not attempt an unattended EDL import", async () => {
    const result = await getCompetitorGapTools(bridgeOptions).import_edl.handler({ file_path: "D:/cuts/spot.edl" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("No mutation was attempted");
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("rejects ambiguous batch insert positions before writing", async () => {
    const result = await getCompetitorGapTools(bridgeOptions).add_to_timeline_batch.handler({
      clips: [
        { item_id: "a", track_index: 0, start_seconds: 4 },
        { item_id: "b", track_index: 0, start_seconds: 4 },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("shares video track");
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("preflights and reads back batch insertions", async () => {
    await getCompetitorGapTools(bridgeOptions).add_to_timeline_batch.handler({
      clips: [
        { item_id: "later", track_index: 1, start_seconds: 10, audio_track_index: 0 },
        { item_id: "first", track_index: 0, start_seconds: 2, audio_track_index: 0 },
      ],
    });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("Preflight every mutable dependency");
    expect(script).toContain("seq.insertClip");
    expect(script).toContain("actualStart");
    expect(script.indexOf('itemId: "first"')).toBeLessThan(script.indexOf('itemId: "later"'));
  });

  it("requires a meaningful crop change before adding an effect", async () => {
    const result = await getCompetitorGapTools(bridgeOptions).crop_clip.handler({ node_id: "video-1" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("requires at least one");
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("uses the QE crop catalog only when needed and verifies requested values", async () => {
    await getCompetitorGapTools(bridgeOptions).crop_clip.handler({ node_id: "video-1", left: 12, zoom: true });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain('__getQeEffectCatalog("video")');
    expect(script).toContain("addVideoEffect");
    expect(script).toContain('name: "Left"');
    expect(script).toContain("getValue");
  });

  it("rejects overlapping ducking windows before writing automation", async () => {
    const result = await getCompetitorGapTools(bridgeOptions).setup_ducking.handler({
      node_id: "music-1",
      ducking_windows: [
        { start_seconds: 1, end_seconds: 3, ducked_db: -20 },
        { start_seconds: 2, end_seconds: 4, ducked_db: -24 },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("must not overlap");
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("generates verified relative audio keyframes for non-overlapping windows", async () => {
    await getCompetitorGapTools(bridgeOptions).setup_ducking.handler({
      node_id: "music-1",
      base_db: -4,
      fade_seconds: 0.25,
      ducking_windows: [{ start_seconds: 2, end_seconds: 4, ducked_db: -28 }],
    });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("setup_ducking only supports audio");
    expect(script).toContain("setTimeVarying");
    expect(script).toContain("getValueAtTime");
    expect(script).toContain("duckingWindowCount");
  });

  it("generates a non-mutating export readiness audit", async () => {
    await getCompetitorGapTools(bridgeOptions).validate_project_for_export.handler({
      sequence_id: "edit-1",
      output_path: "D:/exports/final.mp4",
      preset_path: "D:/presets/h264.epr",
    });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("OFFLINE_MEDIA");
    expect(script).toContain("TIMELINE_GAPS");
    expect(script).toContain("readyForExport");
    expect(script).not.toContain("encodeSequence");
  });

  it("makes caption-read limitations explicit instead of treating no tracks as no captions", async () => {
    await getCompetitorGapTools(bridgeOptions).read_sequence_captions.handler({});
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("captionReadSupported");
    expect(script).toContain("do not prove this sequence has no captions");
  });

  it("fails property batch speed requests before touching any clip", async () => {
    const result = await getCompetitorGapTools(bridgeOptions).set_clip_properties_batch.handler({
      items: [{ node_id: "clip-1", speed: 150 }],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("speed");
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("preflights, verifies, and restores batch clip properties on mismatch", async () => {
    await getCompetitorGapTools(bridgeOptions).set_clip_properties_batch.handler({
      items: [{ node_id: "clip-1", opacity: 80, scale: 110, position_x: 400, rotation: 12 }],
    });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("No batch mutation was attempted");
    expect(script).toContain("restoreAll");
    expect(script).toContain("No partial batch is reported as verified");
  });

  it("withholds unsafe CEP scene detection without an authenticated UXP bridge", async () => {
    const result = await getCompetitorGapTools(bridgeOptions).detect_scene_edits.handler({
      mode: "create_markers",
      confirm_non_undoable: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("authenticated Premiere UXP bridge");
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("routes confirmed scene detection through UXP with a stable mode mapping", async () => {
    const request = vi.fn().mockResolvedValue({ detected: true });
    const bridge = { request } as any;
    const result = await getCompetitorGapTools(bridgeOptions, bridge).detect_scene_edits.handler({
      mode: "create_subclips",
      confirm_non_undoable: true,
      operation_id: "scene-42",
    });
    expect(result).toMatchObject({ success: true, data: { backend: "uxp" } });
    expect(request).toHaveBeenCalledWith("sceneEdit.detect", { mode: "createSubclips", operationId: "scene-42" });
  });

  it("rejects malformed or unsafe inputs before generating a CEP command", async () => {
    const tools = getCompetitorGapTools(bridgeOptions);

    await expect(tools.add_to_timeline_batch.handler({ clips: [] })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("clips must contain"),
    });
    await expect(tools.add_to_timeline_batch.handler({
      clips: Array.from({ length: 33 }, (_, index) => ({ item_id: `clip-${index}` })),
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("between 1 and 32") });
    await expect(tools.add_to_timeline_batch.handler({ clips: [{ item_id: "" }] })).resolves
      .toMatchObject({ success: false, error: expect.stringContaining("item_id") });
    await expect(tools.add_to_timeline_batch.handler({
      clips: [{ item_id: "clip", track_index: -1 }],
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("non-negative integer") });
    await expect(tools.crop_clip.handler({ node_id: "clip", right: 101 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("percentages") });
    await expect(tools.setup_ducking.handler({
      node_id: "music", fade_seconds: 0, ducking_windows: [],
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("positive fade_seconds") });
    await expect(tools.setup_ducking.handler({
      node_id: "music", ducking_windows: Array.from({ length: 33 }, () => ({ start_seconds: 0, end_seconds: 1, ducked_db: -12 })),
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("0–32 ducking windows") });
    await expect(tools.setup_ducking.handler({
      node_id: "music", ducking_windows: [{ start_seconds: 3, end_seconds: 3, ducked_db: -12 }],
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("greater than start_seconds") });
    await expect(tools.set_clip_properties_batch.handler({ items: [] })).resolves.toMatchObject({ success: false, error: expect.stringContaining("between 1 and 16") });
    await expect(tools.set_clip_properties_batch.handler({ items: [{ node_id: "" }] })).resolves
      .toMatchObject({ success: false, error: expect.stringContaining("node_id") });
    await expect(tools.set_clip_properties_batch.handler({
      items: [{ node_id: "clip" }, { node_id: "clip", opacity: 80 }],
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("must specify at least one") });
    await expect(tools.set_clip_properties_batch.handler({
      items: [{ node_id: "clip", opacity: -1 }],
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("invalid property") });
    await expect(tools.set_clip_properties_batch.handler({
      items: [{ node_id: "clip", opacity: 80 }, { node_id: "clip", opacity: 60 }],
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("duplicate node_id") });
    await expect(tools.detect_scene_edits.handler({ mode: "create_markers", confirm_non_undoable: false })).resolves
      .toMatchObject({ success: false, error: expect.stringContaining("confirm_non_undoable") });

    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("covers optional export, caption, and UXP-scene request variants", async () => {
    const tools = getCompetitorGapTools(bridgeOptions);
    await tools.validate_project_for_export.handler({ require_non_empty_timeline: false, check_gaps: false });
    expect(String(mockedSendCommand.mock.calls[0][0])).toContain("requireNonEmptyTimeline: false");
    expect(String(mockedSendCommand.mock.calls[0][0])).toContain("PRESET_NOT_PROVIDED");

    vi.clearAllMocks();
    await tools.read_sequence_captions.handler({ sequence_id: "sequence-1" });
    expect(String(mockedSendCommand.mock.calls[0][0])).toContain('__findSequence("sequence-1")');

    const rejectedBridge = { request: vi.fn().mockRejectedValue(new Error("UXP disconnected")) } as any;
    await expect(getCompetitorGapTools(bridgeOptions, rejectedBridge).detect_scene_edits.handler({
      mode: "apply_cuts", confirm_non_undoable: true,
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("UXP disconnected") });
    await expect(getCompetitorGapTools(bridgeOptions, { request: vi.fn() } as any).detect_scene_edits.handler({
      mode: "not-supported" as any, confirm_non_undoable: true,
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("Unsupported scene-edit mode") });

    const bridge = { request: vi.fn().mockResolvedValue({ applied: true }) } as any;
    await getCompetitorGapTools(bridgeOptions, bridge).detect_scene_edits.handler({
      mode: "create_markers", confirm_non_undoable: true,
    });
    expect(bridge.request).toHaveBeenCalledWith("sceneEdit.detect", { mode: "createMarkers" });
  });
});
