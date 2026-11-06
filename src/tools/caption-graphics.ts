/**
 * add_caption_graphics: Captioneer-style burned-in captions as MOGRT / Essential Graphics clips on a
 * video track, one clip per caption (or per word). The caption plan, the fit estimates and the
 * clip specs are built in Node (pure, exported for tests); the host work is chunked CEP scripts, each
 * followed by a separate readback call.
 *
 * Host claims are conservative. Premiere cannot measure rendered text, so every fit is an estimate;
 * a MOGRT text control cannot colour single words; importMGT, TrackItem.remove, ComponentParam
 * setColorValue and the MOGRT text JSON (fontSizeEditValue / capPropFontSizeEdit) are used as other
 * tools in this server use them, but each result stays committed_unverified until read back.
 */
import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, type BridgeOptions } from "../bridge/file-bridge.js";
import { CAPTION_PLAN_OPTION_PROPERTIES, PREMIERE_TICKS_PER_SECOND, type PlanCaption } from "../ai/caption-plan.js";
import type { CaptionPlan } from "../ai/caption-plan-types.js";
import {
  CAPTION_SAFE_AREAS,
  checkCaptionFit,
  defaultSafeArea,
  DESCENDER_SHARE,
  fitCaption,
  rebreakToLineLimit,
  safeBoxPx,
  type CaptionSafeAreaId,
  type FitMetrics,
} from "../ai/caption-fit.js";
import type { QaBox } from "../ai/caption-qa.js";
import { CAPTION_PLAN_INPUT_PROPERTIES, CAPTION_TRANSCRIPT_INPUT_PROPERTIES, resolveCaptionPlan } from "./caption-inputs.js";
import {
  CAPTION_CUT_SOURCE_PROPERTY,
  normalizeCutSource,
  readCaptionSequence,
  summarizeCaptionPlan,
  type CaptionSequenceInfo,
} from "./caption-host.js";
import { MOGRT_DURATION_HELPER } from "./text.js";
import { compareMogrtText, MOGRT_TEXT_WRITE_HELPER, type MogrtTextCheck } from "./mogrt-text.js";
import { preflightCaptionTemplate } from "./mogrt-controls.js";
import { validateMogrtArchive } from "./mogrt-validation.js";

export const MAX_CAPTION_GRAPHICS_CLIPS = 2000;
export const DEFAULT_CHUNK_SIZE = 25;
export const MAX_CHUNK_SIZE = 50;
/** Longest placed-clip list returned in full; the counts always cover every clip. */
export const MAX_REPORTED_CLIPS = 200;
/** Seconds past the plan's last caption that the overlap guard also covers: importMGT places the template's default length before it is trimmed. */
export const OVERLAP_GUARD_SECONDS = 10;
/** Start times above this lose tick precision as doubles. */
const MAX_START_SECONDS = 8 * 3600;

export const WORD_MODES = ["off", "single", "accumulate"] as const;
export const PLACEMENTS = ["template", "safe_bottom", "safe_middle", "safe_top"] as const;
export const FIT_MODES = ["both", "rebreak", "shrink", "none"] as const;
export type WordMode = (typeof WORD_MODES)[number];
export type Placement = (typeof PLACEMENTS)[number];
export type FitMode = (typeof FIT_MODES)[number];

export type TextFields = { line_fields: string[] } | { text_field: string };

export interface CaptionGraphicsOptions {
  mogrt_path: string;
  track_index: number;
  text_fields: TextFields;
  color_field?: string;
  name_prefix: string;
  word_mode: WordMode;
  safe_area?: CaptionSafeAreaId;
  placement: Placement;
  fit: FitMode;
  font_size_px?: number;
  char_width_ratio?: number;
  replace_existing: boolean;
  chunk_size: number;
}

export interface FrameInfo {
  width: number;
  height: number;
  /** Exact frames per second (ticks per second over ticks per frame). */
  exact_fps: number;
  frame_ticks: number;
}

export interface ClipSpec {
  /** 0-based position in the whole run. */
  index: number;
  caption_n: number;
  word_index?: number;
  start: number;
  end: number;
  start_ticks: number;
  end_ticks: number;
  name: string;
  lines: string[];
  fields: Array<{ name: string; text: string }>;
  color: string | null;
  /** Share of the template's text size (1 = unchanged). */
  scale: number;
  /** Motion position, normalised 0..1 (y down); null leaves the template's. */
  position: [number, number] | null;
}

export interface RefitEntry {
  n: number;
  word_index?: number;
  method: "estimated";
  action: string;
  scale: number;
  lines: string[];
  fits: boolean;
}

/** A caption whose lines were re-broken because the template has fewer line fields than the plan has lines. */
export interface RebreakEntry {
  n: number;
  reason: "template_line_fields";
  /** The template's line fields (the most lines it can show). */
  line_fields: number;
  from_lines: number;
  to_lines: number;
  lines: string[];
  /** True when the text needs a wider line than the safe width allows at this size (fit then shrinks it, or it is reported in refits / outside_safe). */
  exceeds_width: boolean;
}

export interface OutsideSafeEntry {
  n: number;
  reason: "too_wide" | "above_safe_area" | "below_safe_area";
}

function fail(message: string): never {
  throw new Error(message);
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function textFieldName(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200 || /[\u0000-\u001f]/.test(value)) fail(`${label} must be a non-empty MOGRT parameter display name of at most 200 characters`);
  return value;
}

/** Validates the tool arguments (not the plan inputs, which resolveCaptionPlan validates). Throws Error. */
export function parseGraphicsOptions(args: Record<string, unknown>): CaptionGraphicsOptions {
  if (typeof args.mogrt_path !== "string" || !args.mogrt_path.trim() || args.mogrt_path.length > 4096) fail("mogrt_path is required: the absolute path of a .mogrt file");
  if (!/\.mogrt$/i.test(args.mogrt_path)) fail("mogrt_path must end in .mogrt");
  if (!Number.isInteger(args.track_index) || (args.track_index as number) < 0) fail("track_index must be a non-negative integer (0-based video track index)");
  if (!isObject(args.text_fields)) fail("text_fields is required: { line_fields: [\"Line 1\", \"Line 2\"] } or { text_field: \"Text\" }");
  const tf = args.text_fields;
  const hasLines = tf.line_fields !== undefined;
  const hasText = tf.text_field !== undefined;
  if (hasLines === hasText) fail("text_fields needs exactly one of line_fields or text_field");
  for (const key of Object.keys(tf)) if (key !== "line_fields" && key !== "text_field") fail(`text_fields has an unknown field: ${key}`);
  let text_fields: TextFields;
  if (hasLines) {
    if (!Array.isArray(tf.line_fields) || tf.line_fields.length < 1 || tf.line_fields.length > 6) fail("text_fields.line_fields must list 1 to 6 field names");
    const names = tf.line_fields.map((n, i) => textFieldName(n, `text_fields.line_fields[${i}]`));
    if (new Set(names).size !== names.length) fail("text_fields.line_fields names must be unique");
    text_fields = { line_fields: names };
  } else {
    text_fields = { text_field: textFieldName(tf.text_field, "text_fields.text_field") };
  }
  const color_field = args.color_field === undefined ? undefined : textFieldName(args.color_field, "color_field");
  const prefix = args.name_prefix === undefined ? "Caption" : args.name_prefix;
  if (typeof prefix !== "string" || !prefix.trim() || prefix.length > 40 || prefix !== prefix.trim() || /[\u0000-\u001f]/.test(prefix)) fail("name_prefix must be 1 to 40 characters without leading or trailing spaces or control characters");
  const word_mode = (args.word_mode ?? "off") as WordMode;
  if (!WORD_MODES.includes(word_mode)) fail(`word_mode must be one of: ${WORD_MODES.join(", ")}`);
  const placement = (args.placement ?? "template") as Placement;
  if (!PLACEMENTS.includes(placement)) fail(`placement must be one of: ${PLACEMENTS.join(", ")}`);
  const fit = (args.fit ?? "both") as FitMode;
  if (!FIT_MODES.includes(fit)) fail(`fit must be one of: ${FIT_MODES.join(", ")}`);
  if (args.safe_area !== undefined && !Object.prototype.hasOwnProperty.call(CAPTION_SAFE_AREAS, String(args.safe_area))) fail(`safe_area must be one of: ${Object.keys(CAPTION_SAFE_AREAS).join(", ")}`);
  const finitePositive = (v: unknown, label: string, max: number) => {
    if (v === undefined) return undefined;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > max) fail(`${label} must be a number greater than 0 and at most ${max}`);
    return v;
  };
  const replace_existing = args.replace_existing === undefined ? true : args.replace_existing;
  if (typeof replace_existing !== "boolean") fail("replace_existing must be a boolean");
  const chunk_size = args.chunk_size === undefined ? DEFAULT_CHUNK_SIZE : args.chunk_size;
  if (!Number.isInteger(chunk_size) || (chunk_size as number) < 1 || (chunk_size as number) > MAX_CHUNK_SIZE) fail(`chunk_size must be an integer from 1 to ${MAX_CHUNK_SIZE}`);
  return {
    mogrt_path: args.mogrt_path,
    track_index: args.track_index as number,
    text_fields,
    ...(color_field !== undefined ? { color_field } : {}),
    name_prefix: prefix,
    word_mode,
    ...(args.safe_area !== undefined ? { safe_area: args.safe_area as CaptionSafeAreaId } : {}),
    placement,
    fit,
    ...(args.font_size_px !== undefined ? { font_size_px: finitePositive(args.font_size_px, "font_size_px", 2000) } : {}),
    ...(args.char_width_ratio !== undefined ? { char_width_ratio: finitePositive(args.char_width_ratio, "char_width_ratio", 3) } : {}),
    replace_existing,
    chunk_size: chunk_size as number,
  };
}

/** Maps a caption's lines onto the template's text fields. */
export function mapTextToFields(lines: string[], fields: TextFields): Array<{ name: string; text: string }> {
  if ("text_field" in fields) return [{ name: fields.text_field, text: lines.join("\r") }];
  const names = fields.line_fields;
  return names.map((name, index) => {
    if (index < names.length - 1) return { name, text: lines[index] ?? "" };
    return { name, text: lines.slice(index).join(" ") };
  });
}

export function parseHexColor(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * For each word of a caption, the index of the last text token it covers, or null when the words do
 * not line up with the displayed text (a label, hyphen or sound event is skipped as a prefix, trailing
 * tokens go to the last word).
 */
export function alignWordsToTokens(wordTexts: string[], tokens: string[]): number[] | null {
  const ends: number[] = [];
  let cursor = 0;
  for (const word of wordTexts) {
    const wn = norm(word);
    let found = -1;
    for (let j = cursor; j < Math.min(tokens.length, cursor + 4); j++) {
      const tn = norm(tokens[j]);
      const same = wn === "" ? tokens[j] === word : tn === wn || (wn.length > 2 && tn.includes(wn)) || (tn.length > 2 && wn.includes(tn));
      if (same) {
        found = j;
        break;
      }
    }
    if (found < 0) return null;
    ends.push(found);
    cursor = found + 1;
  }
  if (ends.length) ends[ends.length - 1] = tokens.length - 1;
  return ends;
}

/** The first `endToken + 1` tokens of the lines, kept in the lines' own breaks. */
export function linesUpToToken(lines: string[], endToken: number): string[] {
  let remaining = endToken + 1;
  const out: string[] = [];
  for (const line of lines) {
    if (remaining <= 0) break;
    const tokens = line.split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    out.push(tokens.slice(0, remaining).join(" "));
    remaining -= tokens.length;
  }
  return out;
}

interface Piece {
  caption: PlanCaption;
  word_index?: number;
  start_frame: number;
  end_frame: number;
  /** Text lines before fitting. */
  lines: string[];
}

/** One piece per caption (word_mode off), per word (single) or per growing text (accumulate). */
function piecesOf(plan: CaptionPlan, fps: number, mode: WordMode, finalLines: (c: PlanCaption) => string[], warnings: string[]): Piece[] {
  const pieces: Piece[] = [];
  let lostWords = 0;
  let unaligned = 0;
  for (const caption of plan.captions) {
    const startFrame = Math.round(caption.start * fps);
    let endFrame = Math.round(caption.end * fps);
    if (endFrame <= startFrame) endFrame = startFrame + 1;
    const lines = finalLines(caption);
    const words = caption.words;
    const wholeCaption = mode === "off" || caption.kind !== "speech" || words.length < 2;
    if (wholeCaption) {
      pieces.push({ caption, start_frame: startFrame, end_frame: endFrame, lines });
      continue;
    }
    const tokens = lines.join(" ").split(/\s+/).filter(Boolean);
    const ends = mode === "accumulate" ? alignWordsToTokens(words.map((w) => w.text), tokens) : [];
    if (ends === null) {
      unaligned++;
      pieces.push({ caption, start_frame: startFrame, end_frame: endFrame, lines });
      continue;
    }
    const kept: Array<{ w: number; f: number }> = [{ w: 0, f: startFrame }];
    for (let k = 1; k < words.length; k++) {
      const t = caption.highlight?.[k] ?? words[k].start;
      const f = Math.round(t * fps);
      if (f >= endFrame || f <= kept[kept.length - 1].f) {
        if (mode === "single") lostWords++;
        continue;
      }
      kept.push({ w: k, f });
    }
    kept.forEach((entry, j) => {
      const next = kept[j + 1];
      const isLast = j === kept.length - 1;
      let pieceLines: string[];
      if (mode === "single") pieceLines = [words[entry.w].text];
      else pieceLines = linesUpToToken(lines, isLast ? tokens.length - 1 : ends[entry.w]);
      pieces.push({ caption, word_index: entry.w, start_frame: entry.f, end_frame: next ? next.f : endFrame, lines: pieceLines });
    });
  }
  if (lostWords) warnings.push(`word_mode single: ${lostWords} word(s) were too short to hold a frame and were not shown as their own clip.`);
  if (unaligned) warnings.push(`word_mode accumulate: ${unaligned} caption(s) had words that did not line up with their text and are shown as one clip each.`);
  return pieces;
}

export interface BuiltClips {
  clips: ClipSpec[];
  refits: RefitEntry[];
  rebreaks: RebreakEntry[];
  /** The most lines a caption can have here: the plan's max_lines, or the template's line fields when fewer. */
  effective_max_lines: number;
  outside_safe: OutsideSafeEntry[];
  warnings: string[];
  font_size_px: number;
  safe_area: CaptionSafeAreaId;
}

/**
 * Turns a plan into clip specs: word mode expansion, estimated fit, text-to-field mapping, names,
 * frame-exact ticks and (for placement safe_*) the Motion position. Pure.
 */
export function buildGraphicsClips(plan: CaptionPlan, frame: FrameInfo, options: CaptionGraphicsOptions, fontSizePx: number): BuiltClips {
  const warnings: string[] = [];
  const area = options.safe_area ? CAPTION_SAFE_AREAS[options.safe_area] : defaultSafeArea(frame.width, frame.height);
  const box: QaBox = safeBoxPx(area, frame.width, frame.height);
  const metrics: FitMetrics = { font_size_px: fontSizePx, ...(options.char_width_ratio !== undefined ? { char_width_ratio: options.char_width_ratio } : {}) };
  const lineFields = "line_fields" in options.text_fields ? options.text_fields.line_fields.length : undefined;
  // A template with fewer line fields than the plan has lines can show only that many: lines are never joined into the last field.
  const maxLines = Math.max(lineFields === undefined ? plan.settings.max_lines : Math.min(plan.settings.max_lines, lineFields), 1);
  const refits: RefitEntry[] = [];
  const rebreaks: RebreakEntry[] = [];
  const outside: OutsideSafeEntry[] = [];
  const scaleByCaption = new Map<number, number>();
  const fitted = new Map<number, string[]>();

  // Caption-level fit (also drives accumulate, which keeps one stable layout for all of a caption's clips).
  for (const caption of plan.captions) {
    let lines = caption.lines;
    if (lineFields !== undefined && lines.length > lineFields && options.word_mode !== "single") {
      const r = rebreakToLineLimit(lines, lineFields, box, frame.width, metrics);
      rebreaks.push({ n: caption.n, reason: "template_line_fields", line_fields: lineFields, from_lines: lines.length, to_lines: r.lines.length, lines: r.lines, exceeds_width: r.exceeds_width });
      lines = r.lines;
    }
    if (options.fit === "none") {
      fitted.set(caption.n, lines);
      scaleByCaption.set(caption.n, 1);
      continue;
    }
    const result = fitCaption(lines, box, frame.width, metrics, { max_lines: lineFields === undefined ? Math.max(maxLines, lines.length) : maxLines, mode: options.fit });
    fitted.set(caption.n, result.lines);
    scaleByCaption.set(caption.n, result.scale);
    if (options.word_mode !== "single" && (result.action !== "none" || !result.fits)) {
      refits.push({ n: caption.n, method: "estimated", action: result.action, scale: result.scale, lines: result.lines, fits: result.fits });
    }
  }

  const pieces = piecesOf(plan, frame.exact_fps, options.word_mode, (c) => fitted.get(c.n) ?? c.lines, warnings);
  if (pieces.length > MAX_CAPTION_GRAPHICS_CLIPS) fail(`This plan makes ${pieces.length} clips; at most ${MAX_CAPTION_GRAPHICS_CLIPS} per call. Caption a part of the transcript at a time (from_s / to_s) and give each part its own name_prefix (for example "Caption A", "Caption B"): a later call with the same name_prefix removes the earlier part.`);
  const digits = Math.max(3, String(pieces.length).length);
  const outsideSeen = new Set<number>();
  const markOutside = (n: number, reason: OutsideSafeEntry["reason"]) => {
    if (outsideSeen.has(n)) return;
    outsideSeen.add(n);
    outside.push({ n, reason });
  };
  const clips: ClipSpec[] = pieces.map((piece, index) => {
    let lines = piece.lines;
    let scale = scaleByCaption.get(piece.caption.n) ?? 1;
    if (options.word_mode === "single" && piece.word_index !== undefined && (options.fit === "both" || options.fit === "shrink")) {
      const r = fitCaption(lines, box, frame.width, metrics, { max_lines: 1, mode: "shrink" });
      scale = r.scale;
      lines = r.lines;
      if (r.action !== "none" || !r.fits) refits.push({ n: piece.caption.n, word_index: piece.word_index, method: "estimated", action: r.action, scale: r.scale, lines: r.lines, fits: r.fits });
    }
    const shown: FitMetrics = { ...metrics, font_size_px: fontSizePx * scale };
    const check = checkCaptionFit(lines, box, frame.width, shown);
    let position: [number, number] | null = null;
    if (options.placement !== "template") {
      const height = lines.length * shown.font_size_px * (shown.line_height_ratio ?? 1.2);
      let centre: number;
      if (options.placement === "safe_bottom") centre = box.bottom - height / 2;
      else if (options.placement === "safe_top") centre = box.top + height / 2;
      else centre = (box.top + box.bottom) / 2;
      position = [0.5, centre / frame.height];
      const top = centre - height / 2;
      const bottom = centre + height / 2;
      if (top < box.top - 0.5) markOutside(piece.caption.n, "above_safe_area");
      else if (bottom > box.bottom + DESCENDER_SHARE * shown.font_size_px + 0.5) markOutside(piece.caption.n, "below_safe_area");
    }
    if (check.too_wide) markOutside(piece.caption.n, "too_wide");
    return {
      index,
      caption_n: piece.caption.n,
      ...(piece.word_index !== undefined ? { word_index: piece.word_index } : {}),
      start: piece.start_frame / frame.exact_fps,
      end: piece.end_frame / frame.exact_fps,
      start_ticks: piece.start_frame * frame.frame_ticks,
      end_ticks: piece.end_frame * frame.frame_ticks,
      name: `${options.name_prefix} ${String(index + 1).padStart(digits, "0")}`,
      lines,
      fields: mapTextToFields(lines, options.text_fields),
      color: piece.caption.color ?? null,
      scale,
      position,
    };
  });

  // Rounding to frames can leave a caption touching the next: trim, or refuse when nothing is left.
  for (let i = 0; i < clips.length - 1; i++) {
    const a = clips[i];
    const b = clips[i + 1];
    if (a.end_ticks > b.start_ticks) {
      a.end_ticks = b.start_ticks;
      a.end = b.start;
      if (a.end_ticks <= a.start_ticks) fail(`Captions ${a.caption_n} and ${b.caption_n} overlap after rounding to frames; nothing was changed. Re-plan with min_gap_frames or close_gaps_under.`);
    }
  }
  for (const clip of clips) {
    if (clip.start > MAX_START_SECONDS) fail(`A caption starts after ${MAX_START_SECONDS / 3600} hours; frame-exact ticks are not safe there. Caption a part of the sequence at a time.`);
    if (!Number.isSafeInteger(clip.start_ticks) || !Number.isSafeInteger(clip.end_ticks)) fail("A caption time is too large for exact tick arithmetic");
  }
  if (rebreaks.length) {
    const wide = rebreaks.filter((r) => r.exceeds_width).length;
    warnings.push(`${rebreaks.length} caption${rebreaks.length === 1 ? " was" : "s were"} re-broken into at most ${lineFields} line${lineFields === 1 ? "" : "s"}: the template has ${lineFields} line field${lineFields === 1 ? "" : "s"} and the plan up to ${plan.settings.max_lines} lines (see rebreaks).${wide ? ` ${wide} of them need${wide === 1 ? "s" : ""} a line wider than the safe area at this size: ${options.fit === "none" ? "fit is none, so they are listed in outside_safe" : "they were shrunk or listed in refits / outside_safe"}.` : ""}`);
  }
  return { clips, refits, rebreaks, effective_max_lines: maxLines, outside_safe: outside, warnings, font_size_px: fontSizePx, safe_area: area.id };
}

// ---------- host scripts ----------

const esc = escapeForExtendScript;

/** Names must be `<prefix> <digits>` (three or more digits) to count as this tool's earlier clips. */
const NAME_MATCH_FUNCTION = `
    function __isCaptionName(name, prefix) {
      if (name.length <= prefix.length || name.substring(0, prefix.length) !== prefix) return false;
      var rest = name.substring(prefix.length);
      return rest.length >= 3 && /^[0-9]+$/.test(rest);
    }
`;

/** Read-only: this tool's earlier clips and the other clips overlapping the plan's range, on one video track. */
export function buildGraphicsTrackInspectScript(trackIndex: number, namePrefix: string, rangeStart: number, rangeEnd: number): string {
  return buildToolScript(`
    ${NAME_MATCH_FUNCTION}
    var seq = app.project.activeSequence;
    if (!seq) return __error("No active sequence");
    var track = seq.videoTracks[${trackIndex}];
    if (!track) return __error("Video track ${trackIndex} does not exist");
    var prefix = "${esc(namePrefix)} ";
    var stale = [];
    var staleCount = 0;
    var others = [];
    var otherCount = 0;
    for (var c = 0; c < track.clips.numItems; c++) {
      var clip = track.clips[c];
      var name = String(clip.name);
      var startSeconds = null, endSeconds = null;
      try { startSeconds = __ticksToSeconds(clip.start.ticks); endSeconds = __ticksToSeconds(clip.end.ticks); } catch (rangeError) {}
      if (__isCaptionName(name, prefix)) {
        staleCount++;
        if (stale.length < 50) stale.push({ nodeId: String(clip.nodeId), name: name, startSeconds: startSeconds, endSeconds: endSeconds });
      } else if (startSeconds === null || endSeconds === null || (endSeconds > ${rangeStart} && startSeconds < ${rangeEnd})) {
        otherCount++;
        if (others.length < 100) others.push({ nodeId: String(clip.nodeId), name: name, startSeconds: startSeconds, endSeconds: endSeconds });
      }
    }
    return __result({
      trackIndex: ${trackIndex},
      locked: __isTrackLocked(track),
      clipCount: track.clips.numItems,
      staleCount: staleCount,
      stale: stale,
      overlapCount: otherCount,
      overlapping: others
    });
  `);
}

/** Removes every clip on the track named `<prefix> <digits>`; the readback is a separate inspect call. */
export function buildGraphicsRemoveScript(trackIndex: number, namePrefix: string): string {
  return buildToolScript(`
    ${NAME_MATCH_FUNCTION}
    var seq = app.project.activeSequence;
    if (!seq) return __error("No active sequence");
    var track = seq.videoTracks[${trackIndex}];
    if (!track) return __error("Video track ${trackIndex} does not exist");
    if (__isTrackLocked(track)) return __refuse("Video track ${trackIndex} is locked; nothing was removed.");
    var prefix = "${esc(namePrefix)} ";
    var removed = 0;
    var errors = [];
    for (var c = track.clips.numItems - 1; c >= 0; c--) {
      var clip = track.clips[c];
      if (!__isCaptionName(String(clip.name), prefix)) continue;
      try { clip.remove(false, false); removed++; }
      catch (removeError) { if (errors.length < 20) errors.push(String(clip.name) + ": " + String(removeError)); }
    }
    return __result({ trackIndex: ${trackIndex}, removeAttempted: removed, errors: errors });
  `);
}

function specLiteral(spec: ClipSpec, existing: string | null): string {
  const fields = spec.fields.map((f) => `{ n: "${esc(f.name)}", plain: "${esc(f.text)}", enc: "${esc(JSON.stringify(f.text))}" }`).join(", ");
  let color = "null";
  if (spec.color) {
    const rgb = parseHexColor(spec.color);
    if (rgb) color = `[255, ${rgb[0]}, ${rgb[1]}, ${rgb[2]}]`;
  }
  const pos = spec.position ? `[${spec.position[0]}, ${spec.position[1]}]` : "null";
  return `{ i: ${spec.index}, existing: ${existing ? `"${esc(existing)}"` : "null"}, startTicks: "${spec.start_ticks}", endTicks: "${spec.end_ticks}", name: "${esc(spec.name)}", fields: [${fields}], color: ${color}, scale: ${spec.scale}, pos: ${pos} }`;
}

/**
 * Places (or, for a spec with an existing node id, revises) one chunk of clips. Stops at the first
 * failure and reports what was done. Verification is a separate call.
 */
export function buildGraphicsPlaceScript(trackIndex: number, mogrtPath: string, colorField: string | undefined, specs: Array<{ spec: ClipSpec; existing: string | null }>): string {
  return buildToolScript(`
    ${MOGRT_TEXT_WRITE_HELPER}
    ${MOGRT_DURATION_HELPER}
    var seq = app.project.activeSequence;
    if (!seq) return __refuse("No active sequence");
    var trackIndex = ${trackIndex};
    var track = seq.videoTracks[trackIndex];
    if (!track) return __refuse("Video track " + trackIndex + " does not exist");
    if (__isTrackLocked(track)) return __refuse("Video track " + trackIndex + " is locked; nothing was placed.");
    var mogrtPath = "${esc(mogrtPath)}";
    var colorField = ${colorField === undefined ? "null" : `"${esc(colorField)}"`};
    var specs = [${specs.map((s) => specLiteral(s.spec, s.existing)).join(",\n      ")}];

    function __findOnTrack(nodeId) {
      for (var c = 0; c < track.clips.numItems; c++) if (String(track.clips[c].nodeId) === nodeId) return track.clips[c];
      return null;
    }
    function __findParam(comp, name) {
      for (var p = 0; p < comp.properties.numItems; p++) if (comp.properties[p].displayName === name) return comp.properties[p];
      return null;
    }
    function __fontSizeOf(comp, name) {
      var prop = __findParam(comp, name);
      if (!prop) return null;
      var text = null;
      try { text = prop.getValue(); } catch (readError) { return null; }
      var match = typeof text === "string" ? /"fontSizeEditValue"\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)/.exec(text) : null;
      return match ? parseFloat(match[1]) : null;
    }
    // Shrink by rewriting fontSizeEditValue where the control allows it (capPropFontSizeEdit true).
    function __shrinkFields(comp, fields, scale, expected) {
      var changed = 0;
      for (var f = 0; f < fields.length; f++) {
        var prop = __findParam(comp, fields[f].n);
        if (!prop) continue;
        var text = prop.getValue();
        if (typeof text !== "string" || !/"capPropFontSizeEdit"\\s*:\\s*true/.test(text)) continue;
        var match = /"fontSizeEditValue"\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)/.exec(text);
        if (!match) continue;
        var next = Math.round(parseFloat(match[1]) * scale * 100) / 100;
        prop.setValue(text.replace(/("fontSizeEditValue"\\s*:\\s*)[0-9]+(?:\\.[0-9]+)?/, function (whole, head) { return head + next; }), true);
        expected.push(next);
        changed++;
      }
      return changed;
    }
    function __motionOf(clip) {
      for (var i = 0; i < clip.components.numItems; i++) {
        var candidate = clip.components[i];
        if (candidate.matchName === "AE.ADBE Motion" || candidate.displayName === "Motion") return candidate;
      }
      return null;
    }

    var results = [];
    var failedAt = null;
    for (var s = 0; s < specs.length && failedAt === null; s++) {
      var spec = specs[s];
      var entry = { i: spec.i, ok: false };
      results.push(entry);
      var clip = null;
      var justImported = false;
      try {
        if (spec.existing) {
          clip = __findOnTrack(spec.existing);
          if (!clip) throw new Error("the clip to revise (" + spec.existing + ") is no longer on the track");
        } else {
          clip = seq.importMGT(mogrtPath, spec.startTicks, trackIndex, trackIndex);
          if (!clip) throw new Error("importMGT returned no clip");
          justImported = true;
        }
        entry.nodeId = String(clip.nodeId);
        if (justImported) {
          // Name it at once: a later failure must not leave a default-named clip that the overlap guard and replace_existing both ignore.
          clip.name = spec.name;
          try {
            var defaultStart = parseFloat(clip.start.ticks);
            var defaultEnd = parseFloat(clip.end.ticks);
            if (isFinite(defaultStart) && isFinite(defaultEnd) && defaultEnd > defaultStart) entry.defaultSeconds = __ticksToSeconds(defaultEnd - defaultStart);
          } catch (defaultError) {}
        }
        var comp = null;
        try { comp = clip.getMGTComponent ? clip.getMGTComponent() : null; } catch (mgtError) { comp = null; }
        if (!comp) throw new Error("the placed clip exposes no MGT component, so text could not be written");
        var written = [];
        for (var f = 0; f < spec.fields.length; f++) __mogrtWriteText(comp, written, spec.fields[f].n, spec.fields[f].plain, spec.fields[f].enc);
        var problems = [];
        for (var w = 0; w < written.length; w++) if (written[w].missing || written[w].setError) problems.push(written[w]);
        if (problems.length) { entry.textProblems = problems; throw new Error("text control missing or not writable: " + problems[0].displayName); }
        entry.fontSize = __fontSizeOf(comp, spec.fields[0].n);
        if (spec.scale < 1) {
          var expectedSizes = [];
          var changed = __shrinkFields(comp, spec.fields, spec.scale, expectedSizes);
          if (changed === spec.fields.length) { entry.shrink = "font_size"; entry.expectedFontSizes = expectedSizes; }
          else if (changed === 0) {
            var motion = __motionOf(clip);
            if (!motion) throw new Error("no Motion component to scale");
            var scaled = __setMotionScale(motion, Math.round(spec.scale * 10000) / 100);
            if (!scaled.ok) throw new Error(scaled.error);
            entry.shrink = "motion_scale";
          } else throw new Error("only " + changed + " of " + spec.fields.length + " text controls accept a font size; shrink was not applied evenly");
        }
        if (!spec.existing) {
          var durationSeconds = (parseFloat(spec.endTicks) - parseFloat(spec.startTicks)) / TICKS_PER_SECOND;
          var duration = __mogrtSetDuration(clip, trackIndex, durationSeconds);
          entry.duration = duration.status;
          if (duration.status === "blocked" || duration.status === "mismatch") throw new Error("duration not applied: " + (duration.error || duration.status));
          // The helper accepts an end within a whole frame; the readback needs half a frame, so land on the target.
          var frameTicksNow = seq.timebase ? parseFloat(seq.timebase) : NaN;
          if (!frameTicksNow || isNaN(frameTicksNow)) frameTicksNow = TICKS_PER_SECOND / 24;
          var targetEnd = parseFloat(spec.endTicks);
          var currentEnd = NaN;
          try { currentEnd = parseFloat(clip.end.ticks); } catch (endReadError) {}
          if (isFinite(currentEnd) && Math.abs(currentEnd - targetEnd) > frameTicksNow / 2) {
            try {
              var exactEnd = new Time();
              exactEnd.ticks = String(targetEnd);
              clip.end = exactEnd;
            } catch (exactError) {
              try { clip.end = String(targetEnd); } catch (exactError2) {}
            }
            var settledEnd = NaN;
            try { settledEnd = parseFloat(clip.end.ticks); } catch (settleReadError) {}
            if (isFinite(settledEnd) && Math.abs(settledEnd - targetEnd) > frameTicksNow / 2) { entry.duration = "mismatch"; throw new Error("clip end could not be set to the exact frame"); }
            entry.duration = "verified";
          }
        }
        if (spec.color && colorField) {
          var colorParam = __findParam(comp, colorField);
          if (!colorParam || typeof colorParam.setColorValue !== "function") throw new Error("colour control '" + colorField + "' not found or not a colour parameter");
          colorParam.setColorValue(spec.color[0], spec.color[1], spec.color[2], spec.color[3], true);
          entry.colorSet = true;
        }
        if (spec.pos) {
          var place = __motionOf(clip);
          var positionParam = null;
          if (place) for (var q = 0; q < place.properties.numItems; q++) if (__videoIntrinsicPropertyMatches(place.properties[q], "Position")) { positionParam = place.properties[q]; break; }
          if (!positionParam) throw new Error("Motion Position not found");
          positionParam.setValue(spec.pos, true);
          entry.positionSet = true;
        }
        entry.ok = true;
      } catch (placeError) {
        entry.error = String(placeError);
        failedAt = spec.i;
        if (justImported && clip) {
          // Take the half-built clip off the track again; a clip left behind would shadow a re-run.
          entry.orphan_removed = false;
          try {
            var orphanId = String(clip.nodeId);
            clip.remove(false, false);
            var stillThere = false;
            for (var oc = 0; oc < track.clips.numItems; oc++) if (String(track.clips[oc].nodeId) === orphanId) { stillThere = true; break; }
            if (!stillThere) { entry.orphan_removed = true; entry.removedNodeId = orphanId; delete entry.nodeId; }
          } catch (orphanError) { entry.orphanError = String(orphanError); }
        }
      }
    }
    return __result({ trackIndex: trackIndex, requested: specs.length, results: results, failedAt: failedAt });
  `);
}

export interface ReadbackItem {
  nodeId: string;
  fieldNames: string[];
}

/** Read-only: name, range, text controls, colour, Motion position and scale of placed clips. */
export function buildGraphicsReadbackScript(trackIndex: number, colorField: string | undefined, items: ReadbackItem[]): string {
  const list = items.map((it) => `{ nodeId: "${esc(it.nodeId)}", fields: [${it.fieldNames.map((n) => `"${esc(n)}"`).join(", ")}] }`).join(",\n      ");
  return buildToolScript(`
    var seq = app.project.activeSequence;
    if (!seq) return __error("No active sequence");
    var track = seq.videoTracks[${trackIndex}];
    if (!track) return __error("Video track ${trackIndex} does not exist");
    var colorField = ${colorField === undefined ? "null" : `"${esc(colorField)}"`};
    var items = [${list}];
    var out = [];
    for (var n = 0; n < items.length; n++) {
      var wanted = items[n];
      var clip = null;
      for (var c = 0; c < track.clips.numItems; c++) if (String(track.clips[c].nodeId) === wanted.nodeId) { clip = track.clips[c]; break; }
      var row = { nodeId: wanted.nodeId, found: !!clip };
      if (clip) {
        row.name = String(clip.name);
        try { row.startTicks = parseFloat(clip.start.ticks); row.endTicks = parseFloat(clip.end.ticks); } catch (rangeError) { row.rangeError = String(rangeError); }
        var comp = null;
        try { comp = clip.getMGTComponent ? clip.getMGTComponent() : null; } catch (mgtError) { comp = null; }
        row.parameters = [];
        row.fontSizes = [];
        if (comp) {
          for (var f = 0; f < wanted.fields.length; f++) {
            var param = null;
            for (var p = 0; p < comp.properties.numItems; p++) if (comp.properties[p].displayName === wanted.fields[f]) { param = comp.properties[p]; break; }
            if (!param) { row.parameters.push({ displayName: wanted.fields[f], missing: true }); row.fontSizes.push(null); continue; }
            try {
              var fieldValue = param.getValue();
              row.parameters.push({ displayName: wanted.fields[f], value: fieldValue });
              var sizeMatch = typeof fieldValue === "string" ? /"fontSizeEditValue"\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)/.exec(fieldValue) : null;
              row.fontSizes.push(sizeMatch ? parseFloat(sizeMatch[1]) : null);
            }
            catch (readError) { row.parameters.push({ displayName: wanted.fields[f], readbackError: String(readError) }); row.fontSizes.push(null); }
          }
          if (colorField) {
            for (var q = 0; q < comp.properties.numItems; q++) {
              if (comp.properties[q].displayName === colorField) { row.color = __readColorValue(comp.properties[q]); break; }
            }
          }
        }
        for (var m = 0; m < clip.components.numItems; m++) {
          var component = clip.components[m];
          if (component.matchName !== "AE.ADBE Motion" && component.displayName !== "Motion") continue;
          for (var k = 0; k < component.properties.numItems; k++) {
            var prop = component.properties[k];
            try {
              if (__videoIntrinsicPropertyMatches(prop, "Position")) row.position = prop.getValue();
              else if (__videoIntrinsicPropertyMatches(prop, "Scale") || __videoIntrinsicPropertyMatches(prop, "Scale Height")) row.motionScale = Number(prop.getValue());
            } catch (motionError) {}
          }
          break;
        }
      }
      out.push(row);
    }
    return __result({ trackIndex: ${trackIndex}, rows: out });
  `);
}

// ---------- readback evaluation ----------

export type ClipStatus = "verified" | "committed_unverified" | "mismatch";

export interface ClipCheck {
  status: ClipStatus;
  problems: string[];
  text_checks?: MogrtTextCheck[];
}

/** Compares one readback row with what was asked for. */
export function evaluateReadback(
  spec: ClipSpec,
  shrink: string | undefined,
  row: Record<string, unknown> | undefined,
  frameTicks: number,
  colorField: string | undefined,
  expectedFontSizes?: number[],
): ClipCheck {
  if (!row || row.found !== true) return { status: "mismatch", problems: ["the clip is not on the track"] };
  const problems: string[] = [];
  let unverified = false;
  if (row.name !== spec.name) problems.push(`name reads ${JSON.stringify(row.name)}`);
  const half = frameTicks / 2;
  if (typeof row.startTicks !== "number" || typeof row.endTicks !== "number") unverified = true;
  else {
    if (Math.abs(row.startTicks - spec.start_ticks) > half) problems.push(`start reads ${row.startTicks / PREMIERE_TICKS_PER_SECOND}s, wanted ${spec.start}s`);
    if (Math.abs(row.endTicks - spec.end_ticks) > half) problems.push(`end reads ${row.endTicks / PREMIERE_TICKS_PER_SECOND}s, wanted ${spec.end}s`);
  }
  const expected: Record<string, string> = {};
  for (const f of spec.fields) expected[f.name] = f.text;
  const parameters = Array.isArray(row.parameters) ? (row.parameters as Array<Record<string, unknown>>) : [];
  const textChecks = compareMogrtText(expected, parameters);
  for (const c of textChecks) {
    if (c.status === "mismatch") problems.push(`text field ${c.displayName} reads ${JSON.stringify(c.actual)}`);
    else if (c.status === "missing_property") problems.push(`text field ${c.displayName} is missing`);
    else if (c.status === "committed_unverified") unverified = true;
  }
  if (spec.color && colorField) {
    const rgb = parseHexColor(spec.color);
    const actual = row.color;
    if (!rgb || !Array.isArray(actual) || actual.length !== 4) unverified = true;
    else if ([1, 2, 3].some((i) => Math.abs(Number(actual[i]) - rgb[i - 1]) > 1)) problems.push(`colour reads ${JSON.stringify(actual)}, wanted ${spec.color}`);
  }
  if (spec.position) {
    const pos = row.position;
    if (!Array.isArray(pos) || pos.length < 2) unverified = true;
    else if (Math.abs(Number(pos[0]) - spec.position[0]) > 1e-3 || Math.abs(Number(pos[1]) - spec.position[1]) > 1e-3) problems.push(`position reads ${JSON.stringify(pos)}`);
  }
  if (shrink === "motion_scale") {
    if (typeof row.motionScale !== "number" || !Number.isFinite(row.motionScale)) unverified = true;
    else if (Math.abs(row.motionScale - spec.scale * 100) > 0.5) problems.push(`Motion scale reads ${row.motionScale}`);
  }
  if (shrink === "font_size") {
    const read = Array.isArray(row.fontSizes) ? (row.fontSizes as unknown[]) : [];
    if (!expectedFontSizes || expectedFontSizes.length !== spec.fields.length || read.length !== spec.fields.length) unverified = true;
    else {
      read.forEach((value, i) => {
        if (typeof value !== "number" || !Number.isFinite(value)) unverified = true;
        else if (Math.abs(value - expectedFontSizes[i]) > 0.05) problems.push(`font size of ${spec.fields[i].name} reads ${value}, wanted ${expectedFontSizes[i]}`);
      });
    }
  }
  const status: ClipStatus = problems.length ? "mismatch" : unverified ? "committed_unverified" : "verified";
  return { status, problems, text_checks: textChecks };
}

// ---------- the tool ----------

type HostRows = Array<Record<string, unknown>>;

interface PlacedRecord {
  n: number;
  word_index?: number;
  node_id: string;
  name: string;
  start: number;
  end: number;
  text: string;
  status: ClipStatus | "placed_not_read_back";
  problems?: string[];
  shrink?: string;
}

const HOST_LIMITATIONS = [
  "Premiere cannot measure rendered text: every fit, outside_safe and position result is an estimate from character counts (method \"estimated\"). Verify with export_sequence_review_frames or a short export.",
  "A MOGRT text control takes one colour: per-word highlight colour inside one text field is not possible. The closest are word_mode single or accumulate (one clip per word), or building the look in After Effects (for example with the chroma-ae MCP) and importing that MOGRT.",
  "importMGT may add a project item per call; those items are not tracked or removed (unverified).",
  "importMGT is called with the same index for the video and the audio track: a template that carries audio places it on the audio track with the same index as track_index. This tool does not move or remove that audio.",
  "Still-frame exports and previews can lag behind the timeline; a stale frame is not evidence the clips are missing.",
  "Text, name, timing, colour and Motion values are read back per chunk in a separate call; anything the host does not return is reported committed_unverified, never verified.",
] as const;

const chunksOf = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

export function getCaptionGraphicsTools(bridgeOptions: BridgeOptions) {
  return {
    add_caption_graphics: {
      description:
        "Burn captions into the timeline as MOGRT / Essential Graphics clips on an existing video track, one clip per caption (word_mode single or accumulate: one per word). Plans from a transcript or saved plan_path at the sequence's own frame rate, then removes this tool's earlier clips ('<name_prefix> 001', ... on that track; replace_existing true by default, read back before placing) and places clips in chunks of 25 (importMGT at the frame-rounded start, text written to the template's controls, duration trimmed, named, optional speaker colour through color_field, optional Motion position for safe_bottom / safe_middle / safe_top assuming the template's text is centred on the frame). Fit (rebreak and shrink) is ESTIMATED from character counts and a font size (font_size_px, else read from the first placed clip's text JSON fontSizeEditValue, else 6% of the frame short side with a warning); shrink rewrites fontSizeEditValue when capPropFontSizeEdit is true, else Motion Scale. Each chunk is read back in a separate call (name, start/end within half a frame, text values, colour): per clip verified, committed_unverified or mismatch; a failure or mismatch stops the run and reports what was placed, never a partial batch as success. Before anything is sent to Premiere the .mogrt is opened: a Premiere-built template (definition.json authorApp ppro) is refused, because Premiere does not expose its text to scripts (use an After Effects-built MOGRT), and every text_fields name and color_field must be a text or colour control of the template (the available names are listed when one is not). Captions are clamped to the sequence end (rule sequence_end in plan.sequence_end_changes). A template with fewer line fields than the plan has lines gets its captions re-broken to the field count (fit.rebreaks). Refuses when other clips on the track overlap the captions (use another track; add_track first if needed). expected_project_path is honoured: the server applies it to every CEP command automatically. Results can be committed_unverified. Text template convention: text_fields.line_fields [\"Line 1\", \"Line 2\"] (one line per field) or text_fields.text_field (lines joined with a carriage return). Per-word colour inside one text field has no Premiere equivalent; see host_limitations in the result.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          ...CAPTION_TRANSCRIPT_INPUT_PROPERTIES,
          ...CAPTION_PLAN_INPUT_PROPERTIES,
          ...CAPTION_PLAN_OPTION_PROPERTIES,
          mogrt_path: { type: "string", maxLength: 4096, description: "Absolute path of the caption .mogrt template (validated as a MOGRT archive before Premiere is contacted)." },
          track_index: { type: "integer", minimum: 0, description: "0-based video track the clips are placed on. It must exist (use add_track first). Other clips on it that overlap the captions make the call refuse." },
          text_fields: {
            type: "object",
            additionalProperties: false,
            description: "How lines map onto the template's text controls (display names). Give exactly one of line_fields or text_field.",
            properties: {
              line_fields: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", minLength: 1, maxLength: 200 }, description: "One field per line, for example [\"Line 1\", \"Line 2\"]. The most lines a caption can have is min(the plan's max_lines, the number of fields): a caption with more lines is re-broken from its text into that many (grammar-aware, listed in fit.rebreaks), never joined into the last field; unused fields get an empty string." },
              text_field: { type: "string", minLength: 1, maxLength: 200, description: "A single field for the whole caption; its lines are joined with a carriage return." },
            },
          },
          color_field: { type: "string", minLength: 1, maxLength: 200, description: "Display name of the template's colour control, set to the speaker colour (speaker_style color) with setColorValue and read back. Without it, speaker colours are not applied (a warning says so; use speaker_style label or hyphen)." },
          name_prefix: { type: "string", minLength: 1, maxLength: 40, description: "Clip names are '<name_prefix> 001', '<name_prefix> 002', ... Default 'Caption'. Earlier clips with exactly this name pattern on the track are the ones replaced, so captioning a long transcript in parts (from_s / to_s) needs a different name_prefix per part, for example 'Caption A', 'Caption B'." },
          word_mode: { type: "string", enum: [...WORD_MODES], description: "off (default): one clip per caption. single: one clip per word, from the word's highlight time (word start minus the highlight lead) to the next word's, the last to the caption end. accumulate: one clip per word showing the caption's words up to that word, in the caption's own line breaks." },
          safe_area: { type: "string", enum: Object.keys(CAPTION_SAFE_AREAS), description: "Safe area for the fit estimate and placement. Default reels_9_16 for a frame taller than wide, else landscape_16_9." },
          placement: { type: "string", enum: [...PLACEMENTS], description: "template (default): leave the template's position. safe_bottom, safe_middle, safe_top: set Motion Position so the estimated text box sits against that part of the safe area, assuming the template's text is centred on the frame." },
          fit: { type: "string", enum: [...FIT_MODES], description: "both (default): re-break lines, then shrink. rebreak, shrink, or none (report only). Estimated from character counts." },
          font_size_px: { type: "number", exclusiveMinimum: 0, maximum: 2000, description: "The template's text size in sequence pixels, for the fit estimate. Default: read from the first placed clip's text JSON (fontSizeEditValue), else 6% of the frame short side with a warning." },
          char_width_ratio: { type: "number", exclusiveMinimum: 0, maximum: 3, description: "Average glyph width as a share of the font size for the fit estimate. Default 0.55; a condensed face is nearer 0.45, a wide display face 0.65." },
          replace_existing: { type: "boolean", description: "Default true: remove this tool's earlier clips (names matching exactly '<name_prefix> NNN') on the track first and read back that none remain; clips with another prefix are left alone. false: refuse if any exist. A second part of a long transcript needs its own name_prefix, or it deletes the first part." },
          cut_source: CAPTION_CUT_SOURCE_PROPERTY,
          chunk_size: { type: "integer", minimum: 1, maximum: MAX_CHUNK_SIZE, description: `Clips placed per host call (default ${DEFAULT_CHUNK_SIZE}). At most ${MAX_CAPTION_GRAPHICS_CLIPS} clips per call; for more, caption parts with from_s / to_s and a different name_prefix for each part.` },
        },
        required: ["mogrt_path", "track_index", "text_fields"],
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          return await runAddCaptionGraphics(args, bridgeOptions);
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
  };
}

async function hostCall(script: string, bridgeOptions: BridgeOptions): Promise<{ ok: boolean; data: Record<string, unknown>; error?: string }> {
  const response = await sendCommand(script, bridgeOptions);
  const data = response && response.data && typeof response.data === "object" && !Array.isArray(response.data) ? (response.data as Record<string, unknown>) : {};
  return { ok: !!response && response.success === true, data, ...(response && response.error ? { error: response.error } : {}) };
}

async function runAddCaptionGraphics(args: Record<string, unknown>, bridgeOptions: BridgeOptions) {
  const options = parseGraphicsOptions(args);
  const cutSource = normalizeCutSource(args.cut_source);
  const archiveError = validateMogrtArchive(options.mogrt_path);
  if (archiveError) return { success: false, error: archiveError };
  // Before anything is sent to Premiere: a Premiere-built template, or a field name the template does not have.
  const templateProblem = preflightCaptionTemplate(options.mogrt_path, {
    textFields: "line_fields" in options.text_fields ? options.text_fields.line_fields : [options.text_fields.text_field],
    ...(options.color_field !== undefined ? { colorField: options.color_field } : {}),
  });
  if (templateProblem) return { success: false, error: templateProblem, data: { outcome: "not_applied", timelineChanged: false } };

  // 1. The sequence.
  const sequence: CaptionSequenceInfo = await readCaptionSequence(bridgeOptions, {
    include_edit_points: cutSource === "edit_points",
    exclude_video_track: options.track_index,
  });
  if (options.track_index >= sequence.video_track_count) {
    return { success: false, error: `Video track ${options.track_index} does not exist (the sequence has ${sequence.video_track_count}). Nothing was changed; call add_track first, then retry.` };
  }
  const frame: FrameInfo = { width: sequence.frame_width, height: sequence.frame_height, exact_fps: sequence.exact_fps, frame_ticks: sequence.timebase_ticks };

  // 2. The plan, at the sequence's frame rate.
  const resolved = resolveCaptionPlan(args, {
    frame_rate: sequence.fps,
    ...(sequence.duration_seconds !== null && sequence.duration_seconds > 0 ? { end_s: sequence.duration_seconds } : {}),
    ...(cutSource === "edit_points" && sequence.edit_points ? { cut_times: sequence.edit_points } : {}),
  });
  const plan = resolved.plan;
  if (plan.captions.length === 0) return { success: false, error: "The plan has no captions, so nothing was placed.", data: { plan: summarizeCaptionPlan(plan) } };
  const warnings = [...plan.warnings];
  const shortSide = Math.min(frame.width, frame.height);
  const provisional = buildGraphicsClips(plan, frame, options, options.font_size_px ?? 0.06 * shortSide);
  const rangeStart = provisional.clips[0].start;
  const rangeEnd = provisional.clips[provisional.clips.length - 1].end;
  if (plan.captions.some((c) => c.color) && !options.color_field) {
    warnings.push("The plan asks for speaker colours, but no color_field was given, so no colour was applied. Pass color_field (the template's colour control), or use speaker_style label or hyphen.");
  }
  if (sequence.edit_points_truncated) warnings.push("The sequence has more edit points than the host collected; later cuts were not used for snapping.");

  // 3. Look at the track: this tool's earlier clips and anything else in the way.
  const inspect = await hostCall(buildGraphicsTrackInspectScript(options.track_index, options.name_prefix, rangeStart, rangeEnd + OVERLAP_GUARD_SECONDS), bridgeOptions);
  if (!inspect.ok) return { success: false, error: `Could not inspect video track ${options.track_index}: ${inspect.error ?? "unknown error"}. Nothing was changed.` };
  if (inspect.data.locked === true) return { success: false, error: `Video track ${options.track_index} is locked; unlock it first. Nothing was changed.` };
  const overlapCount = Number(inspect.data.overlapCount ?? 0);
  if (overlapCount > 0) {
    return {
      success: false,
      error: `${overlapCount} other clip(s) on video track ${options.track_index} overlap the captions' time range (plus ${OVERLAP_GUARD_SECONDS} s for the template's default length); nothing was changed. Use another, empty track (add_track) and pass its track_index.`,
      data: { overlapping_clips: inspect.data.overlapping, range_seconds: [rangeStart, rangeEnd] },
    };
  }
  const staleCount = Number(inspect.data.staleCount ?? 0);
  let removedCount = 0;
  if (staleCount > 0) {
    if (!options.replace_existing) {
      return { success: false, error: `${staleCount} clip(s) named '${options.name_prefix} NNN' already exist on video track ${options.track_index}; pass replace_existing true to replace them or a different name_prefix. Nothing was changed.`, data: { existing: inspect.data.stale } };
    }
    const removal = await hostCall(buildGraphicsRemoveScript(options.track_index, options.name_prefix), bridgeOptions);
    if (!removal.ok) return { success: false, error: `Removing the earlier caption clips failed: ${removal.error ?? "unknown error"}. Inspect the track before retrying.`, data: { outcome: "unknown", removal: removal.data } };
    const after = await hostCall(buildGraphicsTrackInspectScript(options.track_index, options.name_prefix, rangeStart, rangeEnd + OVERLAP_GUARD_SECONDS), bridgeOptions);
    const remaining = Number(after.data.staleCount ?? NaN);
    if (!after.ok || !Number.isFinite(remaining)) {
      return { success: false, error: "Could not read the track back after removing the earlier caption clips, so nothing new was placed. Inspect the track before retrying.", data: { outcome: "unknown", removal: removal.data } };
    }
    if (remaining > 0) {
      return { success: false, error: `${remaining} earlier caption clip(s) are still on the track after removal; nothing new was placed (stale clips are never reused).`, data: { outcome: "partial_removal", removal: removal.data, remaining: after.data.stale } };
    }
    removedCount = staleCount;
  }

  // 4. The font size: caller's, else read from a probe clip (clip 1, revised afterwards).
  const chunkReports: Array<Record<string, unknown>> = [];
  const placed: PlacedRecord[] = [];
  const placedByIndex = new Map<number, string>();
  let fontSize = options.font_size_px;
  let fontSource: "caller" | "template_json" | "fallback" = "caller";
  let built = provisional;
  /** The template's default length (seconds) as importMGT placed it, before it was trimmed. */
  let defaultLengthSeconds: number | null = null;
  const noteDefaultLength = (row: Record<string, unknown> | undefined) => {
    if (defaultLengthSeconds === null && row && typeof row.defaultSeconds === "number" && Number.isFinite(row.defaultSeconds) && row.defaultSeconds > 0) defaultLengthSeconds = row.defaultSeconds;
  };
  const failRun = async (message: string, extra: Record<string, unknown>) => {
    let onTrack: number | null = null;
    try {
      const look = await hostCall(buildGraphicsTrackInspectScript(options.track_index, options.name_prefix, rangeStart, rangeEnd), bridgeOptions);
      if (look.ok) onTrack = Number(look.data.staleCount);
    } catch {
      onTrack = null;
    }
    return {
      success: false as const,
      error: message,
      data: {
        outcome: "partial",
        verified: false,
        removed_existing: removedCount,
        caption_clips_on_track: onTrack,
        placed: placed.slice(0, MAX_REPORTED_CLIPS),
        placed_count: placed.length,
        planned_clip_count: built.clips.length,
        chunks: chunkReports,
        advice: "Re-run with replace_existing true (the default) to clear these clips and start again; stale clips are never reused.",
        ...extra,
      },
    };
  };

  if (fontSize === undefined) {
    const probeSpec = provisional.clips[0];
    const probe = await hostCall(buildGraphicsPlaceScript(options.track_index, options.mogrt_path, options.color_field, [{ spec: { ...probeSpec, scale: 1, position: null, color: null }, existing: null }]), bridgeOptions);
    const row = (Array.isArray(probe.data.results) ? (probe.data.results as HostRows) : [])[0];
    chunkReports.push({
      chunk: 0,
      purpose: "font size probe (clip 1, revised in chunk 1)",
      ok: probe.ok && row?.ok === true,
      error: probe.ok ? row?.error : probe.error,
      ...(row && typeof row.orphan_removed === "boolean" ? { orphan_removed: row.orphan_removed } : {}),
    });
    noteDefaultLength(row);
    if (!probe.ok || !row || row.ok !== true) {
      if (row && typeof row.nodeId === "string") placedByIndex.set(0, row.nodeId);
      return failRun(`The first caption clip could not be placed: ${probe.ok ? String(row?.error ?? "unknown error") : probe.error}.`, {
        placed_probe: row ?? null,
        ...(row && typeof row.orphan_removed === "boolean" ? { orphan_removed: row.orphan_removed } : {}),
      });
    }
    placedByIndex.set(0, String(row.nodeId));
    if (typeof row.fontSize === "number" && Number.isFinite(row.fontSize) && row.fontSize > 0) {
      fontSize = row.fontSize;
      fontSource = "template_json";
    } else {
      fontSize = 0.06 * shortSide;
      fontSource = "fallback";
      warnings.push("The template's text size could not be read from its text JSON (no fontSizeEditValue), so the fit estimate assumes 6% of the frame's short side. Pass font_size_px for a better estimate.");
    }
  }
  built = buildGraphicsClips(plan, frame, options, fontSize);
  warnings.push(...built.warnings);

  // 5. Chunks: place, then read back in a separate call.
  const clips = built.clips;
  const colorField = options.color_field;
  const shrinkByIndex = new Map<number, string>();
  const checks: ClipCheck[] = [];
  const chunkList = chunksOf(clips, options.chunk_size);
  for (let ci = 0; ci < chunkList.length; ci++) {
    const chunk = chunkList[ci];
    // importMGT places the template's default length before it is trimmed: nothing foreign may start inside it.
    const chunkLastStart = chunk[chunk.length - 1].start;
    if (defaultLengthSeconds !== null && chunkLastStart + defaultLengthSeconds > rangeEnd + OVERLAP_GUARD_SECONDS) {
      const windowEnd = chunkLastStart + defaultLengthSeconds;
      const look = await hostCall(buildGraphicsTrackInspectScript(options.track_index, options.name_prefix, chunkLastStart, windowEnd), bridgeOptions);
      if (!look.ok) {
        return failRun(`Could not check video track ${options.track_index} before chunk ${ci + 1}: ${look.error ?? "unknown error"}. Stopped after ${placed.length} clip(s).`, {});
      }
      if (Number(look.data.overlapCount ?? 0) > 0) {
        return failRun(
          `Stopped before chunk ${ci + 1} of ${chunkList.length}: ${Number(look.data.overlapCount)} other clip(s) on video track ${options.track_index} start within the template's default length (${defaultLengthSeconds} s) after caption ${chunk[chunk.length - 1].index + 1}'s start, and importMGT would overwrite them. Move them, use another track, or caption a shorter part (from_s / to_s). Stopped after ${placed.length} clip(s).`,
          { overlapping_clips: look.data.overlapping, template_default_length_seconds: defaultLengthSeconds },
        );
      }
    }
    const place = await hostCall(
      buildGraphicsPlaceScript(options.track_index, options.mogrt_path, colorField, chunk.map((spec) => ({ spec, existing: placedByIndex.get(spec.index) ?? null }))),
      bridgeOptions,
    );
    const rows = Array.isArray(place.data.results) ? (place.data.results as HostRows) : [];
    const okRows: HostRows = [];
    for (const row of rows) {
      noteDefaultLength(row);
      if (row.ok === true && typeof row.nodeId === "string") {
        okRows.push(row);
        placedByIndex.set(Number(row.i), row.nodeId);
        if (typeof row.shrink === "string") shrinkByIndex.set(Number(row.i), row.shrink);
      } else if (typeof row.nodeId === "string") {
        placedByIndex.set(Number(row.i), row.nodeId);
      }
    }
    const failedRow = rows.find((row) => row.ok !== true);

    // Readback in its own call, for every clip the host created in this chunk (also a failed one).
    const toRead = rows.filter((row) => typeof row.nodeId === "string");
    const specByIndex = new Map(chunk.map((s) => [s.index, s]));
    let readRows: HostRows = [];
    let readbackError: string | undefined;
    if (toRead.length) {
      const back = await hostCall(buildGraphicsReadbackScript(options.track_index, colorField, toRead.map((row) => ({ nodeId: String(row.nodeId), fieldNames: specByIndex.get(Number(row.i))!.fields.map((f) => f.name) }))), bridgeOptions);
      if (back.ok && Array.isArray(back.data.rows)) readRows = back.data.rows as HostRows;
      else readbackError = back.error ?? "the readback returned no rows";
    }
    let verified = 0;
    let unverified = 0;
    let mismatch = 0;
    for (const row of toRead) {
      const spec = specByIndex.get(Number(row.i))!;
      const nodeId = String(row.nodeId);
      const readRow = readRows.find((r) => r.nodeId === nodeId);
      const check: ClipCheck = readbackError
        ? { status: "committed_unverified", problems: [`readback unavailable: ${readbackError}`] }
        : evaluateReadback(
          spec,
          typeof row.shrink === "string" ? row.shrink : undefined,
          readRow,
          frame.frame_ticks,
          colorField,
          Array.isArray(row.expectedFontSizes) ? (row.expectedFontSizes as unknown[]).map(Number) : undefined,
        );
      const isFailedRow = row.ok !== true;
      const status: ClipStatus = isFailedRow ? "mismatch" : check.status;
      if (status === "verified") verified++;
      else if (status === "committed_unverified") unverified++;
      else mismatch++;
      checks.push({ ...check, status });
      placed.push({
        n: spec.caption_n,
        ...(spec.word_index !== undefined ? { word_index: spec.word_index } : {}),
        node_id: nodeId,
        name: spec.name,
        start: spec.start,
        end: spec.end,
        text: spec.lines.join(" "),
        status,
        ...(check.problems.length || isFailedRow ? { problems: isFailedRow ? [String(row.error ?? "placement failed"), ...check.problems] : check.problems } : {}),
        ...(typeof row.shrink === "string" ? { shrink: row.shrink } : {}),
      });
    }
    chunkReports.push({
      chunk: ci + 1,
      clips: chunk.length,
      first_index: chunk[0].index + 1,
      placed_ok: okRows.length,
      verified,
      committed_unverified: unverified,
      mismatch,
      ...(failedRow
        ? {
            failed_at_clip: Number(failedRow.i) + 1,
            error: String(failedRow.error ?? "unknown error"),
            ...(typeof failedRow.orphan_removed === "boolean" ? { orphan_removed: failedRow.orphan_removed } : {}),
          }
        : {}),
      ...(readbackError ? { readback_error: readbackError } : {}),
    });
    if (!place.ok) {
      return failRun(`Placing chunk ${ci + 1} of ${chunkList.length} failed: ${place.error ?? "unknown error"}. Stopped; ${placed.length} of ${clips.length} clips were read back.`, {});
    }
    if (failedRow) {
      const orphanNote = failedRow.orphan_removed === true ? " The half-placed clip was removed again (orphan_removed true)." : failedRow.orphan_removed === false ? " The half-placed clip could NOT be removed (orphan_removed false); it is on the track under its final name and the next run replaces it." : "";
      return failRun(`Clip ${Number(failedRow.i) + 1} of ${clips.length} could not be placed: ${String(failedRow.error)}. Stopped after ${placed.length} clip(s).${orphanNote}`, {
        ...(typeof failedRow.orphan_removed === "boolean" ? { orphan_removed: failedRow.orphan_removed } : {}),
      });
    }
    if (mismatch > 0) {
      return failRun(`${mismatch} clip(s) in chunk ${ci + 1} did not read back as written. Stopped after ${placed.length} clip(s); inspect them before retrying.`, {});
    }
  }

  // 6. The receipt.
  const verifiedCount = checks.filter((c) => c.status === "verified").length;
  const unverifiedCount = checks.filter((c) => c.status === "committed_unverified").length;
  const outcome = unverifiedCount === 0 ? "verified" : "committed_unverified";
  if (outcome !== "verified") warnings.push(`${unverifiedCount} clip(s) could not be fully read back; inspect them in the timeline or with a short export.`);
  if (fontSource === "template_json" && options.font_size_px === undefined) warnings.push(`The fit estimate used ${fontSize} px, read from the template's text JSON; confirm that is in sequence pixels.`);
  if (colorField && !plan.captions.some((c) => c.color)) warnings.push("color_field was given but the plan has no speaker colours (use speaker_style color), so no colour was set.");
  if (options.placement !== "template") warnings.push("Placement assumes the template's text is centred on the frame at Motion Position 0.5, 0.5; a template with an offset anchor will land elsewhere.");
  const shrinkMethods: Record<string, number> = {};
  for (const method of shrinkByIndex.values()) shrinkMethods[method] = (shrinkMethods[method] ?? 0) + 1;
  return {
    success: true,
    data: {
      outcome,
      verified: outcome === "verified",
      sequence: { id: sequence.sequence_id, name: sequence.name, fps: sequence.fps, frame_width: frame.width, frame_height: frame.height, cut_source: cutSource, edit_point_count: sequence.edit_points?.length ?? null },
      track_index: options.track_index,
      plan: summarizeCaptionPlan(plan),
      removed_existing: removedCount,
      clip_count: clips.length,
      verified_count: verifiedCount,
      committed_unverified_count: unverifiedCount,
      mismatch_count: 0,
      placed: placed.slice(0, MAX_REPORTED_CLIPS),
      placed_truncated: placed.length > MAX_REPORTED_CLIPS,
      chunks: chunkReports,
      fit: {
        method: "estimated",
        mode: options.fit,
        safe_area: built.safe_area,
        placement: options.placement,
        font_size_px: fontSize,
        font_size_source: fontSource,
        char_width_ratio: options.char_width_ratio ?? null,
        effective_max_lines: built.effective_max_lines,
        rebreak_count: built.rebreaks.length,
        rebreaks: built.rebreaks.slice(0, MAX_REPORTED_CLIPS),
        refit_count: built.refits.length,
        refits: built.refits.slice(0, MAX_REPORTED_CLIPS),
        shrink_methods: shrinkMethods,
        outside_safe: built.outside_safe.slice(0, MAX_REPORTED_CLIPS),
        outside_safe_count: built.outside_safe.length,
      },
      warnings,
      host_limitations: [...HOST_LIMITATIONS],
    },
  };
}
