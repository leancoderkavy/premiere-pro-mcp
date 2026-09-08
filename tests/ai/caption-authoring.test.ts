import { describe, expect, it } from "vitest";
import {
  buildCaptionArtifact,
  checkCaptionSafeZone,
  describeCaptionStyle,
  formatCaptionTimestamp,
  normalizeCaptionAuthoringOptions,
  PLATFORM_SAFE_ZONES,
  SAFE_ZONE_PLATFORMS,
  suggestSafePosition,
  wrapCaptionWords,
} from "../../src/ai/caption-authoring.js";

const revision = `sha256:${"a".repeat(64)}`;
const word = (text: string, start: number, end: number, speaker_label?: string) => ({ text, start_seconds: start, end_seconds: end, ...(speaker_label ? { speaker_label } : {}) });
const timeline = (words: ReturnType<typeof word>[]) => ({ source_project_item_id: "clip-1", transcript_revision: revision, words });

const FIXTURE = timeline([
  word("Hello", 0, 0.4),
  word("world,", 0.45, 0.8),
  word("this", 0.9, 1.1),
  word("is", 1.1, 1.2),
  word("a", 1.2, 1.3),
  word("test.", 1.3, 1.8),
  word("Captions", 2.5, 3.0),
  word("rock!", 3.0, 3.4),
]);

const GOLDEN_SRT = [
  "1",
  "00:00:00,000 --> 00:00:01,100",
  "Hello world, this",
  "",
  "2",
  "00:00:01,100 --> 00:00:01,800",
  "is a test.",
  "",
  "3",
  "00:00:02,500 --> 00:00:03,400",
  "Captions rock!",
  "",
].join("\n");

const GOLDEN_VTT = `WEBVTT\n\n${GOLDEN_SRT.replace(/(\d{2}),(\d{3})/g, "$1.$2")}`;

describe("buildCaptionArtifact", () => {
  it("renders the golden SRT artifact", () => {
    const result = buildCaptionArtifact({ word_timeline: FIXTURE, format: "srt" });
    expect(result.artifact_text).toBe(GOLDEN_SRT);
    expect(result.cue_count).toBe(3);
    expect(result.cues.map((cue) => [cue.start_seconds, cue.end_seconds])).toEqual([[0, 1.1], [1.1, 1.8], [2.5, 3.4]]);
    expect(result.warnings).toEqual([]);
  });

  it("renders the golden VTT artifact with a WEBVTT header", () => {
    const result = buildCaptionArtifact({ word_timeline: FIXTURE, format: "vtt" });
    expect(result.artifact_text).toBe(GOLDEN_VTT);
    expect(result.artifact_text.startsWith("WEBVTT\n\n1\n")).toBe(true);
  });

  it("emits karaoke word timestamps inside VTT cues", () => {
    const result = buildCaptionArtifact({ word_timeline: FIXTURE, format: "vtt", karaoke: true });
    expect(result.cues.map((cue) => cue.text)).toEqual([
      "Hello <00:00:00.450>world, <00:00:00.900>this",
      "is <00:00:01.200>a <00:00:01.300>test.",
      "Captions <00:00:03.000>rock!",
    ]);
  });

  it("rejects karaoke for SRT", () => {
    expect(() => buildCaptionArtifact({ word_timeline: FIXTURE, format: "srt", karaoke: true })).toThrow(/karaoke.*vtt/);
  });

  it("wraps emphasis words with format-specific markup", () => {
    const srt = buildCaptionArtifact({ word_timeline: FIXTURE, format: "srt", emphasis_words: ["WORLD", "rock"] });
    expect(srt.cues[0].text).toBe("Hello <b>world,</b> this");
    expect(srt.cues[2].text).toBe("Captions <b>rock!</b>");
    const vtt = buildCaptionArtifact({ word_timeline: FIXTURE, format: "vtt", emphasis_words: ["world"], karaoke: true });
    expect(vtt.cues[0].text).toBe("Hello <00:00:00.450><c.emphasis>world,</c> <00:00:00.900>this");
  });

  it("never crosses a sentence boundary even when words_per_cue allows it", () => {
    const result = buildCaptionArtifact({ word_timeline: FIXTURE, format: "srt", words_per_cue: 12 });
    expect(result.cues.map((cue) => cue.text)).toEqual(["Hello world, this is a test.", "Captions rock!"]);
  });

  it("treats long pauses as sentence boundaries", () => {
    const paused = timeline([word("one", 0, 0.3), word("two", 0.3, 0.6), word("three", 2.0, 2.4), word("four", 2.4, 2.8)]);
    const result = buildCaptionArtifact({ word_timeline: paused, format: "srt", words_per_cue: 8 });
    expect(result.cues.map((cue) => cue.text)).toEqual(["one two", "three four"]);
  });

  it("balances groups instead of leaving an orphan word", () => {
    const five = timeline([word("a", 0, 0.2), word("b", 0.2, 0.4), word("c", 0.4, 0.6), word("d", 0.6, 0.8), word("e", 0.8, 1.0)]);
    const result = buildCaptionArtifact({ word_timeline: five, format: "srt", words_per_cue: 4, min_cue_seconds: 0.2 });
    expect(result.cues.map((cue) => cue.word_count)).toEqual([3, 2]);
  });

  it("extends short cues to min_cue_seconds without passing the next cue", () => {
    const short = timeline([word("Hi", 0, 0.1), word("there.", 0.1, 0.2), word("Next.", 0.35, 5.0)]);
    const result = buildCaptionArtifact({ word_timeline: short, format: "srt", min_cue_seconds: 0.5, max_cue_seconds: 5 });
    expect(result.cues[0].end_seconds).toBe(0.35);
    expect(result.cues[1].start_seconds).toBe(0.35);
    expect(result.warnings.some((entry) => /shorter than min_cue_seconds/.test(entry))).toBe(true);
    const spaced = timeline([word("Hi", 0, 0.1), word("there.", 0.1, 0.2), word("Next.", 5, 6)]);
    expect(buildCaptionArtifact({ word_timeline: spaced, format: "srt" }).cues[0].end_seconds).toBe(0.5);
  });

  it("shortens cues that exceed max_cue_seconds", () => {
    const long = timeline([word("Loooong", 0, 8)]);
    const result = buildCaptionArtifact({ word_timeline: long, format: "srt", max_cue_seconds: 5 });
    expect(result.cues[0].end_seconds).toBe(5);
    expect(result.warnings).toContain("cue 1 shortened to max_cue_seconds (5s)");
  });

  it("splits a sentence when its span would exceed max_cue_seconds", () => {
    const slow = timeline([word("one", 0, 1), word("two", 1, 2), word("three", 2, 3), word("four", 3, 4)]);
    const result = buildCaptionArtifact({ word_timeline: slow, format: "srt", words_per_cue: 8, max_cue_seconds: 2.5 });
    expect(result.cues.map((cue) => cue.text)).toEqual(["one two", "three four"]);
  });

  it("merges small gaps so captions do not flicker", () => {
    const gapped = timeline([word("A.", 0, 0.5), word("B.", 0.7, 1.2)]);
    expect(buildCaptionArtifact({ word_timeline: gapped, format: "srt", merge_gap_seconds: 0.3 }).cues[0].end_seconds).toBe(0.7);
    expect(buildCaptionArtifact({ word_timeline: gapped, format: "srt", merge_gap_seconds: 0.1 }).cues[0].end_seconds).toBe(0.5);
  });

  it("keeps cues strictly ordered and non-overlapping for tolerated word overlaps", () => {
    const overlapping = timeline([word("one.", 0, 0.5), word("two.", 0.47, 1.0), word("three.", 1.0, 1.5)]);
    const result = buildCaptionArtifact({ word_timeline: overlapping, format: "srt", words_per_cue: 1, min_cue_seconds: 0.2 });
    for (let index = 1; index < result.cues.length; index += 1) {
      expect(result.cues[index].start_seconds).toBeGreaterThanOrEqual(result.cues[index - 1].end_seconds);
      expect(result.cues[index].end_seconds).toBeGreaterThan(result.cues[index].start_seconds);
    }
    expect(result.warnings.some((entry) => /trimmed/.test(entry))).toBe(true);
  });

  it("wraps onto multiple lines without splitting words", () => {
    const result = buildCaptionArtifact({ word_timeline: FIXTURE, format: "srt", words_per_cue: 12, max_chars_per_line: 12, max_lines: 3 });
    expect(result.cues[0].text).toBe("Hello world,\nthis is a\ntest.");
    expect(result.cues[0].line_count).toBe(3);
    expect(result.cues[1].text).toBe("Captions\nrock!");
    expect(result.warnings).toContain("2 cue(s) wrapped onto multiple lines");
  });

  it("keeps an overlong word whole and warns", () => {
    const big = timeline([word("Supercalifragilistic", 0, 1)]);
    const result = buildCaptionArtifact({ word_timeline: big, format: "srt", max_chars_per_line: 8 });
    expect(result.cues[0].text).toBe("Supercalifragilistic");
    expect(result.warnings.some((entry) => /longer than max_chars_per_line/.test(entry))).toBe(true);
  });

  it("strips fillers and uppercases text", () => {
    const filled = timeline([word("Um,", 0, 0.2), word("hello", 0.2, 0.5), word("uh", 0.5, 0.7), word("world.", 0.7, 1.0)]);
    const result = buildCaptionArtifact({ word_timeline: filled, format: "srt", strip_fillers: ["um", "uh"], uppercase: true });
    expect(result.cues.map((cue) => cue.text)).toEqual(["HELLO WORLD."]);
    expect(result.evidence).toMatchObject({ word_count: 4, words_used: 2, words_stripped: 2 });
    expect(() => buildCaptionArtifact({ word_timeline: filled, format: "srt", strip_fillers: ["um", "hello", "uh", "world"] })).toThrow(/every word was removed/);
  });

  it("prefixes speakers and splits cues on speaker change", () => {
    const dialogue = timeline([word("Hi", 0, 0.3, "Ana"), word("there", 0.3, 0.6, "Ana"), word("hello", 0.6, 0.9, "Ben"), word("back.", 0.9, 1.2, "Ben")]);
    const srt = buildCaptionArtifact({ word_timeline: dialogue, format: "srt", speaker_prefix: true, words_per_cue: 8 });
    expect(srt.cues.map((cue) => cue.text)).toEqual(["Ana: Hi there", "Ben: hello back."]);
    expect(srt.cues.map((cue) => cue.speaker_label)).toEqual(["Ana", "Ben"]);
    const vtt = buildCaptionArtifact({ word_timeline: dialogue, format: "vtt", speaker_prefix: true, words_per_cue: 8 });
    expect(vtt.cues[0].text).toBe("<v Ana>Hi there");
  });

  it("escapes markup-sensitive characters in VTT only", () => {
    const html = timeline([word("a<b>&c", 0, 1)]);
    expect(buildCaptionArtifact({ word_timeline: html, format: "vtt" }).cues[0].text).toBe("a&lt;b&gt;&amp;c");
    expect(buildCaptionArtifact({ word_timeline: html, format: "srt" }).cues[0].text).toBe("a<b>&c");
  });

  it("is deterministic and binds the plan revision to inputs and options", () => {
    const first = buildCaptionArtifact({ word_timeline: FIXTURE, format: "srt" });
    const second = buildCaptionArtifact({ word_timeline: FIXTURE, format: "srt" });
    expect(first.plan_revision).toBe(second.plan_revision);
    expect(first.plan_revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(buildCaptionArtifact({ word_timeline: FIXTURE, format: "vtt" }).plan_revision).not.toBe(first.plan_revision);
    expect(first.evidence.transcript_revision).toBe(revision);
  });

  it("returns a style descriptor with per-platform safe-zone anchors", () => {
    const result = buildCaptionArtifact({ word_timeline: FIXTURE, format: "vtt", style_preset: "bold_pop" });
    expect(result.style.preset).toBe("bold_pop");
    expect(result.style.stroke).toBe(true);
    expect(Object.keys(result.style.safe_zone_recommendation).sort()).toEqual([...SAFE_ZONE_PLATFORMS].sort());
    expect(result.style.safe_zone_recommendation.tiktok).toEqual({ x: 0.5, y: 0.68 });
    expect(describeCaptionStyle("karaoke").word_highlight).toBe(true);
    const karaokePreset = buildCaptionArtifact({ word_timeline: FIXTURE, format: "srt", style_preset: "karaoke" });
    expect(karaokePreset.warnings.some((entry) => /style_preset karaoke/.test(entry))).toBe(true);
  });

  it.each([
    [{ format: "ass" }, /format must be one of/],
    [{ format: "srt", words_per_cue: 0 }, /words_per_cue must be between/],
    [{ format: "srt", words_per_cue: 2.5 }, /words_per_cue must be an integer/],
    [{ format: "srt", max_chars_per_line: 200 }, /max_chars_per_line/],
    [{ format: "srt", max_lines: 4 }, /max_lines/],
    [{ format: "srt", min_cue_seconds: 4, max_cue_seconds: 1 }, /min_cue_seconds must not exceed/],
    [{ format: "srt", merge_gap_seconds: -1 }, /merge_gap_seconds/],
    [{ format: "srt", karaoke: "yes" }, /karaoke must be a boolean/],
    [{ format: "srt", emphasis_words: "loud" }, /emphasis_words must be an array/],
    [{ format: "srt", strip_fillers: [""] }, /strip_fillers\[0\]/],
    [{ format: "srt", style_preset: "neon" }, /style_preset must be one of/],
  ])("rejects invalid options %j", (options, message) => {
    expect(() => buildCaptionArtifact({ word_timeline: FIXTURE, ...options })).toThrow(message);
  });

  it("rejects invalid word timelines", () => {
    expect(() => buildCaptionArtifact({ word_timeline: null, format: "srt" })).toThrow(/word_timeline must be an object/);
    expect(() => buildCaptionArtifact({ word_timeline: { ...FIXTURE, transcript_revision: "nope" }, format: "srt" })).toThrow(/sha256/);
  });

  it("normalizes option defaults", () => {
    expect(normalizeCaptionAuthoringOptions({ format: "vtt" })).toMatchObject({ words_per_cue: 4, max_chars_per_line: 32, max_lines: 1, min_cue_seconds: 0.5, max_cue_seconds: 5, merge_gap_seconds: 0.3, karaoke: false, style_preset: "clean", emphasis_words: [], strip_fillers: [] });
  });
});

describe("caption helpers", () => {
  it("formats timestamps for both formats", () => {
    expect(formatCaptionTimestamp(3_723_456, "srt")).toBe("01:02:03,456");
    expect(formatCaptionTimestamp(3_723_456, "vtt")).toBe("01:02:03.456");
    expect(formatCaptionTimestamp(-5, "srt")).toBe("00:00:00,000");
  });
  it("wraps greedily without splitting words", () => {
    expect(wrapCaptionWords(["one", "two", "three"], 7)).toEqual([["one", "two"], ["three"]]);
    expect(wrapCaptionWords(["averyveryverylongword", "x"], 5)).toEqual([["averyveryverylongword"], ["x"]]);
    expect(wrapCaptionWords([], 10)).toEqual([]);
  });
});

describe("checkCaptionSafeZone", () => {
  const frame = { width: 1080, height: 1920 };

  it("flags a bottom caption on TikTok and suggests the nearest clear position", () => {
    const report = checkCaptionSafeZone({ platform: "tiktok", frame, elements: [{ id: "cap", x: 0.1, y: 0.85, width: 0.8, height: 0.1, kind: "caption" }] });
    const [element] = report.elements;
    expect(element.safe).toBe(false);
    expect(element.overlaps).toEqual([{ zone_id: "bottom_caption_area", overlap_ratio: 1 }]);
    expect(element.suggested_position).toEqual({ x: 0.02, y: 0.68 });
    expect(report.all_safe).toBe(false);
    expect(report.recommended_caption_anchor).toEqual({ x: 0.5, y: 0.68 });
    expect(report.orientation).toBe("vertical");
    expect(element.pixel_rect).toEqual({ x: 108, y: 1632, width: 864, height: 192 });
  });

  it("reports safe elements with their own position", () => {
    const report = checkCaptionSafeZone({ platform: "tiktok", frame, elements: [{ id: "logo", x: 0.05, y: 0.1, width: 0.2, height: 0.1, kind: "logo" }] });
    expect(report.elements[0]).toMatchObject({ safe: true, overlaps: [], suggested_position: { x: 0.05, y: 0.1 } });
    expect(report.all_safe).toBe(true);
    expect(report.warnings).toEqual([]);
  });

  it("computes partial overlap ratios on title-safe platforms", () => {
    const report = checkCaptionSafeZone({ platform: "youtube", frame: { width: 1920, height: 1080 }, elements: [{ id: "cap", x: 0.2, y: 0.9, width: 0.6, height: 0.08, kind: "caption" }] });
    expect(report.elements[0].overlaps).toEqual([{ zone_id: "bottom_margin", overlap_ratio: 0.375 }]);
    expect(report.elements[0].suggested_position).toEqual({ x: 0.2, y: 0.87 });
    expect(report.recommended_caption_anchor).toEqual({ x: 0.5, y: 0.86 });
  });

  it("returns null suggestions for elements that cannot fit", () => {
    const report = checkCaptionSafeZone({ platform: "instagram_reels", frame, elements: [{ id: "full", x: 0, y: 0, width: 1, height: 1, kind: "graphic" }] });
    expect(report.elements[0].suggested_position).toBeNull();
    expect(report.elements[0].overlaps.map((entry) => entry.zone_id)).toEqual(["top_nav", "right_action_rail", "bottom_caption_area"]);
    expect(report.warnings.some((entry) => /cannot fit/.test(entry))).toBe(true);
  });

  it("warns when the frame orientation does not match the platform", () => {
    const report = checkCaptionSafeZone({ platform: "youtube_shorts", frame: { width: 1920, height: 1080 }, elements: [{ id: "a", x: 0.4, y: 0.4, width: 0.2, height: 0.1, kind: "title" }] });
    expect(report.warnings.some((entry) => /assume a vertical frame/.test(entry))).toBe(true);
    expect(report.assumptions.some((entry) => /verify against current platform overlay guides/.test(entry))).toBe(true);
  });

  it("is deterministic and lists the zone table for every platform", () => {
    const input = { platform: "x", frame: { width: 1080, height: 1080 }, elements: [{ id: "a", x: 0.5, y: 0.5, width: 0.1, height: 0.1, kind: "caption" }] };
    expect(checkCaptionSafeZone(input).plan_revision).toBe(checkCaptionSafeZone(input).plan_revision);
    expect(checkCaptionSafeZone(input).orientation).toBe("square");
    for (const platform of SAFE_ZONE_PLATFORMS) {
      expect(PLATFORM_SAFE_ZONES[platform].zones.length).toBeGreaterThan(0);
      for (const zone of PLATFORM_SAFE_ZONES[platform].zones) {
        expect(zone.x + zone.width).toBeLessThanOrEqual(1 + 1e-9);
        expect(zone.y + zone.height).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it("suggests the nearest position exactly", () => {
    const zones = PLATFORM_SAFE_ZONES.tiktok.zones;
    expect(suggestSafePosition({ id: "r", x: 0.85, y: 0.5, width: 0.1, height: 0.1, kind: "graphic" }, zones)).toEqual({ x: 0.72, y: 0.5 });
    expect(suggestSafePosition({ id: "t", x: 0.4, y: 0.02, width: 0.2, height: 0.1, kind: "title" }, zones)).toEqual({ x: 0.4, y: 0.08 });
  });

  it.each([
    [{ platform: "vimeo", frame, elements: [] }, /platform must be one of/],
    [{ platform: "tiktok", frame: null, elements: [] }, /frame must be an object/],
    [{ platform: "tiktok", frame: { width: 8, height: 1920 }, elements: [] }, /frame.width must be an integer/],
    [{ platform: "tiktok", frame: { width: 1080, height: 1920.5 }, elements: [] }, /frame.height/],
    [{ platform: "tiktok", frame: { width: 1080, height: 1920, depth: 1 }, elements: [] }, /frame has an unknown field/],
    [{ platform: "tiktok", frame, elements: [] }, /elements must contain between 1 and 64/],
    [{ platform: "tiktok", frame, elements: [null] }, /elements\[0\] must be an object/],
    [{ platform: "tiktok", frame, elements: [{ id: "a", x: 0.5, y: 0.5, width: 0.6, height: 0.1, kind: "caption" }] }, /extends outside the frame/],
    [{ platform: "tiktok", frame, elements: [{ id: "a", x: 0, y: 0, width: 0, height: 0.1, kind: "caption" }] }, /greater than 0/],
    [{ platform: "tiktok", frame, elements: [{ id: "a", x: 0, y: 0, width: 0.1, height: 0.1, kind: "sticker" }] }, /kind must be one of/],
    [{ platform: "tiktok", frame, elements: [{ id: "a", x: 0, y: 0, width: 0.1, height: 0.1, kind: "logo", z: 1 }] }, /unknown field: z/],
    [{ platform: "tiktok", frame, elements: [{ id: "a", x: 0, y: 0, width: 0.1, height: 0.1, kind: "logo" }, { id: "a", x: 0.5, y: 0.5, width: 0.1, height: 0.1, kind: "logo" }] }, /duplicate id/],
    [{ platform: "tiktok", frame, elements: Array.from({ length: 65 }, (_, index) => ({ id: `e${index}`, x: 0, y: 0, width: 0.1, height: 0.1, kind: "logo" })) }, /between 1 and 64/],
  ])("rejects invalid safe-zone input %#", (input, message) => {
    expect(() => checkCaptionSafeZone(input as never)).toThrow(message);
  });
});
