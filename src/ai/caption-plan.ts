/**
 * src/ai/caption-plan.ts
 *
 * The caption planner: transcript segments in, a frame-timed, line-broken caption plan out.
 * One set of options (CAPTION_PLAN_OPTION_PROPERTIES) is shared by every caption tool: a
 * standard preset, shot changes, transcript clean-up, social chunking, speakers and SDH.
 * Words are grouped at a speaker change, a pause, a sentence end once the caption has some
 * length, or when the line, line-count or duration limits would be broken; each caption is
 * line-broken, held for its minimum length and rounded to whole frames without overlapping
 * the next. With a `standard` its limits become the defaults and violations are fixed (see
 * caption-rules.ts). Pure: nothing here touches Premiere or the file system.
 */
import { createHash } from "node:crypto";
import { cleanupWords, Out, SENTENCE_END_RE, type CleanWord } from "./caption-cleanup.js";
import type {
  CaptionKind,
  CaptionPlan,
  CaptionPlanOptions,
  CaptionTranscriptSegment,
  CaptionTranscriptWord,
  CleanupOptions,
  CleanupReport,
  PlanCaption,
  PlanChange,
  PlanSettings,
  PlanViolation,
  SdhOptions,
} from "./caption-plan-types.js";
import {
  closeGaps,
  cutOutTimes,
  enforceGaps,
  exactFrameRate,
  findViolations,
  fitSoundCaptions,
  mergePass,
  recordExtensions,
  Rec,
  settleEnds,
  snapInTimes,
  splitAtCuts,
  splitPass,
  type RuleSettings,
  type WorkCap,
} from "./caption-rules.js";
import { breakPenalty, CAPTION_STANDARD_IDS, CAPTION_STANDARDS, properNounRuns, SPEAKER_COLORS } from "./caption-standards.js";
import { CaptionTranscriptError, timedWords } from "./caption-transcript.js";

export type {
  Caption,
  CaptionKind,
  CaptionPlan,
  CaptionPlanOptions,
  CaptionTranscriptFormat,
  CaptionTranscriptSegment,
  CaptionTranscriptWord,
  CleanupOptions,
  CleanupReport,
  PlanCaption,
  PlanChange,
  PlanSettings,
  PlanViolation,
  SdhOptions,
  SpeakerStyle,
} from "./caption-plan-types.js";
export { CaptionTranscriptError, detectFormat, parseCaptionTranscript, segmentsFromWordTimeline } from "./caption-transcript.js";

type TranscriptSegment = CaptionTranscriptSegment;
type TranscriptWord = CaptionTranscriptWord;

// ---------- Premiere frame rates ----------

/** Premiere's time base: ticks per second. */
export const PREMIERE_TICKS_PER_SECOND = 254016000000;

const COMMON_RATES = [24, 25, 30, 50, 60];

/**
 * Frame rate from Premiere's ticks per frame (Sequence timebase). Snaps to a common rate within 0.01:
 * 24, 25, 30, 50, 60, and the NTSC rates as their exact rationals (24000/1001, 30000/1001, 60000/1001,
 * shown as 23.976, 29.97, 59.94). Else the exact value.
 */
export function frameRateFromTimebaseTicks(ticksPerFrame: number | string): number {
  const ticks = typeof ticksPerFrame === "string" ? Number(ticksPerFrame.trim()) : ticksPerFrame;
  if (typeof ticks !== "number" || !Number.isFinite(ticks) || ticks <= 0) throw new Error("ticksPerFrame must be a positive number of ticks per frame");
  const fps = PREMIERE_TICKS_PER_SECOND / ticks;
  const ntsc = exactFrameRate(fps);
  if (ntsc !== fps) return ntsc;
  for (const rate of COMMON_RATES) if (Math.abs(fps - rate) <= 0.01) return rate;
  return fps;
}

// ---------- options ----------

const HEX_COLOR_PATTERN = "^#[0-9a-fA-F]{6}$";

const CLEANUP_PROPERTIES = {
  drop_after_s: { type: "number", minimum: 0, description: "Drop words that start at or after this time (seconds, transcript time): speech recognition often invents words in trailing silence or music. Give the audio's end." },
  drop_music_tokens: { type: "boolean", description: "Drop words that are only music notes, the replacement character or other symbol-only tokens. Default true." },
  min_word_s: { type: "number", minimum: 0, maximum: 0.5, description: "Drop words shorter than this (seconds); recognisers leave near-zero spans where they guessed. Default 0.05; 0 keeps all." },
  remove_fillers: { type: "boolean", description: "Remove filler words (um, uh, erm, er, ah, hmm, mm, mhm). Default false." },
  filler_words: { type: "array", maxItems: 100, items: { type: "string", minLength: 1, maxLength: 30 }, description: "Your own filler list instead of the default." },
  remove_stutters: { type: "boolean", description: "Collapse stutters and repeats ('I- I', 'the the', 'the, the') into one word. Default false." },
  glossary: {
    type: "array",
    maxItems: 500,
    description: "Whole-word find and replace, in order (brand names, spellings the transcript gets wrong). A phrase may span words.",
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        find: { type: "string", minLength: 1, maxLength: 100, description: "Word or phrase to find." },
        replace: { type: "string", maxLength: 100, description: "Replacement text; empty removes the match." },
        case_sensitive: { type: "boolean", description: "Match case exactly. Default false." },
      },
      required: ["find", "replace"],
    },
  },
  case: { type: "string", enum: ["as_is", "upper", "sentence"], description: "Case of the caption text. Default as_is." },
  strip_punctuation: { type: "boolean", description: "Remove punctuation from the caption text (apostrophes inside words stay). Sentence ends are still used for grouping. Default false." },
} as const;

/** JSON Schema `properties` for every planner option, shared by the caption tools. */
export const CAPTION_PLAN_OPTION_PROPERTIES = {
  standard: {
    type: "string",
    enum: [...CAPTION_STANDARD_IDS],
    description:
      "A caption standard: netflix_adult (20 cps, 42 cpl, 2 lines, 5/6 s to 7 s, 2-frame gaps), netflix_kids (17 cps), bbc (180 wpm, 0.33 s per word, 37 cpl), dcmp (32 cpl, 40 frames to 6 s), social_9x16 (25 cpl, 3 lines). " +
      "Sets the defaults for line length, lines, durations, gaps and linger (explicit fields still win) and turns on fixing: out-times extend into the gap, then short captions merge, then long ones split. The result lists every change and any violation left.",
  },
  fix: { type: "boolean", description: "With a standard: fix what breaks it (default true). false only reports violations." },
  frame_rate: { type: "number", exclusiveMinimum: 0, maximum: 240, description: "Frames per second of the sequence; every caption time is rounded to whole frames of this rate. Premiere sequences report it (or convert Sequence timebase ticks with 254016000000 ticks per second). Default 30, with a warning." },
  max_chars_per_line: { type: "integer", minimum: 8, maximum: 80, description: "Characters per line, default 32 (about 20 suits 9:16). Counted, not measured: a proportional font can run wider." },
  max_lines: { type: "integer", minimum: 1, maximum: 4, description: "Lines per caption, default 2. A caption is split when its words would need more." },
  min_duration: { type: "number", minimum: 0.1, maximum: 5, description: "Seconds a caption stays up at least (up to the next caption), default 1." },
  max_duration: { type: "number", minimum: 1, maximum: 15, description: "A caption is split when it would run longer than this, default 6." },
  linger: { type: "number", minimum: 0, maximum: 2, description: "Seconds a caption stays after its last word (up to the next caption), default 0.25." },
  pause_break: { type: "number", minimum: 0.1, maximum: 5, description: "A pause between words longer than this starts a new caption, default 0.7." },
  offset: { type: "number", description: "Seconds added to every transcript time, for example the clip's start on the sequence (captions must not start before 0)." },
  from_s: { type: "number", minimum: 0, description: "Only transcript words that overlap this time and later (before offset). A word or cue that straddles the bound is clipped, not dropped. Use the clip in-point (transcribe_audio audible_source_range) or a long transcript captioned in several calls." },
  to_s: { type: "number", minimum: 0, description: "Only transcript words that overlap times before this (before offset). A word or cue that straddles the bound is clipped, not dropped. Use the clip out-point so captions do not land on later shots." },
  min_gap_frames: { type: "integer", minimum: 0, maximum: 12, description: "Frames between captions at least. Default 2 with a standard, else 0." },
  close_gaps_under: { type: "number", minimum: 0, maximum: 2, description: "Seconds: a gap shorter than this (and longer than the minimum) closes to min_gap_frames. Default the standard's (0.5 s), else off." },
  cut_times: {
    type: "array",
    maxItems: 5000,
    items: { type: "number", minimum: 0 },
    description:
      "Shot changes in sequence seconds (not source time). Get them from detect_scene_edits / scene_edit_detection or from the sequence's edit points. Captions do not straddle a cut: an in-time moves onto the cut or at least 0.5 s before it, an out-time to 2 frames before it or at least 0.5 s after.",
  },
  cleanup: { type: "object", additionalProperties: false, properties: CLEANUP_PROPERTIES, description: "Transcript clean-up before captions are made. The result's `cleanup` counts what changed." },
  max_words: { type: "integer", minimum: 1, maximum: 30, description: "Words per caption at most (social chunking)." },
  single_word: { type: "boolean", description: "One word per caption (social style): a word shorter than 8 frames merges into the next, and a number with its unit or a first name with a surname stays together." },
  highlight_lead_frames: { type: "integer", minimum: 0, maximum: 6, description: "The highlighted word switches this many frames before the voice (reads as in sync). Default 1." },
  speaker_style: {
    type: "string",
    enum: ["none", "color", "hyphen", "label"],
    description: "How a speaker change shows: color (BBC order white, yellow, cyan, green per speaker), hyphen (two speakers in one caption, each line starting '- '), label ('NAME: ' at each change). Default none.",
  },
  speaker_colors: { type: "array", minItems: 1, maxItems: 16, items: { type: "string", pattern: HEX_COLOR_PATTERN }, description: "Colours (#RRGGBB) per speaker in order of first appearance instead of the BBC order." },
  speaker_names: { type: "object", additionalProperties: { type: "string", maxLength: 60 }, description: 'Display names for speaker ids (e.g. {"speaker_0": "ANNA"}), for labels.' },
  end_s: { type: "number", exclusiveMinimum: 0, description: "Where the sequence (or media) ends, in sequence seconds (after offset). No caption ends past it, a caption that would start at or after it is dropped, and a sound or linger extension never passes it; each is listed in changes with rule sequence_end. A transcript that states its media duration (Whisper, ElevenLabs) also clamps to that duration plus offset. create_caption_track import_plan and add_caption_graphics clamp to the sequence's own end." },
  accessibility: { type: "boolean", description: "Never use colour as the only cue: with speaker_style color, a label is added at each speaker change too. Default false." },
  sdh: {
    type: "object",
    additionalProperties: false,
    description: "Subtitles for the deaf and hard of hearing: sound events and lyrics.",
    properties: {
      sound_events: { type: "boolean", description: "Keep sound events (ElevenLabs audio_event entries, or words in square brackets) as their own captions in [lower-case brackets]. Default true." },
      lyric_ranges: {
        type: "array",
        maxItems: 200,
        description: "Sung passages (transcript time): their captions are marked lyric (italic, wrapped in music notes).",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            start: { type: "number", minimum: 0, description: "Start of the sung passage in transcript seconds." },
            end: { type: "number", minimum: 0, description: "End of the sung passage in transcript seconds; must be after start." },
          },
          required: ["start", "end"],
        },
      },
    },
  },
} as const;

export const CAPTION_PLAN_OPTION_KEYS: readonly string[] = Object.keys(CAPTION_PLAN_OPTION_PROPERTIES);

function fail(message: string): never {
  throw new Error(message);
}

type Present = Record<string, unknown>;
const has = (o: Present, k: string) => o[k] !== undefined && o[k] !== null;

function numberField(o: Present, key: string, label: string, min: number, max: number, opts: { int?: boolean; exclusiveMin?: boolean } = {}): number | undefined {
  if (!has(o, key)) return undefined;
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`${label} must be a finite number`);
  if (opts.int && !Number.isInteger(v)) fail(`${label} must be an integer`);
  if (opts.exclusiveMin ? v <= min : v < min) fail(`${label} must be ${opts.exclusiveMin ? "greater than" : "at least"} ${min}`);
  if (v > max) fail(`${label} must be at most ${max}`);
  return v;
}

function boolField(o: Present, key: string, label: string): boolean | undefined {
  if (!has(o, key)) return undefined;
  if (typeof o[key] !== "boolean") fail(`${label} must be true or false`);
  return o[key] as boolean;
}

function enumField<T extends string>(o: Present, key: string, label: string, values: readonly T[]): T | undefined {
  if (!has(o, key)) return undefined;
  const v = o[key];
  if (typeof v !== "string" || !(values as readonly string[]).includes(v)) fail(`${label} must be one of ${values.join(", ")}`);
  return v as T;
}

function objectField(o: Present, key: string, label: string): Present | undefined {
  if (!has(o, key)) return undefined;
  const v = o[key];
  if (typeof v !== "object" || Array.isArray(v)) fail(`${label} must be an object`);
  return v as Present;
}

function arrayField(o: Present, key: string, label: string, min: number, max: number): unknown[] | undefined {
  if (!has(o, key)) return undefined;
  const v = o[key];
  if (!Array.isArray(v)) fail(`${label} must be an array`);
  if (v.length < min || v.length > max) fail(`${label} must hold between ${min} and ${max} entries`);
  return v;
}

function normalizeCleanup(raw: Present): CleanupOptions {
  const out: CleanupOptions = {};
  const L = "cleanup";
  const dropAfter = numberField(raw, "drop_after_s", `${L}.drop_after_s`, 0, Infinity);
  if (dropAfter !== undefined) out.drop_after_s = dropAfter;
  const music = boolField(raw, "drop_music_tokens", `${L}.drop_music_tokens`);
  if (music !== undefined) out.drop_music_tokens = music;
  const minWord = numberField(raw, "min_word_s", `${L}.min_word_s`, 0, 0.5);
  if (minWord !== undefined) out.min_word_s = minWord;
  const fillers = boolField(raw, "remove_fillers", `${L}.remove_fillers`);
  if (fillers !== undefined) out.remove_fillers = fillers;
  const words = arrayField(raw, "filler_words", `${L}.filler_words`, 0, 100);
  if (words) {
    out.filler_words = words.map((s, i) => {
      if (typeof s !== "string" || s.length < 1 || s.length > 30) fail(`${L}.filler_words[${i}] must be a string of 1 to 30 characters`);
      return s;
    });
  }
  const stutters = boolField(raw, "remove_stutters", `${L}.remove_stutters`);
  if (stutters !== undefined) out.remove_stutters = stutters;
  const glossary = arrayField(raw, "glossary", `${L}.glossary`, 0, 500);
  if (glossary) {
    out.glossary = glossary.map((g, i) => {
      const label = `${L}.glossary[${i}]`;
      if (!g || typeof g !== "object" || Array.isArray(g)) fail(`${label} must be an object`);
      const e = g as Present;
      if (typeof e.find !== "string" || e.find.length < 1 || e.find.length > 100) fail(`${label}.find must be a string of 1 to 100 characters`);
      if (typeof e.replace !== "string" || e.replace.length > 100) fail(`${label}.replace must be a string of at most 100 characters`);
      const cs = boolField(e, "case_sensitive", `${label}.case_sensitive`);
      return { find: e.find, replace: e.replace, ...(cs !== undefined ? { case_sensitive: cs } : {}) };
    });
  }
  const kase = enumField(raw, "case", `${L}.case`, ["as_is", "upper", "sentence"] as const);
  if (kase) out.case = kase;
  const strip = boolField(raw, "strip_punctuation", `${L}.strip_punctuation`);
  if (strip !== undefined) out.strip_punctuation = strip;
  return out;
}

/**
 * Validates the planner options out of a tool call's arguments. Unknown keys are ignored (callers pass
 * the full tool arguments); null counts as absent. Throws Error with a clear message on a bad value.
 */
export function normalizeCaptionPlanOptions(raw: Record<string, unknown>): CaptionPlanOptions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("caption options must be an object");
  const out: CaptionPlanOptions = {};
  const standard = enumField(raw, "standard", "standard", CAPTION_STANDARD_IDS);
  if (standard) out.standard = standard;
  const fix = boolField(raw, "fix", "fix");
  if (fix !== undefined) out.fix = fix;
  const fps = numberField(raw, "frame_rate", "frame_rate", 0, 240, { exclusiveMin: true });
  if (fps !== undefined) out.frame_rate = fps;
  const mcpl = numberField(raw, "max_chars_per_line", "max_chars_per_line", 8, 80, { int: true });
  if (mcpl !== undefined) out.max_chars_per_line = mcpl;
  const ml = numberField(raw, "max_lines", "max_lines", 1, 4, { int: true });
  if (ml !== undefined) out.max_lines = ml;
  const minD = numberField(raw, "min_duration", "min_duration", 0.1, 5);
  if (minD !== undefined) out.min_duration = minD;
  const maxD = numberField(raw, "max_duration", "max_duration", 1, 15);
  if (maxD !== undefined) out.max_duration = maxD;
  const linger = numberField(raw, "linger", "linger", 0, 2);
  if (linger !== undefined) out.linger = linger;
  const pause = numberField(raw, "pause_break", "pause_break", 0.1, 5);
  if (pause !== undefined) out.pause_break = pause;
  const offset = numberField(raw, "offset", "offset", -Infinity, Infinity);
  if (offset !== undefined) out.offset = offset;
  const from = numberField(raw, "from_s", "from_s", 0, Infinity);
  if (from !== undefined) out.from_s = from;
  const to = numberField(raw, "to_s", "to_s", 0, Infinity);
  if (to !== undefined) out.to_s = to;
  const gap = numberField(raw, "min_gap_frames", "min_gap_frames", 0, 12, { int: true });
  if (gap !== undefined) out.min_gap_frames = gap;
  const close = numberField(raw, "close_gaps_under", "close_gaps_under", 0, 2);
  if (close !== undefined) out.close_gaps_under = close;
  const cuts = arrayField(raw, "cut_times", "cut_times", 0, 5000);
  if (cuts) {
    out.cut_times = cuts.map((c, i) => {
      if (typeof c !== "number" || !Number.isFinite(c) || c < 0) fail(`cut_times[${i}] must be a number of seconds, 0 or more`);
      return c;
    });
  }
  const cleanup = objectField(raw, "cleanup", "cleanup");
  if (cleanup) out.cleanup = normalizeCleanup(cleanup);
  const mw = numberField(raw, "max_words", "max_words", 1, 30, { int: true });
  if (mw !== undefined) out.max_words = mw;
  const sw = boolField(raw, "single_word", "single_word");
  if (sw !== undefined) out.single_word = sw;
  const hl = numberField(raw, "highlight_lead_frames", "highlight_lead_frames", 0, 6, { int: true });
  if (hl !== undefined) out.highlight_lead_frames = hl;
  const style = enumField(raw, "speaker_style", "speaker_style", ["none", "color", "hyphen", "label"] as const);
  if (style) out.speaker_style = style;
  const colors = arrayField(raw, "speaker_colors", "speaker_colors", 1, 16);
  if (colors) {
    out.speaker_colors = colors.map((c, i) => {
      if (typeof c !== "string" || !new RegExp(HEX_COLOR_PATTERN).test(c)) fail(`speaker_colors[${i}] must be a colour like #FFFF00`);
      return c;
    });
  }
  const names = objectField(raw, "speaker_names", "speaker_names");
  if (names) {
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(names)) {
      if (typeof v !== "string" || v.length > 60) fail(`speaker_names.${k} must be a string of at most 60 characters`);
      map[k] = v;
    }
    out.speaker_names = map;
  }
  const endS = numberField(raw, "end_s", "end_s", 0, Infinity, { exclusiveMin: true });
  if (endS !== undefined) out.end_s = endS;
  const acc = boolField(raw, "accessibility", "accessibility");
  if (acc !== undefined) out.accessibility = acc;
  const sdh = objectField(raw, "sdh", "sdh");
  if (sdh) {
    const s: SdhOptions = {};
    const se = boolField(sdh, "sound_events", "sdh.sound_events");
    if (se !== undefined) s.sound_events = se;
    const ranges = arrayField(sdh, "lyric_ranges", "sdh.lyric_ranges", 0, 200);
    if (ranges) {
      s.lyric_ranges = ranges.map((r, i) => {
        const label = `sdh.lyric_ranges[${i}]`;
        if (!r || typeof r !== "object" || Array.isArray(r)) fail(`${label} must be an object`);
        const o = r as Present;
        const start = numberField(o, "start", `${label}.start`, 0, Infinity);
        const end = numberField(o, "end", `${label}.end`, 0, Infinity);
        if (start === undefined || end === undefined) fail(`${label} needs start and end`);
        if (end <= start) fail(`${label}.end must be after start`);
        return { start, end };
      });
    }
    out.sdh = s;
  }
  return out;
}

const MUSIC = "♪";

/** Lines a greedy fill needs for these word lengths. A word longer than the line still takes a line to itself. */
export function greedyLineCount(lengths: number[], maxChars: number): number {
  let lines = 0;
  let len = 0;
  for (const n of lengths) {
    if (lines === 0) {
      lines = 1;
      len = n;
    } else if (len + 1 + n <= maxChars) {
      len += 1 + n;
    } else {
      lines++;
      len = n;
    }
  }
  return lines;
}

function greedyLines(words: string[], maxChars: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export interface BreakOptions {
  /** Text to judge each word's grammar by when `words` carry decoration (labels, music notes). Same length as `words`. */
  gram?: string[];
  /** Weigh grammar (no line ending on an article, preposition, conjunction ...). Default true. */
  grammar?: boolean;
  /** Prefer the lower line longer when two layouts cost about the same. Default true. */
  bottom_heavy?: boolean;
  /**
   * Most lines allowed. The fewest lines that fit are used, unless that splits a name ("Land Rover Defender",
   * "Sarah Jones") and a layout with more lines up to this number does not. Default: the fewest lines only.
   */
  max_lines?: number;
}

/** Extra grammar points for a break inside a name (on top of breakPenalty's own), when the whole name fits one line. */
const NAME_SPLIT_POINTS = 20;

/**
 * Breaks words into the fewest lines of at most `maxChars` characters, with the lines as even as
 * possible (a two-line caption is split near the middle, not greedily). A line should not end on
 * an article, preposition, conjunction, auxiliary, a subject pronoun before its verb, a first name
 * before a surname or a number before its unit when another break is nearby: each break costs its
 * grammar penalty (caption-standards breakPenalty) next to the evenness cost, and a layout with the
 * lower line shorter costs a little extra. A break inside a run of capitalised words that read as one
 * name ("Land Rover Defender") costs extra when the whole name fits a line; every split into the fewest
 * lines is weighed, and with `max_lines` a layout with more lines is taken when only that keeps the name
 * whole. A capitalised word that merely starts a sentence ("Today", "So") is not a name. Character counts
 * only: Node can't measure glyphs, so a proportional font can still run wider than the count suggests.
 */
export function breakLines(words: string[], maxChars: number, opts: BreakOptions = {}): string[] {
  if (!words.length) return [];
  const lens = words.map((w) => w.length);
  const n = greedyLineCount(lens, maxChars);
  if (n <= 1) return [words.join(" ")];
  const gram = opts.gram ?? words;
  const useGrammar = opts.grammar !== false;
  const bottomHeavy = opts.bottom_heavy !== false;
  // One penalty point is worth a fortieth of a full-width line's evenness cost.
  const unit = (maxChars * maxChars) / 40;
  const lineLen = (i: number, j: number) => lens.slice(i, j).reduce((a, b) => a + b, 0) + (j - i - 1);
  // nameSplit[j]: a break before word j falls inside a name that would fit on one line.
  const nameSplit = new Array<boolean>(words.length + 1).fill(false);
  if (useGrammar) {
    for (const [first, last] of properNounRuns(gram)) {
      if (lineLen(first, last + 1) > maxChars) continue;
      for (let j = first + 1; j <= last; j++) nameSplit[j] = true;
    }
  }
  const cost = (i: number, j: number) => {
    const len = lineLen(i, j);
    let c: number;
    if (len > maxChars) c = j - i === 1 ? (len - maxChars) ** 2 : Infinity;
    else c = (maxChars - len) ** 2;
    if (useGrammar && j < words.length) {
      c += unit * breakPenalty(gram[j - 1], gram[j], "line");
      if (nameSplit[j]) c += unit * NAME_SPLIT_POINTS;
    }
    return c;
  };
  /** The cheapest layout in exactly `k` lines, or null when none fits. */
  const solve = (k: number): { lines: string[]; cost: number; names: number } | null => {
    // best[m][j]: cheapest way to set the first j words in m lines.
    const best: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(words.length + 1).fill(Infinity));
    const from: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(words.length + 1).fill(0));
    best[0][0] = 0;
    for (let m = 1; m <= k; m++) {
      for (let j = m; j <= words.length; j++) {
        for (let i = m - 1; i < j; i++) {
          let c = best[m - 1][i] + cost(i, j);
          if (bottomHeavy && m >= 2 && j === words.length && lineLen(i, j) < lineLen(from[m - 1][i], i)) c += 0.6 * unit;
          if (c < best[m][j]) {
            best[m][j] = c;
            from[m][j] = i;
          }
        }
      }
    }
    if (!Number.isFinite(best[k][words.length])) return null;
    const lines: string[] = [];
    let names = 0;
    let j = words.length;
    for (let m = k; m >= 1; m--) {
      const i = from[m][j];
      lines.unshift(words.slice(i, j).join(" "));
      if (i > 0 && nameSplit[i]) names++;
      j = i;
    }
    return { lines, cost: best[k][words.length], names };
  };
  let chosen = solve(n);
  if (!chosen) return greedyLines(words, maxChars);
  const limit = Math.min(Math.floor(opts.max_lines ?? n), words.length);
  for (let k = n + 1; chosen.names > 0 && k <= limit; k++) {
    const more = solve(k);
    if (more && more.names < chosen.names) chosen = more;
  }
  return chosen.lines;
}

const snapTo = (t: number, fps: number) => Math.round(t * fps) / fps;

/** Text for a sound event: "(Laughter)" and "[laughter]" both become "[laughter]". Undefined when nothing is left. */
function soundText(raw: string): string | undefined {
  const inner = raw.replace(/^[\s[(]+|[\s\])]+$/g, "").trim().toLowerCase();
  return inner ? `[${inner}]` : undefined;
}

/** Pulls words wholly in [square brackets] (also a run of several) out of the speech into sound events. */
function takeBracketEvents(words: CleanWord[]): { words: CleanWord[]; events: TranscriptWord[] } {
  const kept: CleanWord[] = [];
  const events: TranscriptWord[] = [];
  let carry = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.text.startsWith("[")) {
      let j = i;
      while (j < words.length && j - i < 8 && !words[j].text.endsWith("]")) j++;
      if (j < words.length && words[j].text.endsWith("]") && j - i < 8) {
        events.push({ text: words.slice(i, j + 1).map((x) => x.text).join(" "), start: w.start, end: words[j].end });
        if (words[i].cue_start) carry = true;
        i = j;
        continue;
      }
    }
    kept.push(carry && !w.cue_start ? { ...w, cue_start: true } : w);
    carry = false;
  }
  return { words: kept, events };
}

interface Group {
  words: CleanWord[];
  kind: CaptionKind;
  label?: string;
  /** Turn boundary for a hyphen caption. */
  turns?: number;
  notes: Array<{ rule: PlanChange["rule"]; action: PlanChange["action"]; detail: string }>;
}

/** Keep items that overlap `[from, to)` and clip any that straddle a bound. */
function clipToRange<T extends { start: number; end: number }>(items: T[], from: number, to: number): T[] {
  const out: T[] = [];
  for (const item of items) {
    if (!(item.end > from && item.start < to)) continue;
    const start = item.start < from ? from : item.start;
    const end = item.end > to ? to : item.end;
    if (!(end > start)) continue;
    out.push(start === item.start && end === item.end ? item : { ...item, start, end });
  }
  return out;
}

/**
 * Transcript segments to a caption plan. See the module comment; `cut_times`, `cleanup`, social
 * chunking, speakers and SDH are described by CAPTION_PLAN_OPTION_PROPERTIES. Times are rounded to
 * whole frames of `frame_rate` (30 with a warning when absent). Pure.
 */
export function buildCaptionPlan(allSegments: TranscriptSegment[], options: CaptionPlanOptions = {}): CaptionPlan {
  const opts = options;
  const from = opts.from_s ?? 0;
  const to = opts.to_s ?? Infinity;
  const windowed = opts.from_s !== undefined || opts.to_s !== undefined;
  const segments = windowed ? allSegments.filter((s) => s.end > from && s.start < to) : allSegments;
  if (!segments.length) throw new CaptionTranscriptError(windowed ? `No transcript segment overlaps ${from} s to ${to} s` : "The transcript has no segments");
  const std = opts.standard ? CAPTION_STANDARDS[opts.standard] : undefined;
  const fix = std ? opts.fix !== false : false;
  const maxChars = opts.max_chars_per_line ?? std?.max_cpl ?? 32;
  const maxLines = opts.max_lines ?? std?.max_lines ?? 2;
  const minDur = opts.min_duration ?? std?.min_duration_s ?? 1;
  const maxDur = opts.max_duration ?? std?.max_duration_s ?? 6;
  const linger = opts.linger ?? std?.linger_s ?? 0.25;
  const pause = opts.pause_break ?? 0.7;
  const offset = opts.offset ?? 0;
  const minGapFrames = opts.min_gap_frames ?? (std ? std.min_gap_frames : 0);
  const closeUnder = opts.close_gaps_under ?? (std && fix ? std.close_gap_under_s : 0);
  const cutZone = std?.cut_zone_s ?? 0.5;
  const rawCuts = opts.cut_times ?? [];
  const warnings: string[] = [];
  let estimated = false;

  // Times are whole frames; without a frame rate, 30 is assumed (and said).
  const frameRateAssumed = !opts.frame_rate;
  const fps = exactFrameRate(opts.frame_rate ?? 30);
  if (frameRateAssumed) warnings.push("No frame_rate was given, so times are rounded to 30 fps frames. Pass the sequence's frame rate for exact frames.");
  const frame = 1 / fps;
  const snap = (t: number) => snapTo(t, fps);
  const leadFrame = frame;
  const lead = (opts.highlight_lead_frames ?? 1) * leadFrame;
  const sdhSound = opts.sdh?.sound_events !== false;
  const speakerStyle = opts.speaker_style ?? "none";
  const labelMode = speakerStyle === "label" || (speakerStyle === "color" && opts.accessibility === true);
  const nameOf = (id: string) => opts.speaker_names?.[id] ?? id.toUpperCase();

  // A subtitle cue (SRT, VTT: no word times) is already a caption, so a new caption starts at each one.
  let all: CleanWord[] = [];
  let events: TranscriptWord[] = [];
  for (const seg of segments) {
    const t = timedWords(seg);
    let words: CleanWord[] = t.words.map((w) => (t.estimated ? { ...w, estimated: true } : { ...w }));
    if (t.estimated && words.length) {
      estimated = true;
      words[0] = { ...words[0], cue_start: true };
    }
    if (windowed) {
      const hadCueStart = words.some((w) => w.cue_start);
      words = clipToRange(words, from, to);
      if (hadCueStart && words.length && !words[0].cue_start) words[0] = { ...words[0], cue_start: true };
    }
    if (sdhSound) {
      const taken = takeBracketEvents(words);
      words = taken.words;
      events.push(...taken.events);
      for (const ev of seg.sound_events ?? []) events.push(ev);
    }
    all.push(...words);
  }
  if (windowed) events = clipToRange(events, from, to);

  let cleanupReport: CleanupReport | undefined;
  if (opts.cleanup) {
    const r = cleanupWords(all, opts.cleanup);
    all = r.words;
    cleanupReport = r.report;
    if (opts.cleanup.drop_after_s !== undefined) {
      const limit = opts.cleanup.drop_after_s;
      const before = events.length;
      events = events.filter((e) => e.start < limit);
      cleanupReport.dropped_after_end += before - events.length;
    }
  }
  events = events.sort((a, b) => a.start - b.start).filter((e) => soundText(e.text) !== undefined);

  // A negative offset (or from_s with one) can put words before the start of the sequence: those are dropped,
  // and a word that straddles 0 starts at 0.
  if (offset < 0) {
    let before = 0;
    const o = new Out();
    for (const w of all) {
      if (w.end + offset <= 0) {
        before++;
        o.drop(w);
      } else o.push(w.start + offset < 0 ? { ...w, start: -offset } : w);
    }
    all = o.words;
    const keptEvents: TranscriptWord[] = [];
    for (const e of events) {
      if (e.end + offset <= 0) before++;
      else keptEvents.push(e.start + offset < 0 ? { ...e, start: -offset } : e);
    }
    events = keptEvents;
    if (before) warnings.push(`${before} word${before === 1 ? "" : "s"} or sound event${before === 1 ? "" : "s"} would start before 0 s with an offset of ${offset} s and ${before === 1 ? "was" : "were"} dropped; a caption that straddles 0 s starts at 0 s.`);
  }
  if (!all.length && !events.length) throw new CaptionTranscriptError("The transcript has no words to caption");

  const lyricRanges = opts.sdh?.lyric_ranges ?? [];
  const kindOf = (w: CleanWord): CaptionKind => {
    const mid = (w.start + w.end) / 2;
    return lyricRanges.some((r) => mid >= r.start && mid < r.end) ? "lyric" : "speech";
  };
  const isSentEnd = (w: CleanWord) => w.sentence_end ?? SENTENCE_END_RE.test(w.text);
  const gramOf = (w: CleanWord) => w.gram ?? w.text;

  /** The tokens a caption's lines are broken from: the words, with a speaker label and lyric notes counted in. */
  const tokensOf = (texts: string[], label: string | undefined, kind: CaptionKind): string[] => {
    const t = texts.slice();
    if (kind === "lyric" && t.length) {
      t[0] = `${MUSIC} ${t[0]}`;
      t[t.length - 1] = `${t[t.length - 1]} ${MUSIC}`;
    }
    if (label && t.length) t[0] = `${label} ${t[0]}`;
    return t;
  };
  const bottomHeavy = std ? std.bottom_heavy : true;
  const layout = (c: WorkCap): string[] => {
    const texts = c.words.map((w) => w.text);
    if (c.kind === "sound") return [texts.join(" ")];
    if (c.turns !== undefined) return ["- " + texts.slice(0, c.turns).join(" "), "- " + texts.slice(c.turns).join(" ")];
    return breakLines(tokensOf(texts, c.label, c.kind ?? "speech"), maxChars, { gram: c.gram, bottom_heavy: bottomHeavy, max_lines: maxLines });
  };

  // ----- grouping -----
  const groups: Group[] = [];
  let cur: CleanWord[] = [];
  let curKind: CaptionKind = "speech";
  let curLabel: string | undefined;
  let lastSpeaker: string | undefined;
  let ei = 0;
  const flush = () => {
    if (cur.length) groups.push({ words: cur, kind: curKind, ...(curLabel ? { label: curLabel } : {}), notes: [] });
    cur = [];
    curLabel = undefined;
  };
  const pushEvents = (before: number) => {
    while (ei < events.length && events[ei].start <= before) {
      flush();
      const ev = events[ei++];
      groups.push({ words: [{ text: soundText(ev.text)!, start: ev.start, end: ev.end }], kind: "sound", notes: [] });
    }
  };
  const tokenLens = (ws: CleanWord[], label: string | undefined, kind: CaptionKind) => tokensOf(ws.map((x) => x.text), label, kind).map((t) => t.length);
  const overflows = (ws: CleanWord[]) => ws[ws.length - 1].end - ws[0].start > maxDur || greedyLineCount(tokenLens(ws, curLabel, curKind), maxChars) > maxLines;
  const chars = (ws: CleanWord[]) => ws.reduce((n, w) => n + w.text.length, 0) + Math.max(0, ws.length - 1);

  /** How many of `ws` stay in the caption that is closed: the best grammatical break among the last few words. */
  const bestSplit = (ws: CleanWord[], next: CleanWord): number => {
    if (ws.length < 3) return ws.length;
    let bestK = ws.length;
    let bestCost = Infinity;
    for (let k = ws.length; k >= Math.max(2, ws.length - 4); k--) {
      const after = k < ws.length ? ws[k] : next;
      const cost = breakPenalty(gramOf(ws[k - 1]), gramOf(after), "caption") + 0.3 * (ws.length - k);
      if (cost < bestCost - 1e-9) {
        bestCost = cost;
        bestK = k;
      }
    }
    return bestK;
  };

  /** True when `b` may share a caption with `a` as far as speaker, kind, cue and pause go (not the length limits). */
  const joinable = (a: CleanWord, b: CleanWord) => b.speaker === a.speaker && !b.cue_start && kindOf(b) === kindOf(a) && b.start - a.end <= pause;

  /**
   * A max_words chunk is full and `w` is next: how many of cur + w close the chunk. Usually all of cur (a break before w),
   * but a chunk may take one extra word, or hand its last word to the next chunk, when that avoids ending on a weak word
   * (article, preposition, conjunction, auxiliary, first name) or a chunk that cannot stay up the minimum time. A break at
   * punctuation or a pause is preferred.
   */
  const wordBreak = (ws: CleanWord[], wi: number): number => {
    const cap = opts.max_words!;
    const line = [...ws, all[wi]];
    const after = all[wi + 1];
    const timed = fix && std !== undefined;
    let bestK = ws.length;
    let bestCost = Infinity;
    for (const k of [ws.length, ws.length + 1, ws.length - 1]) {
      if (k < 1 || k > cap + 1) continue;
      if (k === ws.length + 1 && overflows(line)) continue;
      const a = line[k - 1];
      const b = line[k] ?? after;
      // A speaker change, cue start or long pause breaks there anyway, so it costs nothing.
      let cost = b === undefined || !joinable(a, b) ? 0 : breakPenalty(gramOf(a), gramOf(b), "caption");
      if (b !== undefined && b.start - a.end >= 0.2) cost -= 1;
      if (k > cap) cost += 1.5; // an extra word must buy a real gain: a weak end or a too-short chunk
      else if (k < ws.length) cost += 0.3;
      if (timed && b !== undefined && b.start - line[0].start < minDur - frame * 0.5) cost += 3;
      if (cost < bestCost - 1e-9) {
        bestCost = cost;
        bestK = k;
      }
    }
    return bestK;
  };

  for (let wi = 0; wi < all.length; wi++) {
    const w = all[wi];
    pushEvents(w.start);
    const prev = cur[cur.length - 1];
    const kind = kindOf(w);
    let hard = false;
    let soft = false;
    let wordFull = false;
    if (prev) {
      if (w.speaker !== prev.speaker || w.cue_start || kind !== curKind) hard = true;
      else if (w.start - prev.end > pause) hard = true;
      else if (opts.single_word) hard = true;
      else if (opts.max_words && cur.length >= opts.max_words) wordFull = true;
      else if (overflows([...cur, w])) soft = true;
      else if (isSentEnd(prev) && chars(cur) >= maxChars * 0.4) hard = true;
    }
    if (wordFull) {
      const k = wordBreak(cur, wi);
      if (k > cur.length) {
        // The chunk takes w as its extra word and closes.
        cur.push(w);
        lastSpeaker = w.speaker;
        flush();
        continue;
      }
      groups.push({ words: cur.slice(0, k), kind: curKind, ...(curLabel ? { label: curLabel } : {}), notes: [] });
      cur = cur.slice(k);
      curLabel = undefined;
    } else if (soft) {
      let first = true;
      while (cur.length && overflows([...cur, w])) {
        const k = first ? bestSplit(cur, w) : cur.length;
        first = false;
        groups.push({ words: cur.slice(0, k), kind: curKind, ...(curLabel ? { label: curLabel } : {}), notes: [] });
        cur = cur.slice(k);
        curLabel = undefined;
      }
    } else if (hard) flush();
    if (!cur.length) {
      curKind = kind;
      curLabel = labelMode && w.speaker !== undefined && w.speaker !== lastSpeaker ? `${nameOf(w.speaker)}:` : undefined;
    }
    lastSpeaker = w.speaker;
    cur.push(w);
  }
  flush();
  pushEvents(Infinity);

  // Social chunking: a very short word, a number and its unit, a first name and a surname show together.
  if (opts.single_word) {
    const shortT = 8 * leadFrame;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (g.kind === "sound") continue;
      while (g.words.length < 3 && i + 1 < groups.length) {
        const last = g.words[g.words.length - 1];
        const nxt = groups[i + 1];
        if (nxt.kind !== g.kind || nxt.label || nxt.words[0].speaker !== last.speaker || nxt.words[0].cue_start) break;
        if (nxt.words[0].start - last.end > pause || isSentEnd(last)) break;
        const isShort = last.end - last.start < shortT - 1e-9;
        const joined = breakPenalty(gramOf(last), gramOf(nxt.words[0]), "line") >= 8;
        if (!isShort && !joined) break;
        // A merge for shortness alone must not split a pair that belongs together at its new end
        // ("Anna | Smith", "The | 10 km"); a joined pair merges whatever its length.
        if (!joined) {
          const after = groups[i + 2];
          const tail = nxt.words[nxt.words.length - 1];
          if (after && after.kind === g.kind && !after.label && after.words[0].speaker === tail.speaker && !after.words[0].cue_start && breakPenalty(gramOf(tail), gramOf(after.words[0]), "line") >= 8) break;
        }
        g.notes.push({
          rule: "single_word",
          action: "merged",
          detail: isShort ? `"${last.text}" is under 8 frames, so it shows with "${nxt.words[0].text}"` : `"${last.text} ${nxt.words[0].text}" stay together`,
        });
        g.words = [...g.words, ...nxt.words];
        groups.splice(i + 1, 1);
      }
    }
  }

  // Hyphen style: two short turns by different speakers share a two-line caption.
  // A word limit applies to the pair as a whole, and a one-word-per-caption look has no pairs.
  if (speakerStyle === "hyphen" && maxLines >= 2 && !opts.single_word) {
    const maxCps = std?.max_cps ?? 21;
    const maxWpm = std?.max_wpm;
    for (let i = 0; i + 1 < groups.length; i++) {
      const a = groups[i];
      const b = groups[i + 1];
      if (a.kind !== "speech" || b.kind !== "speech" || a.turns !== undefined) continue;
      const sa = a.words[0].speaker;
      const sb = b.words[0].speaker;
      if (sa === undefined || sb === undefined || sa === sb) continue;
      const ta = "- " + a.words.map((w) => w.text).join(" ");
      const tb = "- " + b.words.map((w) => w.text).join(" ");
      if (ta.length > maxChars || tb.length > maxChars) continue;
      if (opts.max_words && a.words.length + b.words.length > opts.max_words) continue;
      const span = b.words[b.words.length - 1].end - a.words[0].start;
      if (span > maxDur || b.words[0].start - a.words[a.words.length - 1].end > pause) continue;
      const hold = Math.max(span, minDur);
      if ((ta.length + 1 + tb.length) / hold > maxCps) continue;
      if (maxWpm && ((a.words.length + b.words.length) * 60) / hold > maxWpm) continue;
      groups.splice(i, 2, { words: [...a.words, ...b.words], kind: "speech", ...(a.label ? { label: a.label } : {}), turns: a.words.length, notes: [] });
    }
  }

  // ----- captions -----
  const speakerIds: string[] = [];
  const caps: WorkCap[] = groups.map((g) => {
    const first = g.words[0];
    const lastW = g.words[g.words.length - 1];
    const cap: WorkCap = {
      start: snap(first.start + offset),
      end: 0,
      lines: [],
      words: g.words.map((w) => ({ text: w.text, start: w.start + offset, end: w.end + offset })),
      kind: g.kind,
      gram: g.words.map(gramOf),
      spk: g.words.map((w) => w.speaker),
      rawStart: first.start + offset,
      rawLastEnd: lastW.end + offset,
    };
    if (first.speaker !== undefined && g.kind !== "sound") cap.speaker = first.speaker;
    if (g.label) cap.label = g.label;
    if (g.turns !== undefined) {
      cap.turns = g.turns;
      cap.locked = true;
    }
    if (g.kind === "lyric") cap.italic = true;
    return cap;
  });

  // Whole frames, in order, every word at least a frame after the one before.
  for (const c of caps) {
    let t = c.start;
    for (const w of c.words) {
      w.start = Math.max(snap(w.start), t);
      w.end = Math.max(snap(w.end), w.start);
      t = w.start + frame;
    }
    c.lines = layout(c);
  }

  // ----- rules -----
  const cuts = [...new Set(rawCuts.map(snap))].sort((a, b) => a - b);
  const S: RuleSettings = {
    frame,
    snap,
    maxChars,
    maxLines,
    minDur,
    maxDur,
    linger,
    minGapT: minGapFrames * frame,
    closeUnder,
    cutZone,
    cuts,
    std,
    fix,
    maxWords: opts.max_words,
    singleWord: opts.single_word === true,
    layout,
  };
  const rec = new Rec();
  groups.forEach((g, i) => {
    for (const nt of g.notes) rec.add(caps[i], nt.rule, nt.action, nt.detail);
  });

  splitAtCuts(caps, S, rec);
  snapInTimes(caps, S, rec);
  settleEnds(caps, S);
  if (fix) {
    for (let pass = 0; pass < 4; pass++) {
      const before = caps.length;
      mergePass(caps, S, rec);
      splitPass(caps, S, rec);
      settleEnds(caps, S);
      if (caps.length === before) break;
    }
    snapInTimes(caps, S, rec);
    settleEnds(caps, S);
  }
  closeGaps(caps, S, rec);
  cutOutTimes(caps, S, rec);
  enforceGaps(caps, S, rec);
  for (const c of caps) {
    const lastStart = c.words[c.words.length - 1].start;
    if (c.end <= lastStart) c.end = snap(lastStart + frame);
  }
  const soundDropped = fitSoundCaptions(caps, S, rec);
  // The list is in start order now (a sound caption can move past a speech caption); clear overlaps between the neighbours it had.
  enforceGaps(caps, S, rec);
  recordExtensions(caps, S, rec);
  const violations = findViolations(caps, S);

  // ----- speakers, show_at -----
  for (const c of caps) {
    if (c.speaker !== undefined) {
      let idx = speakerIds.indexOf(c.speaker);
      if (idx < 0) idx = speakerIds.push(c.speaker) - 1;
      c.speaker_index = idx;
      if (speakerStyle === "color") {
        const palette: readonly string[] = opts.speaker_colors && opts.speaker_colors.length ? opts.speaker_colors : SPEAKER_COLORS;
        c.color = palette[idx % palette.length];
      }
    }
    let floor = c.start;
    for (const w of c.words) {
      const at = snap(Math.max(w.start - lead, floor));
      w.show_at = Math.min(at, w.start);
      floor = Math.max(floor, w.show_at);
    }
  }

  const changes: PlanChange[] = [];
  for (const it of rec.items) {
    const n = caps.indexOf(it.cap) + 1;
    if (n > 0) changes.push({ n, rule: it.rule, action: it.action, detail: it.detail });
  }
  changes.sort((a, b) => a.n - b.n);

  const captions: PlanCaption[] = caps.map((c, i) => {
    const kind: CaptionKind = c.kind ?? "speech";
    const cap: PlanCaption = {
      n: i + 1,
      start: c.start,
      end: c.end,
      lines: c.lines,
      text: c.lines.join(" "),
      kind,
      words: c.words.map((w) => ({ text: w.text, start: w.start, end: w.end })),
    };
    if (c.speaker !== undefined) cap.speaker = c.speaker;
    if (c.speaker_index !== undefined) cap.speaker_index = c.speaker_index;
    if (c.color !== undefined) cap.color = c.color;
    if (c.italic) cap.italic = true;
    if (kind !== "sound") cap.highlight = c.words.map((w) => w.show_at ?? w.start);
    return cap;
  });

  if (soundDropped) warnings.push(`${soundDropped} sound caption${soundDropped === 1 ? " was" : "s were"} dropped: no room between the speech captions for it.`);
  if (estimated) {
    warnings.push("Some word times are estimates (SRT and VTT carry line times only): the word highlight follows character share, not the voice. A JSON transcript with word times is exact.");
  }
  if (!std) {
    const fast = captions.filter((c) => c.lines.join(" ").length / Math.max(c.end - c.start, 0.001) > 21).length;
    if (fast) warnings.push(`${fast} caption${fast === 1 ? " is" : "s are"} faster than 21 characters per second; raise max_lines or max_chars_per_line, or lower max_duration.`);
  }
  const wide = captions.filter((c) => c.lines.some((l) => l.length > maxChars)).length;
  if (wide) warnings.push(`${wide} caption${wide === 1 ? " has" : "s have"} a single word longer than max_chars_per_line.`);
  const settings: PlanSettings = {
    frame_rate: fps,
    frame_rate_assumed: frameRateAssumed,
    ...(std ? { standard: std.id } : {}),
    fix,
    max_chars_per_line: maxChars,
    max_lines: maxLines,
    min_duration: minDur,
    max_duration: maxDur,
    linger,
    pause_break: pause,
    offset,
    min_gap_frames: minGapFrames,
    close_gaps_under: closeUnder,
    ...(opts.max_words !== undefined ? { max_words: opts.max_words } : {}),
    single_word: opts.single_word === true,
    highlight_lead_frames: opts.highlight_lead_frames ?? 1,
    speaker_style: speakerStyle,
    cut_count: cuts.length,
  };
  const built: CaptionPlan = { captions, changes, violations, cleanup: cleanupReport, warnings, settings, estimated_word_times: estimated };
  const limits: Array<{ end: number; why: string }> = [];
  if (opts.end_s !== undefined) limits.push({ end: opts.end_s, why: "end_s" });
  if (opts.transcript_duration_s !== undefined) limits.push({ end: opts.transcript_duration_s + offset, why: "the transcript's media duration" });
  if (!limits.length) return built;
  limits.sort((a, b) => a.end - b.end);
  return clampPlanToEnd(built, limits[0].end, limits[0].why);
}

// ---------- clamp to the end of the sequence or media ----------

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Clamps every caption of a plan to `endS` (seconds on the plan's timeline, rounded down to a whole frame): an
 * out-time past it moves to it, a caption that starts at or after it is dropped, and word times and highlight
 * times stay inside the caption. Each is a change with rule "sequence_end" (a dropped caption is numbered after
 * the last kept one). A clamped caption that now breaks its standard's minimum duration or reading speed is added
 * to violations. Changes and violations of dropped captions are removed. The plan is returned as is when nothing
 * reaches past `endS`; settings.end_s records the limit either way.
 */
export function clampPlanToEnd(plan: CaptionPlan, endS: number, why = "end_s"): CaptionPlan {
  if (!Number.isFinite(endS) || endS <= 0) return plan;
  const fps = plan.settings.frame_rate;
  const frame = 1 / fps;
  const limit = Math.floor(endS * fps + 1e-6) / fps;
  const kept: PlanCaption[] = [];
  const dropped: PlanCaption[] = [];
  const clamped: Array<{ n: number; from: number }> = [];
  for (const c of plan.captions) {
    if (c.start >= limit - 1e-9) {
      dropped.push(c);
      continue;
    }
    if (c.end <= limit + 1e-9 && c.words.every((w) => w.end <= limit + 1e-9)) {
      kept.push(c);
      continue;
    }
    const lastStart = Math.max(c.start, limit - frame);
    const words = c.words.map((w) => {
      const start = Math.min(w.start, lastStart);
      return { text: w.text, start, end: Math.max(start, Math.min(w.end, limit)) };
    });
    const out: PlanCaption = {
      ...c,
      end: Math.min(c.end, limit),
      words,
      ...(c.highlight ? { highlight: c.highlight.map((h) => Math.min(h, lastStart)) } : {}),
    };
    if (c.end > limit + 1e-9) clamped.push({ n: kept.length + 1, from: c.end });
    kept.push(out);
  }
  const settings: PlanSettings = { ...plan.settings, end_s: limit };
  if (!dropped.length && !clamped.length) return { ...plan, settings };
  const numbered = kept.map((c, i) => ({ ...c, n: i + 1 }));
  const keptCount = numbered.length;
  const changes: PlanChange[] = plan.changes.filter((c) => c.n <= keptCount);
  const violations: PlanViolation[] = plan.violations.filter((v) => v.n <= keptCount);
  for (const c of clamped) {
    changes.push({ n: c.n, rule: "sequence_end", action: "shortened", detail: `out-time ${r3(c.from)} s moved to ${r3(limit)} s, the end (${why})` });
    const cap = numbered[c.n - 1];
    const std = plan.settings.standard ? CAPTION_STANDARDS[plan.settings.standard] : undefined;
    if (std) {
      const dur = cap.end - cap.start;
      const chars = cap.lines.join(" ").length;
      const tol = frame * 0.25 + 1e-6;
      if (dur < plan.settings.min_duration - tol && !violations.some((v) => v.n === c.n && v.rule === "min_duration")) {
        violations.push({ n: c.n, rule: "min_duration", detail: `on screen ${r3(dur)} s after clamping to the end; the minimum is ${r3(plan.settings.min_duration)} s` });
      }
      if (cap.kind !== "sound" && std.max_cps && chars / Math.max(dur, frame) > std.max_cps + 1e-6 && !violations.some((v) => v.n === c.n && v.rule === "cps")) {
        violations.push({ n: c.n, rule: "cps", detail: `${Math.round((chars / Math.max(dur, frame)) * 10) / 10} characters per second after clamping to the end; the limit is ${std.max_cps}` });
      }
    }
  }
  dropped.forEach((c, k) => {
    const text = c.text.length > 40 ? `${c.text.slice(0, 39)}…` : c.text;
    changes.push({ n: keptCount + k + 1, rule: "sequence_end", action: "dropped", detail: `"${text}" would start at ${r3(c.start)} s, at or after the end ${r3(limit)} s (${why}), so it was dropped` });
  });
  changes.sort((a, b) => a.n - b.n);
  violations.sort((a, b) => a.n - b.n);
  const parts: string[] = [];
  if (clamped.length) parts.push(`${clamped.length} caption${clamped.length === 1 ? "" : "s"} shortened`);
  if (dropped.length) parts.push(`${dropped.length} dropped`);
  const warnings = [...plan.warnings, `Captions were clamped to the end at ${r3(limit)} s (${why}): ${parts.join(", ")}.`];
  return { ...plan, captions: numbered, changes, violations, warnings, settings };
}

// ---------- versioned plan document ----------

export const CAPTION_PLAN_DOCUMENT_KIND = "premiere-pro-mcp.caption-plan";
export const CAPTION_PLAN_DOCUMENT_VERSION = 1;
export const MAX_PLAN_DOCUMENT_CAPTIONS = 20_000;
const MAX_PLAN_DOCUMENT_ENTRIES = 100_000;
const MAX_PLAN_LINES = 12;
const MAX_PLAN_WORDS = 400;
const REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/;

export interface CaptionPlanSource {
  kind: "word_timeline" | "text" | "path";
  sha256: string;
  format: string;
  path?: string;
}

export interface CaptionPlanDocument {
  kind: typeof CAPTION_PLAN_DOCUMENT_KIND;
  version: typeof CAPTION_PLAN_DOCUMENT_VERSION;
  /** sha256 of the canonical JSON of `settings` and `captions`: changes when anything a host would apply changes. */
  plan_revision: string;
  source: CaptionPlanSource;
  settings: PlanSettings;
  captions: PlanCaption[];
  changes: PlanChange[];
  violations: PlanViolation[];
  cleanup: CleanupReport | null;
  warnings: string[];
}

/** JSON with object keys sorted, so equal values always hash alike. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

function planRevision(settings: PlanSettings, captions: PlanCaption[]): string {
  return `sha256:${createHash("sha256").update(canonicalJson({ settings, captions })).digest("hex")}`;
}

/** Wraps a plan in a versioned, hash-bound document that a host tool can take back later. */
export function captionPlanDocument(plan: CaptionPlan, source: CaptionPlanSource): CaptionPlanDocument {
  return {
    kind: CAPTION_PLAN_DOCUMENT_KIND,
    version: CAPTION_PLAN_DOCUMENT_VERSION,
    plan_revision: planRevision(plan.settings, plan.captions),
    source: { kind: source.kind, sha256: source.sha256, format: source.format, ...(source.path !== undefined ? { path: source.path } : {}) },
    settings: plan.settings,
    captions: plan.captions,
    changes: plan.changes,
    violations: plan.violations,
    cleanup: plan.cleanup ?? null,
    warnings: plan.warnings,
  };
}

/** The plan inside a document. */
export function planFromDocument(doc: CaptionPlanDocument): CaptionPlan {
  return {
    captions: doc.captions,
    changes: doc.changes,
    violations: doc.violations,
    cleanup: doc.cleanup ?? undefined,
    warnings: doc.warnings,
    settings: doc.settings,
    estimated_word_times: false,
  };
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function objectAt(v: unknown, label: string): Present {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail(`${label} must be an object`);
  return v as Present;
}

function listAt(v: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(v)) fail(`${label} must be an array`);
  if (v.length > max) fail(`${label} may hold at most ${max} entries`);
  return v;
}

function numAt(v: unknown, label: string): number {
  if (!finite(v)) fail(`${label} must be a finite number`);
  return v;
}

function textAt(v: unknown, label: string, max = 4000): string {
  if (typeof v !== "string" || v.length > max) fail(`${label} must be a string of at most ${max} characters`);
  return v;
}

const CHANGE_RULES = ["min_duration", "max_duration", "cps", "cpl", "lines", "gap", "close_gap", "shot_change", "linger", "single_word", "max_words", "overlap", "sequence_end"];
const CHANGE_ACTIONS = ["extended", "shortened", "merged", "split", "moved_in", "moved_out", "closed_gap", "opened_gap", "merged_over_max_words", "dropped"];
const SPEAKER_STYLES = ["none", "color", "hyphen", "label"];
const CAPTION_KINDS = ["speech", "sound", "lyric"];
const CLEANUP_KEYS = ["dropped_after_end", "dropped_music_tokens", "dropped_short", "fillers_removed", "stutters_removed", "glossary_replacements"] as const;

function parseSettings(v: unknown): PlanSettings {
  const o = objectAt(v, "settings");
  const fps = numAt(o.frame_rate, "settings.frame_rate");
  if (!(fps > 0) || fps > 240) fail("settings.frame_rate must be greater than 0 and at most 240");
  const out: PlanSettings = {
    frame_rate: fps,
    frame_rate_assumed: o.frame_rate_assumed === true,
    fix: o.fix === true,
    max_chars_per_line: numAt(o.max_chars_per_line, "settings.max_chars_per_line"),
    max_lines: numAt(o.max_lines, "settings.max_lines"),
    min_duration: numAt(o.min_duration, "settings.min_duration"),
    max_duration: numAt(o.max_duration, "settings.max_duration"),
    linger: numAt(o.linger, "settings.linger"),
    pause_break: numAt(o.pause_break, "settings.pause_break"),
    offset: numAt(o.offset, "settings.offset"),
    min_gap_frames: numAt(o.min_gap_frames, "settings.min_gap_frames"),
    close_gaps_under: numAt(o.close_gaps_under, "settings.close_gaps_under"),
    single_word: o.single_word === true,
    highlight_lead_frames: numAt(o.highlight_lead_frames, "settings.highlight_lead_frames"),
    speaker_style: "none",
    cut_count: numAt(o.cut_count, "settings.cut_count"),
  };
  if (o.standard !== undefined) {
    if (typeof o.standard !== "string" || !(CAPTION_STANDARD_IDS as readonly string[]).includes(o.standard)) fail("settings.standard is not a known caption standard");
    out.standard = o.standard as PlanSettings["standard"];
  }
  if (o.max_words !== undefined) out.max_words = numAt(o.max_words, "settings.max_words");
  if (o.end_s !== undefined) out.end_s = numAt(o.end_s, "settings.end_s");
  if (typeof o.speaker_style !== "string" || !SPEAKER_STYLES.includes(o.speaker_style)) fail(`settings.speaker_style must be one of ${SPEAKER_STYLES.join(", ")}`);
  out.speaker_style = o.speaker_style as PlanSettings["speaker_style"];
  return out;
}

function parseCaptionEntry(v: unknown, i: number): PlanCaption {
  const label = `captions[${i}]`;
  const o = objectAt(v, label);
  if (o.n !== i + 1) fail(`${label}.n must be ${i + 1}`);
  const start = numAt(o.start, `${label}.start`);
  const end = numAt(o.end, `${label}.end`);
  if (start < 0) fail(`${label}.start must be 0 or more`);
  if (!(start < end)) fail(`${label}.start must be before end`);
  const lines = listAt(o.lines, `${label}.lines`, MAX_PLAN_LINES).map((l, k) => {
    const t = textAt(l, `${label}.lines[${k}]`);
    if (!t.trim()) fail(`${label}.lines[${k}] must not be empty`);
    return t;
  });
  if (!lines.length) fail(`${label}.lines must hold at least one line`);
  if (typeof o.kind !== "string" || !CAPTION_KINDS.includes(o.kind)) fail(`${label}.kind must be one of ${CAPTION_KINDS.join(", ")}`);
  const words = listAt(o.words, `${label}.words`, MAX_PLAN_WORDS).map((w, k) => {
    const wo = objectAt(w, `${label}.words[${k}]`);
    const ws = numAt(wo.start, `${label}.words[${k}].start`);
    const we = numAt(wo.end, `${label}.words[${k}].end`);
    if (we < ws) fail(`${label}.words[${k}].end must not be before start`);
    return { text: textAt(wo.text, `${label}.words[${k}].text`, 500), start: ws, end: we };
  });
  const cap: PlanCaption = { n: i + 1, start, end, lines, text: textAt(o.text, `${label}.text`), kind: o.kind as CaptionKind, words };
  if (o.speaker !== undefined) cap.speaker = textAt(o.speaker, `${label}.speaker`, 300);
  if (o.speaker_index !== undefined) cap.speaker_index = numAt(o.speaker_index, `${label}.speaker_index`);
  if (o.color !== undefined) {
    if (typeof o.color !== "string" || !new RegExp(HEX_COLOR_PATTERN).test(o.color)) fail(`${label}.color must be a colour like #FFFF00`);
    cap.color = o.color;
  }
  if (o.italic !== undefined) cap.italic = o.italic === true;
  if (o.highlight !== undefined) {
    const h = listAt(o.highlight, `${label}.highlight`, MAX_PLAN_WORDS).map((x, k) => numAt(x, `${label}.highlight[${k}]`));
    if (h.length !== words.length) fail(`${label}.highlight must have one entry per word`);
    cap.highlight = h;
  }
  return cap;
}

/**
 * Strict validator for a saved plan document. Checks kind and version, caption order (numbered from 1,
 * start before end, not earlier than the caption before), finite numbers, non-empty lines, bounded counts,
 * and recomputes plan_revision. Throws Error with a clear message.
 */
export function parseCaptionPlanDocument(value: unknown): CaptionPlanDocument {
  const o = objectAt(value, "caption plan");
  if (o.kind !== CAPTION_PLAN_DOCUMENT_KIND) fail(`caption plan kind must be "${CAPTION_PLAN_DOCUMENT_KIND}"`);
  if (o.version !== CAPTION_PLAN_DOCUMENT_VERSION) fail(`caption plan version must be ${CAPTION_PLAN_DOCUMENT_VERSION}`);
  if (typeof o.plan_revision !== "string" || !REVISION_PATTERN.test(o.plan_revision)) fail("caption plan plan_revision must match ^sha256:[a-f0-9]{64}$");
  const src = objectAt(o.source, "caption plan source");
  if (src.kind !== "word_timeline" && src.kind !== "text" && src.kind !== "path") fail("caption plan source.kind must be word_timeline, text or path");
  if (typeof src.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(src.sha256)) fail("caption plan source.sha256 must be a sha256 hex digest");
  const source: CaptionPlanSource = { kind: src.kind, sha256: src.sha256, format: textAt(src.format, "caption plan source.format", 40) };
  if (src.path !== undefined) source.path = textAt(src.path, "caption plan source.path", 4096);
  const settings = parseSettings(o.settings);
  const rawCaptions = listAt(o.captions, "captions", MAX_PLAN_DOCUMENT_CAPTIONS);
  if (!rawCaptions.length) fail("captions must hold at least one caption");
  const captions = rawCaptions.map((c, i) => parseCaptionEntry(c, i));
  for (let i = 1; i < captions.length; i++) {
    if (captions[i].start < captions[i - 1].start) fail(`captions[${i}] starts before captions[${i - 1}]; captions must be ordered by start`);
  }
  const changes: PlanChange[] = listAt(o.changes, "changes", MAX_PLAN_DOCUMENT_ENTRIES).map((c, i) => {
    const e = objectAt(c, `changes[${i}]`);
    if (typeof e.rule !== "string" || !CHANGE_RULES.includes(e.rule)) fail(`changes[${i}].rule is not a known rule`);
    if (typeof e.action !== "string" || !CHANGE_ACTIONS.includes(e.action)) fail(`changes[${i}].action is not a known action`);
    return { n: numAt(e.n, `changes[${i}].n`), rule: e.rule as PlanChange["rule"], action: e.action as PlanChange["action"], detail: textAt(e.detail, `changes[${i}].detail`) };
  });
  const violations: PlanViolation[] = listAt(o.violations, "violations", MAX_PLAN_DOCUMENT_ENTRIES).map((c, i) => {
    const e = objectAt(c, `violations[${i}]`);
    if (typeof e.rule !== "string" || !(CHANGE_RULES.includes(e.rule) || e.rule === "grammar")) fail(`violations[${i}].rule is not a known rule`);
    return { n: numAt(e.n, `violations[${i}].n`), rule: e.rule as PlanViolation["rule"], detail: textAt(e.detail, `violations[${i}].detail`) };
  });
  let cleanup: CleanupReport | null = null;
  if (o.cleanup !== null && o.cleanup !== undefined) {
    const c = objectAt(o.cleanup, "cleanup");
    const report = {} as CleanupReport;
    for (const k of CLEANUP_KEYS) report[k] = numAt(c[k], `cleanup.${k}`);
    cleanup = report;
  }
  const warnings = listAt(o.warnings, "warnings", 1000).map((w, i) => textAt(w, `warnings[${i}]`));
  const revision = planRevision(settings, captions);
  if (revision !== o.plan_revision) fail("caption plan plan_revision does not match its settings and captions; the plan was edited or is corrupt");
  return { kind: CAPTION_PLAN_DOCUMENT_KIND, version: CAPTION_PLAN_DOCUMENT_VERSION, plan_revision: revision, source, settings, captions, changes, violations, cleanup, warnings };
}
