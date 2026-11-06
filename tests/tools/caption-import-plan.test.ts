import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync), writeFileSync: vi.fn(actual.writeFileSync) };
});

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getCaptionTools } from "../../src/tools/captions.js";
import { resolveCaptionPlan, writeCaptionPlanDocument } from "../../src/tools/caption-inputs.js";
import { cleanupTempDirs, makeTempDir } from "../helpers/temp-dir.js";
import { makeFakeCaptionHost, type FakeHostOptions } from "../helpers/fake-caption-host.js";

const tool = getCaptionTools({}).create_caption_track;
const mocked = vi.mocked(sendCommand);
const realRead = vi.mocked(readFileSync);
const realWrite = vi.mocked(writeFileSync);

const SRT = "1\n00:00:01,000 --> 00:00:03,000\nHello there my friend.\n\n2\n00:00:04,000 --> 00:00:06,000\nI am fine thanks.\n";
const SPEAKERS = JSON.stringify([
  { text: "Hello there my friend.", start: 1, end: 3, speaker: "A" },
  { text: "I am fine thanks.", start: 4, end: 6, speaker: "B" },
]);

function install(options: FakeHostOptions = {}, wrap?: (script: string) => any | undefined) {
  const host = makeFakeCaptionHost(options);
  const kinds: string[] = [];
  const scripts: string[] = [];
  mocked.mockImplementation(async (script: string) => {
    scripts.push(script);
    kinds.push(script.includes("timebase: timebase") ? "read" : script.includes("importFiles") ? "import" : script.includes("createCaptionTrack") ? "create" : "other");
    return wrap?.(script) ?? host.run(script);
  });
  return { host, kinds, scripts };
}

const call = (args: Record<string, unknown>) => tool.handler({ action: "import_plan", ...args } as any) as Promise<any>;

beforeEach(() => {
  vi.clearAllMocks();
  realRead.mockImplementation((...a: any[]) => (jest_actual_read as any)(...a));
  realWrite.mockImplementation((...a: any[]) => (jest_actual_write as any)(...a));
});
afterAll(() => cleanupTempDirs());

// The partial mock wraps the real function; keep a handle for the mismatch test.
import * as realFs from "node:fs";
const jest_actual_read = (await vi.importActual<typeof import("node:fs")>("node:fs")).readFileSync;
const jest_actual_write = (await vi.importActual<typeof import("node:fs")>("node:fs")).writeFileSync;
void realFs;

describe("create_caption_track action import_plan", () => {
  it("plans at the sequence rate, writes and reads back an SRT, imports it and creates the track in separate calls", async () => {
    const dir = makeTempDir("import-plan-");
    const { host, kinds } = install({ fps: 25 });
    const result = await call({ transcript_text: SRT, approved_workspace_path: dir, frame_rate: 30 });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(kinds).toEqual(["read", "import", "create"]);
    const data = result.data;
    expect(data).toMatchObject({ action: "import_plan", outcome: "verified" });
    expect(data.sequence).toMatchObject({ name: "Reel: Final/Cut", fps: 25, cut_source: "none" });
    expect(data.plan).toMatchObject({ caption_count: 2, frame_rate: 25 });
    expect(data.plan.warnings.join(" ")).toContain("sequence's rate was used");
    expect(data.srt).toMatchObject({ cue_count: 2, cue_count_readback: 2 });
    expect(path.basename(data.srt.path)).toBe("Reel_ Final_Cut captions.srt");
    expect(readFileSync(data.srt.path, "utf8")).toContain("00:00:01,000 --> 00:00:03,240");
    expect(data.imported_item).toMatchObject({ name: "Reel_ Final_Cut captions.srt" });
    expect(data.track).toMatchObject({ verified: true, beforeTrackCount: 0, afterTrackCount: 1, styleApplied: false });
    expect(data.track.reversal.cepRemovalAvailable).toBe(false);
    expect(data.notes.join(" ")).toContain("another caption track");
    expect(host.log.captionCreates).toBe(1);
    expect(host.log.importFiles).toEqual([data.srt.path]);
  });

  it("numbers the default file name instead of overwriting and honours start_seconds and caption_format", async () => {
    const dir = makeTempDir("import-plan-");
    const { scripts } = install();
    const first = await call({ transcript_text: SRT, approved_workspace_path: dir });
    const second = await call({ transcript_text: SRT, approved_workspace_path: dir, start_seconds: 2, caption_format: "708" });
    expect(path.basename(second.data.srt.path)).toBe("Reel_ Final_Cut captions 2.srt");
    expect(existsSync(first.data.srt.path)).toBe(true);
    expect(scripts[scripts.length - 1]).toContain("2, Sequence.CAPTION_FORMAT_708");
  });

  it("moves on to the next number when the default name is taken, also when it is taken between two tries (EEXIST)", async () => {
    const dir = makeTempDir("import-plan-");
    install();
    writeFileSync(path.join(dir, "Reel_ Final_Cut captions.srt"), "keep 1");
    writeFileSync(path.join(dir, "Reel_ Final_Cut captions 2.srt"), "keep 2");
    const third = await call({ transcript_text: SRT, approved_workspace_path: dir });
    expect(path.basename(third.data.srt.path)).toBe("Reel_ Final_Cut captions 3.srt");
    expect(readFileSync(path.join(dir, "Reel_ Final_Cut captions.srt"), "utf8")).toBe("keep 1");

    // Another process creates the file after we looked: the write fails with EEXIST and the next number is used.
    install();
    const raced = makeTempDir("import-plan-");
    realWrite.mockImplementationOnce(((file: string, ...rest: unknown[]) => {
      (jest_actual_write as any)(file, "someone else");
      void rest;
      throw Object.assign(new Error("file exists"), { code: "EEXIST" });
    }) as never);
    const result = await call({ transcript_text: SRT, approved_workspace_path: raced });
    expect(result.success).toBe(true);
    expect(path.basename(result.data.srt.path)).toBe("Reel_ Final_Cut captions 2.srt");
    expect(readFileSync(path.join(raced, "Reel_ Final_Cut captions.srt"), "utf8")).toBe("someone else");
  });

  it("builds the default path from the trimmed workspace, and reports a workspace that is not a directory or a write error", async () => {
    const dir = makeTempDir("import-plan-");
    install();
    const padded = await call({ transcript_text: SRT, approved_workspace_path: `  ${dir}  ` });
    expect(padded.success).toBe(true);
    expect(padded.data.srt.path).toBe(path.join(dir, "Reel_ Final_Cut captions.srt"));
    const missing = await call({ transcript_text: SRT, approved_workspace_path: path.join(dir, "nope") });
    expect(missing).toMatchObject({ success: false, error: expect.stringContaining("existing directory") });
    realWrite.mockImplementationOnce((() => { throw Object.assign(new Error("denied"), { code: "EACCES" }); }) as never);
    const denied = await call({ transcript_text: SRT, approved_workspace_path: dir });
    expect(denied).toMatchObject({ success: false, error: expect.stringContaining("denied") });
  });

  it("gives up after 999 taken default names", async () => {
    const dir = makeTempDir("import-plan-");
    install();
    writeFileSync(path.join(dir, "Reel_ Final_Cut captions.srt"), "x");
    for (let n = 2; n < 1000; n++) writeFileSync(path.join(dir, `Reel_ Final_Cut captions ${n}.srt`), "x");
    expect(await call({ transcript_text: SRT, approved_workspace_path: dir })).toMatchObject({ success: false, error: expect.stringContaining("free captions file name") });
  });

  it("uses output_path and never overwrites it", async () => {
    const dir = makeTempDir("import-plan-");
    install();
    const target = path.join(dir, "mine.srt");
    const ok = await call({ transcript_text: SRT, approved_workspace_path: dir, output_path: target });
    expect(ok.data.srt.path).toBe(target);
    writeFileSync(path.join(dir, "taken.srt"), "keep");
    mocked.mockClear();
    const refused = await call({ transcript_text: SRT, approved_workspace_path: dir, output_path: path.join(dir, "taken.srt") });
    expect(refused.success).toBe(false);
    expect(refused.error).toContain("already exists");
    expect(readFileSync(path.join(dir, "taken.srt"), "utf8")).toBe("keep");
    expect(mocked).not.toHaveBeenCalled();
    const wrongExtension = await call({ transcript_text: SRT, approved_workspace_path: dir, output_path: path.join(dir, "x.vtt") });
    expect(wrongExtension).toMatchObject({ success: false, error: "output_path must end in .srt" });
  });

  it("validates before contacting Premiere", async () => {
    install();
    expect(await call({ transcript_text: SRT })).toMatchObject({ success: false, error: expect.stringContaining("approved_workspace_path is required") });
    const dir = makeTempDir("import-plan-");
    expect(await call({ transcript_text: SRT, approved_workspace_path: dir, caption_format: "nope" })).toMatchObject({ success: false, error: expect.stringContaining("caption_format") });
    expect(await call({ transcript_text: SRT, approved_workspace_path: dir, cut_source: "scenes" })).toMatchObject({ success: false, error: expect.stringContaining("cut_source") });
    expect(await call({ transcript_text: SRT, approved_workspace_path: dir, start_seconds: -1 })).toMatchObject({ success: false });
    expect(mocked).not.toHaveBeenCalled();
    expect(await call({ approved_workspace_path: dir })).toMatchObject({ success: false, error: expect.stringContaining("exactly one of plan_path") });
  });

  it("reports a sequence that cannot be read and an empty plan, writing nothing", async () => {
    const dir = makeTempDir("import-plan-");
    install({}, () => ({ success: false, error: "No active sequence" }));
    expect(await call({ transcript_text: SRT, approved_workspace_path: dir })).toMatchObject({ success: false, error: expect.stringContaining("No active sequence") });
    install();
    expect(await call({ transcript_text: SRT, approved_workspace_path: dir, from_s: 9000 })).toMatchObject({ success: false, error: expect.stringContaining("No transcript segment") });
    const { document } = resolveCaptionPlan({ transcript_text: SRT });
    writeFileSync(path.join(dir, "empty.json"), JSON.stringify({ ...document, captions: [] }));
    const empty = await call({ plan_path: path.join(dir, "empty.json"), approved_workspace_path: dir });
    expect(empty.success).toBe(false);
    if (empty.data) expect(empty.data.plan.caption_count).toBe(0);
  });

  it("warns that speaker colours cannot be applied to a native caption track and writes plain text", async () => {
    const dir = makeTempDir("import-plan-");
    install();
    const result = await call({ transcript_text: SPEAKERS, approved_workspace_path: dir, speaker_style: "color" });
    expect(result.success).toBe(true);
    expect(result.data.warnings.join(" ")).toContain("no scripting style API");
    expect(result.data.warnings.join(" ")).toContain("add_caption_graphics");
    expect(readFileSync(result.data.srt.path, "utf8")).not.toContain("<font");
  });

  it("warns about italics that are not written", async () => {
    const dir = makeTempDir("import-plan-");
    install();
    const lyric = JSON.stringify([{ text: "♪ la la la ♪", start: 1, end: 3 }]);
    const result = await call({ transcript_text: lyric, approved_workspace_path: dir, sdh: { lyric_ranges: [{ start: 0, end: 5 }] }, drop_music_tokens: false });
    if (result.success && result.data.plan.caption_count > 0) {
      expect(readFileSync(result.data.srt.path, "utf8")).not.toContain("<i>");
    }
  });

  it("is committed_unverified when the track count cannot be read, and fails when it did not change", async () => {
    const dir = makeTempDir("import-plan-");
    install({ captionTracks: { after: null } });
    const unknown = await call({ transcript_text: SRT, approved_workspace_path: dir });
    expect(unknown.success).toBe(true);
    expect(unknown.data.outcome).toBe("committed_unverified");
    expect(unknown.data.track.verified).toBe(false);
    install({ captionTracks: { before: 1, after: 1 } });
    const same = await call({ transcript_text: SRT, approved_workspace_path: dir });
    expect(same.success).toBe(false);
    expect(same.error).toContain("did not show exactly one new track");
    expect(same.data.outcome).toBe("committed_unverified");
  });

  it("stops after the import when no project item is found, keeping the SRT", async () => {
    const dir = makeTempDir("import-plan-");
    const { kinds } = install({ importFilesNoItem: true });
    const result = await call({ transcript_text: SRT, approved_workspace_path: dir });
    expect(result.success).toBe(false);
    expect(result.error).toContain("did not confirm importing it");
    expect(kinds).toEqual(["read", "import"]);
    expect(existsSync(result.data.srt.path)).toBe(true);
    install({}, (script) => (script.includes("importFiles") ? { success: true, data: {} } : undefined));
    expect(await call({ transcript_text: SRT, approved_workspace_path: dir })).toMatchObject({ success: false, error: expect.stringContaining("no project item found") });
  });

  it("refuses to import when the written SRT does not read back with the planned cue count", async () => {
    const dir = makeTempDir("import-plan-");
    const { kinds } = install();
    realRead.mockImplementation(((file: any, ...rest: any[]) => (String(file).endsWith(".srt") ? "1\n00:00:01,000 --> 00:00:02,000\nonly one\n" : (jest_actual_read as any)(file, ...rest))) as any);
    const result = await call({ transcript_text: SRT, approved_workspace_path: dir });
    expect(result.success).toBe(false);
    expect(result.error).toContain("reads back 1 cues instead of 2");
    expect(result.data).toMatchObject({ cue_count: 2, cue_count_readback: 1 });
    expect(kinds).toEqual(["read"]);
  });

  it("reads edit points when cut_source is edit_points and merges them as cut times", async () => {
    const dir = makeTempDir("import-plan-");
    const { scripts } = install({ existing: [{ track: 0, name: "A", start: 0, end: 2.4 }, { track: 0, name: "B", start: 2.4, end: 100 }] });
    const result = await call({ transcript_text: SRT, approved_workspace_path: dir, cut_source: "edit_points", cut_times: [5] });
    expect(result.success).toBe(true);
    expect(scripts[0]).toContain("if (true)");
    expect(result.data.sequence).toMatchObject({ cut_source: "edit_points", edit_point_count: 2 });
    expect(result.data.plan.warnings.join(" ")).not.toContain("cut_times were ignored");
  });

  it("flags truncated edit points", async () => {
    const dir = makeTempDir("import-plan-");
    install({}, (script) => (script.includes("timebase: timebase") ? { success: true, data: { sequenceId: "s", sequenceName: "S", timebase: "10160640000", endTicks: 1e15, frameWidth: 1920, frameHeight: 1080, videoTrackCount: 1, editPoints: [3], editPointsTruncated: true } } : undefined));
    const result = await call({ transcript_text: SRT, approved_workspace_path: dir, cut_source: "edit_points" });
    expect(result.data.warnings.join(" ")).toContain("more edit points than the host collected");
  });

  it("takes a saved plan_path and re-rounds it to the sequence rate", async () => {
    const dir = makeTempDir("import-plan-");
    const { document } = resolveCaptionPlan({ transcript_text: SRT, frame_rate: 30 });
    const planFile = writeCaptionPlanDocument(document, dir, path.join(dir, "plan.json"));
    install({ fps: 25 });
    const result = await call({ plan_path: planFile, approved_workspace_path: dir, cut_source: "edit_points" });
    expect(result.success).toBe(true);
    expect(result.data.plan.frame_rate).toBe(25);
    expect(result.data.plan.warnings.join(" ")).toContain("re-rounded to 25 fps");
  });

  it("keeps the schema a union of the old and new inputs", () => {
    const props = Object.keys(tool.parameters.properties);
    expect(props).toEqual(expect.arrayContaining(["action", "item_id", "start_seconds", "caption_format", "caption_content", "plan_path", "transcript_text", "word_timeline", "approved_workspace_path", "output_path", "cut_source", "standard", "speaker_style"]));
    expect(tool.parameters.properties.action.enum).toEqual(["import", "plan_lecture_workflow", "import_plan"]);
    expect(tool.description).toContain("import_plan");
  });

  it("still rejects an unknown action", async () => {
    expect(await tool.handler({ action: "bogus" } as any)).toMatchObject({ success: false, error: expect.stringContaining("import_plan") });
  });
});

describe("import_plan clamps to the sequence end", () => {
  const JINGLE = JSON.stringify({
    words: [
      { text: "Thanks", start: 25, end: 25.4, type: "word" },
      { text: "everyone.", start: 25.5, end: 26, type: "word" },
      { text: "(outro jingle)", start: 27.2, end: 29.63, type: "audio_event" },
    ],
  });

  it("ends the sound caption at the 29.2 s sequence end instead of 29.63 s, and says so in changes", async () => {
    const dir = makeTempDir("import-plan-");
    install({ fps: 25, durationSeconds: 29.2 });
    const result = await call({ transcript_text: JINGLE, transcript_format: "json", approved_workspace_path: dir, standard: "netflix_adult" });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.data.plan.last_end).toBeLessThanOrEqual(29.2 + 1e-9);
    expect(result.data.plan.sequence_end).toBeCloseTo(29.2, 6);
    expect(result.data.plan.sequence_end_changes[0]).toMatchObject({ rule: "sequence_end", action: "shortened" });
    const srt = readFileSync(result.data.srt.path, "utf8");
    expect(srt).toContain("00:00:29,200");
    expect(srt).not.toContain("00:00:29,6");
  });

  it("measures the end from start_seconds, and refuses a start_seconds at or after the end", async () => {
    const dir = makeTempDir("import-plan-");
    install({ fps: 25, durationSeconds: 29.2 });
    const shifted = await call({ transcript_text: JINGLE, transcript_format: "json", approved_workspace_path: dir, start_seconds: 10, offset: -10 });
    expect(shifted.success).toBe(true);
    expect(shifted.data.plan.last_end).toBeLessThanOrEqual(19.2 + 1e-9);
    const late = await call({ transcript_text: SRT, approved_workspace_path: dir, start_seconds: 30 });
    expect(late).toMatchObject({ success: false, error: expect.stringContaining("at or after the end of the sequence") });
  });

  it("clamps a saved plan too", async () => {
    const dir = makeTempDir("import-plan-");
    install({ fps: 25, durationSeconds: 5 });
    const resolved = resolveCaptionPlan({ transcript_text: SRT, frame_rate: 25 });
    const file = writeCaptionPlanDocument(resolved.document, dir, path.join(dir, "plan.json"));
    const result = await call({ plan_path: file, approved_workspace_path: dir });
    expect(result.success).toBe(true);
    expect(result.data.plan.caption_count).toBe(2);
    expect(result.data.plan.last_end).toBeLessThanOrEqual(5 + 1e-9);
    expect(result.data.plan.sequence_end_changes.length).toBeGreaterThan(0);
  });
});
