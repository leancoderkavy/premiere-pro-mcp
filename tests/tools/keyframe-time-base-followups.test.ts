import { beforeEach, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { getAudioTools } from "../../src/tools/audio.js";
import { getCompetitorGapTools } from "../../src/tools/competitor-gaps.js";
import { sendCommand } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
const send = vi.mocked(sendCommand);
const audioTools = getAudioTools({ tempDir: "/tmp/keyframe-followups", timeoutMs: 5000 });
const gapTools = getCompetitorGapTools({ tempDir: "/tmp/keyframe-followups", timeoutMs: 5000 });
const TICKS = 254016000000;
const toTicks = (seconds: number) => String(Math.round(seconds * TICKS));

function host(options: { speed?: number; reverse?: boolean; missingKeys?: boolean; nodeId?: string } = {}) {
  const values = new Map<number, number>();
  const prop = {
    displayName: "Level",
    setTimeVarying() {},
    addKey(time: { ticks: string }) { if (!options.missingKeys) values.set(Number(time.ticks), 1); },
    setValueAtKey(time: { ticks: string }, value: number) { if (!options.missingKeys) values.set(Number(time.ticks), value); },
    setValueAtTime(time: { ticks: string }, value: number) { values.set(Number(time.ticks), value); },
    getValueAtTime(time: { ticks: string }) { return values.get(Number(time.ticks)) ?? NaN; },
    getKeys() { return Array.from(values.keys()).sort((a, b) => a - b).map((ticks) => ({ ticks: String(ticks) })); },
  };
  const components = Object.assign([{ displayName: "Volume", matchName: "audioVolume", properties: Object.assign([prop], { numItems: 1 }) }], { numItems: 1 });
  const clip = {
    nodeId: options.nodeId ?? 'music"\\\u2028', name: "Music", start: { ticks: toTicks(25) }, end: { ticks: toTicks(35) },
    inPoint: { ticks: toTicks(30) }, outPoint: { ticks: toTicks(40) }, duration: { ticks: toTicks(10) },
    components, getSpeed: () => options.speed ?? 1, isSpeedReversed: () => options.reverse ?? false,
  };
  const track = { clips: Object.assign([clip], { numItems: 1 }) };
  const sequence = { videoTracks: Object.assign([], { numTracks: 0 }), audioTracks: Object.assign([track], { numTracks: 1 }) };
  function Time(this: { ticks: string }) { this.ticks = "0"; }
  send.mockImplementation(async (script) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
    app: { project: { activeSequence: sequence } }, Time,
  }))));
  return {
    clip,
    prop,
    times: () => Array.from(values.keys()).sort((a, b) => a - b).map((ticks) => ticks / TICKS),
    levelAtMedia: (seconds: number) => values.get(Math.round(seconds * TICKS)),
  };
}

beforeEach(() => vi.resetAllMocks());

it("stores add_audio_keyframes at the source in-point plus each clip offset", async () => {
  const h = host();
  const result = await audioTools.add_audio_keyframes.handler({ node_id: h.clip.nodeId, keyframes: [{ time_seconds: 2, level_db: -6 }] });
  expect(result).toMatchObject({ success: true, data: { verified: true, outcome: "verified" } });
  expect(h.times()).toEqual([32]);
  expect(h.levelAtMedia(32)).toBeCloseTo(0.08912509381337455, 12);
});

it("uses Premiere's measured normalized Level mapping for 0 and -6 dB keys", async () => {
  const h = host();
  expect(await audioTools.add_audio_keyframes.handler({ node_id: h.clip.nodeId, keyframes: [{ time_seconds: 1, level_db: 0 }, { time_seconds: 2, level_db: -6 }] })).toMatchObject({ success: true });
  expect(h.levelAtMedia(31)).toBeCloseTo(0.1778279410038923, 12);
  expect(h.levelAtMedia(32)).toBeCloseTo(0.08912509381337455, 12);
});

it("escapes audio clip IDs before building ExtendScript", async () => {
  const nodeId = 'music"\\\n\u2028';
  const h = host({ nodeId });
  expect(await audioTools.add_audio_keyframes.handler({ node_id: nodeId, keyframes: [{ time_seconds: 2, level_db: -6 }] })).toMatchObject({ success: true });
  expect(send.mock.calls[0][0]).toContain('\\u2028');
  expect(send.mock.calls[0][0]).not.toContain(nodeId);
  expect(h.times()).toEqual([32]);
});

it("stores setup_ducking keys in media time for a trimmed audio clip", async () => {
  const h = host();
  const result = await gapTools.setup_ducking.handler({ node_id: h.clip.nodeId, ducking_windows: [{ start_seconds: 2, end_seconds: 4, ducked_db: -6 }], fade_seconds: 0.2 });
  expect(result).toMatchObject({ success: true, data: { verified: true, duckingWindowCount: 1 } });
  expect(h.times()).toEqual([30, 31.8, 32, 34, 34.2, 40]);
  expect(h.levelAtMedia(30)).toBeCloseTo(0.1778279410038923, 12);
  expect(h.levelAtMedia(32)).toBeCloseTo(0.08912509381337455, 12);
  expect(h.levelAtMedia(34.2)).toBeCloseTo(0.1778279410038923, 12);
});

it.each(["speed change", "reverse"])("refuses audio key writes on a %s", async (kind) => {
  const h = host(kind === "reverse" ? { reverse: true } : { speed: 2 });
  const result = await audioTools.add_audio_keyframes.handler({ node_id: h.clip.nodeId, keyframes: [{ time_seconds: 2, level_db: -6 }] });
  expect(result).toMatchObject({ success: false, error: expect.stringContaining("speed change or is reversed") });
  expect(h.times()).toEqual([]);
});

it.each(["speed change", "reverse"])("refuses ducking key writes on a %s", async (kind) => {
  const h = host(kind === "reverse" ? { reverse: true } : { speed: 2 });
  const result = await gapTools.setup_ducking.handler({ node_id: h.clip.nodeId, ducking_windows: [{ start_seconds: 2, end_seconds: 4, ducked_db: -20 }] });
  expect(result).toMatchObject({ success: false, error: expect.stringContaining("speed change or is reversed") });
  expect(h.times()).toEqual([]);
});

it.each([
  { label: "empty", keyframes: [] },
  { label: "nonfinite time", keyframes: [{ time_seconds: Number.NaN, level_db: 0 }] },
  { label: "negative time", keyframes: [{ time_seconds: -1, level_db: 0 }] },
  { label: "nonfinite level", keyframes: [{ time_seconds: 2, level_db: Number.POSITIVE_INFINITY }] },
  { label: "level above Premiere maximum", keyframes: [{ time_seconds: 2, level_db: 16 }] },
])("rejects $label audio key batches before dispatch", async ({ keyframes }) => {
  const h = host();
  const result = await audioTools.add_audio_keyframes.handler({ node_id: h.clip.nodeId, keyframes } as never);
  expect(result).toMatchObject({ success: false });
  expect(send).not.toHaveBeenCalled();
  expect(h.times()).toEqual([]);
});

it("rejects ducking levels above Premiere's +15 dB maximum before dispatch", async () => {
  const h = host();
  expect(await gapTools.setup_ducking.handler({ node_id: h.clip.nodeId, base_db: 16, ducking_windows: [] })).toMatchObject({ success: false });
  expect(await gapTools.setup_ducking.handler({ node_id: h.clip.nodeId, ducking_windows: [{ start_seconds: 2, end_seconds: 4, ducked_db: 16 }] })).toMatchObject({ success: false });
  expect(send).not.toHaveBeenCalled();
});

it("rejects a key beyond clip duration in the host script without writing", async () => {
  const h = host();
  const result = await audioTools.add_audio_keyframes.handler({ node_id: h.clip.nodeId, keyframes: [{ time_seconds: 11, level_db: 0 }] });
  expect(result).toMatchObject({ success: false, error: expect.stringContaining("exceeds clip duration") });
  expect(send).toHaveBeenCalledTimes(1);
  expect(h.times()).toEqual([]);
});

it("reports uncertainty when requested key storage cannot be read back", async () => {
  const h = host({ missingKeys: true });
  const result = await audioTools.add_audio_keyframes.handler({ node_id: h.clip.nodeId, keyframes: [{ time_seconds: 2, level_db: -6 }] });
  expect(result).toMatchObject({ success: false, data: { outcome: "committed_unverified", verified: false } });
  expect(h.times()).toEqual([]);
});

it("reports setup_ducking readback mismatches", async () => {
  const h = host({ missingKeys: true });
  const result = await gapTools.setup_ducking.handler({ node_id: h.clip.nodeId, ducking_windows: [{ start_seconds: 2, end_seconds: 4, ducked_db: -20 }] });
  expect(result).toMatchObject({ success: false, data: { outcome: "committed_unverified", verified: false } });
});


it.each([null, false, "", "0", NaN, 0])("does not verify quiet audio from a nonmatching Level readback %s", async (value) => {
  const h = host();
  h.prop.getValueAtTime = () => value as number;
  const result = await audioTools.add_audio_keyframes.handler({ node_id: h.clip.nodeId, keyframes: [{ time_seconds: 2, level_db: -140 }] });
  expect(result.success).toBe(false);
  expect(result.data).toMatchObject({ verified: false, mutationAttempted: true, timelineChanged: null });
});

it("rejects duplicate quantized key times before invoking the host", async () => {
  const h = host();
  const result = await audioTools.add_audio_keyframes.handler({ node_id: h.clip.nodeId, keyframes: [{ time_seconds: 2, level_db: 0 }, { time_seconds: 2, level_db: -6 }] });
  expect(result.success).toBe(false);
  expect(send).not.toHaveBeenCalled();
});

it("rechecks early audio keys after the entire batch is written", async () => {
  const h = host();
  const write = h.prop.setValueAtKey;
  h.prop.setValueAtKey = (time, value) => {
    write(time, value);
    if (Number(time.ticks) === 33 * TICKS) write({ ticks: toTicks(32) }, 0);
  };
  const result = await audioTools.add_audio_keyframes.handler({ node_id: h.clip.nodeId, keyframes: [{ time_seconds: 2, level_db: -6 }, { time_seconds: 3, level_db: 0 }] });
  expect(result.success).toBe(false);
});

it("refuses unreadable initial key storage without changing Level", async () => {
  const h = host();
  h.prop.getKeys = () => null as never;
  const mutate = vi.spyOn(h.prop, "setTimeVarying");
  const result = await audioTools.add_audio_keyframes.handler({ node_id: h.clip.nodeId, keyframes: [{ time_seconds: 2, level_db: 0 }] });
  expect(result.success).toBe(false);
  expect(mutate).not.toHaveBeenCalled();
});

it("reports uncertainty when enabling keyframes throws after mutation", async () => {
  const h = host();
  h.prop.setTimeVarying = () => { throw new Error("host threw after changing mode"); };
  const result = await gapTools.setup_ducking.handler({ node_id: h.clip.nodeId, ducking_windows: [{ start_seconds: 2, end_seconds: 4, ducked_db: -12 }] });
  expect(result.success).toBe(false);
  expect(result.data).toMatchObject({ mutationAttempted: true, timelineChanged: null });
});

it("keeps ducking endpoint keys within a fractional tick duration", async () => {
  const h = host();
  const durationTicks = Math.round(0.123789 * TICKS);
  h.clip.end.ticks = String(25 * TICKS + durationTicks);
  h.clip.outPoint.ticks = String(30 * TICKS + durationTicks);
  const result = await gapTools.setup_ducking.handler({ node_id: h.clip.nodeId, ducking_windows: [] });
  expect(result.success).toBe(true);
  expect(h.prop.getKeys().map((key) => Number(key.ticks))).toEqual([30 * TICKS, 30 * TICKS + durationTicks]);
});

it("rejects normalized Level underflow without a bridge write", async () => {
  const h = host();
  const result = await audioTools.add_audio_keyframes.handler({ node_id: h.clip.nodeId, keyframes: [{ time_seconds: 2, level_db: -10000 }] });
  expect(result.success).toBe(false);
  expect(send).not.toHaveBeenCalled();
});
