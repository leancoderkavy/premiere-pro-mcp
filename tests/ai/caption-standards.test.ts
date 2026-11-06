import { describe, expect, it } from "vitest";
import {
  ARTICLES,
  bareWord,
  breakPenalty,
  CAPTION_STANDARD_IDS,
  CAPTION_STANDARDS,
  cpsOf,
  describeCaptionStandards,
  isWeakEnd,
  properNounRuns,
  SPEAKER_COLORS,
  weakEndReason,
  wpmOf,
} from "../../src/ai/caption-standards.js";

describe("caption standards table", () => {
  it("holds the five published standards with their numbers", () => {
    expect([...CAPTION_STANDARD_IDS]).toEqual(["netflix_adult", "netflix_kids", "bbc", "dcmp", "social_9x16"]);
    expect(CAPTION_STANDARDS.netflix_adult).toMatchObject({ max_cps: 20, max_cpl: 42, max_lines: 2, max_duration_s: 7, min_gap_frames: 2 });
    expect(CAPTION_STANDARDS.netflix_adult.min_duration_s).toBeCloseTo(5 / 6, 9);
    expect(CAPTION_STANDARDS.netflix_kids.max_cps).toBe(17);
    expect(CAPTION_STANDARDS.bbc).toMatchObject({ max_wpm: 180, min_s_per_word: 0.33, max_cpl: 37, close_gap_under_s: 1 });
    expect(CAPTION_STANDARDS.dcmp).toMatchObject({ max_wpm: 160, max_cpl: 32, max_duration_s: 6 });
    expect(CAPTION_STANDARDS.dcmp.min_duration_s).toBeCloseTo(40 / 29.97, 9);
    expect(CAPTION_STANDARDS.social_9x16).toMatchObject({ max_cpl: 25, max_lines: 3 });
    for (const id of CAPTION_STANDARD_IDS) expect(CAPTION_STANDARDS[id].id).toBe(id);
  });

  it("has speaker colours in BBC order", () => {
    expect([...SPEAKER_COLORS]).toEqual(["#FFFFFF", "#FFFF00", "#00FFFF", "#00FF00"]);
  });

  it("describes the table as plain data", () => {
    const d = describeCaptionStandards();
    expect(d.map((s) => s.id)).toEqual([...CAPTION_STANDARD_IDS]);
    const netflix = d.find((s) => s.id === "netflix_adult")!;
    expect(netflix).toMatchObject({ max_cps: 20, max_cpl: 42, max_lines: 2, min_gap_frames: 2, close_gaps_under_s: 0.5, linger_s: 0.5, max_duration_s: 7 });
    expect(netflix.min_duration_s).toBe(0.833);
    expect(netflix.max_wpm).toBeUndefined();
    const bbc = d.find((s) => s.id === "bbc")!;
    expect(bbc).toMatchObject({ max_wpm: 180, min_s_per_word: 0.33 });
    expect(bbc.max_cps).toBeUndefined();
    expect(bbc.notes.join(" ")).toMatch(/180 words per minute/);
    expect(bbc.notes.join(" ")).toMatch(/0.33 s on screen per word/);
    expect(d.find((s) => s.id === "social_9x16")!.notes.join(" ")).toMatch(/House rule/);
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
    for (const s of d) expect(s.source.length).toBeGreaterThan(5);
  });
});

describe("grammar and reading speed", () => {
  it("normalises words", () => {
    expect(bareWord("“Don’t,”")).toBe("don't");
    expect(ARTICLES.has("the")).toBe(true);
  });
  it("costs a clean break after punctuation 0, no next word 0, and a bad break more than a plain one", () => {
    expect(breakPenalty("end.", "Next")).toBe(0);
    expect(breakPenalty("word", undefined)).toBe(0);
    expect(breakPenalty("the", "cat")).toBe(10);
    expect(breakPenalty("to", "go")).toBe(7);
    expect(breakPenalty("and", "go")).toBe(6);
    expect(breakPenalty("was", "going")).toBe(6);
    expect(breakPenalty("they", "went")).toBe(5);
    expect(breakPenalty("it", "went")).toBe(1);
    expect(breakPenalty("John", "Smith")).toBe(8);
    expect(breakPenalty("10", "km")).toBe(8);
    expect(breakPenalty("table", "chair")).toBe(1);
    expect(breakPenalty("the", "cat", "caption")).toBe(15);
  });
  it("flags weak ends with a reason", () => {
    expect(isWeakEnd("the", "cat")).toBe(true);
    expect(isWeakEnd("table", "chair")).toBe(false);
    expect(weakEndReason("the", "cat")).toBe("ends on an article");
    expect(weakEndReason("my", "cat")).toBe("ends on a possessive");
    expect(weakEndReason("to", "go")).toBe("ends on a preposition");
    expect(weakEndReason("and", "go")).toBe("ends on a conjunction");
    expect(weakEndReason("was", "going")).toBe("ends on an auxiliary verb");
    expect(weakEndReason("they", "went")).toMatch(/subject pronoun/);
    expect(weakEndReason("John", "Smith")).toBe("splits a name");
    expect(weakEndReason("10", "km")).toBe("splits a number from its unit");
    expect(weakEndReason("table", "chair")).toBeUndefined();
    expect(weakEndReason("the.", "Cat")).toBeUndefined();
    expect(weakEndReason("the", undefined)).toBeUndefined();
  });
  it("computes characters and words per time", () => {
    expect(cpsOf(["Hello", "there"], 0, 1)).toBe(11);
    expect(wpmOf(["Hello", "there"], 0, 1)).toBe(120);
    expect(cpsOf(["x"], 1, 1)).toBeGreaterThan(100);
  });
});

describe("proper-noun runs", () => {
  const w = (s: string) => s.split(" ");
  it("finds runs of capitalised words that read as one name", () => {
    expect(properNounRuns(w("the new Land Rover Defender launch film,"))).toEqual([[2, 4]]);
    expect(properNounRuns(w("we met Sarah Jones and Tom Smith"))).toEqual([[2, 3], [5, 6]]);
  });
  it("does not count a capital that only starts the sentence or caption", () => {
    expect(properNounRuns(w("Today we're looking at it"))).toEqual([]);
    expect(properNounRuns(w("So Sarah went home"))).toEqual([]);
    expect(properNounRuns(w("It ended. Today Tom Smith left"))).toEqual([[3, 4]]);
  });
  it("counts a sentence-initial name when a capitalised word follows it, and stops runs at a comma", () => {
    expect(properNounRuns(w("Sarah Jones said hello"))).toEqual([[0, 1]]);
    expect(properNounRuns(w("Paris, France and Rome"))).toEqual([]);
    expect(properNounRuns(w("I Am Here"))).toEqual([]);
  });
  it("breakPenalty and weakEndReason leave sentence openers and function words alone, and still guard names", () => {
    expect(breakPenalty("Today", "Sarah")).toBeLessThan(5);
    expect(breakPenalty("So", "Sarah")).toBeLessThan(8);
    expect(isWeakEnd("Today", "Sarah")).toBe(false);
    expect(weakEndReason("Today", "Sarah")).toBeUndefined();
    expect(breakPenalty("Land", "Rover")).toBe(8);
    expect(weakEndReason("Rover", "Defender")).toBe("splits a name");
  });
});
