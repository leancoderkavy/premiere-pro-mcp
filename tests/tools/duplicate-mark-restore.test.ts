import { runInNewContext } from "node:vm";
import { parse } from "acorn";
import { describe, expect, it, vi } from "vitest";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { getTimelineTools } from "../../src/tools/timeline.js";
import { createHost2652, observeHostOverwrite, HostTime, FRAME_NTSC_2997 } from "../helpers/premiere-26-5-2.js";
const T = 254016000000;
const options = { tempDir: "/tmp/duplicate-restore", timeoutMs: 1000 };
function host(ignoreRestore = false, rate = 48000) {
  const h = createHost2652();
  h.sequence.setSettings({ ...h.sequence.getSettings(), videoFrameRate: new HostTime(FRAME_NTSC_2997) });
  const item = h.addItem({ nodeId: 'source"384', hasVideo: false, sampleRate: rate, durationSeconds: 15 });
  const clip = h.addClip(item, { mediaType: "Audio", inSeconds: 1.001 - 1 / rate, durationSeconds: 3.003, linked: false });
  h.addClip(item, { mediaType: "Audio", trackIndex: 1, durationSeconds: 1 }).remove();
  const set = (inside: number, outside: number) => { item.setOutPoint(outside + .25 / rate, 2); item.setInPoint(inside + .25 / rate, 2); };
  vi.mocked(sendCommand).mockImplementation(async script => {
    parse(script, { ecmaVersion: 3, allowReserved: "never" });
    return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app: h.app, Time: HostTime })));
  });
  const placements = observeHostOverwrite(h, () => {
    if (ignoreRestore) { item.setInPoint = () => {}; item.setOutPoint = () => {}; }
  });
  return { h, item, clip, set, placements };
}
describe("duplicate source mark restoration and high-rate guard", () => {
  it("restores marks beyond the temporary copy Out in safe order", async () => {
    const { item, clip, set } = host(); set(10.01, 14.014);
    const before = [item.getInPoint(2).ticks, item.getOutPoint(2).ticks];
    expect(await getTimelineTools(options).duplicate_clip.handler({ node_id: clip.nodeId })).toMatchObject({ success: true, data: { verified: true, marksRestored: true } });
    expect([item.getInPoint(2).ticks, item.getOutPoint(2).ticks]).toEqual(before);
  });
  it("refuses the supplied high-rate temporary source range without changes", async () => {
    const { h, item, clip, set, placements } = host(false, 384000); set(1.001 - 1 / 384000, 4.004);
    const before = [item.getInPoint(2).ticks, item.getOutPoint(2).ticks];
    const result = await getTimelineTools(options).duplicate_clip.handler({ node_id: clip.nodeId });
    expect(result).toMatchObject({ success: false, data: { mutationOutcome: "not_applied", timelineChanged: false } });
    expect(placements()).toBe(0);expect(h.audio.length).toBe(1);
    expect([item.getInPoint(2).ticks, item.getOutPoint(2).ticks]).toEqual(before);
  });
  it("identifies every surviving copy after an ignored mark restore", async () => {
    const { h, clip, set, placements } = host(true); set(10.01, 14.014);
    const result = await getTimelineTools(options).duplicate_clip.handler({ node_id: clip.nodeId });
    const surviving = h.audio.filter(c => c.nodeId !== clip.nodeId).map(c => c.nodeId);
    expect(placements()).toBe(1);
    expect(surviving.length).toBe(1);
    expect(result).toMatchObject({ success: false, data: { marksRestored: false, timelineChanged: true, survivingCopyIds: surviving, markRestore: { sampleRate: 48000, gridTicks: "5292000" } } });
  });
  it("refuses an unknown source before any duplicate is created", async () => {
    const { h } = host();
    expect(await getTimelineTools(options).duplicate_clip.handler({ node_id: 'missing"\n' })).toMatchObject({ success: false });
    expect(h.audio.length).toBe(1);
  });
  it("reads whitespace-padded MediaTimebase and quarter-sample bias exactly", () => {
    const { item } = host(false, 384000);
    const result = runInNewContext(`${getHelpersSource()}\n[__itemAudioSampleRate(item),__mediaGridTicks(item,2),__biasedMarkSeconds(0,__mediaGridTicks(item,2))*TICKS_PER_SECOND]`, { item });
    expect(Array.from(result)).toEqual([384000, 661500, 165375]);
  });
});
