import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getCompetitorGapTools } from "../../src/tools/competitor-gaps.js";
import { cleanupTempDirs, makeTempDir as makeRawTempDir } from "../helpers/temp-dir.js";

/** A temp dir by its realpath: the tool returns canonical paths, and on macOS tmpdir() (/var/...) is a link to /private/var/.... */
const makeTempDir = (prefix: string) => realpathSync(makeRawTempDir(prefix));

const tool = getCompetitorGapTools({}).read_sequence_captions;
const mocked = vi.mocked(sendCommand);
const call = (args: Record<string, unknown>) => tool.handler(args as any) as Promise<any>;

const readable = [
  { trackIndex: 0, startSeconds: 1, endSeconds: 3, text: "Hello there." },
  { trackIndex: 0, startSeconds: 4, endSeconds: 6.5, text: "Two lines\nof text." },
];
const hostReply = (captions: unknown[], extra: Record<string, unknown> = {}) => ({
  success: true,
  data: { sequenceId: "s", sequenceName: "S", captionReadSupported: true, hostProbe: "getCaptionTracks", trackCount: 1, captionCount: captions.length, captions, note: "n", ...extra },
});

beforeEach(() => vi.clearAllMocks());
afterAll(() => cleanupTempDirs());

describe("read_sequence_captions without export", () => {
  it("returns the host reply untouched when nothing is readable", async () => {
    const reply = hostReply([]);
    mocked.mockResolvedValue(reply as any);
    expect(await call({})).toBe(reply);
    const noText = hostReply([{ trackIndex: 0, startSeconds: 1, endSeconds: 2, text: null }]);
    mocked.mockResolvedValue(noText as any);
    expect(await call({})).toBe(noText);
  });

  it("adds QA-ready cues when every caption has text and times", async () => {
    mocked.mockResolvedValue(hostReply(readable) as any);
    const result = await call({});
    expect(result.data.cues).toEqual([
      { start_seconds: 1, end_seconds: 3, text: "Hello there." },
      { start_seconds: 4, end_seconds: 6.5, text: "Two lines\nof text." },
    ]);
    expect(result.data.captions).toEqual(readable);
    expect(result.data).not.toHaveProperty("export");
  });

  it("returns cues per track and a flat list only when exactly one caption track exists", async () => {
    mocked.mockResolvedValue(hostReply(readable) as any);
    const one = await call({});
    expect(one.data.cues_by_track).toEqual([{ track_index: 0, cues: one.data.cues }]);
    const second = { trackIndex: 1, startSeconds: 7, endSeconds: 8, text: "Other track" };
    mocked.mockResolvedValue(hostReply([...readable, second], { trackCount: 2 }) as any);
    const two = await call({});
    expect(two.data).not.toHaveProperty("cues");
    expect(two.data.cues_by_track).toEqual([
      { track_index: 0, cues: [{ start_seconds: 1, end_seconds: 3, text: "Hello there." }, { start_seconds: 4, end_seconds: 6.5, text: "Two lines\nof text." }] },
      { track_index: 1, cues: [{ start_seconds: 7, end_seconds: 8, text: "Other track" }] },
    ]);
    // One unreadable track: the readable one is listed per track, but there is no flat list that would hide the other.
    mocked.mockResolvedValue(hostReply([...readable, { trackIndex: 1, startSeconds: 7, endSeconds: 8, text: null }], { trackCount: 2 }) as any);
    const mixed = await call({});
    expect(mixed.data.cues_by_track.map((t: any) => t.track_index)).toEqual([0]);
    expect(mixed.data).not.toHaveProperty("cues");
    expect(tool.description).toContain("cues_by_track");
  });

  it.each([
    [{ trackIndex: 0, startSeconds: "1", endSeconds: 2, text: "x" }],
    [{ trackIndex: 0, startSeconds: 1, endSeconds: NaN, text: "x" }],
    [{ trackIndex: 0, startSeconds: 2, endSeconds: 1, text: "x" }],
    [{ trackIndex: 0, startSeconds: 1, endSeconds: 2, text: "  " }],
  ])("withholds cues when a caption is unreadable (%#)", async (bad) => {
    mocked.mockResolvedValue(hostReply([readable[0], bad]) as any);
    expect((await call({})).data).not.toHaveProperty("cues");
  });

  it("passes failures and odd replies through", async () => {
    const failure = { success: false, error: "No active sequence" };
    mocked.mockResolvedValue(failure as any);
    expect(await call({})).toBe(failure);
    mocked.mockResolvedValue(undefined as any);
    expect(await call({})).toBeUndefined();
    const noData = { success: true };
    mocked.mockResolvedValue(noData as any);
    expect(await call({})).toBe(noData);
    const noList = { success: true, data: { captionReadSupported: false } };
    mocked.mockResolvedValue(noList as any);
    expect(await call({})).toBe(noList);
  });

  it("documents the export and keeps the schema strict", () => {
    expect(tool.description).toContain("export");
    expect(tool.parameters.properties.export.required).toEqual(["format", "output_path", "approved_workspace_path"]);
    expect(tool.parameters.properties.export.properties.format.enum).toEqual(["srt", "vtt", "ttml"]);
  });
});

describe("read_sequence_captions with export", () => {
  it.each([
    ["srt", "00:00:01,000 --> 00:00:03,000"],
    ["vtt", "00:00:01.000 --> 00:00:03.000"],
    ["ttml", "<p "],
  ])("writes %s, reads the cue count back and still returns the diagnostic", async (format, marker) => {
    const dir = makeTempDir("seq-captions-");
    mocked.mockResolvedValue(hostReply(readable) as any);
    const target = path.join(dir, `out.${format}`);
    const result = await call({ export: { format, output_path: target, approved_workspace_path: dir } });
    expect(result.success).toBe(true);
    expect(result.data.captionReadSupported).toBe(true);
    expect(result.data.export).toMatchObject({ written: true, refused: false, format, path: target, cue_count: 2, cue_count_readback: 2 });
    expect(readFileSync(target, "utf8")).toContain(marker);
    expect(readFileSync(target, "utf8")).toContain("of text.");
  });

  it("refuses with an explanation when the host exposes no caption text, writing nothing", async () => {
    const dir = makeTempDir("seq-captions-");
    mocked.mockResolvedValue(hostReply([{ trackIndex: 0, startSeconds: 1, endSeconds: 2, text: null }]) as any);
    const target = path.join(dir, "out.srt");
    const result = await call({ export: { format: "srt", output_path: target, approved_workspace_path: dir } });
    expect(result.success).toBe(true);
    expect(result.data.export).toMatchObject({ written: false, refused: true });
    expect(result.data.export.reason).toContain("most CEP builds expose no caption text");
    expect(result.data.export.reason).toContain("import_plan");
    expect(existsSync(target)).toBe(false);
    expect(result.data.captionReadSupported).toBe(true);
    mocked.mockResolvedValue(hostReply([]) as any);
    expect((await call({ export: { format: "srt", output_path: target, approved_workspace_path: dir } })).data.export.refused).toBe(true);
  });

  it("needs a track choice when several tracks have captions", async () => {
    const dir = makeTempDir("seq-captions-");
    const two = [...readable, { trackIndex: 1, startSeconds: 7, endSeconds: 8, text: "Other track" }];
    mocked.mockResolvedValue(hostReply(two, { trackCount: 2 }) as any);
    const target = path.join(dir, "out.srt");
    const ambiguous = await call({ export: { format: "srt", output_path: target, approved_workspace_path: dir } });
    expect(ambiguous.data.export.reason).toContain("export.track_index");
    const chosen = await call({ export: { format: "srt", output_path: target, approved_workspace_path: dir, track_index: 1 } });
    expect(chosen.data.export).toMatchObject({ written: true, cue_count: 1 });
    expect(readFileSync(target, "utf8")).toContain("Other track");
    expect(readFileSync(target, "utf8")).not.toContain("Hello there");
    const none = await call({ export: { format: "vtt", output_path: path.join(dir, "n.vtt"), approved_workspace_path: dir, track_index: 5 } });
    expect(none.data.export.refused).toBe(true);
    expect(none.data.export.reason).toContain("matches no caption track");
    expect(none.data.export.reason).toContain("2 caption tracks (index 0 to 1)");
    expect(none.data.export.reason).not.toContain("exposed text");
  });

  it("gives a track_index beyond the only track its own message, but keeps the host-exposes-no-text reason when no track is reported", async () => {
    const dir = makeTempDir("seq-captions-");
    mocked.mockResolvedValue(hostReply(readable) as any);
    const beyond = await call({ export: { format: "srt", output_path: path.join(dir, "b.srt"), approved_workspace_path: dir, track_index: 1 } });
    expect(beyond.data.export.reason).toContain("1 caption track (index 0)");
    mocked.mockResolvedValue(hostReply([], { trackCount: 0 }) as any);
    const nothing = await call({ export: { format: "srt", output_path: path.join(dir, "c.srt"), approved_workspace_path: dir, track_index: 3 } });
    expect(nothing.data.export.reason).toContain("most CEP builds expose no caption text");
    mocked.mockResolvedValue(hostReply([], { trackCount: 2 }) as any);
    const empty = await call({ export: { format: "srt", output_path: path.join(dir, "d.srt"), approved_workspace_path: dir, track_index: 7 } });
    expect(empty.data.export.reason).toContain("matches no caption track");
  });

  it("rejects a bad export request before contacting Premiere", async () => {
    const dir = makeTempDir("seq-captions-");
    writeFileSync(path.join(dir, "taken.srt"), "keep");
    const bad: Array<[unknown, string]> = [
      ["srt", "export must be an object"],
      [[], "export must be an object"],
      [{ format: "ass", output_path: path.join(dir, "a.ass"), approved_workspace_path: dir }, "export.format"],
      [{ format: "srt", approved_workspace_path: dir }, "required"],
      [{ format: "srt", output_path: path.join(dir, "a.srt"), approved_workspace_path: dir, track_index: -1 }, "track_index"],
      [{ format: "srt", output_path: path.join(dir, "a.vtt"), approved_workspace_path: dir }, "must end in .srt"],
      [{ format: "srt", output_path: path.join(dir, "taken.srt"), approved_workspace_path: dir }, "already exists"],
      [{ format: "srt", output_path: path.join(makeTempDir("elsewhere-"), "a.srt"), approved_workspace_path: dir }, "contained"],
    ];
    for (const [value, message] of bad) {
      const result = await call({ export: value });
      expect(result.success).toBe(false);
      expect(result.error).toContain(message);
    }
    expect(mocked).not.toHaveBeenCalled();
    expect(readFileSync(path.join(dir, "taken.srt"), "utf8")).toBe("keep");
  });

  it("reports a file that appears between validation and writing instead of overwriting it", async () => {
    const dir = makeTempDir("seq-captions-");
    const target = path.join(dir, "race.srt");
    mocked.mockImplementation(async () => {
      writeFileSync(target, "someone else");
      return hostReply(readable) as any;
    });
    const result = await call({ export: { format: "srt", output_path: target, approved_workspace_path: dir } });
    expect(result.data.export.refused).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("someone else");
  });

  it("looks the sequence up by id when asked", async () => {
    mocked.mockResolvedValue(hostReply([]) as any);
    await call({ sequence_id: "seq-9" });
    expect(String(mocked.mock.calls[0][0])).toContain('__findSequence("seq-9")');
  });
});
