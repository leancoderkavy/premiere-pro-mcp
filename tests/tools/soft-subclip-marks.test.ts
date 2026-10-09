import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { getSourceMonitorTools } from "../../src/tools/source-monitor.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";
import { getTimelineTools } from "../../src/tools/timeline.js";
const T = 254016000000;
const options = { tempDir: "/tmp/soft-subclip", timeoutMs: 1000 };
const sent = vi.mocked(sendCommand);
beforeEach(() => vi.clearAllMocks());
function metadata(input = "00:00:20:00", output = "00:00:30:00", frame = T / 25, kind = "Video", timebase = "25") {
  const point = (name: string, value: string) => `<p:Column.Intrinsic.${kind}${name} rdf:parseType="Resource"><rdf:value>${value}</rdf:value><p:frame_rate>${frame}</p:frame_rate></p:Column.Intrinsic.${kind}${name}>`;
  return `<rdf:RDF>${point("InPoint", input)}${point("OutPoint", output)}<p:Column.Intrinsic.MediaTimebase>${timebase}</p:Column.Intrinsic.MediaTimebase></rdf:RDF>`;
}
function item(xml = metadata(), rejectRequested = false) {
  let left = 0, right = 175.3417 * T;
  const mark = (ticks: number) => ({ ticks: String(Math.round(ticks)), seconds: ticks / T });
  return { nodeId: 'soft"item', name: "Soft", type: 1,
    getProjectMetadata: () => xml,
    getInPoint: (_type?: number) => mark(left), getOutPoint: (_type?: number) => mark(right),
    // Live 26.5.2 floors written marks to the media frame grid (25 fps here).
    setInPoint: vi.fn((seconds: number) => { if (!(rejectRequested && seconds === 40)) left = Math.floor(seconds * 25 + 1e-9) * (T / 25); }),
    setOutPoint: vi.fn((seconds: number) => { right = Math.floor(seconds * 25 + 1e-9) * (T / 25); }),
  };
}
function run(expression: string, context: Record<string, unknown> = {}) {
  return runInNewContext(`${getHelpersSource()}\n${expression}`, context);
}
class Time {
  private clock = 0;
  get ticks() { return String(Math.round(this.clock)); } set ticks(t: string) { this.clock = Number(t); }
  get seconds() { return this.clock / T; } set seconds(s: number) { this.clock = Math.round(s * T); }
}
describe("soft subclip restore marks", () => {
  it("runs the emitted regexes and prefers private marks over a whole-media DOM range", () => {
    expect(run("__itemMarksForRestore(item, 4)", { item: item() })).toMatchObject({ inTicks: String(20 * T), outTicks: String(30 * T + T / 25) });
  });
  it("uses nominal 24 counting and the measured fractional frame tick field", () => {
    const frame = 10594575533;
    const marks = run("__itemMarksForRestore(item, 1)", { item: item(metadata("00:00:19:23", "00:00:29:22", frame)) });
    expect(marks.inTicks).toBe(String(479 * frame));
    expect(marks.outTicks).toBe(String(719 * frame));
  });
  it("uses exact NTSC ticks when fractional metadata omits the frame field", () => {
    const xml = metadata("00:00:20:00", "00:00:30:00", T / 24, "Video", "23.976").replace(/<p:frame_rate>.*?<\/p:frame_rate>/g, "");
    const marks = run("__itemMarksForRestore(item, 1)", { item: item(xml) });
    expect(marks.inTicks).toBe(String(480 * (T * 1001 / 24000)));
  });
  it("parses drop-frame timecode and rejects skipped labels", () => {
    const frame = T * 1001 / 30000;
    expect(run("__itemMarksForRestore(item, 1)", { item: item(metadata("00:01:00;02", "00:02:00;02", frame)) }).inTicks).toBe(String(1800 * frame));
    expect(run("__itemMarksForRestore(item, 1)", { item: item(metadata("00:01:00;00", "00:02:00;02", frame)) })).toBeNull();
  });
  it("parses audio samples with an Hz MediaTimebase", () => {
    const marks = run("__itemMarksForRestore(item, 2)", { item: item(metadata("00:00:10:24000", "00:00:20:00000", T / 48000, "Audio", "48000 Hz")) });
    expect(marks.inSeconds).toBeCloseTo(10.5, 4); expect(marks.outSeconds).toBeCloseTo(20, 4);
  });
  it("falls back to readable DOM marks when metadata is absent, keeping near-equal DOM marks", () => {
    const source = item("");
    expect(run("__itemMarksForRestore(item, 4)", { item: source })).toMatchObject({ inSeconds: 0, outSeconds: 175.3417 });
    const near = item(); near.setInPoint(20.03); near.setOutPoint(30.03);
    // The fake floors to the 25 fps grid like the host, so DOM reads 20 / 30 and matches the metadata.
    expect(run("__itemMarksForRestore(item, 4)", { item: near }).inSeconds).toBe(20);
    const empty = { getInPoint: () => null, getOutPoint: () => null };
    expect(run("__itemMarksForRestore(item, 4)", { item: empty })).toBeNull();
  });
  it("refuses partial, empty, invalid-clock, or throwing private metadata reads", () => {
    for (const xml of [metadata().replace(/<p:Column.Intrinsic.VideoOutPoint[\s\S]*?<\/p:Column.Intrinsic.VideoOutPoint>/, ""),
      "<p:Column.Intrinsic.VideoInPoint/><p:Column.Intrinsic.VideoOutPoint/>", metadata().replace(/<p:frame_rate>.*?<\/p:frame_rate>/g, "<p:frame_rate>bad</p:frame_rate>")]) {
      expect(run("__itemMarksForRestore(item, 4)", { item: item(xml) })).toBeNull();
    }
    const source = item(); source.getProjectMetadata = () => { throw new Error("unreadable"); };
    expect(run("__itemMarksForRestore(item, 4)", { item: source })).toBeNull();
  });
  it("restores the private range after a temporary track overwrite", () => {
    const source = item();
    const overwrite = vi.fn();
    expect(run(`__overwriteRangeOnTrack(track, item, "0", "${22*T}", "${24*T}", 1)`, { item: source, track: { overwriteClip: overwrite }, Time })).toMatchObject({ ok: true, marksRestored: true });
    expect(source.getInPoint().seconds).toBe(20); expect(source.getOutPoint().seconds).toBeCloseTo(30.04, 6);
    expect(overwrite).toHaveBeenCalledOnce();
  });
  it("writes the quarter-frame-biased restore seconds so a 26.5.2-style floor cannot drop a frame", () => {
    // Live 26.5.2: a value exactly on the media-frame boundary can store one
    // frame early (00:00:29:22 -> 00:00:29:21). Treat an exact boundary as
    // slightly under, matching that host, so restore must write past it.
    const source = item();
    source.setInPoint = vi.fn((seconds: number) => { source.getInPoint = () => ({ ticks: String(Math.round(Math.floor(seconds * 25 - 1e-12) * (T / 25))), seconds }); });
    source.setOutPoint = vi.fn((seconds: number) => { source.getOutPoint = () => ({ ticks: String(Math.round(Math.floor(seconds * 25 - 1e-12) * (T / 25))), seconds }); });
    const overwrite = vi.fn();
    expect(run(`__overwriteRangeOnTrack(track, item, "0", "${22*T}", "${24*T}", 1, ${T / 25})`, { item: source, track: { overwriteClip: overwrite }, Time })).toMatchObject({ ok: true, marksRestored: true });
    expect(Number(source.getInPoint().ticks)).toBe(20 * T);
    expect(Number(source.getOutPoint().ticks)).toBe(30 * T + T / 25);
    expect(source.setInPoint).toHaveBeenLastCalledWith(expect.closeTo(20.01, 6), 1);
    expect(source.setOutPoint).toHaveBeenLastCalledWith(expect.closeTo(30.05, 6), 1);
  });
  it("restores the biased private range after a preflight that Premiere rejects", () => {
    const source = item();
    source.setInPoint = vi.fn((seconds: number) => { source.getInPoint = () => ({ ticks: String(Math.round(Math.floor(seconds * 25 - 1e-12) * (T / 25))), seconds }); });
    source.setOutPoint = vi.fn((seconds: number) => { source.getOutPoint = () => ({ ticks: String(Math.round(Math.floor(seconds * 25 - 1e-12) * (T / 25))), seconds }); });
    expect(run(`__itemAcceptsRange(item, "${40*T}", "${50*T}", 1)`, { item: source })).toMatchObject({ ok: false, marksRestored: true });
    expect(Number(source.getInPoint().ticks)).toBe(20 * T);
    expect(Number(source.getOutPoint().ticks)).toBe(30 * T + T / 25);
  });
  it.each(["source", "project"])("restores private marks after a failed %s mark write", async (kind) => {
    const source = item(metadata(), true);
    sent.mockImplementation(async (script) => JSON.parse(String(run(script, { Time, app: { sourceMonitor: { getProjectItem: () => source }, project: { rootItem: { children: { numItems: 1, 0: source } } } } }))));
    const tool = kind === "source" ? getSourceMonitorTools(options).set_source_in_out : getTrackTargetingTools(options).set_item_in_out;
    const result = await tool.handler({ item_id: source.nodeId, in_seconds: 40 });
    expect(result.success).toBe(false); expect(result.error).toContain("Original marks were restored");
    expect(source.getInPoint().seconds).toBe(20); expect(source.getOutPoint().seconds).toBeCloseTo(30.04, 6);
  });
  it("restores private marks after duplicating a timeline clip", async () => {
    const source = item();
    const getOut = source.getOutPoint;
    source.getOutPoint = (type?: number) => type === 2 ? { ticks: "0", seconds: 0 } : getOut(type);
    const original = { nodeId: "clip", projectItem: source, start: { ticks: "0" }, end: { ticks: String(10*T) }, inPoint: { ticks: String(20*T) } };
    const target = { clips: { numItems: 0 } as Record<string, unknown> };
    const seq = { timebase: String(T / 25), videoTracks: { numTracks: 2, 0: { clips: { numItems: 1, 0: original } }, 1: target }, audioTracks: { numTracks: 0 },
      overwriteClip: () => { target.clips = { numItems: 1, 0: { nodeId: "copy", start: original.start, end: original.end, inPoint: original.inPoint } }; } };
    sent.mockImplementation(async (script) => JSON.parse(String(run(script, { Time, app: { project: { activeSequence: seq } } }))));
    await expect(getTimelineTools(options).duplicate_clip.handler({ node_id: "clip" })).resolves.toMatchObject({ success: true });
    expect(source.getInPoint().seconds).toBe(20); expect(source.getOutPoint().seconds).toBeCloseTo(30.04, 6);
    source.getProjectMetadata = () => metadata("bad");
    target.clips = { numItems: 0 };
    source.setInPoint.mockClear(); source.setOutPoint.mockClear();
    await expect(getTimelineTools(options).duplicate_clip.handler({ node_id: "clip" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("reliably") });
    expect(source.setInPoint).not.toHaveBeenCalled(); expect(source.setOutPoint).not.toHaveBeenCalled();
  });
  it("refuses malformed private marks before any temporary or requested mark write", async () => {
    const source = item(metadata("bad", "00:00:30:00"));
    const overwrite = vi.fn();
    expect(run(`__overwriteRangeOnTrack(track, item, "0", "${22*T}", "${24*T}", 1)`, { item: source, track: { overwriteClip: overwrite }, Time })).toMatchObject({ ok: false, attempted: false });
    expect(overwrite).not.toHaveBeenCalled();
    sent.mockImplementation(async (script) => JSON.parse(String(run(script, { Time, app: { sourceMonitor: { getProjectItem: () => source }, project: { rootItem: { children: { numItems: 1, 0: source } } } } }))));
    for (const result of [await getSourceMonitorTools(options).set_source_in_out.handler({ in_seconds: 40 }), await getTrackTargetingTools(options).set_item_in_out.handler({ item_id: source.nodeId, in_seconds: 40 })]) expect(result.success).toBe(false);
    expect(source.setInPoint).not.toHaveBeenCalled(); expect(source.setOutPoint).not.toHaveBeenCalled();
  });
});
