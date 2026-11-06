// QA rule set after github/awesome-copilot skills/caption-qa (MIT); reimplemented in TypeScript against our own standards table.
/**
 * src/ai/caption-qa.ts
 *
 * Lints a list of captions against a caption standard (caption-standards.ts):
 * reading speed, line length, line count, time on screen, gaps, overlaps,
 * grammar of the breaks, shot changes and, when per-cue text boxes are given
 * (see caption-fit.ts: Premiere cannot measure rendered text, so they are
 * estimates), the safe area. Pure: the tools turn files and plans into QaCue lists first.
 */
import { DURATION_TOLERANCE_S, exactFrameRate } from "./caption-rules.js";
import { bareWord, CAPTION_STANDARDS, weakEndReason, type CaptionStandardId } from "./caption-standards.js";

export interface QaCue {
  /** 1-based number as the caption is known to the user. */
  n: number;
  start: number;
  end: number;
  /** Displayed text lines, markup already removed. */
  lines: string[];
  outside_safe?: boolean;
  first_outside_safe?: number;
  /** Estimated text box in the same units as QaOptions.safe_area (checked when safe_area is given). */
  text_box?: QaBox;
}

/** A box: left/top/right/bottom in one coordinate space (pixels or fractions of the frame). */
export interface QaBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type QaRule =
  | "cps"
  | "wpm"
  | "min_s_per_word"
  | "cpl"
  | "lines"
  | "min_duration"
  | "max_duration"
  | "gap"
  | "overlap"
  | "grammar"
  | "shot_change"
  | "safe_zone"
  | "empty"
  | "bad_timing";

export interface QaIssue {
  n: number;
  rule: QaRule;
  severity: "error" | "warning";
  start: number;
  end: number;
  detail: string;
}

export interface QaOptions {
  standard?: CaptionStandardId;
  /** Frames per second. Without it, it is inferred from the cue times (see inferFrameRate). */
  frame_rate?: number;
  cut_times?: number[];
  max_issues?: number;
  /** Frames a gap may fall short of the minimum before it is an error. Default 0.05; wider when the frame rate is only a guess. */
  gap_tolerance_frames?: number;
  /** The safe area text boxes must stay inside; with each cue's text_box. Estimates, not measurements. */
  safe_area?: QaBox;
}

export interface QaReport {
  standard: CaptionStandardId;
  label: string;
  frame_rate: number;
  /** True when the frame rate was inferred from the cue times because none was given. */
  frame_rate_inferred: boolean;
  warnings: string[];
  cues: number;
  pass: boolean;
  counts: Record<string, number>;
  issues: QaIssue[];
  truncated: boolean;
}

/** Seconds a duration may miss a limit by: the planner's own tolerance (caption-rules). */
const MS = DURATION_TOLERANCE_S;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

const wordsIn = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));

/** The frame rates a cue file is likely to have been timed at, lowest first (NTSC rates as exact rationals). */
export const COMMON_FRAME_RATES = [24000 / 1001, 24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60];

/**
 * The lowest common frame rate whose frame boundaries every given time sits on (within 0.6 ms: times written to the millisecond are off by at most 0.5 ms), or null when none
 * fits (times typed by hand, or off a grid). Needs at least one time that is not 0.
 */
export function inferFrameRate(times: number[]): number | null {
  const ts = times.filter((t) => Number.isFinite(t) && t > 0);
  if (!ts.length) return null;
  for (const fps of COMMON_FRAME_RATES) {
    if (ts.every((t) => Math.abs(t * fps - Math.round(t * fps)) / fps <= 0.0006)) return fps;
  }
  return null;
}

export function lintCaptions(cues: QaCue[], opts: QaOptions): QaReport {
  const std = CAPTION_STANDARDS[opts.standard ?? "netflix_adult"];
  const warnings: string[] = [];
  let fps = opts.frame_rate !== undefined && opts.frame_rate > 0 ? exactFrameRate(opts.frame_rate) : 0;
  let inferred = false;
  let guessed = false;
  if (!fps) {
    const found = inferFrameRate(cues.flatMap((c) => [c.start, c.end]));
    inferred = true;
    if (found !== null) fps = found;
    else {
      fps = 24;
      guessed = true;
      warnings.push("No frame_rate was given and the cue times fit no common frame rate, so 24 fps is assumed with a half-frame tolerance on gaps. Pass the sequence's frame rate for exact checks.");
    }
  }
  const frame = 1 / fps;
  const gapTol = opts.gap_tolerance_frames ?? (guessed ? 0.5 : 0.05);
  const cuts = [...(opts.cut_times ?? [])].sort((a, b) => a - b);
  const all: QaIssue[] = [];
  const add = (c: QaCue, rule: QaRule, severity: "error" | "warning", detail: string) =>
    all.push({ n: c.n, rule, severity, start: r3(c.start), end: r3(c.end), detail });

  cues.forEach((c, i) => {
    const next = cues[i + 1];
    const lines = c.lines.filter((l) => l.trim().length > 0);
    const text = lines.join(" ");
    const dur = c.end - c.start;

    if (!(c.end > c.start)) add(c, "bad_timing", "error", `Ends at ${r3(c.end)} s, not after its start ${r3(c.start)} s.`);
    if (!text.trim()) add(c, "empty", "error", "No text.");

    if (dur > 0 && text.trim()) {
      const chars = text.length;
      const words = wordsIn(text).length;
      if (std.max_cps !== undefined) {
        const cps = chars / dur;
        if (cps > std.max_cps + 0.05) add(c, "cps", "error", `${r2(cps)} characters a second (limit ${std.max_cps}).`);
      }
      if (std.max_wpm !== undefined) {
        const wpm = (words * 60) / dur;
        if (wpm > std.max_wpm + 0.5) add(c, "wpm", "error", `${Math.round(wpm)} words a minute (limit ${std.max_wpm}).`);
      }
      if (std.min_s_per_word !== undefined && words > 0 && dur / words < std.min_s_per_word - MS) {
        add(c, "min_s_per_word", "warning", `${r2(dur / words)} s a word (guidance at least ${std.min_s_per_word}).`);
      }
      if (dur + MS < std.min_duration_s) add(c, "min_duration", "error", `On screen ${r2(dur)} s (at least ${r2(std.min_duration_s)} s).`);
      if (dur - MS > std.max_duration_s) add(c, "max_duration", "error", `On screen ${r2(dur)} s (at most ${std.max_duration_s} s).`);
    }

    lines.forEach((l, li) => {
      if (l.length > std.max_cpl) add(c, "cpl", "error", `Line ${li + 1} is ${l.length} characters (limit ${std.max_cpl}).`);
    });
    if (lines.length > std.max_lines) add(c, "lines", "error", `${lines.length} lines (limit ${std.max_lines}).`);

    // Grammar: a line break, or the caption's end, that splits a phrase.
    for (let li = 0; li + 1 < lines.length; li++) {
      const lw = lines[li].split(/\s+/).filter(Boolean);
      const nw = lines[li + 1].split(/\s+/).filter(Boolean);
      if (!lw.length || !nw.length) continue;
      const why = weakEndReason(lw[lw.length - 1], nw[0]);
      if (why) add(c, "grammar", "warning", `Line ${li + 1} ${why} ("${bareWord(lw[lw.length - 1])}").`);
    }
    if (next && lines.length) {
      const lw = lines[lines.length - 1].split(/\s+/).filter(Boolean);
      const nextLine = next.lines.find((l) => l.trim().length > 0);
      const nw = nextLine ? nextLine.split(/\s+/).filter(Boolean) : [];
      // After a long silence the next caption starts a fresh thought, so a pause that long is not a split.
      if (lw.length && nw.length && next.start - c.end <= 1.5) {
        const why = weakEndReason(lw[lw.length - 1], nw[0]);
        if (why) add(c, "grammar", "warning", `The caption ${why} ("${bareWord(lw[lw.length - 1])}") and the next one carries on.`);
      }
    }

    // Gap and overlap to the next caption.
    if (next) {
      const gap = next.start - c.end;
      if (gap < -1e-6) {
        add(c, "overlap", "error", `Overlaps caption ${next.n} by ${r3(-gap)} s.`);
      } else {
        const frames = gap * fps;
        if (frames < std.min_gap_frames - gapTol) {
          add(c, "gap", "error", `${r2(frames)} frames before caption ${next.n} (at least ${std.min_gap_frames} at ${r2(fps)} fps).`);
        } else if (gap < std.close_gap_under_s - MS && frames > std.min_gap_frames + 0.05 && !cuts.some((x) => x > c.end - frame / 2 && x < next.start + frame / 2)) {
          add(c, "gap", "warning", `${r3(gap)} s before caption ${next.n}; a gap this short should close to ${std.min_gap_frames} frames.`);
        }
      }
    }

    // Shot changes (one finding per caption).
    if (c.end > c.start) {
      const tol = frame / 2;
      const minGap = std.min_gap_frames * frame;
      for (const cut of cuts) {
        if (c.start < cut - tol && c.end > cut + tol) {
          add(c, "shot_change", "warning", `Straddles the cut at ${r3(cut)} s.`);
          break;
        }
        // A caption that ends 2 frames before the cut never shows across it, so a close in-time is fine.
        if (c.start < cut - tol && c.start > cut - std.cut_zone_s + tol && c.end > cut - minGap + tol) {
          add(c, "shot_change", "warning", `In-time is ${r2(cut - c.start)} s before the cut at ${r3(cut)} s; put it on the cut or at least ${std.cut_zone_s} s before.`);
          break;
        }
        if (c.start < cut - tol && c.end > cut - minGap + tol && c.end <= cut + tol) {
          add(c, "shot_change", "warning", `Out-time is ${r2(cut - c.end)} s before the cut at ${r3(cut)} s; end it ${std.min_gap_frames} frames before the cut.`);
          break;
        }
      }
    }

    if (c.outside_safe || c.first_outside_safe !== undefined) {
      add(c, "safe_zone", "error", c.first_outside_safe !== undefined ? `Text runs outside the safe area (first at ${r3(c.first_outside_safe)} s).` : "Text runs outside the safe area.");
    } else if (opts.safe_area && c.text_box) {
      const a = opts.safe_area;
      const b = c.text_box;
      const tol = 0.5;
      const sides = [b.left < a.left - tol ? "left" : "", b.right > a.right + tol ? "right" : "", b.top < a.top - tol ? "top" : "", b.bottom > a.bottom + tol ? "bottom" : ""].filter(Boolean);
      if (sides.length) add(c, "safe_zone", "error", `The estimated text box runs outside the safe area (${sides.join(", ")}); this is an estimate, not a measurement.`);
    }
  });

  const counts: Record<string, number> = {};
  for (const i of all) counts[i.rule] = (counts[i.rule] ?? 0) + 1;
  const max = Math.min(Math.max(opts.max_issues ?? 200, 1), 500);
  return {
    standard: std.id,
    label: std.label,
    frame_rate: r3(fps),
    frame_rate_inferred: inferred,
    warnings,
    cues: cues.length,
    pass: !all.some((i) => i.severity === "error"),
    counts,
    issues: all.slice(0, max),
    truncated: all.length > max,
  };
}
