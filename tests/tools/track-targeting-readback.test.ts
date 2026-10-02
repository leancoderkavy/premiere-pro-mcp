import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";

const mockedSendCommand = vi.mocked(sendCommand);
const tools = getTrackTargetingTools({ tempDir: "/tmp/track-targeting", timeoutMs: 5000 } as BridgeOptions);
type Result = { success: boolean; error?: string; data?: Record<string, any> };
const run = (tool: { handler: (args: never) => Promise<unknown> }, args: Record<string, unknown>) => tool.handler(args as never) as Promise<Result>;

beforeEach(() => vi.clearAllMocks());

/** A clip parameter that clamps like Premiere 25.2.3 (setValue always returns true). */
function param(displayName: string, value: unknown, clamp?: [number, number], options: { ignore?: boolean } = {}) {
  let stored = value;
  return {
    displayName,
    setValue: (v: unknown) => {
      if (!options.ignore) stored = typeof v === "number" && clamp ? Math.min(clamp[1], Math.max(clamp[0], v)) : v;
      return true;
    },
    getValue: () => stored,
  };
}

function collection<T>(items: T[]) {
  return Object.assign({ numItems: items.length }, items);
}

type ClipOptions = { ignore?: boolean; localizedNames?: boolean };

function clipWith(nodeId: string, options: ClipOptions = {}) {
  const motion = [param("Rotation", 0, undefined, options), param("Uniform Scale", true, undefined, options)];
  const opacity = [param("Opacity", 100, [0, 100], options)];
  const level = [param("Level", 0.17782793939114, [0, 1], options)];
  const name = (english: string, localized: string) => (options.localizedNames ? localized : english);
  return {
    nodeId,
    name: `Clip ${nodeId}`,
    isSelected: () => true,
    remove: vi.fn(),
    components: collection([
      { displayName: name("Opacity", "Opacidad"), matchName: "AE.ADBE Opacity", properties: collection(opacity) },
      { displayName: name("Motion", "Movimiento"), matchName: "AE.ADBE Motion", properties: collection(motion) },
      { displayName: name("Volume", "Volumen"), matchName: "Internal Volume Stereo", properties: collection(level) },
    ]),
    params: { rotation: motion[0], uniform: motion[1], opacity: opacity[0], level: level[0] },
  };
}

type FakeClip = ReturnType<typeof clipWith>;

function host(clips: FakeClip[], extra: Record<string, unknown> = {}) {
  const track = { name: "Audio 1", clips: collection(clips) };
  const seq = {
    videoTracks: { numTracks: 0 },
    audioTracks: Object.assign({ numTracks: 1 }, [track]),
  };
  mockedSendCommand.mockImplementation(async (script: string) =>
    JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app: { project: { activeSequence: seq, ...extra } } }))));
  return { seq, track };
}

describe("clip parameter writes read the stored value back", () => {
  it.each([null, undefined, true, "40"])("does not certify invalid numeric post-read %s", async (value) => {
    const clip = clipWith("c1");
    let written = false;
    clip.params.opacity.setValue = () => { written = true; return true; };
    clip.params.opacity.getValue = () => written ? value : 100;
    host([clip]);
    await expect(run(tools.set_clip_opacity, { node_id: "c1", opacity: 40 })).resolves.toMatchObject({
      success: false, data: { outcome: "committed_unverified", verified: false, timelineChanged: null },
    });
  });

  it("preserves measured Spanish scalar property names", async () => {
    const clip = clipWith("c1", { localizedNames: true });
    clip.params.opacity.displayName = "Opacidad";
    clip.params.rotation.displayName = "Rotación";
    clip.params.level.displayName = "Nivel";
    host([clip]);
    await expect(run(tools.set_clip_opacity, { node_id: "c1", opacity: 40 })).resolves.toMatchObject({ success: true });
    await expect(run(tools.set_clip_rotation, { node_id: "c1", degrees: 45 })).resolves.toMatchObject({ success: true });
    await expect(run(tools.set_clip_volume, { node_id: "c1", volume_db: -6 })).resolves.toMatchObject({ success: true });
  });

  it("set_clip_opacity verifies and refuses values Premiere would clamp", async () => {
    const clip = clipWith("c1");
    host([clip]);
    await expect(run(tools.set_clip_opacity, { node_id: "c1", opacity: 40 })).resolves.toMatchObject({ success: true, data: { opacity: 40, verified: true } });
    await expect(run(tools.set_clip_opacity, { node_id: "c1", opacity: 150 })).resolves.toMatchObject({ success: false, error: "opacity must be a number from 0 to 100." });
    expect(clip.params.opacity.getValue()).toBe(40);
  });

  it("set_clip_opacity finds Opacity by match name on a localized host and reports an ignored write", async () => {
    host([clipWith("c1", { localizedNames: true })]);
    await expect(run(tools.set_clip_opacity, { node_id: "c1", opacity: 40 })).resolves.toMatchObject({ success: true });
    host([clipWith("c2", { ignore: true })]);
    await expect(run(tools.set_clip_opacity, { node_id: "c2", opacity: 40 })).resolves.toMatchObject({ success: false, data: { opacity: 100, requestedOpacity: 40 } });
  });

  it("set_clip_rotation verifies the stored rotation", async () => {
    host([clipWith("c1")]);
    await expect(run(tools.set_clip_rotation, { node_id: "c1", degrees: 720 })).resolves.toMatchObject({ success: true, data: { degrees: 720, verified: true } });
    host([clipWith("c2", { ignore: true })]);
    await expect(run(tools.set_clip_rotation, { node_id: "c2", degrees: 45 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("stored Rotation 0") });
  });

  it("set_clip_volume retains the clamping receipt and reads applied levels back", async () => {
    const clip = clipWith("c1");
    host([clip]);
    await expect(run(tools.set_clip_volume, { node_id: "c1", volume_db: 20 })).resolves.toMatchObject({ success: true, data: { requestedVolumeDb: 20, volumeDb: 15, clamped: true } });
    const result = await run(tools.set_clip_volume, { node_id: "c1", volume_db: -6 });
    expect(result).toMatchObject({ success: true, data: { verified: true } });
    expect(result.data?.volumeDb).toBeCloseTo(-6, 6);
    expect(clip.params.level.getValue()).toBeCloseTo(Math.pow(10, -21 / 20), 10);
  });

  it("set_clips_volume reports clips whose level did not read back and validates indexes", async () => {
    host([clipWith("c1"), clipWith("c2", { ignore: true })]);
    await expect(run(tools.set_clips_volume, { track_index: 0, volume_db: -3 })).resolves.toMatchObject({
      success: false,
      data: { applied: 1, mismatched: [{ clipIndex: 1 }], timelineChanged: true },
    });
    await expect(run(tools.set_clips_volume, { track_index: 0, volume_db: -3, clip_indices: [5] })).resolves.toMatchObject({ success: false, error: expect.stringContaining("Clip index 5 is out of range") });
    await expect(run(tools.set_clips_volume, { track_index: 0, volume_db: -3, clip_indices: [0.5] })).resolves.toMatchObject({ success: false, error: "clip_indices must be non-negative integers." });
  });

  it("set_uniform_scale reads the checkbox back", async () => {
    const clip = clipWith("c1");
    host([clip]);
    await expect(run(tools.set_uniform_scale, { node_id: "c1", uniform: false })).resolves.toMatchObject({ success: true, data: { uniformScale: false, verified: true } });
    host([clipWith("c2", { ignore: true })]);
    await expect(run(tools.set_uniform_scale, { node_id: "c2", uniform: false })).resolves.toMatchObject({ success: false, error: "Premiere kept Uniform Scale at true." });
  });
});

describe("track, timeline and project writes read back", () => {
  it("rename_track fails when the name does not stick", async () => {
    const { track } = host([]);
    await expect(run(tools.rename_track, { track_type: "audio", track_index: 0, name: 'Host "A"' })).resolves.toMatchObject({ success: true, data: { newName: 'Host "A"', verified: true } });
    Object.defineProperty(track, "name", { get: () => "Audio 1", set: () => {} });
    await expect(run(tools.rename_track, { track_type: "audio", track_index: 0, name: "Guest" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("kept the track name Audio 1") });
  });

  it("remove_selected_clips refuses when nothing is selected and reports clips that stay", async () => {
    const clip = clipWith("c1");
    clip.isSelected = () => false;
    host([clip]);
    await expect(run(tools.remove_selected_clips, {})).resolves.toMatchObject({ success: false, error: "No clips are selected; nothing was removed." });
    host([clipWith("c2")]);
    await expect(run(tools.remove_selected_clips, {})).resolves.toMatchObject({ success: false, data: { removed: 0, remainingNodeIds: ["c2"] } });
  });

  it("remove_selected_clips verifies removed clips are gone", async () => {
    const clips = [clipWith("c1")];
    const { track } = host(clips);
    clips[0].remove = vi.fn(() => { (track.clips as unknown as { numItems: number }).numItems = 0; });
    await expect(run(tools.remove_selected_clips, {})).resolves.toMatchObject({ success: true, data: { verified: true } });
  });

  it("move_items_to_bin moves nothing when an item is missing and checks treePath", async () => {
    const bin = { nodeId: "bin", name: "Footage", type: 2, treePath: "\\Proj.prproj\\Footage", children: collection([]) };
    const item = {
      nodeId: "i1", name: "a.wav", type: 1, treePath: "\\Proj.prproj\\a.wav",
      moveBin: vi.fn((target: { treePath: string }) => { item.treePath = `${target.treePath}\\a.wav`; }),
    };
    const stuck = { nodeId: "i2", name: "b.wav", type: 1, treePath: "\\Proj.prproj\\b.wav", moveBin: vi.fn() };
    host([], { rootItem: { children: collection([bin, item, stuck]) } });
    await expect(run(tools.move_items_to_bin, { item_ids: ["i1", "nope"], target_bin: "Footage" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("not found: nope. Nothing was moved.") });
    expect(item.moveBin).not.toHaveBeenCalled();
    await expect(run(tools.move_items_to_bin, { item_ids: ["i1"], target_bin: "Footage" })).resolves.toMatchObject({ success: true, data: { moved: 1, verified: true } });
    await expect(run(tools.move_items_to_bin, { item_ids: ["i2"], target_bin: "Footage" })).resolves.toMatchObject({ success: false, data: { notMoved: ["b.wav"] } });
  });

  it("clear_item_in_out does not certify Out without independent media duration", async () => {
    let inS = 1;
    let outS = 3;
    const item = {
      nodeId: "i1", name: "a.wav", type: 1,
      getInPoint: () => ({ seconds: inS }), getOutPoint: () => ({ seconds: outS }),
      clearInPoint: () => { inS = 0; }, clearOutPoint: () => { outS = 6; },
    };
    host([], { rootItem: { children: collection([item]) } });
    await expect(run(tools.clear_item_in_out, { item_id: "i1" })).resolves.toMatchObject({ success: false, data: { inSeconds: 0, outSeconds: 6, verified: false, outcome: "committed_unverified" } });
    outS = 3;
    item.clearOutPoint = () => {};
    await expect(run(tools.clear_item_in_out, { item_id: "i1", clear_in: false })).resolves.toMatchObject({ success: false, data: { verified: false, outcome: "committed_unverified", outSeconds: 3 } });
    inS = 2;
    item.clearInPoint = () => {};
    await expect(run(tools.clear_item_in_out, { item_id: "i1", clear_out: false })).resolves.toMatchObject({ success: false, error: expect.stringContaining("kept the In point at 2s") });
  });
});
