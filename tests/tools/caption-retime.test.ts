import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCaptionAuthoringTools, MAX_CAPTION_INPUT_BYTES, MAX_INLINE_ARTIFACT_BYTES, resolveContainedInputPath } from "../../src/tools/caption-authoring.js";
import { parseCaptionFile, retimeCaptionBlocks, serializeCaptionFile, validateRetimeRanges } from "../../src/ai/caption-retime.js";
import { capabilitiesForToolInvocation, capabilityForTool, guardToolHandler, resolveCapabilities } from "../../src/security/capabilities.js";
import { annotationsForTool } from "../../src/workflows/tool-metadata.js";
import { WORKFLOW_TOOL_PACKS as TOOL_PACKS } from "../../src/workflows/tool-packs.js";

const tool = getCaptionAuthoringTools().retime_caption_file;
const run = (args: Record<string, unknown>) => tool.handler(args) as Promise<{ success: boolean; error?: string; data?: any }>;

const SRT = [
  "1", "00:00:01,000 --> 00:00:02,000", "One",
  "",
  "2", "00:00:03,000 --> 00:00:05,000", "Two", "second line",
  "",
  "3", "00:00:06,000 --> 00:00:07,000", "Three",
  "",
  "4", "00:00:08,000 --> 00:00:09,500", "Four",
  "",
].join("\n");

const VTT = [
  "WEBVTT - retime fixture",
  "Kind: captions",
  "",
  "STYLE",
  "::cue { color: yellow; }",
  "",
  "NOTE keep me",
  "",
  "intro",
  "00:01.000 --> 00:02.000 align:start position:10%",
  "<v Ann>Hello <00:01.500>there",
  "",
  "00:00:03.000 --> 00:00:05.000 line:90%",
  "Second <00:04.000>cue",
  "",
  "NOTE trailing note",
  "",
  "00:00:06.000 --> 00:00:07.000",
  "Third",
  "",
].join("\n");

describe("retime_caption_file: shift", () => {
  it("shifts every cue by seconds and renumbers SRT", async () => {
    const result = await run({ operation: "shift", content: SRT, offset_seconds: 1.25 });
    expect(result.success).toBe(true);
    expect(result.data.content).toContain("1\n00:00:02,250 --> 00:00:03,250\nOne");
    expect(result.data.content).toContain("4\n00:00:09,250 --> 00:00:10,750\nFour");
    expect(result.data.summary).toMatchObject({ cues_in: 4, cues_out: 4, shifted: 4, removed: 0, first_start: "00:00:02,250", last_end: "00:00:10,750", rounding: "milliseconds" });
    expect(result.data.applied_to_premiere).toBe(false);
    expect(result.data.next_steps.join(" ")).toMatch(/create_caption_track.*action import/);
    expect(result.data.next_steps.join(" ")).toMatch(/get_caption_style_guidance/);
  });

  it("shifts only cues starting at or after from_seconds, in frames", async () => {
    const result = await run({ operation: "shift", content: SRT, offset_frames: 12, fps: 24, from_seconds: 6 });
    expect(result.success).toBe(true);
    expect(result.data.summary).toMatchObject({ shifted: 2, unchanged: 2, rounding: "frames at 24 fps" });
    expect(result.data.content).toContain("00:00:06,500 --> 00:00:07,500\nThree");
    expect(result.data.content).toContain("00:00:01,000 --> 00:00:02,000\nOne");
  });

  it("removes cues pushed before zero and trims cues crossing zero", async () => {
    const result = await run({ operation: "shift", content: SRT, offset_seconds: -2.5 });
    expect(result.success).toBe(true);
    expect(result.data.summary).toMatchObject({ cues_in: 4, cues_out: 3, removed: 1, trimmed: 0, shifted: 3 });
    const crossing = await run({ operation: "shift", content: SRT, offset_seconds: -3.5 });
    expect(crossing.data.summary).toMatchObject({ removed: 1, trimmed: 1 });
    expect(crossing.data.content).toContain("1\n00:00:00,000 --> 00:00:01,500\nTwo");
    expect(crossing.data.warnings.join(" ")).toMatch(/before 0/);
  });

  it("requires exactly one offset and fps for frames", async () => {
    expect((await run({ operation: "shift", content: SRT })).error).toMatch(/exactly one of offset_seconds or offset_frames/);
    expect((await run({ operation: "shift", content: SRT, offset_seconds: 1, offset_frames: 2, fps: 24 })).error).toMatch(/exactly one/);
    expect((await run({ operation: "shift", content: SRT, offset_frames: 2 })).error).toMatch(/requires fps/);
    expect((await run({ operation: "shift", content: SRT, offset_frames: 1.5, fps: 24 })).error).toMatch(/integer/);
    expect((await run({ operation: "shift", content: SRT, offset_seconds: 1, fps: 0 })).error).toMatch(/fps/);
    expect((await run({ operation: "shift", content: SRT, offset_seconds: 1, ranges: [{ start: 0, end: 1 }] })).error).toMatch(/ranges is not accepted for operation shift/);
  });
});

describe("retime_caption_file: ripple_remove_ranges", () => {
  it("deletes contained cues, trims straddlers, and closes gaps", async () => {
    // Remove 2.5–4 (trims cue 2 start) and 5.5–7.5 (deletes cue 3, shifts cue 4).
    const result = await run({ operation: "ripple_remove_ranges", content: SRT, ranges: [{ start: 2.5, end: 4 }, { start: 5.5, end: 7.5 }] });
    expect(result.success).toBe(true);
    expect(result.data.summary).toMatchObject({ cues_in: 4, cues_out: 3, removed: 1, trimmed: 1, shifted: 1, unchanged: 1 });
    expect(result.data.content).toBe([
      "1", "00:00:01,000 --> 00:00:02,000", "One", "",
      "2", "00:00:02,500 --> 00:00:03,500", "Two", "second line", "",
      "3", "00:00:04,500 --> 00:00:06,000", "Four", "",
    ].join("\n"));
    expect(result.data.changes.map((change: any) => change.change)).toEqual(["trimmed", "removed", "shifted"]);
  });

  it("contracts a cue that spans a whole removed range and trims a cue end", async () => {
    const result = await run({ operation: "ripple_remove_ranges", content: SRT, ranges: [{ start: 1.5, end: 2.5 }, { start: 3.5, end: 4 }] });
    expect(result.data.content).toContain("1\n00:00:01,000 --> 00:00:01,500\nOne");
    expect(result.data.content).toContain("2\n00:00:02,000 --> 00:00:03,500\nTwo");
    expect(result.data.summary).toMatchObject({ trimmed: 2, shifted: 2 });
  });

  it("treats cues touching a range edge as outside it", async () => {
    const result = await run({ operation: "ripple_remove_ranges", content: SRT, ranges: [{ start: 2, end: 3 }] });
    expect(result.data.summary).toMatchObject({ unchanged: 1, shifted: 3, trimmed: 0, removed: 0 });
    expect(result.data.content).toContain("2\n00:00:02,000 --> 00:00:04,000\nTwo");
  });

  it("snaps ranges to frames like ripple_remove_timeline_ranges and reports adjustments", async () => {
    const result = await run({ operation: "ripple_remove_ranges", content: SRT, fps: 25, ranges: [{ start: 2.51, end: 2.99 }] });
    expect(result.success).toBe(true);
    expect(result.data.range_adjustments).toEqual([{ range_index: 0, requested: { start: 2.51, end: 2.99 }, snapped: { start: 2.52, end: 3 } }]);
    expect(result.data.content).toContain("00:00:02,520 --> 00:00:04,520\nTwo");
  });

  it("rejects unsorted, overlapping, empty, and oversized range lists", () => {
    expect(() => validateRetimeRanges([{ start: 3, end: 4 }, { start: 1, end: 2 }])).toThrow(/sorted and non-overlapping/);
    expect(() => validateRetimeRanges([{ start: 1, end: 3 }, { start: 2, end: 4 }])).toThrow(/non-overlapping/);
    expect(() => validateRetimeRanges([{ start: 2, end: 2 }])).toThrow(/end > start/);
    expect(() => validateRetimeRanges([{ start: -1, end: 2 }])).toThrow(/non-negative/);
    expect(() => validateRetimeRanges([])).toThrow(/1 to 50/);
    expect(() => validateRetimeRanges(Array.from({ length: 51 }, (_, i) => ({ start: i, end: i + 0.5 })))).toThrow(/1 to 50/);
    expect(() => validateRetimeRanges(["x"])).toThrow(/must be an object/);
    expect(() => validateRetimeRanges([{ start: 1, end: 1.01 }]).length).not.toThrow();
  });

  it("fails when ranges collapse after frame snapping or remove every cue", async () => {
    expect((await run({ operation: "ripple_remove_ranges", content: SRT, fps: 10, ranges: [{ start: 1.01, end: 1.02 }] })).error).toMatch(/empty after snapping/);
    expect((await run({ operation: "ripple_remove_ranges", content: SRT, fps: 10, ranges: [{ start: 1, end: 1.06 }, { start: 1.06, end: 2 }] })).success).toBe(true);
    expect((await run({ operation: "ripple_remove_ranges", content: SRT, ranges: [{ start: 0, end: 20 }] })).error).toMatch(/removed every cue/);
  });
});

describe("retime_caption_file: ripple_insert", () => {
  it("splits a straddling cue by default and shifts later cues", async () => {
    const result = await run({ operation: "ripple_insert", content: SRT, at_seconds: 4, duration_seconds: 2 });
    expect(result.success).toBe(true);
    expect(result.data.summary).toMatchObject({ cues_in: 4, cues_out: 5, split: 1, shifted: 2, unchanged: 1 });
    expect(result.data.content).toContain("2\n00:00:03,000 --> 00:00:04,000\nTwo\nsecond line");
    expect(result.data.content).toContain("3\n00:00:06,000 --> 00:00:07,000\nTwo\nsecond line");
    expect(result.data.content).toContain("5\n00:00:10,000 --> 00:00:11,500\nFour");
  });

  it("extends a straddling cue when requested", async () => {
    const result = await run({ operation: "ripple_insert", content: SRT, at_seconds: 4, duration_frames: 48, fps: 24, straddle_policy: "extend" });
    expect(result.data.summary).toMatchObject({ cues_out: 4, trimmed: 1, split: 0 });
    expect(result.data.content).toContain("2\n00:00:03,000 --> 00:00:07,000\nTwo");
  });

  it("moves a cue starting exactly at the insert point and leaves cues ending there", async () => {
    const result = await run({ operation: "ripple_insert", content: SRT, at_seconds: 3, duration_seconds: 1 });
    expect(result.data.summary).toMatchObject({ unchanged: 1, shifted: 3, split: 0 });
  });

  it("validates insert arguments", async () => {
    expect((await run({ operation: "ripple_insert", content: SRT, duration_seconds: 1 })).error).toMatch(/at_seconds/);
    expect((await run({ operation: "ripple_insert", content: SRT, at_seconds: 1, duration_seconds: 0 })).error).toMatch(/greater than 0/);
    expect((await run({ operation: "ripple_insert", content: SRT, at_seconds: 1, duration_seconds: 1, straddle_policy: "merge" })).error).toMatch(/straddle_policy/);
  });
});

describe("retime_caption_file: edit_cue", () => {
  it("replaces text and timing of one cue", async () => {
    const result = await run({ operation: "edit_cue", content: SRT, cue_index: 2, text: "Fixed\r\nline", start_seconds: 2.5, end_seconds: 5.5 });
    expect(result.success).toBe(true);
    expect(result.data.content).toContain("2\n00:00:02,500 --> 00:00:05,500\nFixed\nline\n");
    expect(result.data.summary).toMatchObject({ edited: 1, unchanged: 3 });
    expect(result.data.changes).toEqual([{ cue_index: 2, change: "edited", before: { start: "00:00:03,000", end: "00:00:05,000" }, after: [{ start: "00:00:02,500", end: "00:00:05,500" }] }]);
  });

  it("reorders cues moved past a neighbour and warns about overlaps", async () => {
    const result = await run({ operation: "edit_cue", content: SRT, cue_index: 1, start_seconds: 8.2, end_seconds: 8.4 });
    expect(result.data.warnings.join(" ")).toMatch(/reordered/);
    expect(result.data.warnings.join(" ")).toMatch(/overlap/);
    expect(result.data.summary.overlapping_cue_pairs).toBe(1);
    expect(result.data.content.indexOf("One")).toBeGreaterThan(result.data.content.indexOf("Four"));
  });

  it("validates the cue edit", async () => {
    expect((await run({ operation: "edit_cue", content: SRT, cue_index: 5, text: "x" })).error).toMatch(/cue_index must be an integer from 1 through 4/);
    expect((await run({ operation: "edit_cue", content: SRT, cue_index: 1 })).error).toMatch(/at least one/);
    expect((await run({ operation: "edit_cue", content: SRT, cue_index: 1, end_seconds: 0.5 })).error).toMatch(/must end after it starts/);
    expect((await run({ operation: "edit_cue", content: SRT, cue_index: 1, text: "a\n\nb" })).error).toMatch(/blank lines/);
    expect((await run({ operation: "edit_cue", content: SRT, cue_index: 1, text: "a --> b" })).error).toMatch(/-->/);
    expect((await run({ operation: "edit_cue", content: SRT, cue_index: 1, text: "   " })).error).toMatch(/non-blank/);
    expect((await run({ operation: "edit_cue", content: SRT, cue_index: 1, text: "x".repeat(2001) })).error).toMatch(/at most 2000/);
    expect((await run({ operation: "edit_cue", content: SRT, cue_index: 1, text: 5 })).error).toMatch(/text must be a string/);
  });
});

describe("retime_caption_file: VTT preservation and conversion", () => {
  it("keeps header, STYLE, NOTE, identifiers, settings, and remaps karaoke stamps", async () => {
    const result = await run({ operation: "ripple_remove_ranges", content: VTT, ranges: [{ start: 1.25, end: 1.75 }, { start: 3.5, end: 4.5 }] });
    expect(result.success).toBe(true);
    const text: string = result.data.content;
    expect(text.startsWith("WEBVTT - retime fixture\nKind: captions\n\nSTYLE\n::cue { color: yellow; }\n\nNOTE keep me\n\nintro\n")).toBe(true);
    expect(text).toContain("intro\n00:00:01.000 --> 00:00:01.500 align:start position:10%\n<v Ann>Hello <00:00:01.250>there");
    expect(text).toContain("00:00:02.500 --> 00:00:03.500 line:90%\nSecond <00:00:03.000>cue");
    expect(text).toContain("NOTE trailing note\n\n00:00:04.500 --> 00:00:05.500\nThird");
    expect(result.data.output.format).toBe("vtt");
  });

  it("splits identifiers uniquely on ripple_insert", async () => {
    const result = await run({ operation: "ripple_insert", content: VTT, at_seconds: 1.5, duration_seconds: 1 });
    expect(result.data.content).toContain("intro\n00:00:01.000 --> 00:00:01.500");
    expect(result.data.content).toContain("intro-2\n00:00:02.500 --> 00:00:03.000");
  });

  it("converts VTT to SRT with warnings and SRT to VTT", async () => {
    const toSrt = await run({ operation: "shift", content: VTT, offset_seconds: 0, output_format: "srt" });
    expect(toSrt.data.content).toBe([
      "1", "00:00:01,000 --> 00:00:02,000", "Ann: Hello there", "",
      "2", "00:00:03,000 --> 00:00:05,000", "Second cue", "",
      "3", "00:00:06,000 --> 00:00:07,000", "Third", "",
    ].join("\n"));
    expect(toSrt.data.warnings.join(" ")).toMatch(/dropped the WEBVTT header and 3 NOTE\/STYLE\/REGION/);
    expect(toSrt.data.warnings.join(" ")).toMatch(/cue settings on 2/);
    const toVtt = await run({ operation: "shift", content: SRT, offset_seconds: 0, output_format: "vtt" });
    expect(toVtt.data.content.startsWith("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOne\n\n")).toBe(true);
  });

  it("accepts BOM and CRLF input and detects VTT from the header", async () => {
    const crlf = `﻿${VTT.replace(/\n/g, "\r\n")}`;
    const result = await run({ operation: "shift", content: crlf, offset_seconds: 1 });
    expect(result.success).toBe(true);
    expect(result.data.input.format).toBe("vtt");
    expect(result.data.content).not.toMatch(/\r|﻿/);
    const srt = await run({ operation: "shift", content: `﻿${SRT.replace(/\n/g, "\r\n")}`, offset_seconds: 1 });
    expect(srt.data.summary.cues_out).toBe(4);
  });

  it("keeps SRT position coordinates when staying SRT", () => {
    const parsed = parseCaptionFile("1\n00:00:01,000 --> 00:00:02,000 X1:10 X2:20 Y1:30 Y2:40\nHi\n");
    const result = retimeCaptionBlocks(parsed, { operation: "shift", offset_seconds: 1 });
    expect(serializeCaptionFile(result.blocks, "srt", "srt", [])).toBe("1\n00:00:02,000 --> 00:00:03,000 X1:10 X2:20 Y1:30 Y2:40\nHi\n");
  });
});

describe("retime_caption_file: malformed input", () => {
  it.each([
    ["1\n00:00:01,000 -> 00:00:02,000\nx\n", /line 1: block has no "-->"/],
    ["1\n00:00:01.0 --> 00:00:02,000\nx\n", /line 2: invalid SRT timestamp/],
    ["1\n00:01,000 --> 00:00:02,000\nx\n", /line 2: SRT timestamps need hours/],
    ["1\n00:00:03,000 --> 00:00:02,000\nx\n", /line 2: cue must end after it starts/],
    ["a\n00:00:01,000 --> 00:00:02,000\nx\n", /line 1: SRT cue number/],
    ["1\n00:00:01,000 --> 00:00:02,000 junk\nx\n", /line 2: unexpected text/],
    ["1\n00:00:01,000 --> 00:00:02,000\nx\n00:00:03,000 --> 00:00:04,000\ny\n", /line 4: cue text contains "-->"/],
    ["1\n2\n3\n00:00:01,000 --> 00:00:02,000\n", /line 4: timing line must be the first or second/],
    ["\n\n   \n", /empty/],
  ])("rejects SRT %#", (content, error) => {
    expect(() => parseCaptionFile(content, "srt")).toThrow(error);
  });

  it("rejects malformed VTT with line numbers", () => {
    expect(() => parseCaptionFile("00:01.000 --> 00:02.000\nx\n", "vtt")).toThrow(/line 1: a VTT file must begin with WEBVTT/);
    expect(() => parseCaptionFile("WEBVTT\n00:01.000 --> 00:02.000\nx\n", "vtt")).toThrow(/header must be followed by a blank line/);
    expect(() => parseCaptionFile("WEBVTT\n\n00:01.000 --> 00:02.000\nx\n\nSTYLE\n::cue {}\n", "vtt")).toThrow(/line 6: STYLE blocks must appear before the first cue/);
    expect(() => parseCaptionFile("WEBVTT\n\nNOTE only\n", "vtt")).toThrow(/no timed cues/);
    expect(() => parseCaptionFile("WEBVTT\n\n00:61.000 --> 01:02.000\nx\n", "vtt")).toThrow(/line 3: invalid VTT timestamp/);
  });

  it("warns about cues without text and bounds the content size", () => {
    expect(parseCaptionFile("1\n00:00:01,000 --> 00:00:02,000\n", "srt").warnings).toEqual(["line 2: cue has no text"]);
    expect(() => parseCaptionFile("x".repeat(750_001), "srt")).toThrow(/exceeds 750000 characters/);
    expect(() => parseCaptionFile(Array.from({ length: 10_001 }, (_, i) => `${i + 1}\n00:00:01,000 --> 00:00:02,000\nx`).join("\n\n"), "srt")).toThrow(/exceeds 10000 cues/);
  });

  it("returns handler errors instead of throwing", async () => {
    expect((await run({ operation: "shift", content: "garbage", offset_seconds: 1 })).error).toMatch(/line 1/);
    expect((await run({ operation: "bogus", content: SRT })).error).toMatch(/operation must be one of/);
    expect((await run(null as any)).error).toMatch(/arguments must be an object/);
    expect((await run({ operation: "shift", offset_seconds: 1 })).error).toMatch(/exactly one of input_path or content/);
    expect((await run({ operation: "shift", content: SRT, offset_seconds: 1, input_format: "ass" })).error).toMatch(/input_format must be srt or vtt/);
    expect((await run({ operation: "shift", content: SRT, offset_seconds: 1, return_content: "yes" })).error).toMatch(/return_content must be a boolean/);
    expect((await run({ operation: "shift", content: SRT, offset_seconds: 1, approved_workspace_path: "/tmp" })).error).toMatch(/only accepted together/);
  });
});

describe("retime_caption_file: files and path guards", () => {
  let workspace: string;
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "caption-retime-"));
  });
  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("reads input_path and writes output_path inside the workspace without overwriting", async () => {
    const input = join(workspace, "in.srt");
    writeFileSync(input, SRT);
    const output = join(workspace, "out.vtt");
    const result = await run({ operation: "shift", input_path: input, output_path: output, approved_workspace_path: workspace, offset_seconds: 1 });
    expect(result.success).toBe(true);
    const written = readFileSync(output, "utf8");
    expect(written.startsWith("WEBVTT\n\n00:00:02.000")).toBe(true);
    expect(result.data.output).toMatchObject({ format: "vtt", written: true, sha256: createHash("sha256").update(written).digest("hex") });
    expect(result.data.content).toBeUndefined();
    expect(result.data.next_steps[0]).toContain("import_media");
    const again = await run({ operation: "shift", input_path: input, output_path: output, approved_workspace_path: workspace, offset_seconds: 1 });
    expect(again.error).toMatch(/already exists and will not be overwritten/);
    const inline = await run({ operation: "shift", input_path: input, output_path: join(workspace, "out2.srt"), approved_workspace_path: workspace, offset_seconds: 1, return_content: true });
    expect(inline.data.content).toBe(readFileSync(join(workspace, "out2.srt"), "utf8"));
  });

  it("requires the workspace and matching extensions", async () => {
    const input = join(workspace, "in.srt");
    writeFileSync(input, SRT);
    expect((await run({ operation: "shift", input_path: input, offset_seconds: 1 })).error).toMatch(/approved_workspace_path is required/);
    expect((await run({ operation: "shift", content: SRT, output_path: join(workspace, "x.srt"), offset_seconds: 1 })).error).toMatch(/approved_workspace_path is required/);
    expect((await run({ operation: "shift", content: SRT, output_path: join(workspace, "x.txt"), approved_workspace_path: workspace, offset_seconds: 1 })).error).toMatch(/output_path must end in .srt or .vtt/);
    expect((await run({ operation: "shift", content: SRT, output_path: join(workspace, "x.srt"), output_format: "vtt", approved_workspace_path: workspace, offset_seconds: 1 })).error).toMatch(/does not match output_format vtt/);
    const txt = join(workspace, "in.txt");
    writeFileSync(txt, SRT);
    expect((await run({ operation: "shift", input_path: txt, approved_workspace_path: workspace, offset_seconds: 1 })).error).toMatch(/input_path must end in .srt or .vtt/);
    expect((await run({ operation: "shift", input_path: txt, input_format: "srt", approved_workspace_path: workspace, offset_seconds: 1 })).success).toBe(true);
  });

  it("rejects inputs outside the workspace, through symlinks, missing, relative, directories, and oversized", () => {
    const outside = mkdtempSync(join(tmpdir(), "caption-retime-outside-"));
    try {
      const foreign = join(outside, "x.srt");
      writeFileSync(foreign, SRT);
      expect(() => resolveContainedInputPath(workspace, foreign)).toThrow(/contained within/);
      symlinkSync(foreign, join(workspace, "link.srt"));
      expect(() => resolveContainedInputPath(workspace, join(workspace, "link.srt"))).toThrow(/contained within/);
      expect(() => resolveContainedInputPath(workspace, join(workspace, "missing.srt"))).toThrow(/does not exist/);
      expect(() => resolveContainedInputPath(workspace, "relative.srt")).toThrow(/absolute path/);
      expect(() => resolveContainedInputPath(join(workspace, "nope"), join(workspace, "a.srt"))).toThrow(/existing directory/);
      expect(() => resolveContainedInputPath(workspace, workspace)).toThrow(/contained within/);
      mkdirSync(join(workspace, "dir.srt"));
      expect(() => resolveContainedInputPath(workspace, join(workspace, "dir.srt"))).toThrow(/regular file/);
      const big = join(workspace, "big.srt");
      writeFileSync(big, Buffer.alloc(MAX_CAPTION_INPUT_BYTES + 1, 0x20));
      expect(() => resolveContainedInputPath(workspace, big)).toThrow(/caption file limit/);
      const file = join(workspace, "file");
      writeFileSync(file, "");
      expect(() => resolveContainedInputPath(file, foreign)).toThrow(/existing directory/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("bounds inline output and points at output_path", async () => {
    const cues = Array.from({ length: 6_000 }, (_, i) => `${i + 1}\n00:00:01,000 --> 00:00:02,000\n${"w".repeat(60)}`).join("\n\n");
    const result = await run({ operation: "shift", content: cues, offset_seconds: 1 });
    expect(result.error).toMatch(new RegExp(`above the ${MAX_INLINE_ARTIFACT_BYTES}-byte inline limit; pass output_path`));
    const withPath = await run({ operation: "shift", content: cues, offset_seconds: 1, output_path: join(workspace, "big.srt"), approved_workspace_path: workspace, return_content: true });
    expect(withPath.error).toMatch(/omit return_content/);
    const written = await run({ operation: "shift", content: cues, offset_seconds: 1, output_path: join(workspace, "big2.srt"), approved_workspace_path: workspace });
    expect(written.success).toBe(true);
    expect(written.data.changes).toHaveLength(50);
    expect(written.data.changes_truncated).toBe(true);
  });
});

describe("retime_caption_file: registration and authority", () => {
  it("is not advertised as read-only (it can write a file) and is in the captions pack", () => {
    expect(annotationsForTool("retime_caption_file")).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    expect(TOOL_PACKS.find((pack) => pack.name === "captions")?.tools).toContain("retime_caption_file");
  });

  it("needs filesystem only when a path is involved", async () => {
    expect(capabilityForTool("retime_caption_file")).toBe("inspect");
    expect(capabilitiesForToolInvocation("retime_caption_file", { content: SRT })).toEqual(["inspect"]);
    expect(capabilitiesForToolInvocation("retime_caption_file", { input_path: "/x.srt" })).toEqual(["inspect", "filesystem"]);
    expect(capabilitiesForToolInvocation("retime_caption_file", { content: SRT, output_path: "/x.srt" })).toEqual(["inspect", "filesystem"]);
    const inspectOnly = resolveCapabilities("inspect");
    const guarded = guardToolHandler("retime_caption_file", tool.handler as any, inspectOnly);
    await expect(guarded({ operation: "shift", content: SRT, offset_seconds: 1 })).resolves.toMatchObject({ success: true });
    await expect(guarded({ operation: "shift", input_path: "/x.srt", approved_workspace_path: "/", offset_seconds: 1 })).rejects.toThrow(/filesystem/);
  });
});
