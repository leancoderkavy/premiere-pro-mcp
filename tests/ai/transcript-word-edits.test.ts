import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILLER_WORDS,
  buildKeepRanges,
  detectRepeatedTakes,
  findPhraseMatches,
  mergeRemovalRanges,
  normalizePhrase,
  phraseListOption,
  planFillerWordRemoval,
  planPauseTightening,
  planWordMuteRanges,
  redactText,
  snapRange,
  textPreview,
  tokenSimilarity,
} from "../../src/ai/transcript-word-edits.js";
import { validateWordTimeline } from "../../src/ai/word-timeline.js";

const revision = `sha256:${"a".repeat(64)}`;
type Word = { text: string; start_seconds: number; end_seconds: number; confidence?: number };

/** Lays words out at 0.3s each with 0.1s gaps starting at `at`. */
function spoken(text: string, at = 0, options: { wordSeconds?: number; gapSeconds?: number; confidence?: number } = {}): Word[] {
  const wordSeconds = options.wordSeconds ?? 0.3;
  const gap = options.gapSeconds ?? 0.1;
  return text.split(/\s+/).filter(Boolean).map((token, index) => {
    const start = at + index * (wordSeconds + gap);
    return { text: token, start_seconds: start, end_seconds: start + wordSeconds, ...(options.confidence === undefined ? {} : { confidence: options.confidence }) };
  });
}

const timeline = (words: Word[]) => ({ source_project_item_id: "clip-1", transcript_revision: revision, words });
const words3 = (a: string, b: string, c: string) => [
  { text: a, start_seconds: 0, end_seconds: 0.3 },
  { text: b, start_seconds: 0.4, end_seconds: 0.7 },
  { text: c, start_seconds: 0.8, end_seconds: 1.1 },
];

describe("shared helpers", () => {
  it("normalizes phrases and validates phrase lists", () => {
    expect(normalizePhrase("  You Know, ")).toEqual(["you", "know"]);
    expect(phraseListOption(undefined, "x", { maxItems: 4, fallback: ["um", "you know"] })).toEqual([["um"], ["you", "know"]]);
    expect(phraseListOption(["Um", "um!", "sort  of"], "x", { maxItems: 4 })).toEqual([["um"], ["sort", "of"]]);
    expect(() => phraseListOption(undefined, "x", { maxItems: 4, required: true })).toThrow(/required/);
    expect(() => phraseListOption([], "x", { maxItems: 4, required: true })).toThrow(/at least one/);
    expect(() => phraseListOption("um", "x", { maxItems: 4 })).toThrow(/array/);
    expect(() => phraseListOption(["a", "b", "c"], "x", { maxItems: 2 })).toThrow(/at most 2/);
    expect(() => phraseListOption([""], "x", { maxItems: 4 })).toThrow(/non-empty/);
    expect(() => phraseListOption(["..."], "x", { maxItems: 4 })).toThrow(/no matchable/);
    expect(() => phraseListOption(["a b c d e f g h i"], "x", { maxItems: 4 })).toThrow(/at most 8 words/);
  });

  it("snaps ranges inward or outward and drops empty ones", () => {
    expect(snapRange(0.01, 0.29, 30, "inward")).toEqual({ start_seconds: 0.033333, end_seconds: 0.266667, start_frame: 1, end_frame: 8 });
    expect(snapRange(0.01, 0.29, 30, "outward")).toEqual({ start_seconds: 0, end_seconds: 0.3, start_frame: 0, end_frame: 9 });
    expect(snapRange(0.01, 0.02, 30, "inward")).toBeUndefined();
    expect(snapRange(-0.5, 0.02, 30, "outward")?.start_frame).toBe(0);
  });

  it("merges overlapping and near ranges while preserving text and reasons", () => {
    const r = (start: number, end: number, text: string, reason = "filler_word") => ({ start_seconds: start / 30, end_seconds: end / 30, start_frame: start, end_frame: end, text, reason });
    const merged = mergeRemovalRanges([r(40, 50, "c", "long_pause"), r(0, 10, "a"), r(12, 20, "b"), r(5, 8, "a")], 0.1);
    expect(merged.map((range) => [range.start_frame, range.end_frame, range.text, range.reason])).toEqual([[0, 20, "a a b", "filler_word"], [40, 50, "c", "long_pause"]]);
    expect(mergeRemovalRanges([r(0, 10, "a"), r(12, 20, "b")], 0)).toHaveLength(2);
    expect(mergeRemovalRanges([r(0, 10, "a"), r(10, 20, "b", "x")], 0)[0].reason).toBe("filler_word+x");
  });

  it("builds keep ranges as the complement of removals", () => {
    const removal = (start: number, end: number) => ({ start_seconds: start / 30, end_seconds: end / 30, start_frame: start, end_frame: end });
    expect(buildKeepRanges([removal(0, 5), removal(10, 20)], 1, 30).map((range) => [range.start_frame, range.end_frame])).toEqual([[5, 10], [20, 30]]);
    expect(buildKeepRanges([], 1, 30)).toEqual([{ start_frame: 0, end_frame: 30, start_seconds: 0, end_seconds: 1 }]);
    expect(buildKeepRanges([removal(0, 30)], 1, 30)).toEqual([]);
  });

  it("finds non-overlapping phrase matches preferring longer phrases", () => {
    const words = spoken("You know, um, I mean you know it.");
    const matches = findPhraseMatches(words, [["you", "know"], ["um"], ["i", "mean"], ["you"]]);
    expect(matches).toEqual([
      { startIndex: 0, endIndex: 1, phrase: "you know" },
      { startIndex: 2, endIndex: 2, phrase: "um" },
      { startIndex: 3, endIndex: 4, phrase: "i mean" },
      { startIndex: 5, endIndex: 6, phrase: "you know" },
    ]);
    expect(findPhraseMatches(words, [["nothing"]])).toEqual([]);
  });

  it("redacts flagged text and computes similarity", () => {
    expect(redactText("Darn")).toBe("d***");
    expect(redactText("a")).toBe("*");
    expect(redactText("oh, heck!")).toBe("o* h***");
    expect(redactText("...")).toBe("*");
    expect(tokenSimilarity(new Set(["a", "b", "c", "d"]), new Set(["a", "b", "c", "d"]))).toEqual({ jaccard: 1, containment: 1, similarity: 1 });
    expect(tokenSimilarity(new Set(["a", "b", "c", "d"]), new Set(["a", "b", "c", "d", "e", "f"])).containment).toBe(1);
    expect(tokenSimilarity(new Set(["a", "b", "c", "d"]), new Set(["a", "b", "c", "d", "e", "f"])).jaccard).toBeCloseTo(4 / 6, 5);
    expect(tokenSimilarity(new Set(), new Set(["a"])).similarity).toBe(0);
    expect(textPreview(spoken("one two three"), 0, 2)).toBe("one two three");
    expect(textPreview(spoken(Array.from({ length: 30 }, () => "word").join(" ")), 0, 29)).toHaveLength(80);
  });
});

describe("planFillerWordRemoval", () => {
  it("removes default fillers with handles and returns keep ranges and routes", () => {
    const plan = planFillerWordRemoval({ word_timeline: timeline(words3("Um,", "hello", "world.")) });
    expect(plan.applied).toBe(false);
    expect(plan.plan_revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(plan.evidence).toEqual({ source_project_item_id: "clip-1", transcript_revision: revision, word_count: 3 });
    expect(plan.removal_ranges).toEqual([{ start_seconds: 0.033333, end_seconds: 0.266667, start_frame: 1, end_frame: 8, text: "Um,", reason: "filler_word" }]);
    expect(plan.keep_ranges.map((range) => [range.start_frame, range.end_frame])).toEqual([[0, 1], [8, 33]]);
    expect(plan.derived_segments[0]).toMatchObject({ id: "keep-0001", source_project_item_id: "clip-1", transcript_revision: revision, source_start_seconds: 0, source_end_seconds: 0.033333 });
    expect(plan.removed_seconds).toBeCloseTo(7 / 30, 5);
    expect(plan.kept_seconds + plan.removed_seconds).toBeCloseTo(1.1, 5);
    expect(plan.estimated_duration_seconds).toBe(plan.kept_seconds);
    expect(plan.filler_counts[0]).toEqual({ filler: "um", matches: 1, removed: 1 });
    expect(plan.filler_counts).toHaveLength(DEFAULT_FILLER_WORDS.length);
    expect(plan.routes.primary).toEqual(["preview_derived_dialogue_sequence_uxp", "apply_derived_dialogue_sequence_uxp"]);
    expect(plan.routes.fallback).toEqual(["split_clip", "ripple_delete"]);
    expect(plan.next_steps.length).toBeGreaterThan(0);
  });

  it("does not remove 'like' unless configured", () => {
    const words = timeline(words3("like", "this", "one"));
    expect(planFillerWordRemoval({ word_timeline: words }).removal_ranges).toEqual([]);
    expect(planFillerWordRemoval({ word_timeline: words, filler_words: ["like"] }).removal_ranges).toHaveLength(1);
  });

  it("matches multi-word fillers only on consecutive tokens", () => {
    const hit = planFillerWordRemoval({ word_timeline: timeline(spoken("so you know it works")), handle_frames: 0 });
    expect(hit.removal_ranges.map((range) => range.text)).toEqual(["you know"]);
    expect(hit.removal_ranges[0]).toMatchObject({ start_frame: 12, end_frame: 33 });
    const miss = planFillerWordRemoval({ word_timeline: timeline(spoken("you really know it")), handle_frames: 0 });
    expect(miss.removal_ranges).toEqual([]);
    expect(miss.warnings).toContain("No filler words matched; nothing to remove.");
  });

  it("merges nearby removals and respects max_removals", () => {
    const plan = planFillerWordRemoval({ word_timeline: timeline(spoken("um uh okay um")), handle_frames: 0 });
    expect(plan.match_count).toBe(3);
    expect(plan.removal_count).toBe(2);
    expect(plan.removal_ranges[0]).toMatchObject({ start_frame: 0, end_frame: 21, text: "um uh" });
    const capped = planFillerWordRemoval({ word_timeline: timeline(spoken("um uh okay um")), handle_frames: 0, max_removals: 1 });
    expect(capped.removal_count).toBe(1);
    expect(capped.truncated).toBe(true);
    expect(capped.warnings[0]).toMatch(/max_removals/);
    const unmerged = planFillerWordRemoval({ word_timeline: timeline(spoken("um uh okay um")), handle_frames: 0, merge_gap_seconds: 0 });
    expect(unmerged.removal_count).toBe(3);
  });

  it("gates removals on min_confidence and reports skipped matches", () => {
    const words = [
      { text: "um", start_seconds: 0, end_seconds: 0.3, confidence: 0.4 },
      { text: "um", start_seconds: 0.5, end_seconds: 0.8, confidence: 0.95 },
      { text: "um", start_seconds: 1, end_seconds: 1.3 },
      { text: "done", start_seconds: 1.5, end_seconds: 1.8 },
    ];
    const plan = planFillerWordRemoval({ word_timeline: timeline(words), min_confidence: 0.9, handle_frames: 0 });
    expect(plan.removal_ranges.map((range) => range.start_frame)).toEqual([15]);
    expect(plan.warnings.some((warning) => warning.includes("below 0.9"))).toBe(true);
    expect(plan.warnings.some((warning) => warning.includes("carry no confidence"))).toBe(true);
    expect(planFillerWordRemoval({ word_timeline: timeline(words), handle_frames: 0 }).removal_ranges).toHaveLength(3);
  });

  it("skips fillers shorter than two handles and warns", () => {
    const plan = planFillerWordRemoval({ word_timeline: timeline([{ text: "um", start_seconds: 0, end_seconds: 0.05 }, { text: "go", start_seconds: 0.2, end_seconds: 0.5 }]), handle_frames: 2 });
    expect(plan.removal_ranges).toEqual([]);
    expect(plan.warnings.some((warning) => warning.includes("shorter than two handles"))).toBe(true);
  });

  it("is deterministic and sensitive to options", () => {
    const input = { word_timeline: timeline(spoken("um hello uh world")) };
    expect(planFillerWordRemoval(input).plan_revision).toBe(planFillerWordRemoval(input).plan_revision);
    expect(planFillerWordRemoval({ ...input, handle_frames: 3 }).plan_revision).not.toBe(planFillerWordRemoval(input).plan_revision);
    expect(planFillerWordRemoval({ ...input, frame_rate: 24 }).plan_revision).not.toBe(planFillerWordRemoval(input).plan_revision);
  });

  it("warns when keep ranges exceed the derived-sequence segment limit", () => {
    const words = spoken(Array.from({ length: 70 }, () => "um okay").join(" "));
    const plan = planFillerWordRemoval({ word_timeline: timeline(words), handle_frames: 0 });
    expect(plan.keep_ranges.length).toBeGreaterThan(64);
    expect(plan.warnings.some((warning) => warning.includes("64-segment limit"))).toBe(true);
  });

  it.each([
    [{ word_timeline: null }, /word_timeline/],
    [{ word_timeline: timeline(spoken("hi")), filler_words: [] }, /at least one/],
    [{ word_timeline: timeline(spoken("hi")), handle_frames: 1.5 }, /handle_frames/],
    [{ word_timeline: timeline(spoken("hi")), handle_frames: 25 }, /handle_frames/],
    [{ word_timeline: timeline(spoken("hi")), merge_gap_seconds: -1 }, /merge_gap_seconds/],
    [{ word_timeline: timeline(spoken("hi")), max_removals: 0 }, /max_removals/],
    [{ word_timeline: timeline(spoken("hi")), min_confidence: 2 }, /min_confidence/],
    [{ word_timeline: timeline(spoken("hi")), frame_rate: 0 }, /frame_rate/],
  ])("rejects invalid input %#", (args, message) => {
    expect(() => planFillerWordRemoval(args)).toThrow(message);
  });
});

describe("planPauseTightening", () => {
  it("tightens a long pause to the target, centered in the gap", () => {
    const plan = planPauseTightening({ word_timeline: timeline([{ text: "hello", start_seconds: 0, end_seconds: 0.5 }, { text: "world", start_seconds: 2.5, end_seconds: 3 }]) });
    expect(plan.removal_ranges).toHaveLength(1);
    expect(plan.removal_ranges[0]).toMatchObject({ start_frame: 21, end_frame: 69, reason: "long_pause", pause_seconds: 2, target_pause_seconds: 0.35, after_word_index: 0 });
    expect(plan.removal_ranges[0].text).toBe("hello [2s pause] world");
    expect(plan.removed_seconds).toBeCloseTo(1.6, 5);
    expect(plan.keep_ranges.map((range) => [range.start_frame, range.end_frame])).toEqual([[0, 21], [69, 90]]);
    expect(plan.estimated_duration_seconds).toBeCloseTo(1.4, 5);
    expect(plan.pauses_examined).toBe(1);
    expect(plan.pauses_tightened).toBe(1);
    expect(plan.applied).toBe(false);
    expect(plan.routes.primary[0]).toBe("preview_derived_dialogue_sequence_uxp");
  });

  it("keeps a longer pause after sentence-ending punctuation", () => {
    const plan = planPauseTightening({ word_timeline: timeline([{ text: "Hello.", start_seconds: 0, end_seconds: 0.5 }, { text: "World", start_seconds: 2.5, end_seconds: 3 }]) });
    expect(plan.removal_ranges[0]).toMatchObject({ start_frame: 24, end_frame: 66, reason: "sentence_pause", target_pause_seconds: 0.6 });
    expect(plan.removed_seconds).toBeCloseTo(1.4, 5);
  });

  it("leaves pauses at or below max_pause_seconds alone", () => {
    const plan = planPauseTightening({ word_timeline: timeline([{ text: "a", start_seconds: 0, end_seconds: 0.5 }, { text: "b", start_seconds: 1.5, end_seconds: 2 }, { text: "c", start_seconds: 2.1, end_seconds: 2.5 }]) });
    expect(plan.removal_ranges).toEqual([]);
    expect(plan.pauses_examined).toBe(2);
    expect(plan.warnings).toContain("No pauses exceed max_pause_seconds; nothing to tighten.");
    expect(plan.keep_ranges).toEqual([{ start_frame: 0, end_frame: 75, start_seconds: 0, end_seconds: 2.5 }]);
  });

  it("does not tighten when the sentence target exceeds the pause", () => {
    const plan = planPauseTightening({ word_timeline: timeline([{ text: "Done.", start_seconds: 0, end_seconds: 0.5 }, { text: "Next", start_seconds: 1.7, end_seconds: 2 }]), max_pause_seconds: 1, sentence_pause_seconds: 1.5 });
    expect(plan.removal_ranges).toEqual([]);
  });

  it("caps edits by keeping the longest pauses and reports truncation", () => {
    const words = [
      { text: "a", start_seconds: 0, end_seconds: 0.5 },
      { text: "b", start_seconds: 2, end_seconds: 2.5 },
      { text: "c", start_seconds: 6, end_seconds: 6.5 },
      { text: "d", start_seconds: 8.5, end_seconds: 9 },
    ];
    const plan = planPauseTightening({ word_timeline: timeline(words), max_edits: 2 });
    expect(plan.truncated).toBe(true);
    expect(plan.removal_ranges.map((range) => range.pause_seconds)).toEqual([3.5, 2]);
    expect(plan.removal_ranges[0].start_frame).toBeLessThan(plan.removal_ranges[1].start_frame);
    expect(plan.warnings[0]).toMatch(/max_edits/);
  });

  it("is deterministic and rejects invalid controls", () => {
    const input = { word_timeline: timeline([{ text: "a", start_seconds: 0, end_seconds: 0.5 }, { text: "b", start_seconds: 3, end_seconds: 3.5 }]) };
    expect(planPauseTightening(input).plan_revision).toBe(planPauseTightening(input).plan_revision);
    expect(planPauseTightening({ ...input, target_pause_seconds: 0.5 }).plan_revision).not.toBe(planPauseTightening(input).plan_revision);
    expect(() => planPauseTightening({ ...input, target_pause_seconds: 2, max_pause_seconds: 1 })).toThrow(/must not exceed/);
    expect(() => planPauseTightening({ ...input, max_pause_seconds: 0.1 })).toThrow(/max_pause_seconds/);
    expect(() => planPauseTightening({ ...input, sentence_pause_seconds: "x" })).toThrow(/sentence_pause_seconds/);
    expect(() => planPauseTightening({ ...input, max_edits: 1000 })).toThrow(/max_edits/);
    expect(() => planPauseTightening({ word_timeline: {} })).toThrow(/word_timeline/);
  });
});

describe("planWordMuteRanges", () => {
  it("returns redacted, padded, outward-snapped mute ranges and audio keyframes", () => {
    const plan = planWordMuteRanges({ word_timeline: timeline(words3("the", "Darn!", "thing")), words: ["darn"] });
    expect(plan.mute_ranges).toEqual([{ start_seconds: 0.333333, end_seconds: 0.766667, start_frame: 10, end_frame: 23, text: "d***", reason: "mute", word_count: 1 }]);
    expect(JSON.stringify(plan)).not.toMatch(/darn/i);
    expect(plan.audio_keyframes).toEqual([
      { time_seconds: 0.3, level_db: 0 },
      { time_seconds: 0.333333, level_db: -60 },
      { time_seconds: 0.766667, level_db: -60 },
      { time_seconds: 0.8, level_db: 0 },
    ]);
    expect(plan.muted_seconds).toBeCloseTo(13 / 30, 5);
    expect(plan.tone_placements).toEqual([]);
    expect(plan.routes).toEqual({ primary: ["add_audio_keyframes"], fallback: ["set_clip_volume"] });
    expect(plan.applied).toBe(false);
    expect(plan.mode).toBe("mute");
  });

  it("omits the leading 0 dB keyframe when the range starts at zero", () => {
    const plan = planWordMuteRanges({ word_timeline: timeline(words3("darn", "it", "all")), words: ["darn"], padding_seconds: 0 });
    expect(plan.audio_keyframes[0]).toEqual({ time_seconds: 0, level_db: -60 });
  });

  it("emits tone placements and extra routes in bleep mode", () => {
    const plan = planWordMuteRanges({ word_timeline: timeline(words3("the", "darn", "thing")), words: ["darn"], mode: "bleep", mute_level_db: -40 });
    expect(plan.tone_placements).toEqual([{ start_seconds: 0.333333, duration_seconds: 0.433334, start_frame: 10, duration_frames: 13 }]);
    expect(plan.routes.primary).toEqual(["add_audio_keyframes", "create_bars_and_tone", "add_to_timeline"]);
    expect(plan.audio_keyframes[1].level_db).toBe(-40);
    expect(plan.next_steps.some((step) => step.includes("create_bars_and_tone"))).toBe(true);
  });

  it("matches phrases and merges adjacent ranges", () => {
    const plan = planWordMuteRanges({ word_timeline: timeline(spoken("oh heck heck no")), words: ["oh heck", "heck"], padding_seconds: 0.1 });
    expect(plan.match_count).toBe(2);
    expect(plan.mute_ranges).toHaveLength(1);
    expect(plan.mute_ranges[0]).toMatchObject({ text: "o* h*** h***", word_count: 3, start_frame: 0, end_frame: 36 });
    const separate = planWordMuteRanges({ word_timeline: timeline(spoken("oh heck no heck")), words: ["oh heck", "heck"], padding_seconds: 0.1 });
    expect(separate.mute_ranges).toHaveLength(2);
    // First range starts at 0 so its leading 0 dB keyframe is omitted: 3 + 4.
    expect(separate.audio_keyframes).toHaveLength(7);
  });

  it("reports no matches and rejects invalid input", () => {
    const empty = planWordMuteRanges({ word_timeline: timeline(spoken("all clean here")), words: ["nope"] });
    expect(empty.mute_ranges).toEqual([]);
    expect(empty.audio_keyframes).toEqual([]);
    expect(empty.warnings[0]).toMatch(/No listed words/);
    expect(() => planWordMuteRanges({ word_timeline: timeline(spoken("hi")) })).toThrow(/words is required/);
    expect(() => planWordMuteRanges({ word_timeline: timeline(spoken("hi")), words: [] })).toThrow(/at least one/);
    expect(() => planWordMuteRanges({ word_timeline: timeline(spoken("hi")), words: ["hi"], mode: "loud" })).toThrow(/mode/);
    expect(() => planWordMuteRanges({ word_timeline: timeline(spoken("hi")), words: ["hi"], mute_level_db: 5 })).toThrow(/mute_level_db/);
    expect(() => planWordMuteRanges({ word_timeline: timeline(spoken("hi")), words: ["hi"], padding_seconds: 2 })).toThrow(/padding_seconds/);
  });

  it("is deterministic across calls and distinct across modes", () => {
    const input = { word_timeline: timeline(spoken("the darn thing")), words: ["darn"] };
    expect(planWordMuteRanges(input).plan_revision).toBe(planWordMuteRanges(input).plan_revision);
    expect(planWordMuteRanges({ ...input, mode: "bleep" }).plan_revision).not.toBe(planWordMuteRanges(input).plan_revision);
  });
});

describe("detectRepeatedTakes", () => {
  const take = "we went to the store today.";

  it("groups near-duplicate sentences and removes all but the last take", () => {
    const words = [...spoken(take, 0), ...spoken("Um, " + take, 4)];
    const plan = detectRepeatedTakes({ word_timeline: timeline(words) });
    expect(plan.group_count).toBe(1);
    expect(plan.groups[0].kept_index).toBe(1);
    expect(plan.groups[0].takes).toHaveLength(2);
    expect(plan.groups[0].takes[0]).toMatchObject({ index: 0, start_seconds: 0, word_count: 6, text_preview: take, similarity_to_previous: null });
    expect(plan.groups[0].takes[1].similarity_to_previous).toBe(1);
    expect(plan.removal_ranges).toHaveLength(1);
    expect(plan.removal_ranges[0]).toMatchObject({ start_frame: 0, end_frame: 119, reason: "repeated_take", text: take });
    expect(plan.keep_ranges[0]).toMatchObject({ start_frame: 119 });
    expect(plan.applied).toBe(false);
    expect(plan.routes.primary).toEqual(["preview_derived_dialogue_sequence_uxp", "apply_derived_dialogue_sequence_uxp"]);
  });

  it("can keep the first take instead", () => {
    const words = [...spoken(take, 0), ...spoken(take, 4)];
    const plan = detectRepeatedTakes({ word_timeline: timeline(words), keep: "first" });
    expect(plan.groups[0].kept_index).toBe(0);
    expect(plan.removal_ranges[0]).toMatchObject({ start_frame: 120, end_frame: secondsToFrames(4 + 5 * 0.4 + 0.3) });
  });

  it("chains three takes into one group and honors max_gap_seconds", () => {
    const words = [...spoken(take, 0), ...spoken(take, 4), ...spoken(take, 8)];
    const chained = detectRepeatedTakes({ word_timeline: timeline(words) });
    expect(chained.group_count).toBe(1);
    expect(chained.groups[0].takes).toHaveLength(3);
    expect(chained.removal_ranges).toHaveLength(1);
    expect(chained.removal_ranges[0]).toMatchObject({ start_frame: 0, end_frame: 239 });
    const far = detectRepeatedTakes({ word_timeline: timeline([...spoken(take, 0), ...spoken(take, 40)]) });
    expect(far.group_count).toBe(0);
    expect(far.warnings).toContain("No repeated takes detected.");
    expect(detectRepeatedTakes({ word_timeline: timeline([...spoken(take, 0), ...spoken(take, 40)]), max_gap_seconds: 60 }).group_count).toBe(1);
  });

  it("ignores short sentences and dissimilar sentences", () => {
    const words = [...spoken("okay.", 0), ...spoken("okay.", 1), ...spoken("this is a totally different line.", 2), ...spoken("nothing alike about that one.", 6)];
    const plan = detectRepeatedTakes({ word_timeline: timeline(words) });
    expect(plan.sentence_count).toBe(4);
    expect(plan.compared_sentence_count).toBe(2);
    expect(plan.group_count).toBe(0);
    expect(plan.keep_ranges).toHaveLength(1);
  });

  it("respects similarity_threshold and min_words", () => {
    const words = [...spoken("we went to the store today.", 0), ...spoken("we went to the market today.", 4)];
    expect(detectRepeatedTakes({ word_timeline: timeline(words), similarity_threshold: 0.7 }).group_count).toBe(1);
    expect(detectRepeatedTakes({ word_timeline: timeline(words), similarity_threshold: 0.9 }).group_count).toBe(0);
    expect(detectRepeatedTakes({ word_timeline: timeline(words), similarity_threshold: 0.7, min_words: 7 }).group_count).toBe(0);
  });

  it("caps groups and is deterministic", () => {
    const words = [...spoken("first line of the take.", 0), ...spoken("first line of the take.", 3), ...spoken("second line entirely different.", 6), ...spoken("second line entirely different.", 9)];
    const plan = detectRepeatedTakes({ word_timeline: timeline(words), max_groups: 1 });
    expect(plan.group_count).toBe(1);
    expect(plan.truncated).toBe(true);
    expect(plan.warnings[0]).toMatch(/max_groups/);
    const full = detectRepeatedTakes({ word_timeline: timeline(words) });
    expect(full.group_count).toBe(2);
    expect(full.plan_revision).toBe(detectRepeatedTakes({ word_timeline: timeline(words) }).plan_revision);
    expect(full.plan_revision).not.toBe(plan.plan_revision);
  });

  it("rejects invalid controls", () => {
    const input = { word_timeline: timeline(spoken(take)) };
    expect(() => detectRepeatedTakes({ ...input, min_words: 2 })).toThrow(/min_words/);
    expect(() => detectRepeatedTakes({ ...input, similarity_threshold: 0.5 })).toThrow(/similarity_threshold/);
    expect(() => detectRepeatedTakes({ ...input, keep: "middle" })).toThrow(/keep/);
    expect(() => detectRepeatedTakes({ ...input, max_groups: 0 })).toThrow(/max_groups/);
    expect(() => detectRepeatedTakes({ ...input, max_gap_seconds: 0.5 })).toThrow(/max_gap_seconds/);
    expect(() => detectRepeatedTakes({ word_timeline: "nope" })).toThrow(/word_timeline/);
  });

  it("stays fast on a large transcript", () => {
    const words: Word[] = [];
    for (let index = 0; index < 1_250; index += 1) {
      const line = `we did w${index}a w${index}b w${index}c here.`;
      words.push(...spoken(line, index * 8), ...spoken(line, index * 8 + 4));
    }
    const started = performance.now();
    const plan = detectRepeatedTakes({ word_timeline: timeline(words), max_groups: 256 });
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(plan.truncated).toBe(true);
    expect(plan.group_count).toBe(256);
    expect(validateWordTimeline(timeline(words)).words).toHaveLength(15_000);
    expect(detectRepeatedTakes({ word_timeline: timeline(words) }).group_count).toBe(64);
  });
});

function secondsToFrames(seconds: number): number {
  return Math.floor(seconds * 30 + 1e-7);
}
