/**
 * src/ai/caption-fit.ts
 *
 * Fitting captions into a safe area. Premiere cannot measure rendered text (there is no
 * sourceRectAtTime equivalent) and Node cannot measure glyphs, so everything here is an
 * ESTIMATE: a line's width is its character count times the font size in pixels times a
 * character-width ratio (default 0.55, caller-overridable; a condensed face is nearer 0.45,
 * a wide display face 0.65). Every result says `method: "estimated"`; verify the look with a
 * short burn-in export or playback.
 *
 * What it does: check a caption against a safe box, re-break its lines (the planner's
 * grammar-aware breaker) to fit the box width, and compute a shrink scale (floor 0.7).
 * Pure: nothing here touches Premiere.
 */
import { breakLines, greedyLineCount } from "./caption-plan.js";
import type { QaBox } from "./caption-qa.js";

/** Font sizes are never scaled below this share of the base size. */
export const FIT_MIN_SCALE = 0.7;

/**
 * Captions are placed by baseline, so descenders (commas, g, p, y) may hang below the safe bottom by design:
 * this share of the font size below the safe bottom is tolerated. Width is judged against the safe width only.
 */
export const DESCENDER_SHARE = 0.3;

/** Estimated average glyph width as a share of the font size. */
export const DEFAULT_CHAR_WIDTH_RATIO = 0.55;

/** Estimated line height as a share of the font size. */
export const DEFAULT_LINE_HEIGHT_RATIO = 1.2;

export type CaptionSafeAreaId = "reels_9_16" | "tiktok_9_16" | "instagram_reels_9_16" | "youtube_shorts_9_16" | "landscape_16_9";

/** A safe area as fractions of the frame (0..1), so it scales to any frame size. */
export interface CaptionSafeArea {
  id: CaptionSafeAreaId;
  label: string;
  /** Left, top, right, bottom edges of the box text may sit in, as fractions of frame width / height. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Where captions normally sit inside the safe area (fractions), when the area defines a band. */
  caption_band?: { left: number; top: number; right: number; bottom: number };
  /** The frame size the numbers were taken at, when they came in pixels. */
  reference_px?: { width: number; height: number };
  approximate: boolean;
  note: string;
}

const APPROX_NOTE = "from ad specs and third-party templates; re-check yearly";

export const CAPTION_SAFE_AREAS: Record<CaptionSafeAreaId, CaptionSafeArea> = {
  reels_9_16: {
    id: "reels_9_16",
    label: "9:16 safe on TikTok, Reels and Shorts at once (default for 9:16)",
    // 1080x1920: x 120-888, y 288-1248.
    left: 120 / 1080,
    right: 888 / 1080,
    top: 288 / 1920,
    bottom: 1248 / 1920,
    reference_px: { width: 1080, height: 1920 },
    approximate: true,
    note: `The union of the three apps' interface: ${APPROX_NOTE}.`,
  },
  tiktok_9_16: {
    id: "tiktok_9_16",
    label: "9:16 TikTok",
    // top 240, bottom 660, left and right 120.
    left: 120 / 1080,
    right: 960 / 1080,
    top: 240 / 1920,
    bottom: 1260 / 1920,
    reference_px: { width: 1080, height: 1920 },
    approximate: true,
    note: `${APPROX_NOTE}. The right rail widens to about 300 px below y 840.`,
  },
  instagram_reels_9_16: {
    id: "instagram_reels_9_16",
    label: "9:16 Instagram Reels",
    // top 269, bottom 672, sides 65.
    left: 65 / 1080,
    right: 1015 / 1080,
    top: 269 / 1920,
    bottom: 1248 / 1920,
    reference_px: { width: 1080, height: 1920 },
    approximate: true,
    note: APPROX_NOTE,
  },
  youtube_shorts_9_16: {
    id: "youtube_shorts_9_16",
    label: "9:16 YouTube Shorts",
    // top 288, bottom 672, left 48, right 192.
    left: 48 / 1080,
    right: 888 / 1080,
    top: 288 / 1920,
    bottom: 1248 / 1920,
    reference_px: { width: 1080, height: 1920 },
    approximate: true,
    note: APPROX_NOTE,
  },
  landscape_16_9: {
    id: "landscape_16_9",
    label: "16:9 title safe (90 % box) with a bottom-centre caption band",
    left: 0.05,
    right: 0.95,
    top: 0.05,
    bottom: 0.95,
    caption_band: { left: 0.1, top: 0.78, right: 0.9, bottom: 0.95 },
    approximate: false,
    note: "Title-safe: 5 % margin on every side. Captions sit in the bottom-centre band.",
  },
};

/** The default safe area for a frame: reels for portrait (taller than wide), 16:9 title safe otherwise. */
export function defaultSafeArea(frameWidth: number, frameHeight: number): CaptionSafeArea {
  return frameHeight > frameWidth ? CAPTION_SAFE_AREAS.reels_9_16 : CAPTION_SAFE_AREAS.landscape_16_9;
}

/** A safe area in pixels for a frame size. */
export function safeBoxPx(area: Pick<CaptionSafeArea, "left" | "top" | "right" | "bottom">, frameWidth: number, frameHeight: number): QaBox {
  return { left: area.left * frameWidth, top: area.top * frameHeight, right: area.right * frameWidth, bottom: area.bottom * frameHeight };
}

export interface FitMetrics {
  /** Font size in pixels. */
  font_size_px: number;
  /** Average glyph width as a share of the font size. Default 0.55. */
  char_width_ratio?: number;
  /** Line height as a share of the font size. Default 1.2. */
  line_height_ratio?: number;
  /** Pixels a background box reaches past the text on each side. */
  box_padding_px?: number;
}

function checkMetrics(m: FitMetrics): { fs: number; ratio: number; lh: number; pad: number } {
  if (!(m.font_size_px > 0) || !Number.isFinite(m.font_size_px)) throw new Error("font_size_px must be a positive number");
  const ratio = m.char_width_ratio ?? DEFAULT_CHAR_WIDTH_RATIO;
  if (!(ratio > 0) || !Number.isFinite(ratio)) throw new Error("char_width_ratio must be a positive number");
  const lh = m.line_height_ratio ?? DEFAULT_LINE_HEIGHT_RATIO;
  if (!(lh > 0) || !Number.isFinite(lh)) throw new Error("line_height_ratio must be a positive number");
  const pad = m.box_padding_px ?? 0;
  if (!(pad >= 0) || !Number.isFinite(pad)) throw new Error("box_padding_px must be 0 or more");
  return { fs: m.font_size_px, ratio, lh, pad };
}

/** Estimated width in pixels of the widest line. */
export function estimateTextWidth(lines: string[], metrics: FitMetrics): number {
  const { fs, ratio } = checkMetrics(metrics);
  const longest = Math.max(0, ...lines.map((l) => l.length));
  return longest * fs * ratio;
}

/** The width the text itself may take: centred text must stay inside the narrower of the two margins. */
export function availableTextWidth(box: QaBox, frameWidth: number, boxPaddingPx = 0, centered = true): number {
  const pad = boxPaddingPx * 2;
  if (centered) return frameWidth - 2 * Math.max(box.left, frameWidth - box.right) - pad;
  return box.right - box.left - pad;
}

export interface FitCheck {
  method: "estimated";
  width_px: number;
  height_px: number;
  available_width_px: number;
  available_height_px: number;
  too_wide: boolean;
  /** More lines than the safe height holds (descenders excepted). */
  too_tall: boolean;
  fits: boolean;
}

/** Checks a caption's lines against a safe box (pixels). Width against the safe width; height with the descender allowance. */
export function checkCaptionFit(lines: string[], box: QaBox, frameWidth: number, metrics: FitMetrics, opts: { centered?: boolean } = {}): FitCheck {
  const { fs, lh, pad } = checkMetrics(metrics);
  const width = estimateTextWidth(lines, metrics);
  const avail = availableTextWidth(box, frameWidth, pad, opts.centered !== false);
  const height = lines.length * fs * lh;
  const availH = box.bottom - box.top + DESCENDER_SHARE * fs;
  const tooWide = width > avail + 0.5;
  const tooTall = height > availH + 0.5;
  return { method: "estimated", width_px: width, height_px: height, available_width_px: avail, available_height_px: availH, too_wide: tooWide, too_tall: tooTall, fits: !tooWide && !tooTall };
}

/**
 * The lines a too-wide caption would be set in: broken for the characters per line the safe width allows
 * at this estimate. Null when that cannot work: no change, more lines than allowed, or a word that alone
 * is wider than the space (unless allow_overflow, where that word sets the line length).
 */
export function rebreakToFit(lines: string[], box: QaBox, frameWidth: number, metrics: FitMetrics, maxLines: number, opts: { centered?: boolean; allow_overflow?: boolean } = {}): string[] | null {
  const { fs, ratio, pad } = checkMetrics(metrics);
  const avail = availableTextWidth(box, frameWidth, pad, opts.centered !== false);
  if (!(avail > 0)) return null;
  // A little under the estimate, as a shorter line of the same text can measure wider per character.
  const fitCpl = Math.floor((avail / (fs * ratio)) * 0.97);
  const words = lines.join(" ").split(/\s+/).filter(Boolean);
  // With allow_overflow a word wider than the space sets the line length: the caller shrinks the rest.
  const cpl = opts.allow_overflow ? Math.max(fitCpl, ...words.map((w) => w.length)) : fitCpl;
  if (cpl < 4 || words.some((w) => w.length > cpl)) return null;
  const out = breakLines(words, cpl, { max_lines: maxLines });
  if (out.length > maxLines || out.some((l) => l.length > cpl)) return null;
  if (out.length === lines.length && out.every((l, i) => l === lines[i])) return null;
  return out;
}

export interface LineLimitResult {
  lines: string[];
  /** False when the caption already had no more lines than the limit. */
  changed: boolean;
  /** The characters per line the new lines were broken for. */
  cpl: number;
  /** True when the text cannot be set in the limit's lines at this size within the safe width: the lines run wider than the space (shrink or shorten). */
  exceeds_width: boolean;
}

/**
 * Re-breaks a caption into at most `maxLines` lines, from its text (every line's words in order), with the
 * planner's grammar-aware breaking. The characters per line come from the safe width at this font estimate;
 * when the text needs more characters per line than that to fit `maxLines` lines, the narrowest line length
 * that fits is used and `exceeds_width` is set, so the caller can shrink the text or report it. Lines are
 * never joined into a longer line than the breaker chose.
 */
export function rebreakToLineLimit(lines: string[], maxLines: number, box: QaBox, frameWidth: number, metrics: FitMetrics, opts: { centered?: boolean } = {}): LineLimitResult {
  const { fs, ratio, pad } = checkMetrics(metrics);
  const limit = Math.max(1, Math.floor(maxLines));
  const words = lines.join(" ").split(/\s+/).filter(Boolean);
  const avail = availableTextWidth(box, frameWidth, pad, opts.centered !== false);
  const fitCpl = avail > 0 ? Math.floor((avail / (fs * ratio)) * 0.97) : 0;
  const lens = words.map((w) => w.length);
  let needed = Math.max(...lens, 1);
  while (greedyLineCount(lens, needed) > limit) needed++;
  if (lines.length <= limit) return { lines, changed: false, cpl: Math.max(fitCpl, needed), exceeds_width: needed > fitCpl };
  const cpl = Math.max(fitCpl, needed);
  const out = breakLines(words, cpl, { max_lines: limit });
  return { lines: out, changed: true, cpl, exceeds_width: needed > fitCpl };
}

export interface ShrinkResult {
  /** Multiply the base font size by this (1 = unchanged). */
  scale: number;
  font_size_px: number;
  /** False when even the floor scale leaves the text too wide. */
  fits: boolean;
  /** Set when the floor was hit and the caption still does not fit. */
  warning?: string;
}

/** The scale that makes a too-wide caption fit, never below FIT_MIN_SCALE. Scale 1 when it already fits. */
export function shrinkScaleToFit(lines: string[], box: QaBox, frameWidth: number, metrics: FitMetrics, opts: { centered?: boolean } = {}): ShrinkResult {
  const { fs, pad } = checkMetrics(metrics);
  const width = estimateTextWidth(lines, metrics);
  const avail = availableTextWidth(box, frameWidth, pad, opts.centered !== false);
  if (!(width > 0) || width <= avail + 0.5) return { scale: 1, font_size_px: fs, fits: true };
  if (!(avail > 0)) return { scale: FIT_MIN_SCALE, font_size_px: Math.ceil(fs * FIT_MIN_SCALE), fits: false, warning: "The safe area has no usable width." };
  const want = Math.min(1, (avail / width) * 0.995);
  if (want >= FIT_MIN_SCALE) return { scale: Math.floor(want * 1000) / 1000, font_size_px: Math.floor(fs * want), fits: true };
  const fitsAtFloor = width * FIT_MIN_SCALE <= avail + 0.5;
  return {
    scale: FIT_MIN_SCALE,
    font_size_px: Math.ceil(fs * FIT_MIN_SCALE),
    fits: fitsAtFloor,
    ...(fitsAtFloor ? {} : { warning: `Even at ${Math.round(FIT_MIN_SCALE * 100)} % of the font size the estimated text is wider than the safe area; shorten the line or raise max_lines.` }),
  };
}

export interface FitResult {
  method: "estimated";
  action: "none" | "rebreak" | "shrink" | "rebreak+shrink";
  lines: string[];
  scale: number;
  font_size_px: number;
  fits: boolean;
  warnings: string[];
}

/**
 * Fits one caption: re-break first (when allowed), then shrink. `mode` "both" (default) tries rebreak then
 * shrink, "rebreak" and "shrink" use one, "none" only reports.
 */
export function fitCaption(
  lines: string[],
  box: QaBox,
  frameWidth: number,
  metrics: FitMetrics,
  opts: { max_lines?: number; mode?: "both" | "rebreak" | "shrink" | "none"; centered?: boolean } = {}
): FitResult {
  const mode = opts.mode ?? "both";
  const maxLines = opts.max_lines ?? Math.max(lines.length, 2);
  const warnings: string[] = [];
  let current = lines.slice();
  let rebroke = false;
  const base = checkMetrics(metrics).fs;
  const centered = opts.centered !== false;
  if ((mode === "both" || mode === "rebreak") && checkCaptionFit(current, box, frameWidth, metrics, { centered }).too_wide) {
    const next = rebreakToFit(current, box, frameWidth, metrics, maxLines, { centered, allow_overflow: true });
    if (next) {
      current = next;
      rebroke = true;
    }
  }
  let scale = 1;
  let size = base;
  let shrunk = false;
  const still = checkCaptionFit(current, box, frameWidth, metrics, { centered }).too_wide;
  if (still && (mode === "both" || mode === "shrink")) {
    const s = shrinkScaleToFit(current, box, frameWidth, metrics, { centered });
    if (s.scale < 1) {
      scale = s.scale;
      size = s.font_size_px;
      shrunk = true;
    }
    if (s.warning) warnings.push(s.warning);
  } else if (still) {
    warnings.push("The estimated text is wider than the safe area; leave fit on rebreak or shrink, or shorten the line.");
  }
  const after = checkCaptionFit(current, box, frameWidth, { ...metrics, font_size_px: size }, { centered });
  warnings.push("Widths are estimated from character counts, not measured; verify the look in a burn-in export or playback.");
  return {
    method: "estimated",
    action: rebroke && shrunk ? "rebreak+shrink" : rebroke ? "rebreak" : shrunk ? "shrink" : "none",
    lines: current,
    scale,
    font_size_px: size,
    fits: !after.too_wide,
    warnings,
  };
}

/**
 * The estimated text box of a caption anchored at `anchor` (x of the centre/left/right edge, y of the last
 * baseline), in pixels. For the QA safe-zone check (QaCue.text_box). The descender allowance is not added.
 */
export function estimateTextBox(
  lines: string[],
  anchor: { x: number; baseline_y: number },
  metrics: FitMetrics,
  justification: "left" | "center" | "right" = "center"
): QaBox & { method: "estimated" } {
  const { fs, lh, pad } = checkMetrics(metrics);
  const width = estimateTextWidth(lines, metrics) + 2 * pad;
  const height = lines.length * fs * lh;
  const left = justification === "center" ? anchor.x - width / 2 : justification === "left" ? anchor.x : anchor.x - width;
  const bottom = anchor.baseline_y;
  return { method: "estimated", left, right: left + width, top: bottom - height + fs * 0.2, bottom };
}
