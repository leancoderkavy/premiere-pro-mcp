import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import * as acorn from "acorn";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/tools/media-evidence.js", () => ({ probeMediaDurationTicks: vi.fn() }));
vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn(),
  sendRawCommand: vi.fn(),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { probeMediaDurationTicks } from "../../src/tools/media-evidence.js";
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getTimelineTools } from "../../src/tools/timeline.js";

const mockedSendCommand = vi.mocked(sendCommand);
const TICKS = 254016000000;
const FRAME = TICKS / 25;
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/trim-hold", timeoutMs: 5000 };
const timeline = getTimelineTools(bridgeOptions);
type Value = number | number[] | string;
type Result = { success: boolean; error?: string; data?: Record<string, any> };

const ticksOf = (value: unknown) => parseFloat(typeof value === "object" && value ? String((value as { ticks: string }).ticks) : String(value));
const secs = (t: number) => Math.round((t / TICKS) * 1000) / 1000;

/** Linear keyframe model in media (source) ticks; holds before the first and after the last key. */
function param(name: string, keys: Array<[number, Value]>, options: { ignoreWrites?: boolean; sampleThrows?: boolean } = {}) {
  const store = keys.map(([seconds, value]) => ({ t: seconds * TICKS, v: value }));
  const sorted = () => store.sort((a, b) => a.t - b.t);
  const valueAt = (t: number): Value => {
    const k = sorted();
    if (t <= k[0].t) return k[0].v;
    const last = k[k.length - 1];
    if (t >= last.t) return last.v;
    let i = 0;
    while (k[i + 1].t < t) i++;
    const a = k[i], b = k[i + 1], f = (t - a.t) / (b.t - a.t);
    if (typeof a.v === "string") return a.v;
    if (Array.isArray(a.v)) return a.v.map((x, n) => x + ((b.v as number[])[n] - x) * f);
    return a.v + ((b.v as number) - a.v) * f;
  };
  return {
    displayName: name,
    store,
    isTimeVarying: () => store.length > 0,
    areKeyframesSupported: () => true,
    getKeys: () => sorted().map((k) => ({ ticks: String(Math.round(k.t)) })),
    getValueAtTime: (time: unknown) => { if (options.sampleThrows) throw new Error("no sample"); return valueAt(ticksOf(time)); },
    addKey: (time: unknown) => { const t = ticksOf(time); if (!store.some((k) => Math.abs(k.t - t) < 1)) store.push({ t, v: valueAt(t) }); },
    setValueAtKey: (time: unknown, value: Value) => {
      if (options.ignoreWrites) return;
      const k = store.find((key) => Math.abs(key.t - ticksOf(time)) < 1);
      if (k) k.v = Array.isArray(value) ? Array.from(value) : value;
    },
    keyTimes: () => sorted().map((k) => secs(k.t)),
  };
}
type Param = ReturnType<typeof param>;

function makeClip(id: string, start: number, end: number, params: Param[]) {
  let s = start * TICKS; let e = end * TICKS; let i = start * TICKS; let o = end * TICKS;
  const properties: Record<string | number, unknown> = { numItems: params.length };
  params.forEach((p, k) => { properties[k] = p; });
  const clip = {
    nodeId: id,
    name: id,
    group: null as unknown[] | null,
    get start() { return { ticks: String(Math.round(s)) }; }, set start(v: unknown) { s = ticksOf(v); },
    get end() { return { ticks: String(Math.round(e)) }; }, set end(v: unknown) { e = ticksOf(v); },
    get inPoint() { return { ticks: String(Math.round(i)) }; }, set inPoint(v: unknown) { i = ticksOf(v); },
    get outPoint() { return { ticks: String(Math.round(o)) }; }, set outPoint(v: unknown) { o = ticksOf(v); },
    get duration() { return { ticks: String(Math.round(e - s)) }; },
    components: params.length ? { numItems: 1, 0: { displayName: "Effect", properties } } : { numItems: 0 },
    projectItem: { getMediaPath: () => "/media/a.mp4" },
    getSpeed: () => 1,
    isSpeedReversed: () => false,
    getLinkedItems() {
      if (!clip.group) return null;
      const list: Record<string | number, unknown> = { numItems: clip.group.length };
      clip.group.forEach((m, k) => { list[k] = m; });
      return list;
    },
    snapshot: () => [secs(s), secs(e), secs(i), secs(o)],
  };
  return clip;
}

/** V1/A1 linked clips 10-30 and 30-60 (source time = timeline time). */
function host(videoParams: Param[][], audioParams: Param[][] = [[], []]) {
  const video = [makeClip("v0", 10, 30, videoParams[0] ?? []), makeClip("v1", 30, 60, videoParams[1] ?? [])];
  const audio = [makeClip("a0", 10, 30, audioParams[0] ?? []), makeClip("a1", 30, 60, audioParams[1] ?? [])];
  video.forEach((v, k) => { v.group = [v, audio[k]]; audio[k].group = [v, audio[k]]; });
  const collection = (list: unknown[]) => new Proxy({}, { get: (_t, key) => (key === "numItems" ? list.length : list[Number(key)]) });
  const seq = {
    sequenceID: "seq",
    timebase: String(FRAME),
    videoTracks: { numTracks: 1, 0: { transitions: { numItems: 0 }, clips: collection(video), isLocked: () => false } },
    audioTracks: { numTracks: 1, 0: { transitions: { numItems: 0 }, clips: collection(audio), isLocked: () => false } },
  };
  const context = {
    app: { project: { documentID: "project", activeSequence: seq, sequences: { numSequences: 1, 0: seq } } },
    Time: function Time(this: { ticks: string }) { this.ticks = "0"; },
  };
  mockedSendCommand.mockImplementation(async (script: string) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, context))));
  return { video, audio };
}

beforeEach(() => { vi.clearAllMocks(); vi.mocked(probeMediaDurationTicks).mockResolvedValue(100 * TICKS); });

describe("trim_clip keyframe_policy hold_last_value", () => {
  it("trimming into an animation keys the new edge with the value it had there", async () => {
    const opacity = param("Opacity", [[12, 0], [20, 100]]);
    const { video } = host([[opacity]]);
    const result = await timeline.trim_clip.handler({ node_id: "v0", new_in_seconds: 15, keyframe_policy: "hold_last_value", include_linked: false }) as Result;
    expect(result.success, result.error).toBe(true);
    expect(video[0].snapshot()).toEqual([15, 30, 15, 30]);
    expect(opacity.keyTimes()).toEqual([12, 15, 20]);
    expect(opacity.getValueAtTime({ ticks: String(15 * TICKS) })).toBeCloseTo(37.5);
    expect(result.data).toMatchObject({
      verified: true,
      keyframePolicy: "hold_last_value",
      keyframesVerified: true,
      keyframeHold: { edge: "in", operation: "trim_into", newEdgeSourceSeconds: 15, verified: true, skipped: [] },
    });
    expect(result.data?.keyframeHold.params).toEqual([expect.objectContaining({ name: "Opacity", mode: "key_new_edge", keysWritten: 1, verified: true, expected: 37.5 })]);
  });

  it("extending past hidden keys anchors old and new edge so the revealed range holds flat", async () => {
    const level = param("Level", [[50, 10], [70, 90]]);
    const position = param("Position", [[50, [0, 0]], [70, [200, 100]]]);
    const { video } = host([[], [level, position]]);
    const result = await timeline.trim_clip.handler({ node_id: "v1", new_out_seconds: 62, keyframe_policy: "hold_last_value", include_linked: false }) as Result;
    expect(result.success, result.error).toBe(true);
    expect(video[1].snapshot()).toEqual([30, 62, 30, 62]);
    const oldEdge = 60 - 1 / 25, newEdge = 62 - 1 / 25;
    const held = 10 + (oldEdge - 50) / 20 * 80;
    expect(level.keyTimes()).toEqual([50, secs(oldEdge * TICKS), secs(newEdge * TICKS), 70]);
    for (const t of [oldEdge, 61, newEdge]) expect(level.getValueAtTime({ ticks: String(Math.round(t * TICKS)) })).toBeCloseTo(held, 6);
    expect(position.getValueAtTime({ ticks: String(Math.round(newEdge * TICKS)) })).toEqual([expect.closeTo((oldEdge - 50) / 20 * 200, 6), expect.closeTo((oldEdge - 50) / 20 * 100, 6)]);
    expect(result.data?.keyframeHold).toMatchObject({ edge: "out", operation: "extend", verified: true });
    expect(result.data?.keyframeHold.params.map((p: any) => [p.name, p.mode, p.keysWritten, p.verified])).toEqual([["Level", "anchor_old_and_new_edge", 2, true], ["Position", "anchor_old_and_new_edge", 2, true]]);
  });

  it("an extension with no keys beyond the old edge already holds and writes nothing", async () => {
    const level = param("Level", [[40, 5], [50, 10]]);
    host([[], [level]]);
    const result = await timeline.trim_clip.handler({ node_id: "v1", new_out_seconds: 62, keyframe_policy: "hold_last_value", include_linked: false }) as Result;
    expect(result.success, result.error).toBe(true);
    expect(level.keyTimes()).toEqual([40, 50]);
    expect(result.data?.keyframeHold.params).toEqual([expect.objectContaining({ mode: "already_held", keysWritten: 0, verified: true })]);
  });

  it("holds the linked partner's own animation too", async () => {
    const opacity = param("Opacity", [[12, 0], [20, 100]]);
    const volume = param("Volume", [[10, -20], [30, 0]]);
    const { audio } = host([[opacity]], [[volume]]);
    const result = await timeline.trim_clip.handler({ node_id: "v0", new_in_seconds: 15, keyframe_policy: "hold_last_value" }) as Result;
    expect(result.success, result.error).toBe(true);
    expect(audio[0].snapshot()).toEqual([15, 30, 15, 30]);
    expect(volume.keyTimes()).toEqual([10, 15, 30]);
    expect(volume.getValueAtTime({ ticks: String(15 * TICKS) })).toBeCloseTo(-15);
    expect(result.data?.linkedPartnersEdited).toEqual([{ nodeId: "a0", trackType: "audio", trackIndex: 0, verified: true }]);
  });

  it("reports committed_unverified when a held key does not read back", async () => {
    const stubborn = param("Opacity", [[12, 0], [20, 100]]);
    const write = stubborn.setValueAtKey;
    stubborn.setValueAtKey = (time: unknown, value: Value) => write(time, (value as number) + 5); // host stores a drifted value
    const { video } = host([[stubborn]]);
    const result = await timeline.trim_clip.handler({ node_id: "v0", new_in_seconds: 15, keyframe_policy: "hold_last_value", include_linked: false }) as Result;
    expect(video[0].snapshot()).toEqual([15, 30, 15, 30]);
    expect(result.data).toMatchObject({ verified: false, outcome: "committed_unverified", keyframesVerified: false, keyframeHold: { verified: false } });
    expect(result.data?.warning).toMatch(/did not read back/);
  });

  it("reports committed_unverified when the partner's held key does not read back", async () => {
    const volume = param("Volume", [[10, -20], [30, 0]], { ignoreWrites: true });
    volume.addKey = () => { throw new Error("locked"); };
    host([[]], [[volume]]);
    const result = await timeline.trim_clip.handler({ node_id: "v0", new_in_seconds: 15, keyframe_policy: "hold_last_value" }) as Result;
    expect(result.data).toMatchObject({ verified: false, outcome: "committed_unverified", linkedPartnersEdited: [{ nodeId: "a0", verified: false }] });
  });

  it("skips non-numeric parameters that need no key, and lists them", async () => {
    const label = param("Label", [[20, "intro"]]);
    host([[label]]);
    const result = await timeline.trim_clip.handler({ node_id: "v0", new_in_seconds: 15, keyframe_policy: "hold_last_value", include_linked: false }) as Result;
    expect(result.success, result.error).toBe(true);
    expect(result.data?.keyframeHold).toMatchObject({ verified: true, params: [], skipped: [expect.objectContaining({ name: "Label", mode: "already_held", reason: expect.stringContaining("non-numeric") })] });
  });

  it.each([
    ["a key would be revealed by the extension", () => [[], [param("Level", [[50, 10], [61, 50], [70, 90]])]], { node_id: "v1", new_out_seconds: 62 }, /range the extension would reveal/],
    ["a non-numeric value would need a key", () => [[param("Label", [[12, "a"], [20, "b"]])]], { node_id: "v0", new_in_seconds: 15 }, /non-numeric value cannot be held/],
    ["a value cannot be sampled", () => [[param("Opacity", [[12, 0], [20, 100]], { sampleThrows: true })]], { node_id: "v0", new_in_seconds: 15 }, /could not be sampled/],
  ] as const)("refuses before mutation when %s", async (_label, params, args, message) => {
    const built = params() as Param[][];
    const { video } = host(built);
    const before = video.map((clip) => clip.snapshot());
    const keysBefore = built.flat().map((p) => p.keyTimes());
    const result = await timeline.trim_clip.handler({ ...args, keyframe_policy: "hold_last_value", include_linked: false }) as Result;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(message);
    expect(result.error).toContain("Nothing was changed");
    expect(video.map((clip) => clip.snapshot())).toEqual(before);
    expect(built.flat().map((p) => p.keyTimes())).toEqual(keysBefore);
  });

  it("refuses the whole linked trim when the partner cannot be held", async () => {
    const { video, audio } = host([[param("Opacity", [[12, 0], [20, 100]])]], [[param("Volume", [[12, 0], [20, 1]], { sampleThrows: true })]]);
    const result = await timeline.trim_clip.handler({ node_id: "v0", new_in_seconds: 15, keyframe_policy: "hold_last_value" }) as Result;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/linked audio clip/);
    expect(video[0].snapshot()).toEqual([10, 30, 10, 30]);
    expect(audio[0].snapshot()).toEqual([10, 30, 10, 30]);
  });

  it("generates ES3 ExtendScript and rejects unknown policies", async () => {
    mockedSendCommand.mockResolvedValue({ success: true, data: { mediaPath: "/media/a.mp4", projectId: "p", sequenceId: "s" } });
    await timeline.trim_clip.handler({ node_id: "v0", new_in_seconds: 15, keyframe_policy: "hold_last_value" });
    const script = String(mockedSendCommand.mock.calls.at(-1)?.[0]);
    expect(script).toContain("__planHoldKeyframes");
    expect(() => acorn.parse(`${getHelpersSource()}\n${script}`, { ecmaVersion: 3, allowReturnOutsideFunction: true })).not.toThrow();
    await expect(timeline.trim_clip.handler({ node_id: "v0", new_in_seconds: 15, keyframe_policy: "hold" as never })).resolves.toMatchObject({ success: false, error: expect.stringContaining("hold_last_value") });
  });
});

describe("trim_clip keyframe_policy reject uses media-time keyframes", () => {
  // Clip v0 has source in 10 s, so its keys at 12 s and 20 s are media time.
  it("allows a trim that keeps every key inside the visible media window", async () => {
    const opacity = param("Opacity", [[12, 0], [20, 100]]);
    const { video } = host([[opacity]]);
    const result = await timeline.trim_clip.handler({ node_id: "v0", new_out_seconds: 25, include_linked: false }) as Result;
    expect(result.success, result.error).toBe(true);
    expect(video[0].snapshot()).toEqual([10, 25, 10, 25]);
  });

  it("refuses a trim that leaves a key after the new out point", async () => {
    const opacity = param("Opacity", [[12, 0], [20, 100]]);
    const { video } = host([[opacity]]);
    const result = await timeline.trim_clip.handler({ node_id: "v0", new_out_seconds: 18, include_linked: false }) as Result;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/1 effect keyframe\(s\) would remain outside/);
    expect(video[0].snapshot()).toEqual([10, 30, 10, 30]);
  });

  it("refuses a trim that leaves a key before the new in point", async () => {
    const opacity = param("Opacity", [[12, 0], [20, 100]]);
    const { video } = host([[opacity]]);
    const result = await timeline.trim_clip.handler({ node_id: "v0", new_in_seconds: 15, include_linked: false }) as Result;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/1 effect keyframe\(s\) would remain outside/);
    expect(video[0].snapshot()).toEqual([10, 30, 10, 30]);
  });
});
