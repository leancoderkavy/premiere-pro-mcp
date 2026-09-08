import { describe, expect, it } from "vitest";
import {
  MAX_TIMELINE_WORDS,
  WORD_TIMELINE_PARAMETER,
  digestWordTimeline,
  endsSentence,
  normalizeToken,
  secondsToFrame,
  sentenceEndIndexes,
  sentenceRanges,
  validateWordTimeline,
} from "../../src/ai/word-timeline.js";

const revision = `sha256:${"a".repeat(64)}`;
const word = (text: string, start: number, end: number, extra: Record<string, unknown> = {}) => ({ text, start_seconds: start, end_seconds: end, ...extra });
const base = (words: unknown[]) => ({ source_project_item_id: "clip-1", transcript_revision: revision, words });

describe("validateWordTimeline", () => {
  it("normalizes a valid timeline and collects sorted speakers", () => {
    const timeline = validateWordTimeline(base([
      word(" Hello ", 0, 0.4, { speaker_label: " zed ", confidence: 0.9 }),
      word("world.", 0.5, 1, { speaker_label: "amy" }),
    ]));
    expect(timeline.source_project_item_id).toBe("clip-1");
    expect(timeline.words[0]).toEqual({ text: "Hello", start_seconds: 0, end_seconds: 0.4, speaker_label: "zed", confidence: 0.9 });
    expect(timeline.duration_seconds).toBe(1);
    expect(timeline.speakers).toEqual(["amy", "zed"]);
  });

  it("tolerates small overlaps but rejects large ones", () => {
    expect(validateWordTimeline(base([word("a", 0, 0.5), word("b", 0.46, 0.9)])).words).toHaveLength(2);
    expect(() => validateWordTimeline(base([word("a", 0, 0.5), word("b", 0.3, 0.9)]))).toThrow(/overlaps/);
  });

  it.each([
    [null, /must be an object/],
    [[], /must be an object/],
    [{ ...base([word("a", 0, 1)]), extra: 1 }, /unknown field/],
    [{ ...base([word("a", 0, 1)]), source_project_item_id: "  " }, /source_project_item_id/],
    [{ ...base([word("a", 0, 1)]), transcript_revision: "sha256:abc" }, /transcript_revision/],
    [base([]), /between 1 and/],
    [base([null]), /must be an object/],
    [base([word("a", 0, 1, { bogus: true })]), /unknown field/],
    [base([word("", 0, 1)]), /text must/],
    [base([word("a", Number.NaN, 1)]), /finite number/],
    [base([word("a", -1, 1)]), /within 0/],
    [base([word("a", 1, 1)]), /greater than start_seconds/],
    [base([word("a", 1, 2), word("b", 0.5, 3)]), /out of order/],
    [base([word("a", 0, 1, { speaker_label: "" })]), /speaker_label/],
    [base([word("a", 0, 1, { confidence: 2 })]), /confidence/],
  ])("rejects malformed input %#", (input, message) => {
    expect(() => validateWordTimeline(input)).toThrow(message);
  });

  it("honours a custom maxWords option", () => {
    expect(() => validateWordTimeline(base([word("a", 0, 1), word("b", 1, 2)]), { maxWords: 1 })).toThrow(/between 1 and 1/);
    expect(MAX_TIMELINE_WORDS).toBe(20_000);
  });

  it("publishes a closed JSON schema fragment", () => {
    expect(WORD_TIMELINE_PARAMETER.additionalProperties).toBe(false);
    expect(WORD_TIMELINE_PARAMETER.required).toEqual(["source_project_item_id", "transcript_revision", "words"]);
    expect(WORD_TIMELINE_PARAMETER.properties.words.items.required).toEqual(["text", "start_seconds", "end_seconds"]);
  });
});

describe("token helpers", () => {
  it("normalizes tokens by case and surrounding punctuation", () => {
    expect(normalizeToken("  Hello,")).toBe("hello");
    expect(normalizeToken("\"Don’t\"")).toBe("don't");
    expect(normalizeToken("...")).toBe("");
    expect(normalizeToken("Ümlaut!")).toBe("ümlaut");
  });

  it("detects sentence-ending punctuation", () => {
    expect(endsSentence("done.")).toBe(true);
    expect(endsSentence("really?\"")).toBe(true);
    expect(endsSentence("wow!)")).toBe(true);
    expect(endsSentence("later…")).toBe(true);
    expect(endsSentence("comma,")).toBe(false);
    expect(endsSentence("plain")).toBe(false);
  });
});

describe("sentence segmentation", () => {
  const words = [word("Hi.", 0, 0.3), word("we", 0.4, 0.6), word("go", 0.7, 0.9), word("now", 2.5, 2.8), word("ok", 2.9, 3.1)];

  it("ends sentences on punctuation, long gaps, and the final word", () => {
    expect(sentenceEndIndexes(words)).toEqual([0, 2, 4]);
    expect(sentenceEndIndexes(words, 5)).toEqual([0, 4]);
  });

  it("builds contiguous inclusive ranges", () => {
    expect(sentenceRanges(words)).toEqual([
      { startIndex: 0, endIndex: 0 },
      { startIndex: 1, endIndex: 2 },
      { startIndex: 3, endIndex: 4 },
    ]);
    expect(sentenceRanges([])).toEqual([]);
  });
});

describe("digestWordTimeline", () => {
  const timeline = validateWordTimeline(base([word("a", 0, 1), word("b", 1, 2)]));

  it("is deterministic and sha256-shaped", () => {
    expect(digestWordTimeline(timeline)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(digestWordTimeline(timeline)).toBe(digestWordTimeline(timeline));
  });

  it("changes with words, revision, and extra data", () => {
    const changed = validateWordTimeline(base([word("a", 0, 1), word("c", 1, 2)]));
    expect(digestWordTimeline(changed)).not.toBe(digestWordTimeline(timeline));
    expect(digestWordTimeline({ ...timeline, transcript_revision: `sha256:${"b".repeat(64)}` })).not.toBe(digestWordTimeline(timeline));
    expect(digestWordTimeline(timeline, { x: 1 })).not.toBe(digestWordTimeline(timeline, { x: 2 }));
  });
});

describe("secondsToFrame", () => {
  it("rounds by default and supports floor and ceil with float tolerance", () => {
    expect(secondsToFrame(1, 30)).toBe(30);
    expect(secondsToFrame(0.5, 25)).toBe(13);
    expect(secondsToFrame(0.51, 30, "floor")).toBe(15);
    expect(secondsToFrame(0.51, 30, "ceil")).toBe(16);
    expect(secondsToFrame(0.3 - 1 / 30, 30, "floor")).toBe(8);
    expect(secondsToFrame(0.1 * 3, 30, "ceil")).toBe(9);
  });
});
