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
  return { clip, prop, times: () => Array.from(values.keys()).sort((a, b) => a - b).map((ticks) => ticks / TICKS) };
}

beforeEach(() => vi.resetAllMocks());

it("stores add_audio_keyframes at the source in-point plus each clip offset", async () => {
  const h = host();
  const result = await audioTools.add_audio_keyframes.handler({ node_id: h.clip.nodeId, keyframes: [{ time_seconds: 2, level_db: -6 }] });
  expect(result).toMatchObject({ success: true, data: { verified: true, outcome: "verified" } });
  expect(h.times()).toEqual([32]);
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
  const result = await gapTools.setup_ducking.handler({ node_id: h.clip.nodeId, ducking_windows: [{ start_seconds: 2, end_seconds: 4, ducked_db: -20 }], fade_seconds: 0.2 });
  expect(result).toMatchObject({ success: true, data: { verified: true, duckingWindowCount: 1 } });
  expect(h.times()).toEqual([30, 31.8, 32, 34, 34.2, 40]);
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
])("rejects $label audio key batches before dispatch", async ({ keyframes }) => {
  const h = host();
  const result = await audioTools.add_audio_keyframes.handler({ node_id: h.clip.nodeId, keyframes } as never);
  expect(result).toMatchObject({ success: false });
  expect(send).not.toHaveBeenCalled();
  expect(h.times()).toEqual([]);
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
