import { beforeEach, describe, expect, it, vi } from "vitest";
import * as acorn from "acorn";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import {
  buildCaptionSequenceReadScript,
  buildImportCaptionFileScript,
  CAPTION_CUT_SOURCE_PROPERTY,
  normalizeCutSource,
  readCaptionSequence,
  safeFileStem,
  summarizeCaptionPlan,
} from "../../src/tools/caption-host.js";
import { makeFakeCaptionHost, TPS, type FakeHostOptions } from "../helpers/fake-caption-host.js";

const mocked = vi.mocked(sendCommand);
const es3 = (script: string) => expect(() => acorn.parse(script, { ecmaVersion: 3, allowReturnOutsideFunction: true })).not.toThrow();

function install(options: FakeHostOptions = {}) {
  const host = makeFakeCaptionHost(options);
  mocked.mockImplementation(async (script: string) => host.run(script));
  return host;
}

beforeEach(() => vi.clearAllMocks());

describe("cut_source", () => {
  it("defaults to none and rejects unknown values", () => {
    expect(normalizeCutSource(undefined)).toBe("none");
    expect(normalizeCutSource(null)).toBe("none");
    expect(normalizeCutSource("edit_points")).toBe("edit_points");
    expect(() => normalizeCutSource("scenes")).toThrow("cut_source");
    expect(() => normalizeCutSource(3)).toThrow("cut_source");
    expect(CAPTION_CUT_SOURCE_PROPERTY.enum).toEqual(["none", "edit_points"]);
  });
});

describe("readCaptionSequence", () => {
  it("reads frame rate, size, duration and track count", async () => {
    install({ fps: 29.97, width: 1920, height: 1080, durationSeconds: 90, videoTracks: 4 });
    const info = await readCaptionSequence({});
    expect(info).toMatchObject({ sequence_id: "seq-1", name: "Reel: Final/Cut", fps: 30000 / 1001, frame_width: 1920, frame_height: 1080, video_track_count: 4 });
    expect(info.exact_fps).toBeCloseTo(TPS / Math.round(TPS / 29.97), 6);
    expect(info.duration_seconds).toBeCloseTo(90, 6);
    expect(info.edit_points).toBeUndefined();
  });

  it("collects sorted unique edit points, leaving out the caption track, 0 and the end", async () => {
    install({
      durationSeconds: 60,
      existing: [
        { track: 0, name: "A", start: 0, end: 10 },
        { track: 0, name: "B", start: 10, end: 25.5 },
        { track: 1, name: "C", start: 25.5, end: 60 },
        { track: 2, name: "Captions", start: 3, end: 4 },
      ],
    });
    const all = await readCaptionSequence({}, { include_edit_points: true });
    expect(all.edit_points).toEqual([3, 4, 10, 25.5]);
    const without = await readCaptionSequence({}, { include_edit_points: true, exclude_video_track: 2 });
    expect(without.edit_points).toEqual([10, 25.5]);
  });

  it("looks a sequence up by id or name and fails clearly when it is missing", async () => {
    install();
    expect((await readCaptionSequence({}, { sequence_id: "seq-1" })).sequence_id).toBe("seq-1");
    expect((await readCaptionSequence({}, { sequence_id: "Reel: Final/Cut" })).name).toBe("Reel: Final/Cut");
    await expect(readCaptionSequence({}, { sequence_id: 'nope"' })).rejects.toThrow("Sequence not found");
  });

  it("rejects an unreadable timebase or frame size", async () => {
    mocked.mockResolvedValueOnce({ success: true, data: { timebase: "", frameWidth: 1080, frameHeight: 1920 } });
    await expect(readCaptionSequence({})).rejects.toThrow("timebase");
    mocked.mockResolvedValueOnce({ success: true, data: { timebase: "10160640000", frameWidth: 0, frameHeight: 1920 } });
    await expect(readCaptionSequence({})).rejects.toThrow("frame size");
    mocked.mockResolvedValueOnce({ success: false, error: "No active sequence" });
    await expect(readCaptionSequence({})).rejects.toThrow("No active sequence");
    mocked.mockResolvedValueOnce({ success: false });
    await expect(readCaptionSequence({})).rejects.toThrow("unknown error");
  });

  it("tolerates a missing duration, junk edit points and a missing data block", async () => {
    mocked.mockResolvedValueOnce({
      success: true,
      data: { timebase: "10160640000", frameWidth: 1080, frameHeight: 1920, endTicks: null, videoTrackCount: -1, editPoints: [5, "x", null, 5.0000001, 0.0001, 7], editPointsTruncated: true, sequenceId: undefined },
    });
    const info = await readCaptionSequence({}, { include_edit_points: true });
    expect(info).toMatchObject({ duration_seconds: null, video_track_count: 0, edit_points: [5, 7], edit_points_truncated: true, sequence_id: "", name: "" });
    mocked.mockResolvedValueOnce({ success: true });
    await expect(readCaptionSequence({})).rejects.toThrow("timebase");
  });

  it("generates ES3", () => {
    es3(buildCaptionSequenceReadScript());
    es3(buildCaptionSequenceReadScript({ sequence_id: 'a"b', include_edit_points: true, exclude_video_track: 2.7 }));
  });
});

describe("buildImportCaptionFileScript", () => {
  it("imports the file and finds the new item by media path, case-insensitively on Windows", async () => {
    const host = install({ mediaPathUpper: true });
    const reply = host.run(buildImportCaptionFileScript("C:\\work\\captions.srt"));
    expect(reply.success).toBe(true);
    expect(reply.data).toMatchObject({ imported: true, verified: true, outcome: "verified", matchCount: 1, item: { name: "work\\captions.srt".split("\\").pop() } });
    expect(host.log.importFiles).toEqual(["C:\\work\\captions.srt"]);
  });

  it("fails with the receipt when no item matches", async () => {
    const host = install({ importFilesNoItem: true });
    const reply = host.run(buildImportCaptionFileScript("C:/work/captions.srt"));
    expect(reply.success).toBe(false);
    expect(reply.data).toMatchObject({ outcome: "failed", importReturned: true, newRootItems: [] });
    const thrown = install({ importFilesThrows: true }).run(buildImportCaptionFileScript("C:/work/captions.srt"));
    expect(thrown.data).toMatchObject({ hostError: expect.stringContaining("exploded"), outcome: "failed" });
  });

  it("refuses a missing file before importing and escapes the path", () => {
    const host = install({ fileMissing: true });
    const reply = host.run(buildImportCaptionFileScript('C:/we"ird\\name.srt'));
    expect(reply.success).toBe(false);
    expect(reply.error).toContain("does not exist");
    expect(host.log.importFiles).toEqual([]);
    es3(buildImportCaptionFileScript('C:/we"ird\\name.srt'));
  });
});

describe("small helpers", () => {
  it("makes file-name-safe stems", () => {
    expect(safeFileStem('Reel: "Final"/Cut?')).toBe("Reel_ _Final__Cut_");
    expect(safeFileStem("   ")).toBe("sequence");
    expect(safeFileStem("..hidden")).toBe("hidden");
    expect(safeFileStem("x".repeat(200))).toHaveLength(80);
    expect(safeFileStem("", "fallback")).toBe("fallback");
  });

  it("summarises a plan, including an empty one", () => {
    const plan: any = {
      captions: [{ start: 1, end: 2 }, { start: 3, end: 4 }],
      changes: Array.from({ length: 30 }, (_, i) => ({ n: i })),
      violations: [{ n: 1 }],
      warnings: ["w"],
      settings: { frame_rate: 25, standard: "netflix" },
      estimated_word_times: true,
    };
    expect(summarizeCaptionPlan(plan)).toMatchObject({ caption_count: 2, first_start: 1, last_end: 4, frame_rate: 25, standard: "netflix", change_count: 30, violation_count: 1, warnings: ["w"], estimated_word_times: true });
    expect(summarizeCaptionPlan(plan).changes).toHaveLength(20);
    expect(summarizeCaptionPlan({ ...plan, captions: [], settings: { frame_rate: 30 } })).toMatchObject({ caption_count: 0, first_start: null, last_end: null, standard: null });
  });
});
