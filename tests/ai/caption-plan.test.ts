import { describe, expect, it } from "vitest";
import { breakPenalty, CAPTION_STANDARD_IDS, CAPTION_STANDARDS, SPEAKER_COLORS, weakEndReason } from "../../src/ai/caption-standards.js";
import { closeGaps, cutOutTimes, DURATION_TOLERANCE_S, endFor, enforceGaps, exactFrameRate, findViolations, recordExtensions, Rec, settleEnds, snapInTimes, splitAtCuts, splitPass, type RuleSettings, type WorkCap } from "../../src/ai/caption-rules.js";
import { lintCaptions } from "../../src/ai/caption-qa.js";
import { cleanupWords, type CleanWord } from "../../src/ai/caption-cleanup.js";
import { breakLines, buildCaptionPlan as buildCaptions, frameRateFromTimebaseTicks, normalizeCaptionPlanOptions, PREMIERE_TICKS_PER_SECOND, CAPTION_PLAN_OPTION_PROPERTIES, CAPTION_PLAN_OPTION_KEYS, captionPlanDocument, clampPlanToEnd, parseCaptionPlanDocument, planFromDocument, type CaptionPlanOptions as CaptionOptions } from "../../src/ai/caption-plan.js";
import { detectFormat, parseTranscript, parseCaptionTranscript, segmentsFromWordTimeline, transcriptDurationSeconds, type CaptionTranscriptWord as TranscriptWord } from "../../src/ai/caption-transcript.js";

type Spec = [text: string, start: number, end: number, speaker?: string];
const W = (spec: Spec[]): TranscriptWord[] => spec.map(([text, start, end, speaker]) => ({ text, start, end, ...(speaker ? { speaker } : {}) }));
const plan = (words: TranscriptWord[], opts: CaptionOptions = {}) => buildCaptions([{ text: "x", start: words[0].start, end: words[words.length - 1].end, words }], opts);
/** Words one after another, `step` apart, `dur` long. */
const run = (texts: string[], opts: { start?: number; step?: number; dur?: number; speaker?: string } = {}): TranscriptWord[] =>
  texts.map((text, i) => ({
    text,
    start: (opts.start ?? 0) + i * (opts.step ?? 0.5),
    end: (opts.start ?? 0) + i * (opts.step ?? 0.5) + (opts.dur ?? 0.4),
    ...(opts.speaker ? { speaker: opts.speaker } : {}),
  }));
const text = (c: { lines: string[] }) => c.lines.join(" ");
const near = (a: number, b: number, d = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(d);
const f24 = (n: number) => n / 24;

describe("output contract", () => {
  it("with no new options: changes and violations are empty, highlight is set, kind is speech", () => {
    const p = plan(run(["Hello", "there", "friends."]), { frame_rate: 25 });
    expect(p.changes).toEqual([]);
    expect(p.violations).toEqual([]);
    expect(p.settings.standard).toBeUndefined();
    expect(p.cleanup).toBeUndefined();
    expect(p.captions[0].n).toBe(1);
    expect(p.captions[0].text).toBe(p.captions[0].lines.join(" "));
    expect(p.captions[0].kind).toBe("speech");
    expect(p.captions[0].highlight).toHaveLength(p.captions[0].words.length);
    // Same timing as the old planner: last word ends 1.4 + 0.25 linger = 1.65, snapped to 25 fps.
    near(p.captions[0].end, 1.64);
  });
});

describe("standards", () => {
  it("every standard sets line length, lines and durations, and names itself in the plan", () => {
    const words = run("the quick brown fox jumps over the lazy dog while the band plays on and on through the night".split(" "), { step: 0.3, dur: 0.25 });
    for (const id of CAPTION_STANDARD_IDS) {
      const std = CAPTION_STANDARDS[id];
      const p = plan(words, { standard: id, frame_rate: 24 });
      expect(p.settings.standard).toBe(id);
      for (const c of p.captions) {
        expect(c.lines.length).toBeLessThanOrEqual(std.max_lines);
        for (const l of c.lines) expect(l.length).toBeLessThanOrEqual(std.max_cpl);
        expect(c.end - c.start).toBeLessThanOrEqual(std.max_duration_s + 1e-6);
      }
    }
  });

  it("explicit fields beat the standard", () => {
    const words = run("one two three four five six seven eight nine ten eleven twelve".split(" "), { step: 0.3, dur: 0.25 });
    const p = plan(words, { standard: "netflix_adult", max_chars_per_line: 12, max_lines: 1, frame_rate: 24 });
    for (const c of p.captions) {
      expect(c.lines).toHaveLength(1);
      expect(c.lines[0].length).toBeLessThanOrEqual(12);
    }
  });

  it("assumes 30 fps without a frame rate and says so", () => {
    const p = plan(run(["Hello", "there."]), { standard: "netflix_adult" });
    expect(p.warnings.join(" ")).toMatch(/30 fps/);
    expect(p.settings.frame_rate).toBe(30);
    expect(p.settings.frame_rate_assumed).toBe(true);
    expect(plan(run(["Hello", "there."]), { standard: "netflix_adult", frame_rate: 25 }).warnings.join(" ")).not.toMatch(/30 fps/);
    expect(plan(run(["Hello", "there."]), { frame_rate: 25 }).settings.frame_rate_assumed).toBe(false);
  });

  it("holds a short caption to the standard's minimum and lingers toward 0.5 s", () => {
    const p = plan(W([["Hi.", 1, 1.2], ["Later", 6, 6.4]]), { standard: "netflix_adult", frame_rate: 24 });
    // 0.2 s of speech: the 5/6 s minimum (20 frames) wins over 0.2 + 0.5.
    near(p.captions[0].end - p.captions[0].start, 20 / 24);
    const longer = plan(W([["Hello", 1, 1.6], ["Later", 6, 6.4]]), { standard: "netflix_adult", frame_rate: 24 });
    // 1.6 + 0.5 linger = 2.1 s.
    near(longer.captions[0].end, 2.1, 0.03);
    expect(longer.violations).toEqual([]);
  });
});

describe("fixing: extend, merge, split", () => {
  it("extends an out-time into the gap for reading speed and records it", () => {
    // 40 characters over 0.5 s of speech: 20 cps needs 2 s on screen.
    const p = plan(W([["Extraordinarily", 0, 0.3], ["unbelievable", 0.3, 0.5], ["circumstances", 0.5, 0.7], ["Later", 9, 9.5]]), { standard: "netflix_adult", frame_rate: 24, pause_break: 3 });
    const c = p.captions[0];
    expect(c.end - c.start).toBeGreaterThanOrEqual(text(c).length / 20 - 1e-6);
    expect(p.violations).toEqual([]);
    const ch = p.changes.find((x) => x.n === 1 && x.action === "extended");
    expect(ch).toBeDefined();
    expect(["cps", "min_duration"]).toContain(ch!.rule);
  });

  it("never extends into the next caption or the minimum gap", () => {
    const p = plan(W([["Extraordinarily", 0, 0.3], ["unbelievable", 0.3, 0.5], ["circumstances", 0.5, 0.7], ["Later", 1.3, 1.6]]), { standard: "netflix_adult", frame_rate: 24, pause_break: 0.3, fix: true });
    for (let i = 0; i + 1 < p.captions.length; i++) {
      expect(p.captions[i + 1].start - p.captions[i].end).toBeGreaterThanOrEqual(f24(2) - 1e-6);
    }
  });

  it("merges a too-short caption with its neighbour when the result fits, and lists it", () => {
    const words = W([["Yes.", 0, 0.3], ["No.", 0.6, 0.9]]);
    const p = plan(words, { standard: "netflix_adult", frame_rate: 24, pause_break: 0.2 });
    expect(p.captions).toHaveLength(1);
    expect(text(p.captions[0])).toBe("Yes. No.");
    const merge = p.changes.find((c) => c.action === "merged");
    expect(merge).toMatchObject({ n: 1, rule: "min_duration" });
    expect(p.violations).toEqual([]);
  });

  it("does not merge across a speaker change", () => {
    const words = W([["Yes.", 0, 0.3, "A"], ["No.", 0.6, 0.9, "B"]]);
    const p = plan(words, { standard: "netflix_adult", frame_rate: 24, pause_break: 0.2 });
    expect(p.captions).toHaveLength(2);
    expect(p.violations.some((v) => v.rule === "min_duration")).toBe(true);
  });

  it("with fix: false it reports violations and changes nothing extra", () => {
    const words = W([["Yes.", 0, 0.3], ["No.", 0.6, 0.9]]);
    const p = plan(words, { standard: "netflix_adult", frame_rate: 24, pause_break: 0.2, fix: false });
    expect(p.captions).toHaveLength(2);
    expect(p.changes).toEqual([]);
    expect(p.violations.map((v) => [v.n, v.rule])).toContainEqual([1, "min_duration"]);
    // Reading speed is reported too.
    const fast = plan(W([["Extraordinarily", 0, 0.3], ["unbelievable", 0.3, 0.5], ["circumstances", 0.5, 0.7], ["Later", 1.0, 1.5]]), { standard: "netflix_adult", frame_rate: 24, pause_break: 0.2, fix: false });
    expect(fast.violations.some((v) => v.rule === "cps")).toBe(true);
  });

  it("leaves a rule that cannot be fixed in violations", () => {
    // Fast speech with no room: the next caption starts right after, and the speakers differ.
    const p = plan(W([["Extraordinarily", 0, 0.3, "A"], ["unbelievable", 0.3, 0.5, "A"], ["circumstances", 0.5, 0.7, "A"], ["Later", 0.9, 1.5, "B"]]), { standard: "netflix_adult", frame_rate: 24 });
    expect(p.violations.some((v) => v.rule === "cps" && v.n === 1)).toBe(true);
  });

  it("splitPass splits an over-long caption at the best grammatical point near the middle", () => {
    const words = run("We went to the shop and then we came home again".split(" "), { step: 1, dur: 0.9 }).map((w) => ({ ...w }));
    const S: RuleSettings = {
      frame: 1 / 24,
      snap: (t) => Math.round(t * 24) / 24,
      maxChars: 60,
      maxLines: 2,
      minDur: 0.8,
      maxDur: 6,
      linger: 0.5,
      minGapT: 2 / 24,
      closeUnder: 0,
      cutZone: 0.5,
      cuts: [],
      std: CAPTION_STANDARDS.netflix_adult,
      fix: true,
      singleWord: false,
      layout: (c) => breakLines(c.words.map((w) => w.text), 60),
    };
    const cap: WorkCap = {
      start: 0,
      end: 12,
      lines: [words.map((w) => w.text).join(" ")],
      words: words.map((w) => ({ text: w.text, start: w.start, end: w.end })),
      kind: "speech",
      gram: words.map((w) => w.text),
      spk: words.map(() => undefined),
      rawStart: 0,
      rawLastEnd: 11.9,
    };
    const caps = [cap];
    const rec = new Rec();
    splitPass(caps, S, rec);
    expect(caps.length).toBeGreaterThan(1);
    expect(caps.flatMap((c) => c.words.map((w) => w.text))).toEqual(words.map((w) => w.text));
    for (const c of caps) expect(c.words[c.words.length - 1].end - c.words[0].start).toBeLessThanOrEqual(6);
    // Never ends a part on a weak word.
    for (const c of caps.slice(0, -1)) expect(["the", "to", "and", "we"]).not.toContain(c.words[c.words.length - 1].text);
    expect(rec.items[0]).toMatchObject({ rule: "max_duration", action: "split" });
  });
});

describe("gaps and linger", () => {
  const gapPlan = (gapFrames: number, fps: number, extra: CaptionOptions = {}) => {
    const a = [{ text: "one", start: 0, end: 0.5 }];
    const b = [{ text: "two", start: 0.5 + gapFrames / fps, end: 1.0 + gapFrames / fps }];
    return buildCaptions([{ text: "x", start: 0, end: 2, words: [...a, ...b] }], { frame_rate: fps, linger: 0, min_duration: 0.1, pause_break: 0.03, min_gap_frames: 2, close_gaps_under: 0.5, ...extra });
  };

  it("closes gaps of 3 to 11 frames at 24 fps to 2 frames, leaves 12 or more", () => {
    for (let g = 3; g <= 11; g++) {
      const p = gapPlan(g, 24);
      expect(p.captions).toHaveLength(2);
      near(p.captions[1].start - p.captions[0].end, 2 / 24);
      expect(p.changes.some((c) => c.rule === "close_gap" && c.n === 1)).toBe(true);
    }
    for (const g of [12, 20]) {
      const p = gapPlan(g, 24);
      near(p.captions[1].start - p.captions[0].end, g / 24);
      expect(p.changes.some((c) => c.rule === "close_gap")).toBe(false);
    }
  });

  it("scales the closing threshold to the frame rate (0.5 s is 15 frames at 30 fps)", () => {
    near(gapPlan(14, 30).captions[1].start - gapPlan(14, 30).captions[0].end, 2 / 30);
    near(gapPlan(15, 30).captions[1].start - gapPlan(15, 30).captions[0].end, 15 / 30);
    near(gapPlan(2, 30).captions[1].start - gapPlan(2, 30).captions[0].end, 2 / 30);
  });

  it("keeps the minimum gap by shortening the earlier caption, not below its last word start + 1 frame", () => {
    const p = gapPlan(1, 24);
    near(p.captions[1].start - p.captions[0].end, 2 / 24);
    expect(p.changes.some((c) => c.rule === "gap" && c.action === "shortened")).toBe(true);
    // Words touching: the earlier caption can only shrink to its last word start + 1 frame.
    const touching = buildCaptions([{ text: "x", start: 0, end: 1, words: W([["a", 0, 0.5], ["b", 0.5, 0.52], ["c", 0.5 + 1 / 24, 1]]) }], { frame_rate: 24, linger: 0, min_duration: 0.1, pause_break: 0.001, min_gap_frames: 2 });
    for (let i = 0; i + 1 < touching.captions.length; i++) {
      expect(touching.captions[i].end).toBeGreaterThan(touching.captions[i].words[touching.captions[i].words.length - 1].start);
      expect(touching.captions[i].end).toBeLessThanOrEqual(touching.captions[i + 1].start + 1e-9);
    }
  });

  it("lingers 0.5 s after the last word when there is room, with the standard", () => {
    const p = plan(W([["Hello", 1, 1.6], ["World", 8, 8.6]]), { standard: "bbc", frame_rate: 25, pause_break: 1 });
    near(p.captions[0].end, 2.1, 0.03);
    // Not into the minimum gap: the next caption is 0.6 s after the linger would end.
    const q = plan(W([["Hello", 1, 1.6], ["World", 2.3, 2.9]]), { standard: "bbc", frame_rate: 25, pause_break: 0.3, close_gaps_under: 0 });
    expect(q.captions[1].start - q.captions[0].end).toBeGreaterThanOrEqual(2 / 25 - 1e-6);
  });
});

describe("grammar-aware breaks", () => {
  it("does not end a line on an article, preposition or possessive when another break is near", () => {
    const lines = breakLines("I went to the shop with my friend".split(" "), 20);
    expect(lines).toHaveLength(2);
    for (const l of lines.slice(0, -1)) expect(l.split(" ").pop()).not.toMatch(/^(the|to|with|my|a|of)$/);
    expect(lines).toEqual(["I went to the shop", "with my friend"]);
  });

  it("keeps a first name with its surname and a number with its unit", () => {
    expect(breakLines("She met John Smith yesterday".split(" "), 18)).toEqual(["She met John Smith", "yesterday"]);
    const run10 = breakLines("We walked 10 km along the coast road".split(" "), 20);
    for (const l of run10.slice(0, -1)) expect(l.endsWith("10")).toBe(false);
  });

  it("prefers the longer line below when layouts cost the same", () => {
    expect(breakLines(["aaa", "bbb", "ccc", "ddd", "eee"], 12)).toEqual(["aaa bbb", "ccc ddd eee"]);
    expect(breakLines(["aaa", "bbb", "ccc", "ddd", "eee"], 12, { bottom_heavy: false })[0].length).toBeGreaterThan(0);
  });

  it("splits a caption that must split at a grammatical point among the last few words", () => {
    const words = run("She went to the store and then she bought a lot of fruit today".split(" "), { step: 0.3, dur: 0.25 });
    const p = plan(words, { max_chars_per_line: 20, max_lines: 1, pause_break: 5 });
    const ends = p.captions.map((c) => c.words[c.words.length - 1].text);
    for (const e of ends.slice(0, -1)) expect(["the", "to", "a", "of", "and", "she", "then"]).not.toContain(e);
    expect(p.captions.flatMap((c) => c.words.map((w) => w.text))).toEqual(words.map((w) => w.text));
    for (const c of p.captions) expect(c.lines[0].length).toBeLessThanOrEqual(20);
    for (const c of p.captions.slice(0, -1)) expect(c.words.length).toBeGreaterThanOrEqual(2);
  });

  it("reports a caption that ends on a weak word as a grammar violation", () => {
    // The pause forces the caption to close on "the".
    const p = plan(W([["We", 0, 0.3], ["walked", 0.4, 0.7], ["to", 0.8, 1.0], ["the", 1.0, 1.2], ["shop", 2.0, 2.4]]), { standard: "netflix_adult", frame_rate: 24, fix: false, pause_break: 0.7 });
    expect(p.violations.some((v) => v.rule === "grammar")).toBe(true);
  });
});

describe("shot changes", () => {
  const opts = (cuts: number[], extra: CaptionOptions = {}): CaptionOptions => ({ frame_rate: 24, cut_times: cuts, min_gap_frames: 2, pause_break: 3, ...extra });

  it("snaps an in-time within the zone onto the cut, after or before it", () => {
    const p = plan(W([["Hello", 5.2, 5.6], ["there", 5.6, 6.0]]), opts([5]));
    near(p.captions[0].start, 5);
    expect(p.changes).toContainEqual(expect.objectContaining({ rule: "shot_change", action: "moved_in", n: 1 }));
    // Two frames before the first word: also onto the cut.
    const q = plan(W([["Hello", 5 - 2 / 24, 5.4], ["there", 5.5, 6.0]]), opts([5]));
    near(q.captions[0].start, 5);
  });

  it("leaves an in-time at least the zone from any cut", () => {
    const p = plan(W([["Hello", 5.7, 6.0]]), opts([5]));
    near(p.captions[0].start, Math.round(5.7 * 24) / 24);
    expect(p.changes.filter((c) => c.rule === "shot_change")).toEqual([]);
  });

  it("moves an out-time within the zone before a cut to 2 frames before it", () => {
    const p = plan(W([["Hello", 1, 1.4], ["Later", 9, 9.5]]), opts([2.25], { linger: 0.25, min_duration: 1 }));
    near(p.captions[0].end, 2.25 - 2 / 24, 1e-6);
    expect(p.changes).toContainEqual(expect.objectContaining({ rule: "shot_change", n: 1 }));
  });

  it("ends a caption 2 frames before a cut it would span, when its last word is done", () => {
    const p = plan(W([["Hello", 1, 1.4], ["Later", 9, 9.5]]), opts([1.75], { linger: 0.25, min_duration: 1 }));
    near(p.captions[0].end, 1.75 - 2 / 24, 1e-6);
  });

  it("extends a caption past a cut by the zone when its words run over the cut and there is room", () => {
    const p = plan(W([["Hello", 1, 1.9], ["Later", 9, 9.5]]), opts([1.7], { linger: 0, min_duration: 0.2 }));
    near(p.captions[0].end, 1.7 + 0.5, 0.05);
    const tight = plan(W([["Hello", 1, 1.9], ["Later", 2.0, 2.5]]), opts([1.7], { linger: 0, min_duration: 0.2, pause_break: 0.05 }));
    expect(tight.captions[0].end).toBeLessThanOrEqual(tight.captions[1].start - 2 / 24 + 1e-9);
  });

  it("splits a caption whose words are on both sides of a cut, and no caption straddles it", () => {
    const words = run(["one", "two", "three", "four", "five", "six"], { step: 0.5, dur: 0.3 });
    const cut = 34 / 24;
    const p = plan(words, opts([cut], { max_chars_per_line: 40 }));
    expect(p.captions.length).toBeGreaterThanOrEqual(2);
    expect(p.changes).toContainEqual(expect.objectContaining({ rule: "shot_change", action: "split" }));
    for (const c of p.captions) expect(c.start < cut - 1e-6 && c.end > cut + 1e-6).toBe(false);
    near(p.captions[1].start, cut);
    expect(p.captions.flatMap((c) => c.words.map((w) => w.text))).toEqual(words.map((w) => w.text));
  });

  it("does not merge captions across a cut when fixing", () => {
    const words = W([["Yes.", 0, 0.3], ["No.", 0.9, 1.2]]);
    const p = plan(words, { standard: "netflix_adult", frame_rate: 24, pause_break: 0.5, cut_times: [0.6] });
    expect(p.captions).toHaveLength(2);
  });
});

describe("show_at", () => {
  const words = () => W([["one", 1, 1.32], ["two", 1.52, 1.8], ["three", 1.84, 2.2]]);
  it("is the word start minus the lead frames (default 1)", () => {
    const p = plan(words(), { frame_rate: 25 });
    const w = p.captions[0].words;
    const h = p.captions[0].highlight!;
    near(h[1], 1.52 - 1 / 25);
    near(h[0], w[0].start);
  });
  it("lead 0 is the word start; lead 2 is two frames earlier", () => {
    near(plan(words(), { frame_rate: 25, highlight_lead_frames: 0 }).captions[0].highlight![1], 1.52);
    near(plan(words(), { frame_rate: 25, highlight_lead_frames: 2 }).captions[0].highlight![1], 1.52 - 2 / 25);
  });
  it("is never before the caption start or the previous word's show_at", () => {
    const p = plan(words(), { frame_rate: 25, highlight_lead_frames: 6 });
    const c = p.captions[0];
    let prev = c.start;
    c.words.forEach((w, i) => {
      const at = c.highlight![i];
      expect(at).toBeGreaterThanOrEqual(c.start - 1e-9);
      expect(at).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(at).toBeLessThanOrEqual(w.start + 1e-9);
      prev = at;
    });
  });
  it("uses 1/30 s per frame without a frame rate", () => {
    const p = buildCaptions([{ text: "x", start: 1, end: 2.2, words: words() }]);
    near(p.captions[0].highlight![1], 1.52 - 1 / 30, 1 / 30);
  });
});

describe("social chunking", () => {
  it("max_words caps the words per caption", () => {
    const p = plan(run("one two three four five six seven".split(" "), { step: 0.3, dur: 0.25 }), { max_words: 3 });
    for (const c of p.captions) expect(c.words.length).toBeLessThanOrEqual(3);
    expect(p.captions.map((c) => c.words.length)).toEqual([3, 3, 1]);
  });

  it("single_word gives one word per caption, merging a word under 8 frames into the next", () => {
    const words = W([["Go", 0, 5 / 24], ["home", 0.3, 0.7], ["now", 0.8, 1.2]]);
    const p = plan(words, { single_word: true, frame_rate: 24, pause_break: 1 });
    expect(p.captions.map((c) => text(c))).toEqual(["Go home", "now"]);
    expect(p.changes).toContainEqual(expect.objectContaining({ rule: "single_word", action: "merged", n: 1 }));
    const plain = plan(run(["one", "two", "three"], { step: 0.5, dur: 0.4 }), { single_word: true, frame_rate: 24 });
    expect(plain.captions.map((c) => text(c))).toEqual(["one", "two", "three"]);
    expect(plain.changes).toEqual([]);
  });

  it("single_word keeps a number with its unit and a first name with a surname", () => {
    const p = plan(run(["Walk", "10", "km", "with", "John", "Smith", "today"], { step: 0.5, dur: 0.4 }), { single_word: true, frame_rate: 24 });
    expect(p.captions.map((c) => text(c))).toEqual(["Walk", "10 km", "with", "John Smith", "today"]);
  });
});

describe("speakers", () => {
  const two = () => [...run(["Hello", "there", "friend."], { speaker: "speaker_0" }), ...run(["Hi", "back."], { start: 2, speaker: "speaker_1" }), ...run(["More", "talk."], { start: 4, speaker: "speaker_0" })];

  it("numbers speakers by first appearance", () => {
    const p = plan(two());
    expect(p.captions.map((c) => c.speaker_index)).toEqual([0, 1, 0]);
    expect(p.captions.every((c) => c.color === undefined)).toBe(true);
  });

  it("colour style colours by speaker: BBC order, or your own", () => {
    const p = plan(two(), { speaker_style: "color" });
    expect(p.captions.map((c) => c.color)).toEqual([SPEAKER_COLORS[0], SPEAKER_COLORS[1], SPEAKER_COLORS[0]]);
    const custom = plan(two(), { speaker_style: "color", speaker_colors: ["#ff0000", "#00ff00"] });
    expect(custom.captions.map((c) => c.color)).toEqual(["#ff0000", "#00ff00", "#ff0000"]);
    expect(p.captions[0].lines.join(" ")).not.toMatch(/:/);
  });

  it("accessibility adds a label at each change on top of colour", () => {
    const p = plan(two(), { speaker_style: "color", accessibility: true });
    expect(p.captions.map((c) => c.lines[0].split(" ")[0])).toEqual(["SPEAKER_0:", "SPEAKER_1:", "SPEAKER_0:"]);
    expect(p.captions[0].color).toBe(SPEAKER_COLORS[0]);
  });

  it("label style prefixes the first caption after each change, with names, counted in the line length", () => {
    const p = plan(two(), { speaker_style: "label", speaker_names: { speaker_0: "ANNA", speaker_1: "BEN" } });
    expect(p.captions.map((c) => c.lines[0].split(" ")[0])).toEqual(["ANNA:", "BEN:", "ANNA:"]);
    // Same speaker continuing in a second caption has no label.
    const long = plan(run("one two three four five six seven eight nine ten".split(" "), { step: 0.3, dur: 0.25, speaker: "speaker_0" }), { speaker_style: "label", max_chars_per_line: 16, max_lines: 1, pause_break: 5 });
    expect(long.captions[0].lines[0].startsWith("SPEAKER_0:")).toBe(true);
    for (const c of long.captions) expect(c.lines[0].length).toBeLessThanOrEqual(16);
    for (const c of long.captions.slice(1)) expect(c.lines[0]).not.toMatch(/SPEAKER_0:/);
  });

  it("hyphen style puts two short turns of different speakers in one two-line caption", () => {
    const words = W([["Hi", 0, 0.3, "A"], ["there.", 0.3, 0.6, "A"], ["Hello.", 0.9, 1.3, "B"]]);
    const p = plan(words, { speaker_style: "hyphen", pause_break: 1 });
    expect(p.captions).toHaveLength(1);
    expect(p.captions[0].lines).toEqual(["- Hi there.", "- Hello."]);
    // Too long for one line each: plain captions.
    const long = plan(W([["This", 0, 0.3, "A"], ["is", 0.3, 0.6, "A"], ["quite", 0.6, 0.9, "A"], ["a", 0.9, 1.2, "A"], ["long", 1.2, 1.5, "A"], ["turn", 1.5, 1.8, "A"], ["Hello.", 2.0, 2.4, "B"]]), { speaker_style: "hyphen", max_chars_per_line: 20, pause_break: 1 });
    expect(long.captions.every((c) => !c.lines[0].startsWith("- "))).toBe(true);
  });
});

describe("sound events and lyrics (SDH)", () => {
  const ELEVEN = JSON.stringify({
    words: [
      { text: "Hello", start: 0.1, end: 0.5, type: "word" },
      { text: "there.", start: 0.5, end: 0.9, type: "word" },
      { text: "(Laughter)", start: 1.0, end: 1.6, type: "audio_event" },
      { text: "Next", start: 1.8, end: 2.2, type: "word" },
      { text: "thing.", start: 2.2, end: 2.6, type: "word" },
    ],
  });

  it("makes an ElevenLabs audio_event its own [lower-case] caption between the speech", () => {
    const p = buildCaptions(parseTranscript(ELEVEN), { frame_rate: 24 });
    expect(p.captions.map((c) => [c.kind, text(c)])).toEqual([
      ["speech", "Hello there."],
      ["sound", "[laughter]"],
      ["speech", "Next thing."],
    ]);
    expect(p.captions[1].speaker).toBeUndefined();
    expect(p.captions[1].italic).toBeUndefined();
  });

  it("can be switched off, ", () => {
    const p = buildCaptions(parseTranscript(ELEVEN), { frame_rate: 24, sdh: { sound_events: false } });
    expect(p.captions.every((c) => c.kind === "speech")).toBe(true);
    expect(p.captions.map(text).join(" ")).not.toMatch(/laughter/);
  });

  it("splits speech around an event that falls inside a sentence", () => {
    const json = JSON.stringify({
      words: [
        { text: "Hello", start: 0, end: 0.4, type: "word" },
        { text: "(door slams)", start: 0.45, end: 0.7, type: "audio_event" },
        { text: "friends.", start: 0.8, end: 1.2, type: "word" },
      ],
    });
    const p = buildCaptions(parseTranscript(json), { frame_rate: 24 });
    expect(p.captions.map((c) => [c.kind, text(c)])).toEqual([["speech", "Hello"], ["sound", "[door slams]"], ["speech", "friends."]]);
    for (let i = 0; i + 1 < p.captions.length; i++) expect(p.captions[i].end).toBeLessThanOrEqual(p.captions[i + 1].start + 1e-9);
  });

  it("treats words in [square brackets] as sound events, skipped by fillers and glossary", () => {
    const words = W([["So", 0, 0.3], ["[Music", 0.4, 0.8], ["playing]", 0.8, 1.2], ["um", 1.5, 1.8], ["go.", 1.9, 2.3]]);
    const p = plan(words, { cleanup: { remove_fillers: true, glossary: [{ find: "music", replace: "SONG" }] }, frame_rate: 24 });
    expect(p.captions.map((c) => [c.kind, text(c)])).toEqual([["speech", "So"], ["sound", "[music playing]"], ["speech", "go."]]);
    const off = plan(words, { sdh: { sound_events: false }, frame_rate: 24 });
    expect(off.captions.every((c) => c.kind === "speech")).toBe(true);
    expect(off.captions.map(text).join(" ")).toContain("[Music playing]");
  });

  it("never merges a sound caption with speech when fixing", () => {
    const json = JSON.stringify({
      words: [
        { text: "Yes.", start: 0, end: 0.3, type: "word" },
        { text: "(laughs)", start: 0.6, end: 0.8, type: "audio_event" },
        { text: "No.", start: 1.2, end: 1.4, type: "word" },
      ],
    });
    const p = buildCaptions(parseTranscript(json), { standard: "netflix_adult", frame_rate: 24 });
    expect(p.captions.filter((c) => c.kind === "sound")).toHaveLength(1);
    expect(p.captions.filter((c) => c.kind === "sound")[0].lines).toEqual(["[laughs]"]);
  });

  it("marks words in lyric ranges as lyric captions: italic, wrapped in music notes, counted in the line length", () => {
    const words = run(["la", "la", "land", "Back", "to", "talk"], { step: 0.5, dur: 0.4 });
    const p = plan(words, { sdh: { lyric_ranges: [{ start: 0, end: 1.6 }] }, frame_rate: 24, pause_break: 3 });
    const lyric = p.captions.find((c) => c.kind === "lyric")!;
    expect(lyric.italic).toBe(true);
    expect(lyric.lines[0].startsWith("♪ ")).toBe(true);
    expect(lyric.lines[lyric.lines.length - 1].endsWith(" ♪")).toBe(true);
    expect(lyric.words.map((w) => w.text)).toEqual(["la", "la", "land"]);
    const speech = p.captions.find((c) => c.kind === "speech")!;
    expect(text(speech)).toBe("Back to talk");
    expect(speech.italic).toBeUndefined();
    const tight = plan(run(["abcdefgh", "ijklmnop"], { step: 0.5, dur: 0.4 }), { sdh: { lyric_ranges: [{ start: 0, end: 2 }] }, max_chars_per_line: 12, pause_break: 3 });
    for (const l of tight.captions[0].lines) expect(l.length).toBeLessThanOrEqual(12);
    expect(tight.captions[0].lines).toHaveLength(2);
  });
});

describe("review fixes: shot changes, social chunking, hyphen limits", () => {
  const straddles = (p: ReturnType<typeof plan>, cuts: number[]) => p.captions.filter((c) => cuts.some((x) => c.start < x - 1e-6 && c.end > x + 1e-6));
  const wellFormed = (p: ReturnType<typeof plan>, fps: number) => {
    p.captions.forEach((c, i) => {
      for (const w of c.words) expect(w.end).toBeGreaterThanOrEqual(w.start - 1e-9);
      expect(c.end).toBeGreaterThan(c.words[c.words.length - 1].start);
      const n = p.captions[i + 1];
      if (n) expect(n.start - c.end).toBeGreaterThanOrEqual(2 / fps - 1e-6);
    });
  };

  it("never lengthens an out-time back across an earlier cut (30 fps, two cuts)", () => {
    const cuts = [3.6333, 3.9667];
    const p = plan(W([["will", 3.256, 3.505], ["of", 4.841, 5.297]]), { standard: "social_9x16", frame_rate: 30, cut_times: cuts });
    expect(straddles(p, cuts.map((x) => Math.round(x * 30) / 30))).toEqual([]);
    expect(p.violations.filter((v) => v.rule === "shot_change")).toEqual([]);
  });

  it("a single word before two close cuts ends before the first (24 fps)", () => {
    const cuts = [1.5, 1.8333];
    const p = plan(W([["hello", 1.0, 1.4]]), { standard: "netflix_adult", frame_rate: 24, cut_times: cuts });
    expect(p.captions[0].end).toBeLessThanOrEqual(1.5 - 2 / 24 + 1e-6);
    expect(straddles(p, [1.5, 44 / 24])).toEqual([]);
  });

  it("gap closing and linger never carry a caption across a cut whose speech ended before it", () => {
    for (const standard of ["netflix_adult", "social_9x16"] as const) {
      const p = plan(W([["quickly", 1.1, 1.467], ["beautiful", 2.361, 2.82]]), { standard, frame_rate: 24, cut_times: [1.5417] });
      near(p.captions[0].end, 35 / 24);
      expect(straddles(p, [37 / 24])).toEqual([]);
    }
  });

  it("does not snap an in-time onto a cut after the caption's own words ended", () => {
    const words = W([["the", 1.833, 1.917], ["said", 1.992, 2.164], ["they", 2.251, 2.525], ["with", 2.597, 3.132], ["Smith", 3.196, 3.763], ["pm", 3.8, 4.224], ["on", 4.329, 4.41], ["we", 4.455, 4.749], ["we", 4.855, 5.192]]);
    const p = plan(words, { standard: "netflix_adult", frame_rate: 24, cut_times: [1.9583, 5] });
    wellFormed(p, 24);
    // The last word runs over the cut at 5 s, so that one cannot be split; it holds 0.5 s past it instead.
    expect(straddles(p, [47 / 24])).toEqual([]);
    expect(p.captions[0].end).toBeGreaterThanOrEqual(5.5 - 1e-6);
    expect(p.violations.filter((v) => v.rule === "gap" || v.rule === "overlap")).toEqual([]);
  });

  it("two one-word captions around a cut do not overlap (25 fps, speaker colour)", () => {
    const p = plan(W([["on", 4.529, 4.579, "s1"], ["it", 4.714, 4.87, "s0"]]), { standard: "dcmp", frame_rate: 25, speaker_style: "color", cut_times: [4.64] });
    wellFormed(p, 25);
    expect(p.violations.filter((v) => v.rule === "gap" || v.rule === "overlap")).toEqual([]);
  });

  it("a first word that ends before the cut and is followed by more words starts on the cut", () => {
    const p = plan(W([["the", 1.833, 1.917], ["said", 2.0, 2.3], ["so", 2.4, 2.8]]), { standard: "netflix_adult", frame_rate: 24, cut_times: [47 / 24] });
    near(p.captions[0].start, 47 / 24);
    for (const w of p.captions[0].words) expect(w.end).toBeGreaterThanOrEqual(w.start);
  });

  it("splitAtCuts leaves a sliver before a cut alone instead of splitting it off", () => {
    const p = plan(W([["Hello", 0.9, 1.3], ["there", 1.5, 2.2], ["my", 2.3, 2.6], ["friends", 2.7, 3.4], ["today", 3.5, 4.0]]), { standard: "netflix_adult", frame_rate: 24, cut_times: [1.4] });
    // "Hello" alone would have room for under the 5/6 s minimum, so it is not a caption of its own.
    expect(p.captions.every((c) => c.words.length > 1 || c.words[0].text !== "Hello")).toBe(true);
  });

  it("single_word does not split a first name from a surname when merging a short word", () => {
    const p = plan(W([["a", 0, 0.1], ["b", 0.12, 0.2], ["The", 0.3, 0.4], ["10", 0.5, 0.6], ["km", 0.6, 0.9], ["Anna", 1.0, 1.4], ["Smith", 1.4, 1.8]]), { single_word: true, frame_rate: 24 });
    const texts = p.captions.map((c) => c.words.map((w) => w.text).join(" "));
    expect(texts).toContain("Anna Smith");
    expect(texts.some((t) => t.endsWith(" The") || t === "The")).toBe(false);
    expect(texts).toContain("The 10 km");
  });

  it("hyphen style makes no pair when single_word is on, and respects max_words", () => {
    const words = W([["Yes.", 0, 0.5, "s0"], ["No way.", 0.6, 1.2, "s1"]]);
    const base: CaptionOptions = { frame_rate: 24, speaker_style: "hyphen" };
    expect(plan(words, base).captions).toHaveLength(1);
    expect(plan(words, { ...base, single_word: true }).captions.length).toBeGreaterThan(1);
    expect(plan(words, { ...base, max_words: 2 }).captions.length).toBe(2);
    expect(plan(words, { ...base, max_words: 3 }).captions).toHaveLength(1);
  });
});

describe("number and unit rule", () => {
  it("only a unit word keeps a number company", () => {
    expect(weakEndReason("2020", "when")).toBeUndefined();
    expect(weakEndReason("2020", "and")).toBeUndefined();
    expect(breakPenalty("2020", "and")).toBeLessThan(8);
    for (const u of ["km", "pm", "%", "percent", "dollars", "mph", "kg", "million"]) {
      expect(weakEndReason("10", u)).toBe("splits a number from its unit");
      expect(breakPenalty("10", u)).toBeGreaterThanOrEqual(8);
    }
  });
});

describe("social chunking with max_words", () => {
  const social = { standard: "social_9x16" as const, max_words: 3, frame_rate: 30 };
  const weakLast = (c: { lines: string[] }, next?: { lines: string[] }) => {
    const last = c.lines.join(" ").split(" ").pop()!;
    return next !== undefined && weakEndReason(last, next.lines.join(" ").split(" ")[0]) !== undefined;
  };

  it("does not end a chunk on a preposition, article or conjunction when a nearby break is clean", () => {
    // 'for Ogilvy in London at the new studio and ...' cut into threes ends on 'in', 'the', 'and'.
    const texts = "She worked for Ogilvy in London at the new studio and then moved".split(" ");
    const p = plan(run(texts, { step: 0.32, dur: 0.28 }), social);
    p.captions.forEach((c, i) => expect(weakLast(c, p.captions[i + 1]), `caption ${i + 1} "${text(c)}"`).toBe(false));
    // The words are all there, in order, and no chunk is over max_words + 1.
    expect(p.captions.flatMap((c) => c.words.map((w) => w.text))).toEqual(texts);
    for (const c of p.captions) expect(c.words.length).toBeLessThanOrEqual(4);
  });

  it("prefers a break at punctuation: the last word of a full chunk moves on", () => {
    const p = plan(run("Fresh bread, from the bakery".split(" "), { step: 0.3, dur: 0.25 }), { max_words: 3 });
    expect(p.captions.map(text)).toEqual(["Fresh bread,", "from the bakery"]);
  });

  it("takes an extra word or hands one on rather than end on a preposition, and leaves plain words at max_words", () => {
    const p = plan(run("Fresh bread from London every single morning".split(" "), { step: 0.4, dur: 0.3 }), { max_words: 3 });
    p.captions.forEach((c, i) => expect(weakLast(c, p.captions[i + 1]), text(c)).toBe(false));
    const plain = plan(run("one two three four five six seven".split(" "), { step: 0.3, dur: 0.25 }), { max_words: 3 });
    expect(plain.captions.map((c) => c.words.length)).toEqual([3, 3, 1]);
  });

  it("merges a too-short chunk past max_words when fix is on, and says so", () => {
    // 'at the new' 0.37 s and 'It went' 0.23 s: max_words 3 blocks the plain merge.
    const ws: TranscriptWord[] = [];
    const add = (tx: string, start: number, dur: number) => ws.push({ text: tx, start, end: start + dur });
    ["Alpha", "Bravo", "Charlie"].forEach((w, i) => add(w, i * 0.4, 0.35));
    // A quick chunk between two full ones: 0.1 s apart, so it cannot stay up 0.5 s and the next chunk starts 2 frames after it.
    ["Delta", "Echo", "Foxtrot"].forEach((w, i) => add(w, 1.5 + i * 0.1, 0.09));
    ["Golf", "Hotel", "India"].forEach((w, i) => add(w, 1.9 + i * 0.4, 0.35));
    const fixed = plan(ws, { standard: "social_9x16", max_words: 3, frame_rate: 30, fix: true });
    expect(fixed.violations.filter((v) => v.rule === "min_duration")).toEqual([]);
    const over = fixed.changes.filter((c) => c.action === "merged_over_max_words");
    expect(over.length).toBeGreaterThan(0);
    expect(over.every((c) => c.rule === "min_duration" || c.rule === "cps")).toBe(true);
    expect(fixed.captions.some((c) => c.words.length > 4)).toBe(true);
    expect(fixed.captions.every((c) => c.words.length <= 6)).toBe(true);
    // fix off: nothing merged past the limit, the violations stay for the caller.
    const raw = plan(ws, { standard: "social_9x16", max_words: 3, frame_rate: 30, fix: false });
    expect(raw.changes.some((c) => c.action === "merged_over_max_words")).toBe(false);
    // single_word keeps its one-word captions.
    const one = plan(ws, { standard: "social_9x16", max_words: 3, frame_rate: 30, single_word: true });
    expect(one.changes.some((c) => c.action === "merged_over_max_words")).toBe(false);
  });

  it("single_word is unchanged by the word-limit break", () => {
    const p = plan(run("one two three four".split(" "), { step: 0.6, dur: 0.4 }), { single_word: true, max_words: 3 });
    expect(p.captions.map(text)).toEqual(["one", "two", "three", "four"]);
  });

  it("fuzz: random speech never loses words, stays within max_words + 1, and rarely ends on a weak word", () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const weak = "the a an in at of for and but to with on is was we they".split(" ");
    const strong = "brief studio London Ogilvy moved film lights camera team story launch client quickly simple great".split(" ");
    let total = 0;
    let weakEnds = 0;
    for (let run_ = 0; run_ < 60; run_++) {
      const n = 12 + Math.floor(rnd() * 20);
      const texts: string[] = [];
      for (let i = 0; i < n; i++) texts.push(rnd() < 0.3 ? weak[Math.floor(rnd() * weak.length)] : strong[Math.floor(rnd() * strong.length)]);
      let t = 0;
      const ws: TranscriptWord[] = texts.map((tx) => {
        const start = t;
        t += 0.25 + rnd() * 0.15;
        return { text: tx, start, end: t - 0.04 };
      });
      const fix = rnd() < 0.5;
      const p = plan(ws, { standard: "social_9x16", max_words: 3, frame_rate: 30, fix });
      expect(p.captions.flatMap((c) => c.words.map((w) => w.text))).toEqual(texts);
      // With fix on, a caption under the minimum duration joins a neighbour even past max_words (up to twice the limit);
      // nothing in this speech has another speaker or a cut, so none may remain unless it is the only caption.
      if (fix && p.captions.length > 1) expect(p.violations.filter((v) => v.rule === "min_duration"), JSON.stringify(p.violations)).toEqual([]);
      p.captions.forEach((c, i) => {
        expect(c.words.length).toBeLessThanOrEqual(fix ? 6 : 4);
        if (i + 1 < p.captions.length) {
          total++;
          if (weakLast(c, p.captions[i + 1])) weakEnds++;
        }
      });
    }
    // Where a clean break is within one word of the limit there is none left; only runs of weak words can force one.
    expect(weakEnds / total).toBeLessThan(0.06);
  });
});

// ---------- ported cleanup tests ----------

/** Words 0.5 s apart, 0.4 s long, from texts. */
const mk = (texts: string[], opts: { dur?: number; step?: number } = {}): CleanWord[] =>
  texts.map((text, i) => ({ text, start: i * (opts.step ?? 0.5), end: i * (opts.step ?? 0.5) + (opts.dur ?? 0.4) }));
const texts = (ws: CleanWord[]) => ws.map((w) => w.text);

describe("cleanupWords", () => {
  it("drops words at or after drop_after_s", () => {
    const r = cleanupWords(mk(["a", "b", "c", "d"]), { drop_after_s: 1, drop_music_tokens: false, min_word_s: 0 });
    expect(texts(r.words)).toEqual(["a", "b"]);
    expect(r.report.dropped_after_end).toBe(2);
  });

  it("drops music notes, the replacement character and symbol-only tokens, by default", () => {
    const r = cleanupWords(mk(["♪", "hello", "�", "♫♫", "-", "world"]), {});
    expect(texts(r.words)).toEqual(["hello", "world"]);
    expect(r.report.dropped_music_tokens).toBe(4);
    const kept = cleanupWords(mk(["♪", "hello"]), { drop_music_tokens: false });
    expect(texts(kept.words)).toEqual(["♪", "hello"]);
  });

  it("drops words under min_word_s (default 0.05), keeps all with 0, never drops estimated words", () => {
    const ws = mk(["a", "b", "c"]);
    ws[1].end = ws[1].start + 0.01;
    expect(texts(cleanupWords(ws, {}).words)).toEqual(["a", "c"]);
    expect(cleanupWords(ws, {}).report.dropped_short).toBe(1);
    expect(texts(cleanupWords(ws, { min_word_s: 0 }).words)).toEqual(["a", "b", "c"]);
    const est = ws.map((w) => ({ ...w, estimated: true }));
    expect(texts(cleanupWords(est, {}).words)).toEqual(["a", "b", "c"]);
  });

  it("removes the default fillers and moves their punctuation to the word before", () => {
    const r = cleanupWords(mk(["Well", "um,", "then", "uh", "go", "Mhm."]), { remove_fillers: true });
    expect(texts(r.words)).toEqual(["Well,", "then", "go."]);
    expect(r.report.fillers_removed).toBe(3);
  });

  it("gives a sentence-opening filler's capital to the next word", () => {
    const r = cleanupWords(mk(["Um,", "we", "left.", "Uh", "then", "we", "um", "ran."]), { remove_fillers: true });
    expect(texts(r.words)).toEqual(["We", "left.", "Then", "we", "ran."]);
  });

  it("collapses a repeat across a comma ('the, the') but keeps emphatic and sentence-end repeats", () => {
    const r = cleanupWords(mk(["So", "the,", "the", "brief", "was", "simple"]), { remove_stutters: true });
    expect(texts(r.words)).toEqual(["So", "the", "brief", "was", "simple"]);
    expect(r.report.stutters_removed).toBe(1);
    expect(texts(cleanupWords(mk(["It", "was", "a,", "A", "day"]), { remove_stutters: true }).words)).toEqual(["It", "was", "A", "day"]);
    expect(texts(cleanupWords(mk(["Go.", "Go", "now"]), { remove_stutters: true }).words)).toEqual(["Go.", "Go", "now"]);
    expect(texts(cleanupWords(mk(["very,", "very", "good"]), { remove_stutters: true }).words)).toEqual(["very,", "very", "good"]);
  });

  it("takes its own filler list instead of the default", () => {
    const r = cleanupWords(mk(["so", "like", "um", "go"]), { remove_fillers: true, filler_words: ["like"] });
    expect(texts(r.words)).toEqual(["so", "um", "go"]);
  });

  it("collapses stutters and repeats, keeping the later word and its end", () => {
    const ws = mk(["I-", "I", "think", "the", "the", "plan", "th-", "the", "end"]);
    const r = cleanupWords(ws, { remove_stutters: true });
    expect(texts(r.words)).toEqual(["I", "think", "the", "plan", "the", "end"]);
    expect(r.report.stutters_removed).toBe(3);
    expect(r.words[0].start).toBe(0);
    expect(r.words[0].end).toBeCloseTo(0.9, 6);
    // Case-insensitive, but a comma means it was meant.
    expect(texts(cleanupWords(mk(["The", "the"]), { remove_stutters: true }).words)).toEqual(["the"]);
    expect(texts(cleanupWords(mk(["no,", "no"]), { remove_stutters: true }).words)).toEqual(["no,", "no"]);
  });

  it("replaces glossary phrases whole-word, in order, with the span's times", () => {
    const ws = mk(["we", "use", "after", "effects.", "Aftereffects", "is", "chroma"]);
    const r = cleanupWords(ws, {
      glossary: [
        { find: "after effects", replace: "After Effects" },
        { find: "chroma", replace: "CHROMA", case_sensitive: true },
        { find: "Chroma", replace: "Chroma Studio", case_sensitive: true },
      ],
    });
    // The phrase becomes two words sharing the span (the AE word count), the full stop stays.
    expect(texts(r.words)).toEqual(["we", "use", "After", "Effects.", "Aftereffects", "is", "CHROMA"]);
    expect(r.report.glossary_replacements).toBe(2);
    expect(r.words[2].start).toBe(1);
    expect(r.words[3].end).toBeCloseTo(1.9, 6);
  });

  it("case-sensitive glossary entries only match their case", () => {
    const r = cleanupWords(mk(["chroma", "Chroma"]), { glossary: [{ find: "chroma", replace: "X", case_sensitive: true }] });
    expect(texts(r.words)).toEqual(["X", "Chroma"]);
    expect(r.report.glossary_replacements).toBe(1);
    const gone = cleanupWords(mk(["a", "um", "b"]), { glossary: [{ find: "um", replace: "" }] });
    expect(texts(gone.words)).toEqual(["a", "b"]);
  });

  it("upper-cases, or sentence-cases (lower, then capital at sentence starts and for I)", () => {
    const ws = mk(["HELLO", "THERE.", "I", "AM", "I'M", "HERE"]);
    expect(texts(cleanupWords(ws, { case: "upper" }).words)).toEqual(["HELLO", "THERE.", "I", "AM", "I'M", "HERE"]);
    expect(texts(cleanupWords(mk(["hello", "there."]), { case: "upper" }).words)).toEqual(["HELLO", "THERE."]);
    expect(texts(cleanupWords(ws, { case: "sentence" }).words)).toEqual(["Hello", "there.", "I", "am", "I'm", "here"]);
    expect(texts(cleanupWords(mk(["a", "b."]), { case: "as_is" }).words)).toEqual(["a", "b."]);
  });

  it("strips punctuation but keeps inner apostrophes, and remembers the sentence ends", () => {
    const ws = mk(["Don't", "go,", "well-known", "3.5", "“quote.”", "x?"]);
    const r = cleanupWords(ws, { strip_punctuation: true });
    expect(texts(r.words)).toEqual(["Don't", "go", "well-known", "3.5", "quote", "x"]);
    expect(r.words[1].sentence_end).toBe(false);
    expect(r.words[5].sentence_end).toBe(true);
    expect(r.words[1].gram).toBe("go,");
  });

  it("hands a dropped cue start to the next word", () => {
    const ws = mk(["um", "hello"]);
    ws[0].cue_start = true;
    const r = cleanupWords(ws, { remove_fillers: true });
    expect(r.words).toHaveLength(1);
    expect(r.words[0].cue_start).toBe(true);
  });
});

describe("buildCaptions with cleanup", () => {
  const seg = (words: string[]) => [{ text: "x", start: 0, end: words.length * 0.5, words: mk(words) }];

  it("returns the report; without cleanup nothing is dropped and there is no report", () => {
    const withIt = buildCaptions(seg(["um", "hello", "there"]), { cleanup: { remove_fillers: true } });
    expect(withIt.cleanup?.fillers_removed).toBe(1);
    expect(withIt.captions[0].lines).toEqual(["hello there"]);
    const without = buildCaptions(seg(["um", "hello", "there"]));
    expect(without.cleanup).toBeUndefined();
    expect(without.captions[0].lines).toEqual(["um hello there"]);
    // The default-on clean-ups only run when a cleanup object is passed.
    const music = buildCaptions(seg(["♪", "hello", "there"]));
    expect(music.captions[0].words).toHaveLength(3);
    expect(buildCaptions(seg(["♪", "hello", "there"]), { cleanup: {} }).captions[0].words).toHaveLength(2);
  });

  it("still ends a caption at a sentence end when punctuation is stripped", () => {
    const words = ["This", "is", "a", "fairly", "long", "sentence.", "And", "here", "is", "more"];
    const plan = buildCaptions([{ text: "x", start: 0, end: 5, words: mk(words) }], { cleanup: { strip_punctuation: true }, pause_break: 5 });
    expect(plan.captions[0].lines.join(" ")).toBe("This is a fairly long sentence");
    expect(plan.captions[1].lines.join(" ")).toBe("And here is more");
  });

  it("throws when clean-up leaves nothing", () => {
    expect(() => buildCaptions(seg(["um", "uh"]), { cleanup: { remove_fillers: true } })).toThrow(/no words/);
  });
});

describe("review fixes", () => {
  const w = (text: string, start = 0, end = 1): CleanWord => ({ text, start, end });
  const clean = (words: CleanWord[], opts: Parameters<typeof cleanupWords>[1]) => cleanupWords(words, opts).words;

  it("sentence case capitalises I before punctuation", () => {
    const out = clean([w("said", 0, 1), w("I.", 1, 2), w("Then", 2, 3), w("I,", 3, 4), w("left", 4, 5)], { case: "sentence" } as never);
    expect(out.map((x) => x.text)).toEqual(["Said", "I.", "Then", "I,", "left"]);
  });

  it("strip_punctuation keeps joining characters inside a token", () => {
    const out = clean([w("well—known", 0, 1), w("and/or", 1, 2), w("a.m.", 2, 3), w("3.5", 3, 4), w("Hello,", 4, 5)], { strip_punctuation: true } as never);
    expect(out.map((x) => x.text)).toEqual(["well-known", "and/or", "a.m", "3.5", "Hello"]);
  });

  it("strip_punctuation splits wait...what into two words sharing the time by character count", () => {
    const out = clean([w("wait...what", 0, 0.9), w("so", 1, 2)], { strip_punctuation: true } as never);
    expect(out.map((x) => x.text)).toEqual(["wait", "what", "so"]);
    expect(out[0].start).toBe(0);
    expect(out[0].end).toBeCloseTo(0.45, 6);
    expect(out[1].start).toBeCloseTo(0.45, 6);
    expect(out[1].end).toBeCloseTo(0.9, 6);
  });
});

// ---------- Premiere port: frame rates, options, transcript formats, plan document ----------

describe("frameRateFromTimebaseTicks", () => {
  it("snaps Premiere ticks per frame to the common rates", () => {
    expect(PREMIERE_TICKS_PER_SECOND).toBe(254016000000);
    expect(frameRateFromTimebaseTicks(8475667200)).toBe(30000 / 1001);
    expect(frameRateFromTimebaseTicks(10584000000)).toBe(24);
    expect(frameRateFromTimebaseTicks(8467200000)).toBe(30);
    expect(frameRateFromTimebaseTicks(10160640000)).toBe(25);
    expect(frameRateFromTimebaseTicks("10594584000")).toBe(24000 / 1001);
    expect(frameRateFromTimebaseTicks(" 4233600000 ")).toBe(60);
  });
  it("returns the exact rate when no common rate is within 0.01", () => {
    expect(frameRateFromTimebaseTicks(PREMIERE_TICKS_PER_SECOND / 12)).toBe(12);
    expect(frameRateFromTimebaseTicks(PREMIERE_TICKS_PER_SECOND / 47.5)).toBeCloseTo(47.5, 9);
  });
  it("refuses bad input", () => {
    expect(() => frameRateFromTimebaseTicks(0)).toThrow(/positive/);
    expect(() => frameRateFromTimebaseTicks("abc")).toThrow(/positive/);
    expect(() => frameRateFromTimebaseTicks(-5)).toThrow(/positive/);
  });
});

describe("normalizeCaptionPlanOptions", () => {
  it("ignores unknown keys and nulls, and returns nothing for an empty object", () => {
    expect(normalizeCaptionPlanOptions({})).toEqual({});
    expect(normalizeCaptionPlanOptions({ word_timeline: {}, approved_workspace_path: "x", standard: null, fix: undefined, max_lines: null })).toEqual({});
  });
  it("accepts every option", () => {
    const raw = {
      standard: "bbc",
      fix: false,
      frame_rate: 29.97,
      max_chars_per_line: 30,
      max_lines: 2,
      min_duration: 0.5,
      max_duration: 5,
      linger: 0.1,
      pause_break: 0.5,
      offset: -1,
      from_s: 1,
      to_s: 10,
      min_gap_frames: 3,
      close_gaps_under: 0.4,
      cut_times: [1, 2.5],
      cleanup: {
        drop_after_s: 100,
        drop_music_tokens: false,
        min_word_s: 0.1,
        remove_fillers: true,
        filler_words: ["like"],
        remove_stutters: true,
        glossary: [{ find: "a", replace: "b", case_sensitive: true }, { find: "c", replace: "" }],
        case: "sentence",
        strip_punctuation: true,
      },
      max_words: 3,
      single_word: true,
      highlight_lead_frames: 2,
      speaker_style: "color",
      speaker_colors: ["#FFFFFF", "#00ff00"],
      speaker_names: { speaker_0: "ANNA" },
      accessibility: true,
      sdh: { sound_events: false, lyric_ranges: [{ start: 1, end: 2 }] },
      extra_key: 1,
    };
    const out = normalizeCaptionPlanOptions(raw);
    expect(out.standard).toBe("bbc");
    expect(out.cleanup?.glossary).toEqual([{ find: "a", replace: "b", case_sensitive: true }, { find: "c", replace: "" }]);
    expect(out.sdh).toEqual({ sound_events: false, lyric_ranges: [{ start: 1, end: 2 }] });
    expect(out.speaker_names).toEqual({ speaker_0: "ANNA" });
    expect((out as Record<string, unknown>).extra_key).toBeUndefined();
    expect(Object.keys(out).sort()).toEqual(Object.keys(raw).filter((k) => k !== "extra_key").sort());
  });
  it("lists every option as a schema property with a description, and the keys match", () => {
    expect([...CAPTION_PLAN_OPTION_KEYS].sort()).toEqual(Object.keys(CAPTION_PLAN_OPTION_PROPERTIES).sort());
    for (const [k, v] of Object.entries(CAPTION_PLAN_OPTION_PROPERTIES)) expect(typeof (v as { description: string }).description, k).toBe("string");
    const cleanupProps = (CAPTION_PLAN_OPTION_PROPERTIES.cleanup as unknown as { properties: Record<string, { description: string }> }).properties;
    for (const v of Object.values(cleanupProps)) expect(v.description.length).toBeGreaterThan(5);
    expect((CAPTION_PLAN_OPTION_PROPERTIES.cut_times as { description: string }).description).toMatch(/sequence seconds/);
  });
  const bad: Array<[string, Record<string, unknown>, RegExp]> = [
    ["standard", { standard: "nope" }, /standard must be one of/],
    ["fix", { fix: "yes" }, /fix must be true or false/],
    ["frame_rate zero", { frame_rate: 0 }, /greater than 0/],
    ["frame_rate big", { frame_rate: 500 }, /at most 240/],
    ["frame_rate nan", { frame_rate: "30" }, /finite number/],
    ["max_chars", { max_chars_per_line: 5 }, /at least 8/],
    ["max_chars int", { max_chars_per_line: 20.5 }, /integer/],
    ["max_lines", { max_lines: 9 }, /at most 4/],
    ["min_duration", { min_duration: 0 }, /at least 0.1/],
    ["cut_times type", { cut_times: "1" }, /must be an array/],
    ["cut_times entry", { cut_times: [1, -2] }, /cut_times\[1\]/],
    ["cut_times many", { cut_times: new Array(5001).fill(1) }, /between 0 and 5000/],
    ["cleanup type", { cleanup: [] }, /cleanup must be an object/],
    ["cleanup min_word", { cleanup: { min_word_s: 2 } }, /min_word_s must be at most/],
    ["filler word", { cleanup: { filler_words: [""] } }, /filler_words\[0\]/],
    ["glossary entry", { cleanup: { glossary: ["x"] } }, /glossary\[0\] must be an object/],
    ["glossary find", { cleanup: { glossary: [{ find: "", replace: "x" }] } }, /find must be/],
    ["glossary replace", { cleanup: { glossary: [{ find: "a", replace: 3 }] } }, /replace must be/],
    ["cleanup case", { cleanup: { case: "title" } }, /case must be one of/],
    ["speaker_style", { speaker_style: "bold" }, /speaker_style must be one of/],
    ["speaker_colors", { speaker_colors: ["red"] }, /colour like/],
    ["speaker_colors empty", { speaker_colors: [] }, /between 1 and 16/],
    ["speaker_names", { speaker_names: { a: 3 } }, /speaker_names.a/],
    ["speaker_names type", { speaker_names: [] }, /must be an object/],
    ["sdh range", { sdh: { lyric_ranges: [{ start: 2, end: 1 }] } }, /after start/],
    ["sdh range entry", { sdh: { lyric_ranges: [1] } }, /must be an object/],
    ["sdh range missing", { sdh: { lyric_ranges: [{ start: 1 }] } }, /needs start and end/],
    ["max_words", { max_words: 0 }, /at least 1/],
  ];
  for (const [name, raw, re] of bad) it(`refuses a bad ${name}`, () => expect(() => normalizeCaptionPlanOptions(raw)).toThrow(re));
  it("refuses a non-object", () => {
    expect(() => normalizeCaptionPlanOptions(null as never)).toThrow(/must be an object/);
    expect(() => normalizeCaptionPlanOptions([] as never)).toThrow(/must be an object/);
  });
});

describe("transcript parsing", () => {
  const PREMIERE = JSON.stringify({
    language: "en-us",
    segments: [
      {
        start: 1,
        duration: 2.5,
        speaker: "spk1",
        words: [
          { text: "Hello", start: 1, duration: 0.4, confidence: 0.99, eos: false, tags: [], type: "word" },
          { text: "there", start: 1.5, duration: 0.5, confidence: 0.9, eos: false, tags: [], type: "word" },
          { text: ".", start: 2, duration: 0, type: "punctuation" },
          { text: "", start: 2.1, duration: 0.1, type: "spacing" },
        ],
      },
      { start: 4, duration: 1, words: [{ text: "Bye.", start: 4, duration: 0.6, eos: true }] },
      { duration: 1, words: [] },
    ],
    speakers: [{ id: "spk1", name: "Anna" }, { id: "x" }, null],
  });
  it("reads Premiere's exported transcript JSON (durations, speaker names, punctuation tokens)", () => {
    const segs = parseCaptionTranscript(PREMIERE);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ start: 1, end: 3.5, speaker: "Anna", text: "Hello there." });
    expect(segs[0].words!.map((w) => [w.text, w.start, w.end])).toEqual([["Hello", 1, 1.4], ["there.", 1.5, 2]]);
    expect(segs[1]).toMatchObject({ start: 4, end: 5, text: "Bye." });
    expect(segs[1].speaker).toBeUndefined();
    const p = buildCaptions(segs, { frame_rate: 25, speaker_style: "label" });
    expect(p.captions[0].lines[0]).toMatch(/^ANNA:/);
    expect(p.captions[0].speaker).toBe("Anna");
  });
  it("is tolerant of missing fields in Premiere JSON", () => {
    const segs = parseCaptionTranscript(JSON.stringify({ segments: [{ words: [{ text: "Solo", start: 2, duration: 0.5 }] }, { start: 1 }, { text: "x", start: 6, end: 7, speaker_id: 3 }, 5] }));
    expect(segs.map((s) => [s.start, s.end, s.text])).toEqual([[2, 2.5, "Solo"], [6, 7, "x"]]);
    expect(segs[1].speaker).toBe("3");
  });
  it("reads ElevenLabs Scribe words with speakers, spacing and audio events", () => {
    const segs = parseCaptionTranscript(
      JSON.stringify({
        words: [
          { text: "Hello", start: 0, end: 0.4, type: "word", speaker_id: "speaker_0" },
          { text: " ", start: 0.4, end: 0.5, type: "spacing" },
          { text: "(laughter)", start: 0.5, end: 1, type: "audio_event" },
          { text: "there.", start: 1.2, end: 1.6, type: "word", speaker_id: "speaker_1" },
        ],
      }),
    );
    expect(segs.map((s) => s.speaker)).toEqual(["speaker_0", "speaker_1"]);
    expect(segs[0].sound_events?.[0].text).toBe("(laughter)");
  });
  it("reads Whisper-style segments with and without words, and a plain array", () => {
    const whisper = parseCaptionTranscript(JSON.stringify({ segments: [{ start: 0, end: 2, text: " Hi there ", words: [{ word: "Hi", start: 0, end: 0.5 }, { word: "there", start: 0.6, end: 1 }] }, { start: 3, end: 4, text: "No words" }] }));
    expect(whisper[0].words).toHaveLength(2);
    expect(whisper[1].words).toBeUndefined();
    const arr = parseCaptionTranscript(JSON.stringify([{ text: "A", start: 0, end: 1, speaker: "x" }, { text: "B", start: 1, duration: 1 }, { start: 5, end: 6 }, null]));
    expect(arr.map((s) => [s.text, s.speaker])).toEqual([["A", "x"], ["B", undefined]]);
  });
  it("reads SRT and VTT with speaker prefixes and voice spans", () => {
    const srt = "1\n00:00:01,000 --> 00:00:02,000\nANNA: Hello there\n\n2\n00:00:03,000 --> 00:00:04,000\nBEN: Hi\n";
    const segs = parseCaptionTranscript(srt);
    expect(segs.map((s) => [s.speaker, s.text])).toEqual([["ANNA", "Hello there"], ["BEN", "Hi"]]);
    const vtt = "WEBVTT\n\n00:01.000 --> 00:02.000 align:start\n<v Anna>Hello <b>there</b></v>\n\n00:03.000 --> 00:04.000\nPlain\n";
    const v = parseCaptionTranscript(vtt);
    expect(v[0]).toMatchObject({ speaker: "Anna", text: "Hello there" });
    expect(v[1].speaker).toBeUndefined();
    // "Note: ..." is not a speaker
    expect(parseCaptionTranscript("1\n00:00:01,000 --> 00:00:02,000\nNote: this\n")[0].speaker).toBeUndefined();
    expect(parseCaptionTranscript("1\n00:00:01,000 --> 00:00:02,000\nNote: this\n\n2\n00:00:03,000 --> 00:00:04,000\nNote: that\n")[1].speaker).toBe("Note");
  });
  it("detects the format from a hint or the content", () => {
    expect(detectFormat("x", "a.SRT")).toBe("srt");
    expect(detectFormat("x", "a.vtt")).toBe("vtt");
    expect(detectFormat("x", "a.json")).toBe("json");
    expect(detectFormat("  [1]")).toBe("json");
    expect(detectFormat("{}")).toBe("json");
    expect(detectFormat("WEBVTT\n")).toBe("vtt");
    expect(detectFormat("1\n")).toBe("srt");
  });
  it("turns a JSON file with only sound events into one sound segment, and refuses empty input", () => {
    const only = parseCaptionTranscript(JSON.stringify({ words: [{ text: "(music)", start: 1, end: 3, type: "audio_event" }] }));
    expect(only).toHaveLength(1);
    expect(only[0].words).toBeUndefined();
    const p = buildCaptions(only, { frame_rate: 24 });
    expect(p.captions[0]).toMatchObject({ kind: "sound", lines: ["[music]"] });
    expect(p.captions[0].highlight).toBeUndefined();
    expect(() => parseCaptionTranscript("nothing here")).toThrow(/No timed lines/);
    expect(() => parseCaptionTranscript("{bad", "json")).toThrow(/not valid JSON/);
    expect(() => parseCaptionTranscript("{}", "json")).toThrow(/needs `words`/);
    expect(() => parseCaptionTranscript(JSON.stringify({ foo: 1 }), "json")).toThrow(/needs/);
    expect(() => parseCaptionTranscript(JSON.stringify({ words: [] }), "json")).toThrow(/No timed lines/);
    expect(() => parseTranscript("1\n00:xx --> 00:00:02,000\nHi\n")).toThrow(/Bad timecode|No timed lines/);
  });
  it("parses SRT timecodes with hours, commas and minutes only", () => {
    expect(parseTranscript("1\n01:00:00,500 --> 01:00:01,000\nHi\n")[0].start).toBe(3600.5);
    expect(() => parseTranscript("1\n1:2:3:4 --> 00:00:02,000\nHi\n")).toThrow(/Bad timecode/);
  });
  it("makes segments from the repo's word_timeline, splitting at speaker changes and pauses", () => {
    const segs = segmentsFromWordTimeline({
      source_project_item_id: "item",
      transcript_revision: `sha256:${"a".repeat(64)}`,
      duration_seconds: 6,
      speakers: ["A", "B"],
      words: [
        { text: "Hello", start_seconds: 0, end_seconds: 0.4, speaker_label: "A" },
        { text: "there", start_seconds: 0.5, end_seconds: 0.9, speaker_label: "A" },
        { text: "Hi", start_seconds: 1, end_seconds: 1.3, speaker_label: "B" },
        { text: "Later", start_seconds: 5, end_seconds: 5.5 },
      ],
    });
    expect(segs.map((s) => [s.speaker, s.text])).toEqual([["A", "Hello there"], ["B", "Hi"], [undefined, "Later"]]);
    expect(() => segmentsFromWordTimeline({ source_project_item_id: "i", transcript_revision: `sha256:${"a".repeat(64)}`, words: [], duration_seconds: 0, speakers: [] })).toThrow(/no words/);
  });
  it("splits words that hold spaces and spreads SRT cues by character share", () => {
    const p = buildCaptions(parseCaptionTranscript("1\n00:00:01,000 --> 00:00:03,000\nOne two three\n\n2\n00:00:04,000 --> 00:00:05,000\nFour\n"), { frame_rate: 25 });
    expect(p.estimated_word_times).toBe(true);
    expect(p.warnings.join(" ")).toMatch(/estimates/);
    expect(p.captions.map((c) => c.text)).toEqual(["One two three", "Four"]);
    const split = buildCaptions([{ text: "a", start: 0, end: 1, words: [{ text: "two words", start: 0, end: 1 }] }], { frame_rate: 25 });
    expect(split.captions[0].words.map((w) => w.text)).toEqual(["two", "words"]);
  });
});

describe("plan window, settings and wide words", () => {
  const segs = () => [
    { text: "a", start: 0, end: 2, words: run(["one", "two"], { start: 0 }) },
    { text: "b", start: 10, end: 12, words: run(["three", "four"], { start: 10 }) },
  ];
  it("keeps only segments inside from_s and to_s, and says when none are", () => {
    const p = buildCaptions(segs(), { frame_rate: 25, from_s: 5 });
    expect(p.captions.map((c) => c.text)).toEqual(["three four"]);
    expect(buildCaptions(segs(), { frame_rate: 25, to_s: 5 }).captions[0].text).toBe("one two");
    expect(() => buildCaptions(segs(), { from_s: 50 })).toThrow(/overlaps 50 s to Infinity s/);
    expect(() => buildCaptions([], {})).toThrow(/no segments/);
  });
  it("clips words that straddle from_s/to_s instead of dropping the whole segment", () => {
    // Trimmed-clip / media_shortcut path: transcribe_audio passes from_s=inPoint, to_s=outPoint.
    // A Whisper sentence that started before the in-point must still caption the heard words,
    // and words after the out-point must not land on later shots.
    const p = buildCaptions(
      [{
        text: "hello mid world later extra",
        start: 2,
        end: 8,
        words: [
          { text: "hello", start: 2.0, end: 2.4 },
          { text: "mid", start: 2.3, end: 2.8 },
          { text: "world", start: 2.6, end: 3.2 },
          { text: "later", start: 4.8, end: 5.4 },
          { text: "extra", start: 6.0, end: 6.5 },
        ],
      }],
      { frame_rate: 25, from_s: 2.5, to_s: 5, offset: 7.5 },
    );
    const spoken = p.captions.map((c) => c.text).join(" ");
    expect(spoken).toMatch(/mid/);
    expect(spoken).toMatch(/world/);
    expect(spoken).not.toMatch(/hello/);
    expect(spoken).not.toMatch(/extra/);
    const wordStarts = p.captions.flatMap((c) => c.words.map((w) => w.start));
    expect(Math.min(...wordStarts)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...wordStarts)).toBeLessThan(12.5);
  });
  it("refuses a from_s/to_s window that clips every overlapping word to nothing", () => {
    expect(() => buildCaptions(
      [{ text: "x", start: 0, end: 10, words: [{ text: "hi", start: 0, end: 10 }] }],
      { frame_rate: 25, from_s: 5, to_s: 5 },
    )).toThrow(/no words/);
  });
  it("reports resolved settings", () => {
    const p = buildCaptions(segs(), { frame_rate: 24, standard: "netflix_adult", max_words: 4, cut_times: [1, 1, 3] });
    expect(p.settings).toMatchObject({ frame_rate: 24, frame_rate_assumed: false, standard: "netflix_adult", fix: true, max_chars_per_line: 42, max_words: 4, min_gap_frames: 2, cut_count: 2, speaker_style: "none" });
  });
  it("warns about a single word wider than a line and about fast captions without a standard", () => {
    const p = plan(run(["Supercalifragilisticexpialidocious", "word"], { step: 0.2, dur: 0.1 }), { frame_rate: 25, max_chars_per_line: 10, min_duration: 0.1, linger: 0 });
    expect(p.warnings.join(" ")).toMatch(/longer than max_chars_per_line/);
    expect(p.warnings.join(" ")).toMatch(/faster than 21/);
  });
  it("applies offset and rounds every time to whole frames", () => {
    const p = plan(run(["Hello", "there."], { start: 1.013 }), { frame_rate: 25, offset: 2 });
    for (const c of p.captions) {
      expect(Math.abs(c.start * 25 - Math.round(c.start * 25))).toBeLessThan(1e-6);
      expect(Math.abs(c.end * 25 - Math.round(c.end * 25))).toBeLessThan(1e-6);
    }
    expect(p.captions[0].start).toBeGreaterThanOrEqual(3);
  });
  it("gives each speaker a colour (BBC order, then custom) and the speaker index", () => {
    const words = W([["Hi", 0, 0.3, "A"], ["Hello", 1, 1.3, "B"], ["Again", 2, 2.3, "A"]]);
    const p = plan(words, { frame_rate: 25, speaker_style: "color", pause_break: 0.5 });
    expect(p.captions.map((c) => c.color)).toEqual(["#FFFFFF", "#FFFF00", "#FFFFFF"]);
    expect(p.captions.map((c) => c.speaker_index)).toEqual([0, 1, 0]);
    const custom = plan(words, { frame_rate: 25, speaker_style: "color", speaker_colors: ["#112233"], pause_break: 0.5 });
    expect(custom.captions.map((c) => c.color)).toEqual(["#112233", "#112233", "#112233"]);
  });
  it("lyric captions carry notes, italic and a highlight", () => {
    const p = plan(run(["la", "la", "la"], { step: 0.3, dur: 0.25 }), { frame_rate: 25, sdh: { lyric_ranges: [{ start: 0, end: 5 }] } });
    expect(p.captions[0]).toMatchObject({ kind: "lyric", italic: true });
    expect(p.captions[0].text.startsWith("\u266A")).toBe(true);
    expect(p.captions[0].text.endsWith("\u266A")).toBe(true);
    expect(p.captions[0].highlight).toHaveLength(3);
  });
});

describe("caption plan document", () => {
  const make = () => {
    const p = buildCaptions([{ text: "x", start: 0, end: 5, words: run(["Hello", "there,", "friends.", "More", "words", "here."], { step: 0.5, dur: 0.4, speaker: "A" }) }], { frame_rate: 25, standard: "netflix_adult", speaker_style: "color", cleanup: { remove_fillers: true } });
    return { p, doc: captionPlanDocument(p, { kind: "text", sha256: "b".repeat(64), format: "json" }) };
  };
  it("wraps a plan with a revision and round-trips through JSON", () => {
    const { p, doc } = make();
    expect(doc.kind).toBe("premiere-pro-mcp.caption-plan");
    expect(doc.version).toBe(1);
    expect(doc.plan_revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(doc.cleanup).toEqual(p.cleanup);
    const back = parseCaptionPlanDocument(JSON.parse(JSON.stringify(doc)));
    expect(back).toEqual(doc);
    expect(planFromDocument(back).captions).toEqual(p.captions);
    // key order does not matter for the revision
    const shuffled = JSON.parse(JSON.stringify(doc));
    shuffled.captions = shuffled.captions.map((c: Record<string, unknown>) => Object.fromEntries(Object.entries(c).reverse()));
    expect(parseCaptionPlanDocument(shuffled).plan_revision).toBe(doc.plan_revision);
  });
  it("keeps the source path and a null cleanup", () => {
    const p = buildCaptions([{ text: "x", start: 0, end: 2, words: run(["Hi", "there."]) }], { frame_rate: 25 });
    const doc = captionPlanDocument(p, { kind: "path", sha256: "c".repeat(64), format: "srt", path: "C:/a/b.srt" });
    expect(doc.source.path).toBe("C:/a/b.srt");
    expect(doc.cleanup).toBeNull();
    expect(planFromDocument(parseCaptionPlanDocument(JSON.parse(JSON.stringify(doc)))).cleanup).toBeUndefined();
  });
  it("refuses an edited or malformed document", () => {
    const { doc } = make();
    const clone = () => JSON.parse(JSON.stringify(doc));
    const edit = (fn: (d: any) => void) => {
      const d = clone();
      fn(d);
      return d;
    };
    const cases: Array<[string, unknown, RegExp]> = [
      ["not an object", [], /must be an object/],
      ["kind", edit((d) => (d.kind = "x")), /kind must be/],
      ["version", edit((d) => (d.version = 2)), /version must be 1/],
      ["revision shape", edit((d) => (d.plan_revision = "abc")), /plan_revision must match/],
      ["revision value", edit((d) => (d.plan_revision = `sha256:${"0".repeat(64)}`)), /does not match/],
      ["edited caption", edit((d) => (d.captions[0].end += 1)), /does not match/],
      ["source kind", edit((d) => (d.source.kind = "web")), /source.kind/],
      ["source sha", edit((d) => (d.source.sha256 = "zz")), /source.sha256/],
      ["settings", edit((d) => delete d.settings.frame_rate), /settings.frame_rate/],
      ["fps range", edit((d) => (d.settings.frame_rate = 1000)), /at most 240/],
      ["standard", edit((d) => (d.settings.standard = "x")), /known caption standard/],
      ["speaker style", edit((d) => (d.settings.speaker_style = "x")), /speaker_style/],
      ["no captions", edit((d) => (d.captions = [])), /at least one caption/],
      ["too many", edit((d) => (d.captions = new Array(20001).fill(d.captions[0]))), /at most 20000/],
      ["number", edit((d) => (d.captions[0].n = 5)), /\.n must be 1/],
      ["order", edit((d) => (d.captions[1].start = -1)), /start must be 0 or more/],
      ["start end", edit((d) => (d.captions[0].end = d.captions[0].start)), /before end/],
      ["lines", edit((d) => (d.captions[0].lines = [])), /at least one line/],
      ["empty line", edit((d) => (d.captions[0].lines = ["  "])), /must not be empty/],
      ["kind enum", edit((d) => (d.captions[0].kind = "x")), /kind must be/],
      ["word", edit((d) => (d.captions[0].words[0].end = -5)), /must not be before start/],
      ["colour", edit((d) => (d.captions[0].color = "red")), /colour like/],
      ["highlight", edit((d) => (d.captions[0].highlight = [1])), /one entry per word/],
      ["nan", edit((d) => (d.captions[0].start = "1")), /finite number/],
      ["change rule", edit((d) => (d.changes = [{ n: 1, rule: "x", action: "split", detail: "d" }])), /known rule/],
      ["change action", edit((d) => (d.changes = [{ n: 1, rule: "cps", action: "x", detail: "d" }])), /known action/],
      ["violation rule", edit((d) => (d.violations = [{ n: 1, rule: "x", detail: "d" }])), /known rule/],
      ["cleanup", edit((d) => (d.cleanup = { dropped_short: 1 })), /cleanup\./],
      ["warnings", edit((d) => (d.warnings = [3])), /warnings\[0\]/],
    ];
    for (const [name, value, re] of cases) expect(() => parseCaptionPlanDocument(value), name).toThrow(re);
    const unordered = clone();
    if (unordered.captions.length > 1) {
      unordered.captions[1].start = 0;
      expect(() => parseCaptionPlanDocument(unordered)).toThrow();
    }
  });
  it("accepts changes and violations of a real plan", () => {
    const p = buildCaptions([{ text: "x", start: 0, end: 3, words: run(["Extraordinarily", "unbelievable", "circumstances", "Later"], { step: 0.2, dur: 0.15 }) }], { frame_rate: 24, standard: "netflix_adult", pause_break: 0.1, fix: false, cut_times: [0.3] });
    const doc = captionPlanDocument(p, { kind: "text", sha256: "d".repeat(64), format: "srt" });
    expect(parseCaptionPlanDocument(JSON.parse(JSON.stringify(doc))).violations).toEqual(p.violations);
  });
});

// ---------- rules, direct ----------

describe("rule passes on hand-built captions", () => {
  const FPS = 25;
  const settings = (over: Partial<RuleSettings> = {}): RuleSettings => ({
    frame: 1 / FPS,
    snap: (t) => Math.round(t * FPS) / FPS,
    maxChars: 20,
    maxLines: 2,
    minDur: 1,
    maxDur: 6,
    linger: 0.25,
    minGapT: 2 / FPS,
    closeUnder: 0.5,
    cutZone: 0.5,
    cuts: [],
    fix: true,
    singleWord: false,
    layout: (c) => [c.words.map((w) => w.text).join(" ")],
    ...over,
  });
  const cap = (texts: string[], start: number, end: number, over: Partial<WorkCap> = {}): WorkCap => {
    const step = (end - start) / Math.max(texts.length, 1);
    const words = texts.map((text, i) => ({ text, start: start + i * step, end: start + (i + 1) * step }));
    return { start, end, lines: [texts.join(" ")], words, gram: texts, spk: texts.map(() => undefined), kind: "speech", rawStart: start, rawLastEnd: end, ...over };
  };

  it("findViolations reports each kind of broken rule", () => {
    const std = CAPTION_STANDARDS.bbc;
    const S = settings({ std, maxChars: 10, maxLines: 1, maxDur: 3, cuts: [1.5] });
    const fast = cap(["one", "two", "three", "four", "five", "six", "seven", "eight"], 0, 2, { lines: ["one two three four", "five six seven eight"] });
    const next = cap(["after"], 1.9, 3);
    const out = findViolations([fast, next], S);
    const rules = out.map((v) => `${v.n}:${v.rule}`);
    expect(rules).toEqual(expect.arrayContaining(["1:cps", "1:cpl", "1:lines", "1:overlap", "1:shot_change"]));
    expect(out.find((v) => v.rule === "cps")!.detail).toMatch(/words per minute/);
    const long = findViolations([cap(["a", "b"], 0, 9)], settings({ std, maxDur: 3 }));
    expect(long.map((v) => v.rule)).toContain("max_duration");
    const short = findViolations([cap(["a", "b"], 0, 0.2)], settings({ std, minDur: 0.8 }));
    expect(short[0]).toMatchObject({ rule: "min_duration" });
    expect(short[0].detail).toMatch(/per word/);
    const gap = findViolations([cap(["a"], 0, 1), cap(["b"], 1.04, 2)], settings({ std }));
    expect(gap.map((v) => v.rule)).toContain("gap");
    const noStd = findViolations([cap(["a"], 0, 1)], settings());
    expect(noStd).toEqual([]);
  });

  it("findViolations reports a cps violation with the limit, and grammar breaks", () => {
    const std = CAPTION_STANDARDS.netflix_adult;
    const S = settings({ std });
    const text = "x".repeat(60);
    const v = findViolations([cap([text], 0, 1, { lines: [text] })], S);
    expect(v.find((x) => x.rule === "cps")!.detail).toMatch(/characters per second; the limit is 20/);
    const g1 = cap(["We", "went", "to", "the", "market"], 0, 3, { lines: ["We went to the", "market"] });
    const g2 = cap(["She", "walked", "into"], 3.5, 5, { lines: ["She walked into"] });
    const g3 = cap(["the", "room"], 5.2, 6.5);
    const grammar = findViolations([g1, g2, g3], S).filter((x) => x.rule === "grammar");
    expect(grammar.map((x) => `${x.n}:${x.detail}`)).toEqual(['1:line 1 ends on "the"', '2:the caption ends on "into" and the sentence goes on in the next']);
  });

  it("splitPass splits on lines, characters and duration with the matching reason", () => {
    const S = settings({ maxChars: 10, maxLines: 1, maxDur: 3, layout: (c) => [c.words.map((w) => w.text).join(" ")] });
    const rec = new Rec();
    const wide = cap(["alpha", "beta", "gamma", "delta"], 0, 2);
    const caps = [wide];
    splitPass(caps, S, rec);
    expect(caps.length).toBeGreaterThan(1);
    expect(rec.items[0]).toMatchObject({ rule: "cpl", action: "split" });
    expect(rec.items[0].detail).toMatch(/character limit/);
    const rec2 = new Rec();
    const tall = cap(["a", "b", "c", "d"], 0, 2, { lines: ["a b", "c d"] });
    const caps2 = [tall];
    splitPass(caps2, settings({ maxChars: 30, maxLines: 1, layout: (c) => [c.words.map((w) => w.text).join(" ")] }), rec2);
    expect(rec2.items[0]).toMatchObject({ rule: "lines" });
    expect(rec2.items[0].detail).toMatch(/line limit/);
    const rec3 = new Rec();
    const caps3 = [cap(["one", "two", "three", "four"], 0, 8)];
    splitPass(caps3, settings({ maxChars: 80, maxDur: 3, layout: (c) => [c.words.map((w) => w.text).join(" ")] }), rec3);
    expect(rec3.items[0]).toMatchObject({ rule: "max_duration" });
    expect(rec3.items[0].detail).toMatch(/maximum duration/);
    // sound, locked and one-word captions are never split
    const keep = [cap(["a", "b"], 0, 9, { kind: "sound" }), cap(["a", "b"], 10, 20, { locked: true }), cap(["a"], 21, 30)];
    splitPass(keep, settings({ maxDur: 3 }), new Rec());
    expect(keep).toHaveLength(3);
  });

  it("closeGaps closes a short gap, and skips one that would pass the maximum duration or a cut", () => {
    const S = settings({ std: CAPTION_STANDARDS.netflix_adult });
    const rec = new Rec();
    const a = cap(["a"], 0, 1);
    const b = cap(["b"], 1.32, 2.5);
    closeGaps([a, b], S, rec);
    expect(a.end).toBeCloseTo(1.32 - 2 / FPS, 6);
    expect(rec.items[0]).toMatchObject({ rule: "close_gap", action: "closed_gap" });
    const far = cap(["a"], 0, 6.8);
    const next = cap(["b"], 7.1, 8);
    closeGaps([far, next], S, new Rec());
    expect(far.end).toBe(6.8);
    const cutS = settings({ cuts: [1.2] });
    const c1 = cap(["a"], 0, 1);
    closeGaps([c1, cap(["b"], 1.3, 2)], cutS, new Rec());
    expect(c1.end).toBe(1);
    const off = cap(["a"], 0, 1);
    closeGaps([off, cap(["b"], 1.3, 2)], settings({ closeUnder: 0 }), new Rec());
    expect(off.end).toBe(1);
    const tight = cap(["a"], 0, 1.24);
    closeGaps([tight, cap(["b"], 1.3, 2)], S, new Rec());
    expect(tight.end).toBe(1.24);
  });

  it("enforceGaps leaves the minimum gap and clears an overlap", () => {
    const S = settings();
    const rec = new Rec();
    const a = cap(["a", "b"], 0, 2);
    const b = cap(["c"], 1.96, 3);
    enforceGaps([a, b], S, rec);
    expect(a.end).toBeCloseTo(b.start - 2 / FPS, 6);
    expect(rec.items[0]).toMatchObject({ rule: "gap", action: "shortened" });
    const c = cap(["a"], 0, 2);
    const d = cap(["b"], 1.5, 3);
    enforceGaps([c, d], settings({ minGapT: 0 }), new Rec());
    expect(c.end).toBe(1.5);
  });

  it("recordExtensions notes a hold past the linger, by duration or by reading speed", () => {
    const S = settings({ std: CAPTION_STANDARDS.netflix_adult, minDur: 5 / 6, linger: 0.1 });
    const rec = new Rec();
    const held = cap(["Hi"], 0, 1.5, { rawLastEnd: 0.3 });
    const normal = cap(["Hello"], 3, 3.4, { rawLastEnd: 3.3 });
    const text = "x".repeat(60);
    const fast = cap([text], 5, 8, { lines: [text], rawLastEnd: 5.5 });
    recordExtensions([held, normal, fast], S, rec);
    expect(rec.items.map((i) => [i.cap === held, i.cap === normal, i.cap === fast, i.rule, i.action])).toEqual([
      [true, false, false, "min_duration", "extended"],
      [false, false, true, "cps", "extended"],
    ]);
    const again = new Rec();
    again.add(held, "cps", "extended", "x");
    recordExtensions([held], S, again);
    expect(again.items).toHaveLength(1);
    const off = new Rec();
    recordExtensions([held], settings({ std: CAPTION_STANDARDS.netflix_adult, fix: false }), off);
    recordExtensions([held], settings(), off);
    expect(off.items).toEqual([]);
  });

  it("endFor and settleEnds hold a caption within its limits", () => {
    const S = settings({ std: CAPTION_STANDARDS.netflix_adult, minDur: 5 / 6 });
    const a = cap(["Hello"], 0, 0.4, { rawLastEnd: 0.4 });
    const b = cap(["There"], 0.6, 1, { rawLastEnd: 1 });
    expect(endFor(a, b, S)).toBeLessThanOrEqual(b.start - 2 / FPS + 1e-9);
    expect(endFor(a, undefined, S)).toBeGreaterThanOrEqual(5 / 6 - 1e-9);
    const tiny = cap(["x"], 1, 1.0, { rawLastEnd: 1.0 });
    expect(endFor(tiny, undefined, settings())).toBeGreaterThan(1);
    const list = [a, b];
    settleEnds(list, S);
    expect(list[0].end).toBeLessThan(list[1].start);
  });
});

describe("shot-change rules, direct", () => {
  const FPS = 25;
  const S = (cuts: number[]): RuleSettings => ({
    frame: 1 / FPS,
    snap: (t) => Math.round(t * FPS) / FPS,
    maxChars: 40,
    maxLines: 2,
    minDur: 0.5,
    maxDur: 6,
    linger: 0.25,
    minGapT: 2 / FPS,
    closeUnder: 0,
    cutZone: 0.5,
    cuts,
    fix: false,
    singleWord: false,
    layout: (c) => [c.words.map((w) => w.text).join(" ")],
  });
  const cap = (specs: Array<[string, number, number]>, end?: number): WorkCap => {
    const words = specs.map(([text, start, e]) => ({ text, start, end: e }));
    return { start: words[0].start, end: end ?? words[words.length - 1].end, lines: [words.map((w) => w.text).join(" ")], words, gram: words.map((w) => w.text), spk: words.map(() => undefined), kind: "speech", rawStart: words[0].start, rawLastEnd: words[words.length - 1].end };
  };

  it("snapInTimes moves an in-time onto a cut just before or after it, and stays clear of the caption before", () => {
    const before = cap([["hello", 1.88, 2.3], ["there", 2.4, 2.8]]);
    snapInTimes([before], S([1.76]), new Rec());
    expect(before.start).toBe(1.76);
    const after = cap([["hello", 2.0, 2.1], ["there", 2.3, 2.8]]);
    const rec = new Rec();
    snapInTimes([after], S([2.04]), rec);
    expect(after.start).toBe(2.04);
    expect(rec.items[0]).toMatchObject({ rule: "shot_change", action: "moved_in" });
    // a lone word that is over before the cut stays put
    const lone = cap([["hi", 2.0, 2.02]]);
    snapInTimes([lone], S([2.08]), new Rec());
    expect(lone.start).toBe(2.0);
    // too far after the first word started
    const far = cap([["hello", 2.0, 2.5], ["there", 2.6, 3]]);
    snapInTimes([far], S([2.2]), new Rec());
    expect(far.start).toBe(2.0);
    // second word starts too soon after the cut
    const crowd = cap([["a", 2.0, 2.1], ["b", 2.05, 2.5]]);
    snapInTimes([crowd], S([2.04]), new Rec());
    expect(crowd.start).toBe(2.0);
    // the caption before is still on screen at the cut
    const prev = cap([["x", 0.5, 1.9]]);
    const next = cap([["hello", 2.0, 2.4], ["there", 2.5, 3]]);
    snapInTimes([prev, next], S([1.92]), new Rec());
    expect(next.start).toBe(2.0);
    // already on a cut: left alone
    const on = cap([["hello", 2.0, 2.4], ["there", 2.5, 3]]);
    snapInTimes([on], S([2.0, 1.8]), new Rec());
    expect(on.start).toBe(2.0);
    // a late first word is shown from the cut
    const late = cap([["hello", 2.0, 2.04], ["there", 2.5, 3]]);
    snapInTimes([late], S([2.2]), new Rec());
    expect(late.start).toBe(2.0);
    const lateOk = cap([["hello", 2.0, 2.04], ["there", 2.5, 3]]);
    snapInTimes([lateOk], S([2.08]), new Rec());
    expect(lateOk.start).toBe(2.08);
    expect(lateOk.words[0].end).toBeGreaterThanOrEqual(2.12 - 1e-9);
    snapInTimes([cap([["a", 1, 2]])], S([]), new Rec());
  });

  it("splitAtCuts splits a caption on both sides of a cut when both halves stand", () => {
    const wide = cap([["one", 0, 0.5], ["two", 0.6, 1.1], ["three", 1.2, 1.7], ["four", 1.8, 2.4]]);
    const caps = [wide];
    const rec = new Rec();
    splitAtCuts(caps, { ...S([1.15]), minDur: 0.5 }, rec);
    expect(caps).toHaveLength(2);
    expect(caps[1].start).toBeCloseTo(1.2, 6);
    expect(rec.items[0]).toMatchObject({ rule: "shot_change", action: "split" });
    // a sliver on one side is not split
    const sliver = cap([["one", 0, 0.5], ["two", 0.6, 1.1], ["three", 1.2, 1.7], ["four", 1.8, 2.4]]);
    const kept = [sliver];
    splitAtCuts(kept, { ...S([0.55]), minDur: 0.9 }, new Rec());
    expect(kept).toHaveLength(1);
    const sound = cap([["[x]", 0, 3], ["[y]", 3.1, 6]]);
    sound.kind = "sound";
    const soundList = [sound];
    splitAtCuts(soundList, S([3.05]), new Rec());
    expect(soundList).toHaveLength(1);
  });

  it("cutOutTimes ends a caption 2 frames before a cut, or holds it past one", () => {
    const near = cap([["hello", 0, 0.5]], 0.9);
    const rec = new Rec();
    cutOutTimes([near], S([1.0]), rec);
    expect(near.end).toBeCloseTo(1 - 2 / FPS, 6);
    expect(rec.items[0]).toMatchObject({ rule: "shot_change", action: "extended" });
    const spans = cap([["hello", 0, 0.5]], 1.4);
    cutOutTimes([spans], S([1.0]), new Rec());
    expect(spans.end).toBeCloseTo(1 - 2 / FPS, 6);
    const over = cap([["hello", 0.5, 1.1]], 1.2);
    const recOver = new Rec();
    cutOutTimes([over], S([1.0]), recOver);
    expect(over.end).toBeGreaterThanOrEqual(1.5 - 1e-9);
    expect(over.end).toBeLessThanOrEqual(1.55);
    expect(recOver.items[0]).toMatchObject({ action: "extended" });
    const crowded = cap([["hello", 0.5, 1.1]], 1.2);
    const next = cap([["bye", 1.3, 1.8]]);
    const recCrowd = new Rec();
    cutOutTimes([crowded, next], S([1.0]), recCrowd);
    expect(crowded.end).toBeLessThanOrEqual(1.0 - 1 / FPS + 1e-9);
    expect(recCrowd.items[0].detail).toMatch(/no room/);
    const early = cap([["hello", 0, 0.5]], 0.6);
    cutOutTimes([early], S([2.0]), new Rec());
    expect(early.end).toBe(0.6);
    cutOutTimes([cap([["a", 0, 1]])], S([]), new Rec());
  });
});

describe("review fixes: sentence ends, offsets, sound captions, durations, frame rates", () => {
  const overlaps = (caps: Array<{ start: number; end: number }>) => caps.some((c, i) => i > 0 && c.start < caps[i - 1].end - 1e-9);
  const ordered = (caps: Array<{ start: number }>) => caps.every((c, i) => i === 0 || c.start >= caps[i - 1].start);

  it("ends a caption at a plain full stop without cleanup (SENTENCE_END had a missing backslash)", () => {
    const words = [...run(["Hello", "there", "my", "friends."], { step: 0.4, dur: 0.36 }), ...run(["This", "is", "another", "sentence", "here", "today."], { start: 2.0, step: 0.4, dur: 0.36 })];
    const p = plan(words, { frame_rate: 30 });
    expect(p.captions.map(text)).toEqual(["Hello there my friends.", "This is another sentence here today."]);
    // with a quote after the full stop too
    const q = plan([...run(["He", "said", "\"stop.\""], { step: 0.4, dur: 0.36 }), ...run(["Then", "we", "left", "quietly", "together", "again"], { start: 1.6, step: 0.4, dur: 0.36 })], { frame_rate: 30 });
    expect(q.captions).toHaveLength(2);
  });

  describe("negative offset", () => {
    const words = run(["Hello", "there", "friend.", "Again", "now."], { step: 0.5, dur: 0.4 });
    const valid = (p: ReturnType<typeof plan>) => parseCaptionPlanDocument(JSON.parse(JSON.stringify(captionPlanDocument(p, { kind: "text", sha256: "a".repeat(64), format: "json" }))));

    it("drops words that land before 0, starts a straddling word at 0, warns with the count and stays a valid plan", () => {
      const p = plan(words, { frame_rate: 30, offset: -0.7 });
      // "Hello" 0-0.4 and none else end before 0.7: "there" 0.5-0.9 straddles 0.
      expect(p.captions[0].words.map((w) => w.text)).toEqual(["there", "friend.", "Again", "now."].slice(0, p.captions[0].words.length));
      expect(p.captions.every((c) => c.start >= 0)).toBe(true);
      expect(p.captions[0].start).toBe(0);
      expect(p.captions[0].words[0].start).toBe(0);
      expect(p.warnings.join(" ")).toMatch(/1 word or sound event would start before 0 s/);
      expect(text(p.captions[0])).not.toMatch(/Hello/);
      valid(p);
    });

    it("works with from_s and counts every dropped word and sound event", () => {
      const p = buildCaptions(
        [{ text: "x", start: 0, end: 4, words, sound_events: [{ text: "(laughter)", start: 0.1, end: 0.3 }] }],
        { frame_rate: 25, from_s: 0, offset: -1.2 }
      );
      expect(p.warnings.join(" ")).toMatch(/3 words or sound events would start before 0 s/);
      expect(p.captions.every((c) => c.start >= 0 && c.words.every((w) => w.start >= 0))).toBe(true);
      valid(p);
      // everything before 0: nothing to caption
      expect(() => plan(words, { frame_rate: 30, offset: -10 })).toThrow(/no words/);
    });

    it("keeps a cue_start mark on the next word when the first word of a cue is dropped", () => {
      const p = buildCaptions([{ text: "Gone words", start: 0, end: 1 }, { text: "Stay right here", start: 1, end: 3 }], { frame_rate: 25, offset: -1 });
      expect(p.captions.map(text)).toEqual(["Stay right here"]);
      expect(p.captions[0].start).toBe(0);
    });
  });

  describe("sound captions never overlap or misorder", () => {
    const events = (spec: Array<[number, number]>) => spec.map(([start, end]) => ({ text: "(laughter)", start, end }));
    const build = (words: TranscriptWord[], ev: Array<[number, number]>, opts: CaptionOptions) => buildCaptions([{ text: "x", start: 0, end: 20, words, sound_events: events(ev) }], opts);

    it("drops a sound event that starts with the speech it overlaps and says so", () => {
      const words = run(["Hello", "there", "friends."], { start: 1, step: 0.5, dur: 0.4 });
      for (const opts of [{ frame_rate: 24 }, { frame_rate: 24, standard: "netflix_adult" as const }]) {
        const p = build(words, [[1, 1.3]], opts);
        expect(p.captions.map((c) => c.kind)).toEqual(["speech"]);
        expect(p.warnings.join(" ")).toMatch(/1 sound caption was dropped/);
        expect(p.violations).toEqual([]);
      }
    });

    it("clips a long event to the gap before the next speech, keeping the minimum gap", () => {
      const words = run(["Hello", "there", "friends."], { start: 2, step: 0.5, dur: 0.4 });
      const none = build(words, [[0.5, 3]], { frame_rate: 24 });
      expect(none.captions.map((c) => c.kind)).toEqual(["sound", "speech"]);
      expect(none.captions[0].end).toBeLessThanOrEqual(none.captions[1].start + 1e-9);
      const std = build(words, [[0.5, 3]], { frame_rate: 24, standard: "netflix_adult" });
      expect(std.captions[1].start - std.captions[0].end).toBeGreaterThanOrEqual(2 / 24 - 1e-9);
    });

    it("keeps captions in order when the event starts while the first caption is up and ends in the pause before the next", () => {
      const words = [...run(["Hello", "there", "friends."], { start: 1, step: 0.5, dur: 0.4 }), ...run(["Next", "thing."], { start: 5, step: 0.5, dur: 0.4 })];
      const p = build(words, [[1.6, 4.5]], { frame_rate: 24 });
      expect(overlaps(p.captions)).toBe(false);
      expect(ordered(p.captions)).toBe(true);
      expect(p.captions.map((c) => c.kind)).toEqual(["speech", "sound", "speech", "speech"]);
    });

    it("puts a sound caption that a shot change snapped past the next speech caption after it, not before", () => {
      // The event (0.886 s) is snapped onto the cut at 1 s, later than the word "two" (0.94 s) that follows it in the transcript.
      const words = [
        { text: "a", start: 0.6828, end: 0.9323 },
        { text: "two", start: 0.9399, end: 1.1288 },
        { text: "back", start: 1.1749, end: 1.302 },
      ];
      const p = build(words, [[0.8862, 2.0613]], { frame_rate: 29.97, cut_times: [1, 2.5] });
      expect(overlaps(p.captions)).toBe(false);
      expect(ordered(p.captions)).toBe(true);
      for (const s of p.captions.filter((c) => c.kind === "sound")) {
        const before = p.captions.filter((c) => c.kind !== "sound" && c.start < s.start);
        expect(before.every((c) => c.end <= s.start + 1e-9)).toBe(true);
      }
    });

    it("holds for random plans with and without a standard, and a plan with an overlap reports it without a standard", () => {
      let seed = 4242;
      const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
      const vocab = "the a of to and in I you we it is that was for on with as at by".split(" ");
      for (let it = 0; it < 60; it++) {
        const fps = [23.976, 25, 29.97, 30][Math.floor(rnd() * 4)];
        let t = rnd();
        const ws: TranscriptWord[] = [];
        for (let i = 0; i < 40; i++) {
          const d = 0.1 + rnd() * 0.4;
          ws.push({ text: vocab[Math.floor(rnd() * vocab.length)] + (rnd() < 0.15 ? "." : ""), start: t, end: t + d });
          t += d + (rnd() < 0.1 ? 0.3 + rnd() * 1.2 : rnd() * 0.1);
        }
        const ev: Array<[number, number]> = [0, 1, 2, 3].map(() => {
          const s = rnd() * t;
          return [s, s + 0.4 + rnd()];
        });
        const std = [undefined, "netflix_adult" as const, "social_9x16" as const][it % 3];
        const p = build(ws, ev, { frame_rate: fps, ...(std ? { standard: std } : {}), ...(it % 4 === 0 ? { cut_times: [1, 3, 5, 8] } : {}) });
        expect(overlaps(p.captions), `overlap in plan ${it}`).toBe(false);
        expect(ordered(p.captions), `order in plan ${it}`).toBe(true);
        expect(p.violations.filter((v) => v.rule === "overlap")).toEqual([]);
        expect(() => parseCaptionPlanDocument(JSON.parse(JSON.stringify(captionPlanDocument(p, { kind: "text", sha256: "a".repeat(64), format: "json" }))))).not.toThrow();
      }
    });

    it("findViolations reports an overlap even without a standard", () => {
      const mk = (start: number, end: number): WorkCap => ({ start, end, lines: ["x"], words: [{ text: "x", start, end }], gram: ["x"], spk: [undefined], rawStart: start, rawLastEnd: end, kind: "speech" });
      const S = { frame: 1 / 24, snap: (t: number) => t, maxChars: 32, maxLines: 2, minDur: 1, maxDur: 6, linger: 0.25, minGapT: 0, closeUnder: 0, cutZone: 0.5, cuts: [], fix: false, singleWord: false, layout: () => ["x"] } as RuleSettings;
      expect(findViolations([mk(0, 2), mk(1, 3)], S)).toEqual([{ n: 1, rule: "overlap", detail: expect.stringContaining("after the next caption starts") }]);
      expect(findViolations([mk(0, 1), mk(1, 3)], S)).toEqual([]);
    });
  });

  describe("planner and check_captions judge durations alike", () => {
    const SHA = { kind: "text" as const, sha256: "a".repeat(64), format: "json" };

    it("holds a dcmp caption 33 frames at 24 fps (32 frames is 1.3333 s, under the 1.3347 s minimum)", () => {
      const p = plan(run(["Hello."], { dur: 0.3 }), { standard: "dcmp", frame_rate: 24 });
      expect(Math.round((p.captions[0].end - p.captions[0].start) * 24)).toBe(33);
      expect(p.violations).toEqual([]);
      const lint = lintCaptions(p.captions.map((c) => ({ n: c.n, start: c.start, end: c.end, lines: c.lines })), { standard: "dcmp", frame_rate: 24 });
      expect(lint.issues.filter((i) => i.rule === "min_duration")).toEqual([]);
    });

    it("never runs a social_9x16 caption past 5 s at 23.976 fps (120 frames is 5.005 s)", () => {
      const words = run("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen".split(" "), { step: 0.4, dur: 0.35 });
      const p = plan(words, { standard: "social_9x16", frame_rate: 23.976, max_duration: 5 });
      const max = Math.max(...p.captions.map((c) => c.end - c.start));
      expect(max).toBeLessThanOrEqual(5 + DURATION_TOLERANCE_S);
      const lint = lintCaptions(p.captions.map((c) => ({ n: c.n, start: c.start, end: c.end, lines: c.lines })), { standard: "social_9x16", frame_rate: 23.976 });
      expect(lint.issues.filter((i) => i.rule === "max_duration" || i.rule === "min_duration")).toEqual([]);
    });

    it("a plan with no duration violations passes the duration rules of check_captions (random plans)", () => {
      let seed = 777;
      const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
      const vocab = "the a of to and in I you we it is that was for on with as at by this have from they will would there".split(" ");
      const stds = ["netflix_adult", "bbc", "dcmp", "social_9x16"] as const;
      const rates = [23.976, 24, 25, 29.97, 30, 60];
      for (let it = 0; it < 80; it++) {
        const std = stds[it % stds.length];
        const fps = rates[Math.floor(rnd() * rates.length)];
        let t = rnd();
        const ws: TranscriptWord[] = [];
        for (let i = 0; i < 50; i++) {
          const d = 0.1 + rnd() * 0.4;
          ws.push({ text: vocab[Math.floor(rnd() * vocab.length)] + (rnd() < 0.15 ? "." : ""), start: t, end: t + d });
          t += d + (rnd() < 0.1 ? 0.3 + rnd() * 1.2 : rnd() * 0.1);
        }
        const p = plan(ws, { standard: std, frame_rate: fps });
        const lint = lintCaptions(p.captions.map((c) => ({ n: c.n, start: c.start, end: c.end, lines: c.lines })), { standard: std, frame_rate: fps });
        for (const issue of lint.issues) {
          if (issue.rule !== "min_duration" && issue.rule !== "max_duration") continue;
          expect(p.violations.some((v) => v.n === issue.n && v.rule === issue.rule), `${std} ${fps} fps caption ${issue.n}: ${issue.detail}`).toBe(true);
        }
        // and the saved plan reads back
        parseCaptionPlanDocument(JSON.parse(JSON.stringify(captionPlanDocument(p, SHA))));
      }
    });
  });

  describe("NTSC frame rates are exact rationals", () => {
    it("exactFrameRate snaps the rounded NTSC rates and leaves others alone", () => {
      expect(exactFrameRate(23.976)).toBe(24000 / 1001);
      expect(exactFrameRate(29.97)).toBe(30000 / 1001);
      expect(exactFrameRate(59.94)).toBe(60000 / 1001);
      expect(exactFrameRate(29.97002997)).toBe(30000 / 1001);
      expect(exactFrameRate(24)).toBe(24);
      expect(exactFrameRate(25)).toBe(25);
      expect(exactFrameRate(12.5)).toBe(12.5);
    });

    it("rounds every time to frames of the exact rate, whichever way the rate was given", () => {
      const words = run(["Hello", "there", "my", "dear", "friends."], { start: 600, step: 0.5, dur: 0.4 });
      for (const rate of [29.97, 30000 / 1001]) {
        const p = plan(words, { frame_rate: rate });
        expect(p.settings.frame_rate).toBe(30000 / 1001);
        for (const c of p.captions) {
          const frames = c.start * (30000 / 1001);
          expect(Math.abs(frames - Math.round(frames))).toBeLessThan(1e-6);
          const endFrames = c.end * (30000 / 1001);
          expect(Math.abs(endFrames - Math.round(endFrames))).toBeLessThan(1e-6);
        }
      }
    });

    it("snaps Premiere ticks for the NTSC rates to the exact rationals", () => {
      expect(frameRateFromTimebaseTicks(10594584000)).toBe(24000 / 1001);
      expect(frameRateFromTimebaseTicks(4237837200)).toBe(60000 / 1001);
    });
  });
});

describe("review fixes: clean-up", () => {
  const clean = (texts: string[], opts: Parameters<typeof cleanupWords>[1]) => cleanupWords(texts.map((t, i) => ({ text: t, start: i, end: i + 0.5 })), opts).words.map((w) => w.text);

  it("keeps legitimate repeats 'that that' and 'had had' but still collapses other stutters", () => {
    expect(clean(["I", "know", "that", "that", "is", "true"], { remove_stutters: true })).toEqual(["I", "know", "that", "that", "is", "true"]);
    expect(clean(["She", "had", "had", "enough"], { remove_stutters: true })).toEqual(["She", "had", "had", "enough"]);
    expect(clean(["Go", "to", "the", "the", "shop"], { remove_stutters: true })).toEqual(["Go", "to", "the", "shop"]);
    // a comma makes it a stutter again
    expect(clean(["It", "was", "that,", "that", "one"], { remove_stutters: true })).toEqual(["It", "was", "that", "one"]);
  });

  it("does not turn i.e. and e.g. into I.e. in sentence case, and does not start a sentence after them", () => {
    expect(clean(["Bring", "tools,", "i.e.", "the", "saw", "and", "e.g.", "a", "drill."], { case: "sentence" })).toEqual(["Bring", "tools,", "i.e.", "the", "saw", "and", "e.g.", "a", "drill."]);
    expect(clean(["i", "think", "i'm", "right.", "so", "i", "go"], { case: "sentence" })).toEqual(["I", "think", "I'm", "right.", "So", "I", "go"]);
  });
});

describe("review fixes: subtitle and Whisper transcripts", () => {
  it("decodes entities and strips ASS tags in SRT and VTT cues", () => {
    const srt = parseTranscript("1\n00:00:01,000 --> 00:00:03,000\n{\\an8}Tom &amp; Jerry &lt;3 &quot;cheese&quot; it&#39;s&nbsp;fine &#x27;ok&#x27; &amp;lt; &bogus;\n");
    expect(srt[0].text).toBe(`Tom & Jerry <3 "cheese" it's fine 'ok' &lt; &bogus;`);
    const vtt = parseTranscript("WEBVTT\n\n00:01.000 --> 00:02.000\n<i>Fish &amp; chips</i> {\\i1}now{\\i0}\n");
    expect(vtt[0].text).toBe("Fish & chips now");
    // a cue that was only a tag is skipped
    expect(parseTranscript("1\n00:00:01,000 --> 00:00:02,000\n{\\an8}\n\n2\n00:00:03,000 --> 00:00:04,000\nKept\n")).toHaveLength(1);
  });

  it("splits a VTT cue with several <v Name> spans into one segment per speaker, sharing the cue's time", () => {
    const segs = parseTranscript("WEBVTT\n\n00:01.000 --> 00:05.000\n<v Anna>Hello there</v>\n<v Bob &amp; Co>Hi</v>\n");
    expect(segs).toHaveLength(2);
    expect(segs.map((s) => [s.speaker, s.text])).toEqual([["Anna", "Hello there"], ["Bob & Co", "Hi"]]);
    expect(segs[0].start).toBe(1);
    expect(segs[1].end).toBe(5);
    expect(segs[0].end).toBeCloseTo(segs[1].start, 9);
    // 11 characters against 2: Anna keeps the larger share.
    expect(segs[0].end - segs[0].start).toBeGreaterThan(segs[1].end - segs[1].start);
    const p = buildCaptions(segs, { frame_rate: 25 });
    expect(p.captions.map((c) => [c.speaker, text(c)])).toEqual([["Anna", "Hello there"], ["Bob & Co", "Hi"]]);
    // text before the first span has no speaker; one span keeps working
    const mixed = parseTranscript("WEBVTT\n\n00:01.000 --> 00:03.000\nIntro <v.loud Cy>Said it</v>\n");
    expect(mixed.map((s) => [s.speaker, s.text])).toEqual([[undefined, "Intro"], ["Cy", "Said it"]]);
    const single = parseTranscript("WEBVTT\n\n00:01.000 --> 00:03.000\n<v Dee>Only me</v>\n");
    expect(single).toHaveLength(1);
    expect(single[0]).toMatchObject({ speaker: "Dee", text: "Only me", start: 1, end: 3 });
  });

  it("uses the top-level words of a Whisper verbose_json when its segments have none, so times are exact", () => {
    const json = JSON.stringify({
      text: "Hello there friends. Bye now.",
      segments: [
        { id: 0, start: 0, end: 2.4, text: " Hello there friends." },
        { id: 1, start: 3, end: 4.2, text: " Bye now." },
      ],
      words: [
        { word: "Hello", start: 0.1, end: 0.5 },
        { word: "there", start: 0.6, end: 1.1 },
        { word: "friends.", start: 1.3, end: 2.3 },
        { word: "Bye", start: 3.2, end: 3.5 },
        { word: "now.", start: 3.6, end: 4.1 },
      ],
    });
    const segs = parseTranscript(json);
    expect(segs).toHaveLength(2);
    expect(segs[0].words?.map((w) => [w.text, w.start, w.end])).toEqual([["Hello", 0.1, 0.5], ["there", 0.6, 1.1], ["friends.", 1.3, 2.3]]);
    expect(segs[1].words?.map((w) => w.text)).toEqual(["Bye", "now."]);
    const p = buildCaptions(segs, { frame_rate: 25 });
    expect(p.estimated_word_times).toBe(false);
    expect(p.captions.flatMap((c) => c.words.map((w) => w.text))).toEqual(["Hello", "there", "friends.", "Bye", "now."]);
  });

  it("puts top-level Whisper words in the nearest segment, keeps a segment with no word, and takes speakers and sound events along", () => {
    const json = JSON.stringify({
      speakers: [{ id: "s1", name: "Anna" }],
      segments: [
        { start: 0, end: 1, text: "First one", speaker: "s1" },
        { start: 2, end: 3, text: "Silent words" },
        { start: 4, end: 5 },
        { end: 6, text: "no start" },
      ],
      words: [
        { word: "First", start: 0.1, end: 0.4, speaker: "s1" },
        { word: "one", start: 0.5, end: 0.9 },
        { word: "(laughter)", start: 0.95, end: 1.5, type: "audio_event" },
        { word: "late", start: 6.5, end: 6.9 },
      ],
    });
    const segs = parseTranscript(json);
    expect(segs.map((s) => s.text)).toEqual(["First one", "Silent words", "late"]);
    expect(segs[0]).toMatchObject({ speaker: "Anna" });
    expect(segs[0].words?.[0].speaker).toBe("Anna");
    expect(segs[0].sound_events?.map((e) => e.text)).toEqual(["(laughter)"]);
    expect(segs[1].words).toBeUndefined();
    expect(segs[2].start).toBe(4);
    expect(segs[2].words?.[0]).toMatchObject({ text: "late", start: 6.5 });
    // no usable segment at all: the words are segmented by pause
    const bare = parseTranscript(JSON.stringify({ segments: [{ text: "x" }], words: [{ word: "Solo", start: 1, end: 1.5 }] }));
    expect(bare.map((s) => s.text)).toEqual(["Solo"]);
  });

  it("keeps segment words when they exist, ignoring the top-level list", () => {
    const json = JSON.stringify({ segments: [{ start: 0, end: 1, text: "A b", words: [{ word: "A", start: 0, end: 0.3 }, { word: "b", start: 0.4, end: 0.8 }] }], words: [{ word: "Z", start: 0, end: 1 }] });
    expect(parseTranscript(json)[0].words?.map((w) => w.text)).toEqual(["A", "b"]);
  });
});

describe("end_s: clamp to the end of the sequence or media", () => {
  const speech = run(["Thanks", "for", "watching", "everyone."], { start: 25, step: 0.5, dur: 0.4 });
  const withJingle = (): ReturnType<typeof buildCaptions> =>
    buildCaptions([{ text: "x", start: 25, end: 29.63, words: speech, sound_events: [{ text: "(outro jingle)", start: 27.2, end: 29.63 }] }], { frame_rate: 25, standard: "netflix_adult", end_s: 29.2 });

  it("a sound caption that ran to 29.63 s ends at the 29.2 s sequence end, listed as sequence_end", () => {
    const unclamped = buildCaptions([{ text: "x", start: 25, end: 29.63, words: speech, sound_events: [{ text: "(outro jingle)", start: 27.2, end: 29.63 }] }], { frame_rate: 25, standard: "netflix_adult" });
    expect(Math.max(...unclamped.captions.map((c) => c.end))).toBeGreaterThan(29.2);
    const p = withJingle();
    expect(Math.max(...p.captions.map((c) => c.end))).toBeLessThanOrEqual(29.2 + 1e-9);
    expect(p.captions.some((c) => c.kind === "sound")).toBe(true);
    expect(p.changes.filter((c) => c.rule === "sequence_end").length).toBeGreaterThan(0);
    expect(p.settings.end_s).toBeCloseTo(29.2, 6);
    expect(p.warnings.join(" ")).toMatch(/clamped to the end at 29.2 s/);
    for (const c of p.captions) for (const w of c.words) expect(w.end).toBeLessThanOrEqual(29.2 + 1e-9);
  });

  it("drops a caption that would start at or after the end and numbers the change after the kept ones", () => {
    const p = buildCaptions([{ text: "x", start: 1, end: 31, words: [...run(["Hello", "there."], { start: 1 }), ...run(["Late", "words", "here."], { start: 30 })] }], { frame_rate: 25, end_s: 29.2 });
    expect(p.captions).toHaveLength(1);
    const dropped = p.changes.find((c) => c.action === "dropped");
    expect(dropped).toMatchObject({ rule: "sequence_end", n: 2 });
    expect(dropped!.detail).toMatch(/Late words here/);
  });

  it("linger and the minimum duration never carry a caption past the end", () => {
    const p = buildCaptions([{ text: "x", start: 28, end: 29.1, words: run(["Goodbye", "now."], { start: 28.5, step: 0.3, dur: 0.3 }) }], { frame_rate: 25, standard: "netflix_adult", end_s: 29.2 });
    expect(p.captions[p.captions.length - 1].end).toBeLessThanOrEqual(29.2 + 1e-9);
    expect(p.violations.some((v) => v.rule === "min_duration")).toBe(true);
  });

  it("uses the transcript's own duration plus offset, whichever end is earlier, and rejects a bad end_s", () => {
    const words = [{ text: "x", start: 0, end: 12, words: run(["One", "two", "three.", "Four", "five", "six."], { start: 8, step: 1, dur: 0.5 }) }];
    const byTranscript = buildCaptions(words, { frame_rate: 25, transcript_duration_s: 10, offset: 2 });
    expect(Math.max(...byTranscript.captions.map((c) => c.end))).toBeLessThanOrEqual(12 + 1e-9);
    expect(byTranscript.settings.end_s).toBeCloseTo(12, 6);
    const both = buildCaptions(words, { frame_rate: 25, transcript_duration_s: 10, end_s: 9 });
    expect(both.settings.end_s).toBeCloseTo(9, 6);
    expect(() => normalizeCaptionPlanOptions({ end_s: 0 })).toThrow();
    expect(normalizeCaptionPlanOptions({ end_s: 29.2 }).end_s).toBe(29.2);
    expect(CAPTION_PLAN_OPTION_PROPERTIES.end_s.description).toMatch(/sequence_end/);
  });

  it("a plan that fits is unchanged apart from settings.end_s, and a clamped plan survives save and load", () => {
    const fits = buildCaptions([{ text: "x", start: 1, end: 3, words: run(["Hello", "there."], { start: 1 }) }], { frame_rate: 25, end_s: 60 });
    expect(fits.changes).toEqual([]);
    expect(fits.settings.end_s).toBe(60);
    const p = withJingle();
    const doc = captionPlanDocument(p, { kind: "text", sha256: "0".repeat(64), format: "json" });
    const back = planFromDocument(parseCaptionPlanDocument(JSON.parse(JSON.stringify(doc))));
    expect(back.settings.end_s).toBeCloseTo(29.2, 6);
    expect(back.changes.some((c) => c.rule === "sequence_end")).toBe(true);
  });

  it("clampPlanToEnd on a finished plan clamps captions, words and highlights, and ignores a bad end", () => {
    const base = buildCaptions([{ text: "x", start: 1, end: 5, words: run(["Hello", "there", "my", "friend."], { start: 1, step: 1, dur: 0.8 }) }], { frame_rate: 25 });
    const clamped = clampPlanToEnd(base, 2.5);
    expect(clamped.captions[0].end).toBeLessThanOrEqual(2.5 + 1e-9);
    for (const w of clamped.captions[0].words) expect(w.start).toBeLessThan(2.5);
    for (const h of clamped.captions[0].highlight!) expect(h).toBeLessThan(2.5);
    expect(clampPlanToEnd(base, Number.NaN)).toBe(base);
  });
});

describe("transcriptDurationSeconds", () => {
  it("reads a top-level media duration from JSON only", () => {
    expect(transcriptDurationSeconds(JSON.stringify({ words: [], audio_duration_secs: 29.2 }))).toBe(29.2);
    expect(transcriptDurationSeconds(JSON.stringify({ segments: [], duration: 12.5 }))).toBe(12.5);
    expect(transcriptDurationSeconds(JSON.stringify({ words: [] }))).toBeUndefined();
    expect(transcriptDurationSeconds(JSON.stringify([{ text: "a", start: 0, end: 1, duration: 9 }]))).toBeUndefined();
    expect(transcriptDurationSeconds("1\n00:00:01,000 --> 00:00:02,000\nHi\n")).toBeUndefined();
    expect(transcriptDurationSeconds("{bad json", "json")).toBeUndefined();
  });
});

describe("line breaks keep names whole", () => {
  const words = (s: string) => s.split(" ");
  const nameSplit = (lines: string[], name: string) => !lines.some((l) => l.includes(name));

  it("picks the layout that keeps a name on one line when one exists within the line length", () => {
    const text = words("We saw the Land Rover Defender today");
    const two = breakLines(text, 20);
    expect(nameSplit(two, "Land Rover Defender")).toBe(true);
    const three = breakLines(text, 20, { max_lines: 3 });
    expect(three).toEqual(["We saw the", "Land Rover Defender", "today"]);
  });

  it("does not add a line when no extra line keeps the name whole, or when max_lines does not allow one", () => {
    const text = words("Today we're looking at the new Land Rover Defender launch film,");
    const lines = breakLines(text, 25, { max_lines: 3 });
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.length <= 25)).toBe(true);
    expect(breakLines(words("We saw the Land Rover Defender today"), 20, { max_lines: 2 })).toHaveLength(2);
    // Every 3-line split of this text cuts "Land Rover Defender" (it cannot share a 25-character line with the words around it).
    expect(lines.some((l) => l.includes("Land Rover Defender"))).toBe(false);
  });

  it("does not penalise splitting a name that is longer than a line, or a sentence-initial capital", () => {
    const long = words("Wolfeschlegelsteinhausenbergerdorff Hubert Blaine Wolfeschlegelstein went home");
    expect(breakLines(long, 24, { max_lines: 3 }).join(" ")).toBe(long.join(" "));
    expect(breakLines(words("So Sarah Jones went to the shop with a friend"), 20, { max_lines: 3 })[0]).toBe("So Sarah Jones");
    expect(breakLines(words("Today we went to see the new film at the cinema"), 20, { max_lines: 3 }).join(" ")).toBe("Today we went to see the new film at the cinema");
  });

  it("the planner uses the standard's max_lines, so a social caption keeps a name whole where it can", () => {
    const text = words("We saw Land Rover Defender today");
    const w = text.map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.35 }));
    const p = buildCaptions([{ text: "x", start: 0, end: 3, words: w }], { standard: "social_9x16", frame_rate: 25, max_chars_per_line: 20 });
    expect(p.captions).toHaveLength(1);
    expect(p.captions[0].lines).toEqual(["We saw", "Land Rover Defender", "today"]);
    expect(p.violations.filter((v) => v.rule === "grammar")).toEqual([]);
    const two = buildCaptions([{ text: "x", start: 0, end: 3, words: w }], { standard: "netflix_adult", frame_rate: 25, max_chars_per_line: 20 });
    expect(two.captions[0].lines.length).toBeLessThanOrEqual(2);
  });

  it("reports the split when no layout within the line length keeps the name whole", () => {
    const w = words("Today we're looking at the new Land Rover Defender launch film,").map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.35 }));
    const p = buildCaptions([{ text: "x", start: 0, end: 5, words: w }], { standard: "social_9x16", frame_rate: 25 });
    expect(p.captions[0].lines.every((l) => l.length <= 25)).toBe(true);
    expect(p.violations.some((v) => v.rule === "grammar" && /ends on "(Land|Rover)"/.test(v.detail))).toBe(true);
  });
});
