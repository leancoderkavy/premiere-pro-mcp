import { createHash } from "node:crypto";
import { digestWordTimeline, normalizeToken, sentenceRanges, validateWordTimeline, type TranscriptWord, type WordTimeline } from "./word-timeline.js";

/**
 * Local caption authoring: turns a caller-supplied word timeline into a
 * CapCut/Submagic-style SRT or VTT artifact, and checks caption placement
 * against approximate platform UI overlays. Pure and deterministic; nothing
 * here contacts Premiere, a provider, or a model.
 */

export const CAPTION_FORMATS = ["srt", "vtt"] as const;
export type CaptionFormat = (typeof CAPTION_FORMATS)[number];

export const CAPTION_STYLE_PRESETS = ["clean", "bold_pop", "karaoke", "podcast", "lecture"] as const;
export type CaptionStylePreset = (typeof CAPTION_STYLE_PRESETS)[number];

export const SAFE_ZONE_PLATFORMS = ["tiktok", "instagram_reels", "youtube_shorts", "instagram_feed", "youtube", "linkedin", "x"] as const;
export type SafeZonePlatform = (typeof SAFE_ZONE_PLATFORMS)[number];

export const SAFE_ZONE_ELEMENT_KINDS = ["caption", "title", "logo", "graphic"] as const;
export type SafeZoneElementKind = (typeof SAFE_ZONE_ELEMENT_KINDS)[number];

export const MAX_CAPTION_CUES = 10_000;
export const MAX_EMPHASIS_WORDS = 128;
export const MAX_FILLER_TOKENS = 64;
export const MAX_SAFE_ZONE_ELEMENTS = 64;
export const MAX_FRAME_DIMENSION = 16_384;
export const MIN_FRAME_DIMENSION = 16;

export const CAPTION_AUTHORING_ROUTES = ["create_caption_track", "read_sequence_captions", "inspect_caption_tracks_uxp"] as const;
export const SAFE_ZONE_ROUTES = ["set_clip_position", "transform_track_item_uxp", "export_sequence_review_frames", "create_caption_track"] as const;

const SENTENCE_GAP_SECONDS = 0.8;
const LIMITS = {
  words_per_cue: { min: 1, max: 12, fallback: 4 },
  max_chars_per_line: { min: 8, max: 80, fallback: 32 },
  max_lines: { min: 1, max: 3, fallback: 1 },
  min_cue_seconds: { min: 0.2, max: 5, fallback: 0.5 },
  max_cue_seconds: { min: 0.5, max: 15, fallback: 5 },
  merge_gap_seconds: { min: 0, max: 5, fallback: 0.3 },
} as const;

export type CaptionAuthoringOptions = {
  format: CaptionFormat;
  words_per_cue: number;
  max_chars_per_line: number;
  max_lines: number;
  min_cue_seconds: number;
  max_cue_seconds: number;
  merge_gap_seconds: number;
  karaoke: boolean;
  emphasis_words: string[];
  speaker_prefix: boolean;
  strip_fillers: string[];
  uppercase: boolean;
  style_preset: CaptionStylePreset;
};

export type CaptionCue = {
  index: number;
  start_seconds: number;
  end_seconds: number;
  text: string;
  line_count: number;
  word_count: number;
  speaker_label?: string;
};

export type CaptionStyleDescriptor = {
  preset: CaptionStylePreset;
  font_family_suggestion: string;
  font_weight: string;
  font_size_percent_of_height: number;
  position: { x: number; y: number };
  alignment: "center";
  stroke: boolean;
  background: boolean;
  word_highlight: boolean;
  uppercase_recommended: boolean;
  safe_zone_recommendation: Record<SafeZonePlatform, { x: number; y: number }>;
  note: string;
};

export type CaptionArtifactResult = {
  format: CaptionFormat;
  cue_count: number;
  cues: CaptionCue[];
  artifact_text: string;
  style: CaptionStyleDescriptor;
  warnings: string[];
  assumptions: string[];
  options: CaptionAuthoringOptions;
  plan_revision: string;
  evidence: {
    source_project_item_id: string;
    transcript_revision: string;
    word_count: number;
    words_used: number;
    words_stripped: number;
    duration_seconds: number;
  };
};

function fail(message: string): never {
  throw new Error(message);
}

function boundedNumber(value: unknown, label: keyof typeof LIMITS, integer = false): number {
  const limit = LIMITS[label];
  if (value === undefined) return limit.fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be a finite number`);
  if (integer && !Number.isInteger(value)) fail(`${label} must be an integer`);
  if (value < limit.min || value > limit.max) fail(`${label} must be between ${limit.min} and ${limit.max}`);
  return value;
}

function optionalBoolean(value: unknown, label: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") fail(`${label} must be a boolean`);
  return value;
}

function tokenList(value: unknown, label: string, maxItems: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) fail(`${label} must be an array of at most ${maxItems} tokens`);
  const tokens = value.map((item, index) => {
    if (typeof item !== "string" || !item.trim() || item.length > 64) fail(`${label}[${index}] must be a non-empty string of at most 64 characters`);
    return normalizeToken(item);
  }).filter(Boolean);
  return [...new Set(tokens)].sort();
}

export function normalizeCaptionAuthoringOptions(raw: Record<string, unknown>): CaptionAuthoringOptions {
  const format = raw.format;
  if (format !== "srt" && format !== "vtt") fail("format must be one of: srt, vtt");
  const preset = raw.style_preset === undefined ? "clean" : raw.style_preset;
  if (typeof preset !== "string" || !(CAPTION_STYLE_PRESETS as readonly string[]).includes(preset)) fail(`style_preset must be one of: ${CAPTION_STYLE_PRESETS.join(", ")}`);
  const options: CaptionAuthoringOptions = {
    format,
    words_per_cue: boundedNumber(raw.words_per_cue, "words_per_cue", true),
    max_chars_per_line: boundedNumber(raw.max_chars_per_line, "max_chars_per_line", true),
    max_lines: boundedNumber(raw.max_lines, "max_lines", true),
    min_cue_seconds: boundedNumber(raw.min_cue_seconds, "min_cue_seconds"),
    max_cue_seconds: boundedNumber(raw.max_cue_seconds, "max_cue_seconds"),
    merge_gap_seconds: boundedNumber(raw.merge_gap_seconds, "merge_gap_seconds"),
    karaoke: optionalBoolean(raw.karaoke, "karaoke"),
    emphasis_words: tokenList(raw.emphasis_words, "emphasis_words", MAX_EMPHASIS_WORDS),
    speaker_prefix: optionalBoolean(raw.speaker_prefix, "speaker_prefix"),
    strip_fillers: tokenList(raw.strip_fillers, "strip_fillers", MAX_FILLER_TOKENS),
    uppercase: optionalBoolean(raw.uppercase, "uppercase"),
    style_preset: preset as CaptionStylePreset,
  };
  if (options.min_cue_seconds > options.max_cue_seconds) fail("min_cue_seconds must not exceed max_cue_seconds");
  if (options.karaoke && options.format !== "vtt") fail("karaoke word timestamps are only supported for format vtt; use format vtt or set karaoke to false");
  return options;
}

// ---------------------------------------------------------------------------
// Style presets (documentation only)
// ---------------------------------------------------------------------------

type PlatformZone = { id: string; x: number; y: number; width: number; height: number; description: string };
type PlatformProfile = {
  orientation: "vertical" | "horizontal" | "any";
  zones: PlatformZone[];
  recommended_caption_anchor: { x: number; y: number };
};

const EDGE_MARGIN = 0.05;
const titleSafeZones = (): PlatformZone[] => [
  { id: "top_margin", x: 0, y: 0, width: 1, height: EDGE_MARGIN, description: "Title-safe top margin (5%)." },
  { id: "bottom_margin", x: 0, y: 1 - EDGE_MARGIN, width: 1, height: EDGE_MARGIN, description: "Title-safe bottom margin (5%); player controls overlay here on hover." },
  { id: "left_margin", x: 0, y: 0, width: EDGE_MARGIN, height: 1, description: "Title-safe left margin (5%)." },
  { id: "right_margin", x: 1 - EDGE_MARGIN, y: 0, width: EDGE_MARGIN, height: 1, description: "Title-safe right margin (5%)." },
];

/** Approximate platform UI occlusion zones as normalized rects (x, y top-left). Verify against current platform overlay guides. */
export const PLATFORM_SAFE_ZONES: Record<SafeZonePlatform, PlatformProfile> = {
  tiktok: {
    orientation: "vertical",
    zones: [
      { id: "top_status_nav", x: 0, y: 0, width: 1, height: 0.08, description: "Status bar and Following/For You navigation." },
      { id: "right_action_rail", x: 0.82, y: 0.35, width: 0.18, height: 0.5, description: "Profile, like, comment, share, and sound buttons." },
      { id: "bottom_caption_area", x: 0, y: 0.78, width: 1, height: 0.22, description: "Username, caption text, sound ticker, and tab bar." },
    ],
    recommended_caption_anchor: { x: 0.5, y: 0.68 },
  },
  instagram_reels: {
    orientation: "vertical",
    zones: [
      { id: "top_nav", x: 0, y: 0, width: 1, height: 0.06, description: "Reels header and camera shortcut." },
      { id: "right_action_rail", x: 0.85, y: 0.4, width: 0.15, height: 0.4, description: "Like, comment, share, and more buttons." },
      { id: "bottom_caption_area", x: 0, y: 0.8, width: 1, height: 0.2, description: "Username, caption, audio attribution, and tab bar." },
    ],
    recommended_caption_anchor: { x: 0.5, y: 0.7 },
  },
  youtube_shorts: {
    orientation: "vertical",
    zones: [
      { id: "top_nav", x: 0, y: 0, width: 1, height: 0.06, description: "Shorts header, search, and camera icons." },
      { id: "right_action_rail", x: 0.86, y: 0.45, width: 0.14, height: 0.37, description: "Like, dislike, comment, share, and remix buttons." },
      { id: "bottom_caption_area", x: 0, y: 0.82, width: 1, height: 0.18, description: "Channel, title, sound, and navigation bar." },
    ],
    recommended_caption_anchor: { x: 0.5, y: 0.7 },
  },
  instagram_feed: { orientation: "any", zones: titleSafeZones(), recommended_caption_anchor: { x: 0.5, y: 0.86 } },
  youtube: { orientation: "horizontal", zones: titleSafeZones(), recommended_caption_anchor: { x: 0.5, y: 0.86 } },
  linkedin: { orientation: "any", zones: titleSafeZones(), recommended_caption_anchor: { x: 0.5, y: 0.86 } },
  x: { orientation: "any", zones: titleSafeZones(), recommended_caption_anchor: { x: 0.5, y: 0.86 } },
};

const safeZoneRecommendation = (): Record<SafeZonePlatform, { x: number; y: number }> => {
  const out = {} as Record<SafeZonePlatform, { x: number; y: number }>;
  for (const platform of SAFE_ZONE_PLATFORMS) out[platform] = { ...PLATFORM_SAFE_ZONES[platform].recommended_caption_anchor };
  return out;
};

const STYLE_PRESETS: Record<CaptionStylePreset, Omit<CaptionStyleDescriptor, "preset" | "safe_zone_recommendation" | "note" | "alignment">> = {
  clean: { font_family_suggestion: "Inter, Helvetica Neue, Arial", font_weight: "600", font_size_percent_of_height: 4.5, position: { x: 0.5, y: 0.82 }, stroke: false, background: true, word_highlight: false, uppercase_recommended: false },
  bold_pop: { font_family_suggestion: "Montserrat ExtraBold, Impact, Arial Black", font_weight: "800", font_size_percent_of_height: 6, position: { x: 0.5, y: 0.68 }, stroke: true, background: false, word_highlight: false, uppercase_recommended: true },
  karaoke: { font_family_suggestion: "Montserrat ExtraBold, Poppins Bold, Arial Black", font_weight: "800", font_size_percent_of_height: 6, position: { x: 0.5, y: 0.68 }, stroke: true, background: false, word_highlight: true, uppercase_recommended: true },
  podcast: { font_family_suggestion: "Inter, SF Pro Display, Helvetica Neue", font_weight: "600", font_size_percent_of_height: 4.2, position: { x: 0.5, y: 0.8 }, stroke: false, background: true, word_highlight: false, uppercase_recommended: false },
  lecture: { font_family_suggestion: "Source Sans 3, Roboto, Arial", font_weight: "500", font_size_percent_of_height: 4, position: { x: 0.5, y: 0.88 }, stroke: false, background: true, word_highlight: false, uppercase_recommended: false },
};

export function describeCaptionStyle(preset: CaptionStylePreset): CaptionStyleDescriptor {
  const base = STYLE_PRESETS[preset];
  return {
    preset,
    ...base,
    position: { ...base.position },
    alignment: "center",
    safe_zone_recommendation: safeZoneRecommendation(),
    note: "Documentation only. SRT/VTT artifacts carry timing and text; apply visual styling in Premiere's caption track style after import.",
  };
}

// ---------------------------------------------------------------------------
// Cue construction
// ---------------------------------------------------------------------------

type WorkingWord = TranscriptWord & { start_ms: number; end_ms: number; clean: string };
type WorkingCue = { words: WorkingWord[]; start_ms: number; end_ms: number };

const toMs = (seconds: number) => Math.round(seconds * 1000);
const msToSeconds = (ms: number) => Number((ms / 1000).toFixed(3));

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function formatCaptionTimestamp(ms: number, format: CaptionFormat): string {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}${format === "srt" ? "," : "."}${pad(millis, 3)}`;
}

/** Greedy word wrap that never splits a word; a single word longer than the width occupies its own line. */
export function wrapCaptionWords(words: readonly string[], maxChars: number): string[][] {
  const lines: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const word of words) {
    const next = current.length ? length + 1 + word.length : word.length;
    if (current.length && next > maxChars) {
      lines.push(current);
      current = [word];
      length = word.length;
    } else {
      current.push(word);
      length = next;
    }
  }
  if (current.length) lines.push(current);
  return lines;
}

/** Even split of `count` items into `parts` groups, front-loaded by remainder (3+3 rather than 4+2). */
function balancedSizes(count: number, parts: number): number[] {
  const base = Math.floor(count / parts);
  const remainder = count % parts;
  return Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0));
}

function packPhrase(words: WorkingWord[], options: CaptionAuthoringOptions, warnings: string[]): WorkingCue[] {
  const cues: WorkingCue[] = [];
  const maxMs = toMs(options.max_cue_seconds);
  const targets = balancedSizes(words.length, Math.ceil(words.length / options.words_per_cue));
  let targetIndex = 0;
  let current: WorkingWord[] = [];
  const flush = () => {
    if (!current.length) return;
    cues.push({ words: current, start_ms: current[0].start_ms, end_ms: current[current.length - 1].end_ms });
    current = [];
    targetIndex = Math.min(targetIndex + 1, targets.length - 1);
  };
  for (const word of words) {
    if (current.length) {
      const candidate = [...current, word];
      const lines = wrapCaptionWords(candidate.map((item) => item.clean), options.max_chars_per_line);
      const tooLong = word.end_ms - current[0].start_ms > maxMs;
      if (current.length >= targets[targetIndex] || lines.length > options.max_lines || tooLong) flush();
    }
    if (word.clean.length > options.max_chars_per_line) warnings.push(`word "${word.clean}" is longer than max_chars_per_line (${options.max_chars_per_line}) and was kept whole on its own line`);
    current.push(word);
  }
  flush();
  return cues;
}

function buildCues(words: WorkingWord[], options: CaptionAuthoringOptions, warnings: string[]): WorkingCue[] {
  const cues: WorkingCue[] = [];
  for (const range of sentenceRanges(words, SENTENCE_GAP_SECONDS)) {
    let phraseStart = range.startIndex;
    for (let index = range.startIndex + 1; index <= range.endIndex + 1; index += 1) {
      const speakerChanged = index <= range.endIndex && (words[index].speaker_label ?? "") !== (words[index - 1].speaker_label ?? "");
      if (index > range.endIndex || speakerChanged) {
        cues.push(...packPhrase(words.slice(phraseStart, index), options, warnings));
        phraseStart = index;
      }
    }
  }
  if (cues.length > MAX_CAPTION_CUES) fail(`caption artifact would contain ${cues.length} cues; the limit is ${MAX_CAPTION_CUES}`);

  for (let index = 1; index < cues.length; index += 1) {
    const prev = cues[index - 1];
    const cue = cues[index];
    if (cue.start_ms >= prev.end_ms) continue;
    if (cue.start_ms > prev.start_ms) {
      warnings.push(`cue ${index} end trimmed to ${formatCaptionTimestamp(cue.start_ms, options.format)} to avoid overlapping cue ${index + 1}`);
      prev.end_ms = cue.start_ms;
    } else {
      warnings.push(`cue ${index + 1} start pushed to ${formatCaptionTimestamp(prev.end_ms, options.format)} because its words share a start time with cue ${index}`);
      cue.start_ms = prev.end_ms;
      if (cue.end_ms <= cue.start_ms) cue.end_ms = cue.start_ms + 1;
    }
  }

  const minMs = toMs(options.min_cue_seconds);
  const maxMs = toMs(options.max_cue_seconds);
  const mergeMs = toMs(options.merge_gap_seconds);
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    const next = cues[index + 1];
    let desired = Math.max(cue.end_ms, cue.start_ms + minMs);
    if (next && next.start_ms - desired < mergeMs) desired = next.start_ms;
    cue.end_ms = next ? Math.min(desired, next.start_ms) : desired;
    if (cue.end_ms - cue.start_ms < minMs) warnings.push(`cue ${index + 1} is shorter than min_cue_seconds because cue ${index + 2} starts at ${formatCaptionTimestamp(next!.start_ms, options.format)}`);
    if (cue.end_ms - cue.start_ms > maxMs) {
      cue.end_ms = cue.start_ms + maxMs;
      warnings.push(`cue ${index + 1} shortened to max_cue_seconds (${options.max_cue_seconds}s)`);
    }
  }
  return cues;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function escapeVtt(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderWord(word: WorkingWord, options: CaptionAuthoringOptions, emphasis: Set<string>): string {
  let text = options.uppercase ? word.clean.toLocaleUpperCase() : word.clean;
  if (options.format === "vtt") text = escapeVtt(text);
  if (emphasis.size && emphasis.has(normalizeToken(word.clean))) text = options.format === "vtt" ? `<c.emphasis>${text}</c>` : `<b>${text}</b>`;
  return text;
}

function renderCueText(cue: WorkingCue, options: CaptionAuthoringOptions, emphasis: Set<string>): { text: string; lineCount: number } {
  const lines = wrapCaptionWords(cue.words.map((word) => word.clean), options.max_chars_per_line);
  let wordIndex = 0;
  let previousStamp = cue.start_ms;
  const rendered = lines.map((line) => line.map(() => {
    const word = cue.words[wordIndex];
    const first = wordIndex === 0;
    wordIndex += 1;
    const body = renderWord(word, options, emphasis);
    if (!options.karaoke || first) return body;
    let stamp = Math.max(word.start_ms, previousStamp + 1);
    stamp = Math.min(stamp, Math.max(cue.end_ms - 1, previousStamp + 1));
    previousStamp = stamp;
    return `<${formatCaptionTimestamp(stamp, "vtt")}>${body}`;
  }).join(" "));
  const speaker = cue.words[0].speaker_label;
  if (options.speaker_prefix && speaker) {
    const name = speaker.replace(/[<>\n\r]/g, "").trim();
    rendered[0] = options.format === "vtt" ? `<v ${name}>${rendered[0]}` : `${name}: ${rendered[0]}`;
  }
  return { text: rendered.join("\n"), lineCount: rendered.length };
}

export function renderCaptionArtifact(cues: readonly CaptionCue[], format: CaptionFormat): string {
  const blocks = cues.map((cue) => `${cue.index}\n${formatCaptionTimestamp(toMs(cue.start_seconds), format)} --> ${formatCaptionTimestamp(toMs(cue.end_seconds), format)}\n${cue.text}\n`);
  const body = blocks.join("\n");
  return format === "vtt" ? `WEBVTT\n\n${body}` : body;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function buildCaptionArtifact(input: { word_timeline: unknown } & Record<string, unknown>): CaptionArtifactResult {
  const timeline: WordTimeline = validateWordTimeline(input.word_timeline);
  const options = normalizeCaptionAuthoringOptions(input);
  const warnings: string[] = [];
  const fillers = new Set(options.strip_fillers);
  const emphasis = new Set(options.emphasis_words);

  const working: WorkingWord[] = [];
  let stripped = 0;
  for (const word of timeline.words) {
    const clean = word.text.replace(/\s+/g, " ").trim();
    if (fillers.size && fillers.has(normalizeToken(clean))) {
      stripped += 1;
      continue;
    }
    working.push({ ...word, clean, start_ms: toMs(word.start_seconds), end_ms: Math.max(toMs(word.end_seconds), toMs(word.start_seconds) + 1) });
  }
  if (!working.length) fail("every word was removed by strip_fillers; nothing to caption");
  if (stripped) warnings.push(`stripped ${stripped} filler word(s) from the caption text`);
  if (options.style_preset === "karaoke" && !options.karaoke) warnings.push("style_preset karaoke has no word-level timestamps unless karaoke is true and format is vtt");
  if (options.max_lines > 1) warnings.push(`cues may wrap to ${options.max_lines} lines; verify readability at the chosen font size`);

  const workingCues = buildCues(working, options, warnings);
  const cues: CaptionCue[] = workingCues.map((cue, index) => {
    const { text, lineCount } = renderCueText(cue, options, emphasis);
    const speaker = cue.words[0].speaker_label;
    return {
      index: index + 1,
      start_seconds: msToSeconds(cue.start_ms),
      end_seconds: msToSeconds(cue.end_ms),
      text,
      line_count: lineCount,
      word_count: cue.words.length,
      ...(speaker ? { speaker_label: speaker } : {}),
    };
  });
  const wrapped = cues.filter((cue) => cue.line_count > 1).length;
  if (wrapped) warnings.push(`${wrapped} cue(s) wrapped onto multiple lines`);

  const artifactText = renderCaptionArtifact(cues, options.format);
  return {
    format: options.format,
    cue_count: cues.length,
    cues,
    artifact_text: artifactText,
    style: describeCaptionStyle(options.style_preset),
    warnings: [...new Set(warnings)],
    assumptions: [
      `Sentence boundaries come from terminal punctuation or pauses longer than ${SENTENCE_GAP_SECONDS}s; cues never cross them.`,
      "Cue timing is derived from word boundaries and rounded to milliseconds; verify sync after import.",
      "Style descriptors are recommendations for Premiere caption styling and are not encoded in the artifact.",
    ],
    options,
    plan_revision: digestWordTimeline(timeline, options),
    evidence: {
      source_project_item_id: timeline.source_project_item_id,
      transcript_revision: timeline.transcript_revision,
      word_count: timeline.words.length,
      words_used: working.length,
      words_stripped: stripped,
      duration_seconds: timeline.duration_seconds,
    },
  };
}

// ---------------------------------------------------------------------------
// Safe-zone check
// ---------------------------------------------------------------------------

export type SafeZoneElement = { id: string; x: number; y: number; width: number; height: number; kind: SafeZoneElementKind };

export type SafeZoneElementReport = SafeZoneElement & {
  overlaps: Array<{ zone_id: string; overlap_ratio: number }>;
  safe: boolean;
  suggested_position: { x: number; y: number } | null;
  pixel_rect: { x: number; y: number; width: number; height: number };
};

export type SafeZoneReport = {
  platform: SafeZonePlatform;
  frame: { width: number; height: number };
  aspect_ratio: number;
  orientation: "vertical" | "horizontal" | "square";
  zones: PlatformZone[];
  elements: SafeZoneElementReport[];
  all_safe: boolean;
  recommended_caption_anchor: { x: number; y: number };
  assumptions: string[];
  warnings: string[];
  plan_revision: string;
  evidence: { platform: SafeZonePlatform; frame: { width: number; height: number }; element_count: number };
};

const EPSILON = 1e-9;
const round4 = (value: number) => Number(value.toFixed(4));

function normalizedCoordinate(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(`${label} must be a number between ${min} and ${max}`);
  return value;
}

export function validateSafeZoneElements(value: unknown): SafeZoneElement[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SAFE_ZONE_ELEMENTS) fail(`elements must contain between 1 and ${MAX_SAFE_ZONE_ELEMENTS} entries`);
  const ids = new Set<string>();
  return value.map((raw, index) => {
    const label = `elements[${index}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(`${label} must be an object`);
    const item = raw as Record<string, unknown>;
    const unknown = Object.keys(item).find((key) => !["id", "x", "y", "width", "height", "kind"].includes(key));
    if (unknown) fail(`${label} has an unknown field: ${unknown}`);
    if (typeof item.id !== "string" || !item.id.trim() || item.id.length > 128) fail(`${label}.id must be a non-empty string of at most 128 characters`);
    const id = item.id.trim();
    if (ids.has(id)) fail(`elements contains duplicate id: ${id}`);
    ids.add(id);
    if (typeof item.kind !== "string" || !(SAFE_ZONE_ELEMENT_KINDS as readonly string[]).includes(item.kind)) fail(`${label}.kind must be one of: ${SAFE_ZONE_ELEMENT_KINDS.join(", ")}`);
    const element: SafeZoneElement = {
      id,
      x: normalizedCoordinate(item.x, `${label}.x`, 0, 1),
      y: normalizedCoordinate(item.y, `${label}.y`, 0, 1),
      width: normalizedCoordinate(item.width, `${label}.width`, 0, 1),
      height: normalizedCoordinate(item.height, `${label}.height`, 0, 1),
      kind: item.kind as SafeZoneElementKind,
    };
    if (element.width <= 0 || element.height <= 0) fail(`${label} width and height must be greater than 0`);
    if (element.x + element.width > 1 + EPSILON || element.y + element.height > 1 + EPSILON) fail(`${label} extends outside the frame`);
    return element;
  });
}

function overlapArea(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > EPSILON && height > EPSILON ? width * height : 0;
}

function clearsAllZones(rect: { x: number; y: number; width: number; height: number }, zones: readonly PlatformZone[]): boolean {
  return zones.every((zone) => overlapArea(rect, zone) === 0);
}

/**
 * Nearest top-left position (Euclidean) inside the frame that clears every
 * zone. The nearest point lies on the original coordinate, a zone edge, or a
 * frame edge on each axis, so the candidate grid is exact for axis-aligned rects.
 */
export function suggestSafePosition(element: SafeZoneElement, zones: readonly PlatformZone[]): { x: number; y: number } | null {
  if (clearsAllZones(element, zones)) return { x: round4(element.x), y: round4(element.y) };
  const xs = new Set<number>([element.x, 0, 1 - element.width]);
  const ys = new Set<number>([element.y, 0, 1 - element.height]);
  for (const zone of zones) {
    xs.add(zone.x - element.width);
    xs.add(zone.x + zone.width);
    ys.add(zone.y - element.height);
    ys.add(zone.y + zone.height);
  }
  let best: { x: number; y: number; distance: number } | null = null;
  const candidateXs = [...xs].filter((x) => x >= -EPSILON && x + element.width <= 1 + EPSILON).sort((a, b) => a - b);
  const candidateYs = [...ys].filter((y) => y >= -EPSILON && y + element.height <= 1 + EPSILON).sort((a, b) => a - b);
  for (const y of candidateYs) {
    for (const x of candidateXs) {
      if (!clearsAllZones({ x, y, width: element.width, height: element.height }, zones)) continue;
      const distance = Math.hypot(x - element.x, y - element.y);
      if (!best || distance < best.distance - EPSILON) best = { x, y, distance };
    }
  }
  return best ? { x: round4(Math.max(0, best.x)), y: round4(Math.max(0, best.y)) } : null;
}

export function checkCaptionSafeZone(input: { platform: unknown; frame: unknown; elements: unknown }): SafeZoneReport {
  const platform = input.platform;
  if (typeof platform !== "string" || !(SAFE_ZONE_PLATFORMS as readonly string[]).includes(platform)) fail(`platform must be one of: ${SAFE_ZONE_PLATFORMS.join(", ")}`);
  const frameRaw = input.frame;
  if (!frameRaw || typeof frameRaw !== "object" || Array.isArray(frameRaw)) fail("frame must be an object with integer width and height");
  const frame = frameRaw as Record<string, unknown>;
  const unknownFrameKey = Object.keys(frame).find((key) => key !== "width" && key !== "height");
  if (unknownFrameKey) fail(`frame has an unknown field: ${unknownFrameKey}`);
  for (const key of ["width", "height"] as const) {
    const value = frame[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_FRAME_DIMENSION || value > MAX_FRAME_DIMENSION) fail(`frame.${key} must be an integer between ${MIN_FRAME_DIMENSION} and ${MAX_FRAME_DIMENSION}`);
  }
  const width = frame.width as number;
  const height = frame.height as number;
  const elements = validateSafeZoneElements(input.elements);
  const profile = PLATFORM_SAFE_ZONES[platform as SafeZonePlatform];
  const warnings: string[] = [];
  const orientation = width > height ? "horizontal" : width < height ? "vertical" : "square";
  if (profile.orientation !== "any" && profile.orientation !== orientation) warnings.push(`${platform} overlays assume a ${profile.orientation} frame; the supplied frame is ${orientation} (${width}x${height})`);

  const reports: SafeZoneElementReport[] = elements.map((element) => {
    const area = element.width * element.height;
    const overlaps = profile.zones
      .map((zone) => ({ zone_id: zone.id, overlap_ratio: round4(overlapArea(element, zone) / area) }))
      .filter((entry) => entry.overlap_ratio > 0);
    const safe = overlaps.length === 0;
    const suggested = suggestSafePosition(element, profile.zones);
    if (!safe && !suggested) warnings.push(`element ${element.id} cannot fit anywhere in the frame without overlapping a ${platform} overlay zone; reduce its size`);
    return {
      ...element,
      overlaps,
      safe,
      suggested_position: suggested,
      pixel_rect: { x: Math.round(element.x * width), y: Math.round(element.y * height), width: Math.round(element.width * width), height: Math.round(element.height * height) },
    };
  });

  const evidence = { platform: platform as SafeZonePlatform, frame: { width, height }, element_count: elements.length };
  return {
    platform: platform as SafeZonePlatform,
    frame: { width, height },
    aspect_ratio: round4(width / height),
    orientation,
    zones: profile.zones.map((zone) => ({ ...zone })),
    elements: reports,
    all_safe: reports.every((report) => report.safe),
    recommended_caption_anchor: { ...profile.recommended_caption_anchor },
    assumptions: [
      "Overlay zones are approximate normalized rectangles derived from typical mobile app layouts; verify against current platform overlay guides.",
      "Overlay placement varies by device, app version, locale, and caption length; keep a margin beyond the listed zones.",
      "Suggested positions minimize top-left displacement and do not account for other on-screen elements.",
    ],
    warnings,
    plan_revision: `sha256:${createHash("sha256").update(JSON.stringify({ platform, frame: { width, height }, elements })).digest("hex")}`,
    evidence,
  };
}
