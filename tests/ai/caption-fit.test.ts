import { describe, expect, it } from "vitest";
import {
  availableTextWidth,
  CAPTION_SAFE_AREAS,
  checkCaptionFit,
  DEFAULT_CHAR_WIDTH_RATIO,
  defaultSafeArea,
  DESCENDER_SHARE,
  estimateTextBox,
  estimateTextWidth,
  FIT_MIN_SCALE,
  fitCaption,
  rebreakToFit,
  safeBoxPx,
  shrinkScaleToFit,
} from "../../src/ai/caption-fit.js";
import { lintCaptions } from "../../src/ai/caption-qa.js";

const REELS = safeBoxPx(CAPTION_SAFE_AREAS.reels_9_16, 1080, 1920);
const M = { font_size_px: 60 };
const NARROW = { left: 600, top: 0, right: 500, bottom: 100 };

describe("safe areas", () => {
  it("reels_9_16 is x 120-888, y 288-1248 at 1080x1920, stored normalised", () => {
    const a = CAPTION_SAFE_AREAS.reels_9_16;
    expect(a.left).toBeCloseTo(120 / 1080, 9);
    expect(a.right).toBeCloseTo(888 / 1080, 9);
    expect(a.top).toBeCloseTo(288 / 1920, 9);
    expect(a.bottom).toBeCloseTo(1248 / 1920, 9);
    expect(REELS.left).toBeCloseTo(120, 6);
    expect(REELS.right).toBeCloseTo(888, 6);
    expect(REELS.top).toBeCloseTo(288, 6);
    expect(REELS.bottom).toBeCloseTo(1248, 6);
    const half = safeBoxPx(a, 540, 960);
    expect(half.left).toBeCloseTo(60, 6);
    expect(half.bottom).toBeCloseTo(624, 6);
  });
  it("flags the platform areas as approximate with the re-check note, and the 16:9 default as title safe", () => {
    for (const id of ["reels_9_16", "tiktok_9_16", "instagram_reels_9_16", "youtube_shorts_9_16"] as const) {
      expect(CAPTION_SAFE_AREAS[id].approximate).toBe(true);
      expect(CAPTION_SAFE_AREAS[id].note).toContain("from ad specs and third-party templates; re-check yearly");
      expect(CAPTION_SAFE_AREAS[id].reference_px).toEqual({ width: 1080, height: 1920 });
    }
    const t = safeBoxPx(CAPTION_SAFE_AREAS.tiktok_9_16, 1080, 1920);
    expect([t.left, t.top, t.right, t.bottom].map(Math.round)).toEqual([120, 240, 960, 1260]);
    const i = safeBoxPx(CAPTION_SAFE_AREAS.instagram_reels_9_16, 1080, 1920);
    expect([i.left, i.top, i.right, i.bottom].map(Math.round)).toEqual([65, 269, 1015, 1248]);
    const y = safeBoxPx(CAPTION_SAFE_AREAS.youtube_shorts_9_16, 1080, 1920);
    expect([y.left, y.top, y.right, y.bottom].map(Math.round)).toEqual([48, 288, 888, 1248]);
    const l = CAPTION_SAFE_AREAS.landscape_16_9;
    expect([l.left, l.top, l.right, l.bottom]).toEqual([0.05, 0.05, 0.95, 0.95]);
    expect(l.approximate).toBe(false);
    expect(l.caption_band!.bottom).toBe(0.95);
    expect(defaultSafeArea(1080, 1920).id).toBe("reels_9_16");
    expect(defaultSafeArea(1920, 1080).id).toBe("landscape_16_9");
  });
});

describe("estimates", () => {
  it("estimates width as characters x font size x ratio, widest line", () => {
    expect(estimateTextWidth(["12345", "12"], M)).toBeCloseTo(5 * 60 * DEFAULT_CHAR_WIDTH_RATIO, 9);
    expect(estimateTextWidth(["12345"], { ...M, char_width_ratio: 0.5 })).toBe(150);
    expect(estimateTextWidth([], M)).toBe(0);
  });
  it("refuses bad metrics", () => {
    expect(() => estimateTextWidth(["a"], { font_size_px: 0 })).toThrow(/font_size_px/);
    expect(() => estimateTextWidth(["a"], { font_size_px: 10, char_width_ratio: -1 })).toThrow(/char_width_ratio/);
    expect(() => estimateTextWidth(["a"], { font_size_px: 10, line_height_ratio: 0 })).toThrow(/line_height_ratio/);
    expect(() => estimateTextWidth(["a"], { font_size_px: 10, box_padding_px: -2 })).toThrow(/box_padding_px/);
  });
  it("available width: centred text uses the narrower margin, left uses the box", () => {
    expect(availableTextWidth(REELS, 1080)).toBeCloseTo(696, 6);
    expect(availableTextWidth(REELS, 1080, 10)).toBeCloseTo(676, 6);
    expect(availableTextWidth(REELS, 1080, 0, false)).toBeCloseTo(768, 6);
  });
  it("checks a caption against the box, with a descender allowance on the height", () => {
    const ok = checkCaptionFit(["Short line"], REELS, 1080, M);
    expect(ok).toMatchObject({ method: "estimated", too_wide: false, too_tall: false, fits: true });
    const wide = checkCaptionFit(["x".repeat(30)], REELS, 1080, M);
    expect(wide.too_wide).toBe(true);
    expect(wide.fits).toBe(false);
    expect(wide.width_px).toBeCloseTo(30 * 60 * 0.55, 6);
    const tall = checkCaptionFit(new Array(20).fill("a"), REELS, 1080, M);
    expect(tall.too_tall).toBe(true);
    expect(tall.available_height_px).toBeCloseTo(960 + DESCENDER_SHARE * 60, 6);
  });
  it("estimates a text box by justification and feeds the QA safe-zone check", () => {
    const centre = estimateTextBox(["x".repeat(10)], { x: 540, baseline_y: 1200 }, M);
    expect(centre.method).toBe("estimated");
    expect(centre.left).toBeCloseTo(540 - 165, 6);
    expect(centre.right).toBeCloseTo(540 + 165, 6);
    expect(centre.bottom).toBe(1200);
    const left = estimateTextBox(["x".repeat(10)], { x: 100, baseline_y: 500 }, { ...M, box_padding_px: 5 }, "left");
    expect(left.left).toBe(100);
    expect(left.right).toBeCloseTo(100 + 330 + 10, 6);
    const right = estimateTextBox(["x".repeat(10)], { x: 800, baseline_y: 500 }, M, "right");
    expect(right.right).toBe(800);
    const wide = estimateTextBox(["x".repeat(40)], { x: 540, baseline_y: 1200 }, M);
    const r = lintCaptions([{ n: 1, start: 0, end: 2, lines: ["A caption."], text_box: wide }], { frame_rate: 25, safe_area: REELS });
    expect(r.issues.map((i) => i.rule)).toEqual(["safe_zone"]);
    const fine = lintCaptions([{ n: 1, start: 0, end: 2, lines: ["A caption."], text_box: centre }], { frame_rate: 25, safe_area: REELS });
    expect(fine.issues).toEqual([]);
  });
});

describe("re-break and shrink", () => {
  const long = ["We walked all the way to the old market", "this morning"];
  it("re-breaks to the width the box allows, grammar aware, up to max_lines", () => {
    const out = rebreakToFit(long, REELS, 1080, M, 3)!;
    expect(out).not.toBeNull();
    expect(out.length).toBeGreaterThan(2);
    expect(out.length).toBeLessThanOrEqual(3);
    expect(out.join(" ")).toBe(long.join(" "));
    for (const l of out) expect(l.length * 60 * 0.55).toBeLessThanOrEqual(696);
    for (const l of out.slice(0, -1)) expect(l).not.toMatch(/\b(the|to)$/);
  });
  it("gives up when lines would exceed max_lines, a word is too wide, nothing changes, or no width is left", () => {
    expect(rebreakToFit(long, REELS, 1080, M, 2)).toBeNull();
    expect(rebreakToFit(["Supercalifragilisticexpialidocious"], REELS, 1080, M, 3)).toBeNull();
    expect(rebreakToFit(["Supercalifragilisticexpialidocious word"], REELS, 1080, M, 3, { allow_overflow: true })).toEqual(["Supercalifragilisticexpialidocious", "word"]);
    expect(rebreakToFit(["Short"], REELS, 1080, M, 3)).toBeNull();
    expect(rebreakToFit(long, NARROW, 1080, M, 3)).toBeNull();
    expect(rebreakToFit(long, REELS, 1080, { font_size_px: 600 }, 3)).toBeNull();
  });
  it("computes a shrink scale with a floor of 0.7 and warns beyond it", () => {
    expect(FIT_MIN_SCALE).toBe(0.7);
    expect(shrinkScaleToFit(["Short"], REELS, 1080, M)).toEqual({ scale: 1, font_size_px: 60, fits: true });
    expect(shrinkScaleToFit([], REELS, 1080, M).scale).toBe(1);
    const s = shrinkScaleToFit(["x".repeat(24)], REELS, 1080, M);
    expect(s.scale).toBeLessThan(1);
    expect(s.scale).toBeGreaterThanOrEqual(0.7);
    expect(s.fits).toBe(true);
    expect(s.warning).toBeUndefined();
    expect(24 * 60 * s.scale * 0.55).toBeLessThanOrEqual(696);
    const floor = shrinkScaleToFit(["x".repeat(40)], REELS, 1080, M);
    expect(floor).toMatchObject({ scale: 0.7, font_size_px: 42, fits: false });
    expect(floor.warning).toMatch(/70 %/);
    expect(shrinkScaleToFit(["x".repeat(5)], NARROW, 1080, M)).toMatchObject({ fits: false, warning: expect.stringMatching(/no usable width/) });
  });
});

describe("fitCaption", () => {
  const sentence = ["We walked all the way to the old market this morning"];
  it("leaves a caption that fits alone, with the estimate note", () => {
    const r = fitCaption(["Short line"], REELS, 1080, M);
    expect(r).toMatchObject({ method: "estimated", action: "none", scale: 1, font_size_px: 60, fits: true, lines: ["Short line"] });
    expect(r.warnings.join(" ")).toMatch(/estimated/);
  });
  it("re-breaks first, then shrinks, and reports which", () => {
    const rebreak = fitCaption(sentence, REELS, 1080, M, { max_lines: 3 });
    expect(rebreak.action).toBe("rebreak");
    expect(rebreak.lines.length).toBeLessThanOrEqual(3);
    expect(rebreak.fits).toBe(true);
    const shrink = fitCaption(sentence, REELS, 1080, M, { max_lines: 1 });
    expect(shrink.action).toBe("shrink");
    expect(shrink.scale).toBeLessThan(1);
  });
  it("respects the mode: rebreak only, shrink only, none (report only)", () => {
    const rb = fitCaption(sentence, REELS, 1080, M, { mode: "rebreak", max_lines: 3 });
    expect(rb.action).toBe("rebreak");
    const rbFail = fitCaption(sentence, REELS, 1080, M, { mode: "rebreak", max_lines: 1 });
    expect(rbFail).toMatchObject({ action: "none", fits: false });
    expect(rbFail.warnings.join(" ")).toMatch(/wider than the safe area/);
    const sh = fitCaption(sentence, REELS, 1080, M, { mode: "shrink" });
    expect(sh.action).toBe("shrink");
    expect(sh.lines).toEqual(sentence);
    const none = fitCaption(sentence, REELS, 1080, M, { mode: "none" });
    expect(none).toMatchObject({ action: "none", fits: false, scale: 1 });
  });
  it("warns when even the floor does not fit", () => {
    const r = fitCaption(["x".repeat(60)], REELS, 1080, M, { max_lines: 1 });
    expect(r.fits).toBe(false);
    expect(r.scale).toBe(0.7);
    expect(r.warnings.join(" ")).toMatch(/70 %/);
  });
  it("does a rebreak plus shrink when both are needed", () => {
    const r = fitCaption(["Supercalifragilisticexpialidocious word"], REELS, 1080, { font_size_px: 40 }, { max_lines: 2 });
    expect(r.action).toBe("rebreak+shrink");
    expect(r.lines).toEqual(["Supercalifragilisticexpialidocious", "word"]);
    expect(r.scale).toBeLessThan(1);
    expect(r.fits).toBe(true);
  });
});
