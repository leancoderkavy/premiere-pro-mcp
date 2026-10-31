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
    getFootageInterpretation: () => ({ frameRate: 25 }),
    getInPoint: (_type?: number) => mark(left), getOutPoint: (_type?: number) => mark(right),
    // Live 26.5.2 floors written marks to the media frame grid (25 fps here).
    setInPoint: vi.fn((seconds: number) => { if (!(rejectRequested && Math.abs(seconds - 40) < 1 / 25)) left = Math.floor(seconds * 25 + 1e-9) * (T / 25); }),
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
  it("subtracts absolute MediaStart timecode before restoring zero-based marks", () => {
    const frame = T / 25;
    const base = metadata("13:14:03:24", "13:15:21:05", frame);
    const mediaStart = `<p:Column.Intrinsic.MediaStart rdf:parseType="Resource"><rdf:value>13:14:03:24</rdf:value><p:frame_rate>${frame}</p:frame_rate></p:Column.Intrinsic.MediaStart>`;
    const xml = base.replace("</rdf:RDF>", `${mediaStart}</rdf:RDF>`);
    const marks = run("__itemMarksForRestore(item, 1)", { item: item(xml) });
    expect(marks.inTicks).toBe("0");
    expect(Number(marks.outTicks)).toBe(1932 * frame);
  });
  it("restores marks of time-of-day media whose timecode passes midnight", () => {
    // Live 26.0.2: a 23.976 camera started at 22:52:31:00 and ran 01:58:37:00.
    const frame = 10594584000;
    const base = metadata("22:52:31:00", "00:51:07:23", frame, "Video", "23.976 fps");
    const mediaStart = `<p:Column.Intrinsic.MediaStart>22:52:31:00</p:Column.Intrinsic.MediaStart>`;
    const xml = base.replace("</rdf:RDF>", `${mediaStart}</rdf:RDF>`);
    const marks = run("__itemMarksForRestore(item, 1)", { item: item(xml) });
    expect(marks).not.toBeNull();
    expect(marks.inTicks).toBe("0");
    // 01:58:36:23 inclusive = 170807 frames, exclusive Out one frame later.
    expect(Number(marks.outTicks)).toBe(170808 * frame);
  });

  it("restores drop-frame time-of-day marks across midnight", () => {
    const frame = T * 1001 / 30000;
    const base = metadata("23:50:00;00", "00:01:00;02", frame, "Video", "29.97 fps");
    const mediaStart = `<p:Column.Intrinsic.MediaStart>23:50:00;00</p:Column.Intrinsic.MediaStart>`;
    const marks = run("__itemMarksForRestore(item, 1)", { item: item(base.replace("</rdf:RDF>", `${mediaStart}</rdf:RDF>`)) });
    expect(marks).not.toBeNull();
    expect(marks.inTicks).toBe("0");
    // 23:50:00;00 -> 24:00:00;00 is ten DF minutes (17982 frames); 00:01:00;02 is frame 1800; inclusive Out + 1.
    expect(Number(marks.outTicks)).toBe(Math.round((17982 + 1800 + 1) * frame));
  });

  it("parses drop-frame timecode and rejects skipped labels", () => {
    const frame = T * 1001 / 30000;
    expect(run("__itemMarksForRestore(item, 1)", { item: item(metadata("00:01:00;02", "00:02:00;02", frame)) }).inTicks).toBe(String(1800 * frame));
    expect(run("__itemMarksForRestore(item, 1)", { item: item(metadata("00:01:00;00", "00:02:00;02", frame)) })).toBeNull();
  });
  it("reads an audio-only item's range when its Video fields are empty (default media type)", () => {
    // Live 26.5.2 metadata for a 15 s 48 kHz WAV: empty Video blocks, inclusive last-sample Audio Out.
    const P = "premierePrivateProjectMetaData";
    const emptyVideo = (name: string) => `<${P}:Column.Intrinsic.Video${name} rdf:parseType="Resource"><rdf:value/><${P}:min>0</${P}:min><${P}:max>-101606410160640000</${P}:max></${P}:Column.Intrinsic.Video${name}>`;
    const audio = (name: string, tc: string) => `<${P}:Column.Intrinsic.Audio${name} rdf:parseType="Resource"><rdf:value>${tc}</rdf:value></${P}:Column.Intrinsic.Audio${name}>`;
    const xml = `<rdf:RDF>${emptyVideo("InPoint")}${emptyVideo("OutPoint")}${audio("InPoint", "00:00:00:00000")}${audio("OutPoint", "00:00:14:47999")}<${P}:Column.Intrinsic.MediaTimebase>48000 Hz</${P}:Column.Intrinsic.MediaTimebase><${P}:Column.Intrinsic.MediaType>Audio</${P}:Column.Intrinsic.MediaType></rdf:RDF>`;
    const tone = { ...item(xml), getFootageInterpretation: () => ({ frameRate: 2.75404699046078e-8 }) };
    const right = 15 * T;
    tone.getInPoint = () => ({ ticks: "0", seconds: 0 });
    tone.getOutPoint = () => ({ ticks: String(right), seconds: right / T });
    const marks = run("__itemMarksForRestore(item, 4)", { item: tone });
    expect(marks).not.toBeNull();
    expect(marks.inTicks).toBe("0");
    expect(marks.outTicks).toBe(String(15 * T));
    // The write bias is a quarter of a 48 kHz sample, not a quarter of a year.
    expect(marks.outSeconds - 15).toBeGreaterThan(0);
    expect(marks.outSeconds - 15).toBeLessThan(1 / 48000);
    expect(run("__mediaGridTicks(item, 4)", { item: tone })).toBe(T / 48000);
    expect(run("__restoreGridFromItem(item, 4)", { item: tone })).toBe(T / 48000);
  });
  it("parses Premiere's all-semicolon drop-frame metadata like the SMPTE form", () => {
    const frame = T * 1001 / 30000;
    const smpte = run("__itemMarksForRestore(item, 1)", { item: item(metadata("00:01:00;02", "00:02:00;02", frame)) });
    expect(run("__itemMarksForRestore(item, 1)", { item: item(metadata("00;01;00;02", "00;02;00;02", frame)) })).toEqual(smpte);
    expect(run("__itemMarksForRestore(item, 1)", { item: item(metadata("00;01;00;00", "00;02;00;02", frame)) })).toBeNull();
    expect(run("__itemMarksForRestore(item, 1)", { item: item(metadata("00;01;00:02", "00;02;00:02", frame)) })).toBeNull();
  });
  it("parses audio samples with an Hz MediaTimebase", () => {
    const marks = run("__itemMarksForRestore(item, 2)", { item: item(metadata("00:00:10:24000", "00:00:20:00000", T / 48000, "Audio", "48000 Hz")) });
    expect(marks.inSeconds).toBeCloseTo(10.5, 4); expect(marks.outSeconds).toBeCloseTo(20, 4);
  });
  it("treats the private Audio Out as inclusive, like the Video Out", () => {
    // Live 26.5.2: an audio subclip made with an exclusive Out of 4.004 s stores 00:00:04:00191;
    // its frame_rate child is the 25 fps display rate, the samples come from MediaTimebase.
    const marks = run("__itemMarksForRestore(item, 2)", { item: item(metadata("00:00:01:00048", "00:00:04:00191", T / 25, "Audio", "48000 Hz")) });
    expect(marks.inTicks).toBe(String(48048 * (T / 48000)));
    expect(marks.outTicks).toBe(String(192192 * (T / 48000)));
  });
  it("writes an exact audio sample boundary a quarter sample late", () => {
    // Live 26.5.2: setInPoint(1.001, 2) reads back sample 48047.
    const seconds = run("__requestedMarkWriteSeconds(item, 2, 1.001)", { item: item() });
    expect(seconds).toBeGreaterThan(1.001);
    expect(seconds).toBeLessThan(1.001 + 1 / 48000);
    expect(run("__requestedMarkWriteSeconds(item, 2, 1.0010101)", { item: item() })).toBe(1.0010101);
  });
  it("falls back to readable DOM marks when metadata is absent, keeping near-equal DOM marks", () => {
    const source = item("");
    const absent = run("__itemMarksForRestore(item, 4)", { item: source });
    expect(absent.inTicks).toBe("0");
    expect(absent.outTicks).toBe(String(Math.round(175.3417 * T)));
    expect(absent.inSeconds).toBeCloseTo(0.01, 6);
    expect(absent.outSeconds).toBeCloseTo(175.3517, 6);
    const near = item(); near.setInPoint(20.03); near.setOutPoint(30.03);
    // The fake floors to the 25 fps grid like the host, so DOM ticks stay 20 / 30
    // and match the metadata. Write seconds still get a quarter-frame bias so
    // 26.5.2 cannot floor the restore one frame early.
    expect(run("__itemMarksForRestore(item, 4)", { item: near }).inSeconds).toBeCloseTo(20.01, 6);
    expect(run("__itemMarksForRestore(item, 4)", { item: near }).inTicks).toBe(String(20 * T));
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
  it("biases DOM-matched restore seconds so a 26.5.2-style floor cannot shrink a normal clip", () => {
    // XML 20-30 matches DOM after the fake floors 20.03/30.03. The previous
    // return used exact 20/30 seconds; 26.5.2 then stored 19.96 / 29.96.
    const source = item();
    source.setInPoint(20.03);
    source.setOutPoint(30.03);
    source.setInPoint = vi.fn((seconds: number) => { source.getInPoint = () => ({ ticks: String(Math.round(Math.floor(seconds * 25 - 1e-12) * (T / 25))), seconds }); });
    source.setOutPoint = vi.fn((seconds: number) => { source.getOutPoint = () => ({ ticks: String(Math.round(Math.floor(seconds * 25 - 1e-12) * (T / 25))), seconds }); });
    expect(run(`__overwriteRangeOnTrack(track, item, "0", "${22*T}", "${24*T}", 1, ${T / 25})`, { item: source, track: { overwriteClip: vi.fn() }, Time })).toMatchObject({ ok: true, marksRestored: true });
    expect(Number(source.getInPoint().ticks)).toBe(20 * T);
    expect(Number(source.getOutPoint().ticks)).toBe(30 * T);
    expect(source.setInPoint).toHaveBeenLastCalledWith(expect.closeTo(20.01, 6), 1);
    expect(source.setOutPoint).toHaveBeenLastCalledWith(expect.closeTo(30.01, 6), 1);
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
  it("places the requested overwrite range when the host floors exact boundary seconds", () => {
    // unnest_sequence calls __overwriteRangeOnTrack without a one-frame
    // tolerance. Exact tick seconds floor one media frame early on 26.5.2, so
    // the 16-tick default check refused a valid nest (or placed a short clip
    // after the nest was already removed).
    const source = item();
    source.setInPoint = vi.fn((seconds: number) => { source.getInPoint = () => ({ ticks: String(Math.round(Math.floor(seconds * 25 - 1e-12) * (T / 25))), seconds }); });
    source.setOutPoint = vi.fn((seconds: number) => { source.getOutPoint = () => ({ ticks: String(Math.round(Math.floor(seconds * 25 - 1e-12) * (T / 25))), seconds }); });
    const placed = { inTicks: 0, outTicks: 0 };
    const overwrite = vi.fn(() => {
      placed.inTicks = Number(source.getInPoint().ticks);
      placed.outTicks = Number(source.getOutPoint().ticks);
    });
    expect(run(`__overwriteRangeOnTrack(track, item, "0", "${22*T}", "${24*T}", 1)`, { item: source, track: { overwriteClip: overwrite }, Time })).toMatchObject({ ok: true, attempted: true, marksRestored: true });
    expect(overwrite).toHaveBeenCalledOnce();
    expect(placed).toEqual({ inTicks: 22 * T, outTicks: 24 * T });
    expect(source.setInPoint).toHaveBeenNthCalledWith(1, expect.closeTo(22.01, 6), 1);
    expect(source.setOutPoint).toHaveBeenNthCalledWith(1, expect.closeTo(24.01, 6), 1);
  });
  it("restores the biased private range after a preflight that Premiere rejects", () => {
    // Live 26.5.2: Premiere ignores an Out past the media length. The 40-50s
    // request is not a floor miss — the host leaves Out unchanged.
    const source = item();
    source.setInPoint = vi.fn((seconds: number) => { source.getInPoint = () => ({ ticks: String(Math.round(Math.floor(seconds * 25 - 1e-12) * (T / 25))), seconds }); });
    source.setOutPoint = vi.fn((seconds: number) => {
      if (seconds > 35) return;
      source.getOutPoint = () => ({ ticks: String(Math.round(Math.floor(seconds * 25 - 1e-12) * (T / 25))), seconds });
    });
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
    const target = { clips: { numItems: 0 } as Record<string, unknown>, overwriteClip: () => {
      target.clips = { numItems: 1, 0: { nodeId: "copy", start: original.start, end: original.end, inPoint: original.inPoint } };
    } };
    const seq = { timebase: String(T / 25), videoTracks: { numTracks: 2, 0: { clips: { numItems: 1, 0: original } }, 1: target }, audioTracks: { numTracks: 0 } };
    sent.mockImplementation(async (script) => JSON.parse(String(run(script, { Time, app: { project: { activeSequence: seq } } }))));
    await expect(getTimelineTools(options).duplicate_clip.handler({ node_id: "clip" })).resolves.toMatchObject({ success: true });
    expect(source.getInPoint().seconds).toBe(20); expect(source.getOutPoint().seconds).toBeCloseTo(30.04, 6);
    source.getProjectMetadata = () => metadata("bad");
    target.clips = { numItems: 0 };
    source.setInPoint.mockClear(); source.setOutPoint.mockClear();
    await expect(getTimelineTools(options).duplicate_clip.handler({ node_id: "clip" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("reliably") });
    expect(source.setInPoint).not.toHaveBeenCalled(); expect(source.setOutPoint).not.toHaveBeenCalled();
  });
  it("duplicates an audio-only clip without losing a frame of its source In", async () => {
    // Live 26.5.2: type-4 marks on a WAV floor to a 25 fps grid, an exact sample boundary floors
    // one sample early, and overwriteClip floors the copy's In to the sequence frame (1.001 -> 0.9676 s).
    const F = T * 1001 / 30000, S = T / 48000;
    const xml = metadata("00:00:00:00000", "00:00:14:47999", T / 25, "Audio", "48000 Hz").replace("</rdf:RDF>", "<p:Column.Intrinsic.MediaType>Audio</p:Column.Intrinsic.MediaType></rdf:RDF>");
    let left = 0, right = 15 * T;
    const hostFloor = (seconds: number, type?: number) => { const grid = type === 2 ? S : T / 25; return Math.floor(seconds * T / grid * (1 - 1e-12)) * grid; };
    const mark = (ticks: number) => ({ ticks: String(Math.round(ticks)), seconds: ticks / T });
    const tone = { nodeId: "tone", name: "Tone", type: 1,
      getProjectMetadata: () => xml,
      getFootageInterpretation: () => ({ frameRate: 2.75404699046078e-8 }),
      getInPoint: (type?: number) => mark(type === 1 ? 0 : left), getOutPoint: (type?: number) => mark(type === 1 ? 0 : right),
      setInPoint: vi.fn((seconds: number, type?: number) => { left = hostFloor(seconds, type); }),
      setOutPoint: vi.fn((seconds: number, type?: number) => { right = hostFloor(seconds, type); }),
    };
    const original = { nodeId: "clip", projectItem: tone, start: { ticks: String(60 * F) }, end: { ticks: String(164 * F) }, inPoint: { ticks: String(30 * F) } };
    const target = { clips: { numItems: 0 } as Record<string, unknown>,
      overwriteClip: (_item: unknown, time: { ticks: string }) => {
        const start = time.ticks;
        const inTicks = Math.floor(left / F + 1e-9) * F;
        target.clips = { numItems: 1, 0: { nodeId: "copy", start: { ticks: start }, end: { ticks: String(Number(start) + 104 * F) }, inPoint: { ticks: String(inTicks) } } };
      } };
    const seq = { timebase: String(F), videoTracks: { numTracks: 1, 0: { clips: { numItems: 0 } } }, audioTracks: { numTracks: 2, 0: { clips: { numItems: 1, 0: original } }, 1: target } };
    sent.mockImplementation(async (script) => JSON.parse(String(run(script, { Time, app: { project: { activeSequence: seq } } }))));
    const result = await getTimelineTools(options).duplicate_clip.handler({ node_id: "clip" });
    expect(result).toMatchObject({ success: true, data: { verified: true, copy: { trackType: "audio", trackIndex: 1 } } });
    expect((result as { data: { copy: { inSeconds: number } } }).data.copy.inSeconds).toBeCloseTo(30 * F / T, 9);
    expect(tone.setInPoint).not.toHaveBeenCalledWith(expect.anything(), 4);
    expect(left).toBe(0); expect(right).toBe(15 * T);
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
