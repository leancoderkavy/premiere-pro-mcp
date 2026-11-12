import { describe, expect, it } from "vitest";
import { COMMON_FRAME_RATES, inferFrameRate, lintCaptions, type QaCue } from "../../src/ai/caption-qa.js";
import { DURATION_TOLERANCE_S } from "../../src/ai/caption-rules.js";

const cue = (n: number, start: number, end: number, ...lines: string[]): QaCue => ({ n, start, end, lines });
const rules = (cues: QaCue[], opts: Partial<Parameters<typeof lintCaptions>[1]> = {}) =>
  lintCaptions(cues, { frame_rate: 24, ...opts }).issues.map((i) => `${i.n}:${i.rule}:${i.severity}`);
/** Only the findings of one rule, so a test's sample text need not be perfect for the others. */
const only = (rule: string, cues: QaCue[], opts: Partial<Parameters<typeof lintCaptions>[1]> = {}) => rules(cues, opts).filter((r) => r.split(":")[1] === rule);

describe("lintCaptions", () => {
  it("passes a clean caption", () => {
    const r = lintCaptions([cue(1, 1, 3, "A perfectly fine caption.")], { frame_rate: 24 });
    expect(r.pass).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.counts).toEqual({});
    expect(r.standard).toBe("netflix_adult");
  });

  it("cps: over 20 fails, at 20 passes", () => {
    expect(rules([cue(1, 0, 2, "x".repeat(41))])).toEqual(["1:cps:error"]);
    expect(rules([cue(1, 0, 2, "x".repeat(40))])).toEqual([]);
  });

  it("wpm and per-word time for bbc", () => {
    const words = Array.from({ length: 12 }, () => "go").join(" ");
    // 12 words in 3 s = 240 wpm, 0.25 s a word
    const r = rules([cue(1, 0, 3, words)], { standard: "bbc" });
    expect(r).toContain("1:wpm:error");
    expect(r).toContain("1:min_s_per_word:warning");
    expect(rules([cue(1, 0, 6, words)], { standard: "bbc" })).toEqual([]);
  });

  it("cpl counts characters per line", () => {
    expect(rules([cue(1, 0, 4, "y".repeat(43))])).toEqual(["1:cpl:error"]);
    expect(rules([cue(1, 0, 4, "y".repeat(42))])).toEqual([]);
  });

  it("lines: three lines fail, social allows three", () => {
    const three = [cue(1, 0, 4, "one", "two", "three")];
    expect(rules(three)).toEqual(["1:lines:error"]);
    expect(rules(three, { standard: "social_9x16" })).toEqual([]);
  });

  it("min_duration and max_duration", () => {
    expect(rules([cue(1, 0, 0.5, "Hi")])).toEqual(["1:min_duration:error"]);
    expect(rules([cue(1, 0, 5 / 6, "Hi")])).toEqual([]);
    expect(rules([cue(1, 0, 7.5, "Hi")])).toEqual(["1:max_duration:error"]);
    expect(rules([cue(1, 0, 7, "Hi")])).toEqual([]);
  });

  it("gap: under 2 frames is an error, a short tidy gap a warning, a long one clean", () => {
    const a = (gapS: number) => [cue(1, 0, 2, "One."), cue(2, 2 + gapS, 4 + gapS, "Two.")];
    expect(rules(a(0.04))).toEqual(["1:gap:error"]);
    expect(rules(a(0))).toEqual(["1:gap:error"]);
    expect(rules(a(1 / 12))).toEqual([]);
    expect(rules(a(0.3))).toEqual(["1:gap:warning"]);
    expect(rules(a(0.6))).toEqual([]);
  });

  it("gap uses the frame rate", () => {
    const c = [cue(1, 0, 2, "One."), cue(2, 2.07, 4, "Two.")];
    expect(rules(c, { frame_rate: 24 })).toEqual(["1:gap:error"]); // 0.07 s is 1.7 frames at 24
    expect(rules(c, { frame_rate: 30 })).toEqual(["1:gap:warning"]); // and 2.1 frames at 30
  });

  it("overlap is an error", () => {
    const r = lintCaptions([cue(1, 0, 2.5, "One."), cue(2, 2, 4, "Two.")], { frame_rate: 24 });
    expect(r.issues.map((i) => i.rule)).toEqual(["overlap"]);
    expect(r.pass).toBe(false);
  });

  it("grammar: a line or a caption ending on a weak word", () => {
    expect(rules([cue(1, 0, 4, "We went to the", "market today.")])).toEqual(["1:grammar:warning"]);
    expect(rules([cue(1, 0, 4, "We went to the market", "today.")])).toEqual([]);
    const across = [cue(1, 0, 2, "She walked into"), cue(2, 2.5, 4.5, "the room quietly.")];
    expect(rules(across)).toEqual(["1:grammar:warning"]);
    // a long silence is a new thought, and the last caption has no next
    expect(rules([cue(1, 0, 2, "She walked into"), cue(2, 5, 7, "the room quietly.")])).toEqual([]);
    expect(rules([cue(1, 0, 2, "She walked into")])).toEqual([]);
  });

  it("shot_change: straddling and too close to a cut", () => {
    expect(only("shot_change", [cue(1, 1, 3, "Across the cut.")], { cut_times: [2] })).toEqual(["1:shot_change:warning"]);
    // in-time 0.25 s before the cut
    expect(only("shot_change", [cue(1, 1.75, 2, "Near the cut.")], { cut_times: [2] })).toEqual(["1:shot_change:warning"]);
    // out-time on the cut
    expect(only("shot_change", [cue(1, 0, 2, "Ends on the cut.")], { cut_times: [2] })).toEqual(["1:shot_change:warning"]);
    // clean: starts on the cut, ends 2 frames before the next, far from others
    expect(only("shot_change", [cue(1, 2, 4, "On the cut."), cue(2, 5, 7, "Later.")], { cut_times: [2, 4.1] })).toEqual([]);
    expect(only("shot_change", [cue(1, 0, 1.9, "Out two frames early.")], { cut_times: [2] })).toEqual([]);
    expect(only("shot_change", [cue(1, 0, 3, "No cuts.")])).toEqual([]);
  });

  it("safe_zone from layers", () => {
    const c: QaCue = { ...cue(1, 0, 2, "Wide"), outside_safe: true };
    const d: QaCue = { ...cue(2, 3, 5, "Keys"), first_outside_safe: 3.5 };
    expect(only("safe_zone", [c, d])).toEqual(["1:safe_zone:error", "2:safe_zone:error"]);
  });

  it("empty and bad timing", () => {
    expect(rules([cue(1, 0, 2, "  ")])).toEqual(["1:empty:error"]);
    expect(rules([cue(1, 2, 2, "Hi")])).toEqual(["1:bad_timing:error"]);
  });

  it("counts every issue but lists max_issues", () => {
    const cues = Array.from({ length: 10 }, (_, i) => cue(i + 1, i * 10, i * 10 + 0.3, "Hi"));
    const r = lintCaptions(cues, { frame_rate: 24, max_issues: 4 });
    expect(r.issues).toHaveLength(4);
    expect(r.truncated).toBe(true);
    expect(r.counts.min_duration).toBe(10);
  });
});

describe("review fixes", () => {
  it("shot change: a caption wholly before a cut that ends 2 frames before it is fine, even with a close in-time", () => {
    // [3.375, 3.708] with a cut at 3.79 (24 fps): ends 2 frames before the cut, never on screen across it.
    expect(only("shot_change", [cue(1, 3.375, 3.708, "Fine.")], { cut_times: [3.79] })).toEqual([]);
  });

  it("shot change: a close in-time still warns when the caption is on screen at the cut", () => {
    expect(only("shot_change", [cue(1, 3.5, 3.78, "Hmm.")], { cut_times: [3.79] })).toEqual(["1:shot_change:warning"]);
    expect(only("shot_change", [cue(1, 3.5, 4.5, "Straddles.")], { cut_times: [3.79] })).toEqual(["1:shot_change:warning"]);
  });

  it("a number followed by an ordinary word is not a split number and unit", () => {
    expect(only("grammar", [cue(1, 0, 2, "In 2020"), cue(2, 2.2, 4, "when it began.")])).toEqual([]);
    expect(only("grammar", [cue(1, 0, 2, "It was 10"), cue(2, 2.2, 4, "km away.")])).toEqual(["1:grammar:warning"]);
  });
});

// ---------- Premiere port: frame rate inference and safe-zone boxes ----------

describe("frame rate inference", () => {
  it("lists the common rates and finds the lowest that every time sits on", () => {
    expect(COMMON_FRAME_RATES).toEqual([24000 / 1001, 24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60]);
    expect(inferFrameRate([1.04, 2.08, 3.76])).toBe(25);
    expect(inferFrameRate([1, 2])).toBe(24);
    expect(inferFrameRate([1.001, 2.002, 4.004])).toBe(24000 / 1001);
    expect(inferFrameRate([0, 0])).toBeNull();
    expect(inferFrameRate([])).toBeNull();
    expect(inferFrameRate([Number.NaN, 1])).toBe(24);
    expect(inferFrameRate([0.123, 0.4567])).toBeNull();
  });

  it("infers the frame rate when none is given and says so", () => {
    const r = lintCaptions([cue(1, 0, 2, "One."), cue(2, 2.08, 4, "Two.")], {});
    expect(r.frame_rate_inferred).toBe(true);
    expect(r.frame_rate).toBe(25);
    expect(r.warnings).toEqual([]);
    expect(r.issues.map((i) => i.rule)).toEqual([]);
    const given = lintCaptions([cue(1, 0, 2, "One.")], { frame_rate: 30 });
    expect(given.frame_rate_inferred).toBe(false);
    expect(given.frame_rate).toBe(30);
    expect(given.warnings).toEqual([]);
  });

  it("falls back to 24 fps with a half-frame gap tolerance and a warning when nothing fits", () => {
    // 0.123 s and 2.071 s sit on no common frame grid; the gap is 1.64 frames at 24 fps (a half-frame tolerance forgives it)
    const cues = [cue(1, 0.123, 2, "One."), cue(2, 2.071, 4.017, "Two.")];
    const r = lintCaptions(cues, {});
    expect(r.frame_rate_inferred).toBe(true);
    expect(r.frame_rate).toBe(24);
    expect(r.warnings.join(" ")).toMatch(/24 fps/);
    expect(r.issues.filter((i) => i.rule === "gap")).toEqual([]);
    const strict = lintCaptions(cues, { frame_rate: 24 });
    expect(strict.issues.filter((i) => i.rule === "gap")).toHaveLength(1);
    expect(lintCaptions(cues, { frame_rate: 0 }).frame_rate_inferred).toBe(true);
  });
});

describe("safe zone from estimated text boxes", () => {
  const safe = { left: 120, top: 288, right: 888, bottom: 1248 };
  const boxed = (n: number, box: { left: number; top: number; right: number; bottom: number }): QaCue => ({ ...cue(n, n * 3, n * 3 + 2, "Fine caption."), text_box: box });
  it("flags a box outside the safe area, naming the sides, and leaves boxes inside alone", () => {
    const cues = [boxed(1, { left: 200, top: 1000, right: 800, bottom: 1200 }), boxed(2, { left: 50, top: 1000, right: 1000, bottom: 1200 }), boxed(3, { left: 200, top: 100, right: 800, bottom: 1300 })];
    const r = lintCaptions(cues, { frame_rate: 24, safe_area: safe });
    const found = r.issues.filter((i) => i.rule === "safe_zone");
    expect(found.map((i) => i.n)).toEqual([2, 3]);
    expect(found[0].detail).toMatch(/left, right/);
    expect(found[0].detail).toMatch(/estimate/);
    expect(found[1].detail).toMatch(/top, bottom/);
  });
  it("does nothing without a safe_area or a text_box", () => {
    const wide = boxed(1, { left: 0, top: 0, right: 2000, bottom: 2000 });
    expect(only("safe_zone", [wide])).toEqual([]);
    expect(only("safe_zone", [cue(1, 0, 2, "No box.")], { safe_area: safe })).toEqual([]);
  });
});

describe("shared duration tolerance with the planner", () => {
  const cue1 = (start: number, end: number): QaCue => ({ n: 1, start, end, lines: ["Hello there."] });
  it("flags a minimum or maximum missed by more than the planner's tolerance, and no less", () => {
    expect(DURATION_TOLERANCE_S).toBe(0.001);
    // dcmp minimum 1.3347 s: 32 frames at 24 fps is 1.3333 s (flagged), 33 frames 1.375 s (fine)
    expect(lintCaptions([cue1(0, 32 / 24)], { standard: "dcmp", frame_rate: 24 }).issues.some((i) => i.rule === "min_duration")).toBe(true);
    expect(lintCaptions([cue1(0, 33 / 24)], { standard: "dcmp", frame_rate: 24 }).issues.some((i) => i.rule === "min_duration")).toBe(false);
    expect(lintCaptions([cue1(0, 1.3338)], { standard: "dcmp", frame_rate: 24 }).issues.some((i) => i.rule === "min_duration")).toBe(false);
    // social maximum 5 s: 120 frames at 23.976 fps is 5.005 s (flagged), 119 frames 4.963 s (fine)
    expect(lintCaptions([cue1(0, 120 / (24000 / 1001))], { standard: "social_9x16", frame_rate: 23.976 }).issues.some((i) => i.rule === "max_duration")).toBe(true);
    expect(lintCaptions([cue1(0, 119 / (24000 / 1001))], { standard: "social_9x16", frame_rate: 23.976 }).issues.some((i) => i.rule === "max_duration")).toBe(false);
  });

  it("counts frames at the exact NTSC rate and reports the rounded one", () => {
    const r = lintCaptions([cue1(0, 1), { ...cue1(1 + 2 / (30000 / 1001), 3), n: 2 }], { frame_rate: 29.97 });
    expect(r.frame_rate).toBe(29.97);
    expect(r.issues.filter((i) => i.rule === "gap" && i.severity === "error")).toEqual([]);
  });
});
