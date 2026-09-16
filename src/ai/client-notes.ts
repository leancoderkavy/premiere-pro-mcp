import { createHash } from "node:crypto";

/**
 * Client / reviewer note triage (local-only).
 *
 * Editors paste feedback from email, chat, or a review tool and want a
 * checklist plus timeline markers, not another pass of re-reading. This
 * planner turns free text into structured items: it finds timecodes and
 * ranges, classifies each note into an editorial category, infers a priority
 * from the wording, separates approvals and questions from change requests,
 * and emits an `add_markers_batch` payload.
 *
 * Everything is deterministic lexical work. Nothing contacts a model, the
 * network, or Premiere; the caller applies the markers through the routes
 * returned in the plan.
 */

export const MAX_NOTES_BYTES = 64 * 1024;
export const MAX_NOTE_ITEMS = 500;
export const DEFAULT_MAX_NOTE_ITEMS = 200;
export const MAX_MARKER_NAME_LENGTH = 60;

export const NOTE_CATEGORIES = [
  "audio",
  "color",
  "graphics",
  "text",
  "timing",
  "cut",
  "legal",
  "delivery",
  "other",
] as const;
export type NoteCategory = (typeof NOTE_CATEGORIES)[number];

export const NOTE_PRIORITIES = ["must", "should", "nice"] as const;
export type NotePriority = (typeof NOTE_PRIORITIES)[number];

export const NOTE_KINDS = ["change", "question", "approval"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const MARKER_COLOR_MODES = ["priority", "category", "fixed"] as const;
export type MarkerColorMode = (typeof MARKER_COLOR_MODES)[number];

export const TIMECODE_STYLES = ["auto", "clock", "frames"] as const;
/**
 * How a three-part `a:b:c` timecode is read. `clock` means hh:mm:ss,
 * `frames` means mm:ss:ff, and `auto` picks `frames` only when the last
 * field is a plausible frame number below the frame rate and the first field
 * is too large to be an hour count in a normal edit (>= 10).
 */
export type TimecodeStyle = (typeof TIMECODE_STYLES)[number];

export const CLIENT_NOTES_ROUTES = Object.freeze([
  "add_markers_batch",
  "list_markers",
  "export_sequence_marker_review_frames",
  "inspect_sequence_review_report",
]);

/** Premiere marker color indexes as used by add_marker / add_markers_batch. */
export const MARKER_COLORS = Object.freeze({
  green: 0,
  red: 1,
  purple: 2,
  orange: 3,
  yellow: 4,
  white: 5,
  blue: 6,
  cyan: 7,
});

const PRIORITY_COLORS: Readonly<Record<NotePriority, number>> = Object.freeze({
  must: MARKER_COLORS.red,
  should: MARKER_COLORS.orange,
  nice: MARKER_COLORS.green,
});

const CATEGORY_COLORS: Readonly<Record<NoteCategory, number>> = Object.freeze({
  audio: MARKER_COLORS.blue,
  color: MARKER_COLORS.purple,
  graphics: MARKER_COLORS.cyan,
  text: MARKER_COLORS.yellow,
  timing: MARKER_COLORS.orange,
  cut: MARKER_COLORS.red,
  legal: MARKER_COLORS.white,
  delivery: MARKER_COLORS.green,
  other: MARKER_COLORS.white,
});

const CATEGORY_LEXICON: ReadonlyArray<{ category: NoteCategory; terms: readonly string[] }> = [
  { category: "legal", terms: ["legal", "rights", "licens", "clearance", "disclaimer", "trademark", "copyright", "brand guideline", "compliance", "blur the", "blur out", "release form", "permission"] },
  { category: "audio", terms: ["audio", "sound", "music", "volume", "loud", "quiet", "mix", "sfx", "voiceover", "voice over", "voice-over", "vo ", "levels", "hum", "noise", "duck", "mute", "bass", "hiss", "clipping", "peak", "lufs", "db", "track 2", "score", "ambience", "room tone", "eq "] },
  { category: "color", terms: ["color", "colour", "grade", "grading", "exposure", "too bright", "too dark", "saturat", "white balance", "lut", "skin tone", "contrast", "tint", "washed out", "crushed", "lumetri", "warmer", "cooler", "highlight", "shadow", "match the look"] },
  { category: "text", terms: ["caption", "subtitle", "spelling", "typo", "misspell", "font", "wording", "copy says", "lower third text", "the text", "name is wrong", "title says", "reads ", "grammar", "apostrophe", "capitaliz"] },
  { category: "graphics", terms: ["logo", "lower third", "lower-third", "title card", "graphic", "mogrt", "animation", "end card", "endcard", "bug", "watermark", "overlay", "supers", "chyron", "callout", "icon", "cta"] },
  { category: "delivery", terms: ["export", "deliver", "resolution", "aspect", "vertical", "square", "4k", "1080", "file size", "format", "codec", "thumbnail", "frame rate", "letterbox", "safe area", "safe zone", "version for", "cutdown", "cut-down", "cut down to"] },
  { category: "timing", terms: ["too long", "too short", "pacing", "tighten", "trim", "hold longer", "hold on", "faster", "slower", "drags", "speed up", "slow down", "extend", "shorten", "lingers", "rushed", "breathe", "beat", "a few frames", "frames early", "frames late", "linger"] },
  { category: "cut", terms: ["cut", "remove", "delete", "swap", "reorder", "move", "replace", "b-roll", "broll", "b roll", "shot", "take", "transition", "dissolve", "jump cut", "angle", "insert", "lose the", "drop the", "start on", "end on", "open with", "close with", "reverse"] },
];

const MUST_PATTERN = /\b(must|urgent|asap|blocker|blocking|critical|required|has to|have to|need to|needs to|non-negotiable|mandatory|cannot ship|can't ship|before we ship|before delivery|legal)\b/i;
const NICE_PATTERN = /\b(nice to have|nice-to-have|if possible|if you can|if there's time|if there is time|optional|maybe|consider|could we|might be|when you get a chance|not a big deal|low priority|minor|small thing)\b/i;
const APPROVAL_PATTERN = /^(?:[\s\p{P}]*)(approved|approve|looks great|looks good|love it|love this|perfect|great job|nice work|all good|no notes|lgtm|good to go|ship it|works for me|thumbs up|amazing|beautiful)\b/iu;
const APPROVAL_ANYWHERE = /\b(approved|no notes|good to go|ship it|lgtm|works for me|no changes)\b/i;
const NEGATION_NEAR_APPROVAL = /\b(not|isn't|isnt|don't|dont|doesn't|doesnt|but|except|however|although)\b/i;

const BULLET_PREFIX = /^\s*(?:[-*•‣◦▪●]+|\d{1,3}[.)]|[a-z][.)]|\[\s?\]|\[x\]|>+)\s+/i;
const SPEAKER_PREFIX = /^\s*(?:[A-Z][\w .'-]{0,40}|\p{Lu}[\p{L} .'-]{0,40})\s*:(?:\s+(?=\S)|\s*$)/u;
const RANGE_SEPARATOR = /\s*(?:-|–|—|to|thru|through|until|till|→|->)\s*/i;

const TIMECODE_TOKEN = String.raw`(?:\d{1,2}:\d{2}(?::\d{2})?(?:[:;.]\d{1,3})?|\d{1,3}\s*m(?:in)?\s*\d{1,2}\s*s(?:ec)?|\d{1,4}\s*s(?:ec)?\b)`;
const TIMECODE_PATTERN = new RegExp(String.raw`(?<![\w.])(${TIMECODE_TOKEN})(?:${RANGE_SEPARATOR.source}(${TIMECODE_TOKEN}))?(?![\w:])`, "giu");

export type ClientNoteOptions = {
  notes?: unknown;
  frame_rate?: unknown;
  sequence_duration_seconds?: unknown;
  timecode_style?: unknown;
  marker_color_mode?: unknown;
  fixed_marker_color?: unknown;
  marker_name_prefix?: unknown;
  include_approvals_as_markers?: unknown;
  max_items?: unknown;
};

export type ClientNoteItem = {
  index: number;
  text: string;
  raw_line: string;
  line_number: number;
  kind: NoteKind;
  category: NoteCategory;
  priority: NotePriority;
  reviewer: string | null;
  time_seconds: number | null;
  end_seconds: number | null;
  frame: number | null;
  timecode: string | null;
  duration_seconds: number | null;
  also_mentioned_seconds: number[];
  out_of_range: boolean;
  marker: ClientNoteMarker | null;
};

export type ClientNoteMarker = {
  time_seconds: number;
  name: string;
  comments: string;
  color: number;
  duration_seconds: number;
};

export type ClientNotesPlan = {
  applied: boolean;
  plan_revision: string;
  frame_rate: number;
  counts: {
    lines: number;
    items: number;
    timed: number;
    untimed: number;
    ranges: number;
    out_of_range: number;
    markers: number;
    by_kind: Record<NoteKind, number>;
    by_category: Record<NoteCategory, number>;
    by_priority: Record<NotePriority, number>;
  };
  items: ClientNoteItem[];
  markers: ClientNoteMarker[];
  checklist_markdown: string;
  routes: readonly string[];
  next_steps: string[];
  warnings: string[];
  assumptions: string[];
};

function fail(message: string): never {
  throw new Error(message);
}

function round3(value: number): number {
  return Number(value.toFixed(3));
}

function boundedNumber(value: unknown, label: string, minimum: number, maximum: number, fallback: number, integer = false): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) fail(`${label} must be a finite number from ${minimum} through ${maximum}`);
  if (integer && !Number.isInteger(value)) fail(`${label} must be an integer`);
  return value;
}

function optionalEnum<T extends string>(value: unknown, label: string, allowed: readonly T[], fallback: T): T {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) fail(`${label} must be one of: ${allowed.join(", ")}`);
  return value as T;
}

function optionalBoolean(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") fail(`${label} must be a boolean`);
  return value;
}

function optionalShortString(value: unknown, label: string, maxLength: number): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > maxLength) fail(`${label} must be a string of at most ${maxLength} characters`);
  return value.trim();
}

/** Formats seconds as hh:mm:ss:ff (non-drop) for the given frame rate. */
export function secondsToTimecode(seconds: number, fps: number): string {
  const totalFrames = Math.round(seconds * fps);
  const nominal = Math.round(fps);
  const frames = totalFrames % nominal;
  const totalSeconds = Math.floor(totalFrames / nominal);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}:${pad(frames)}`;
}

/**
 * Parses one timecode token into seconds. Returns null when the token cannot
 * be a timecode (for example `12:75`).
 */
export function parseTimecodeToken(token: string, fps: number, style: TimecodeStyle): number | null {
  const compact = token.trim().toLowerCase().replace(/\s+/g, "");
  const minSec = compact.match(/^(\d{1,3})m(?:in)?(\d{1,2})s(?:ec)?$/);
  if (minSec) {
    const minutes = Number(minSec[1]);
    const seconds = Number(minSec[2]);
    if (seconds > 59) return null;
    return minutes * 60 + seconds;
  }
  const onlySec = compact.match(/^(\d{1,4})s(?:ec)?$/);
  if (onlySec) return Number(onlySec[1]);

  const parts = compact.split(/[:;.]/).map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  const hasFractionalSeparator = /[.]\d+$/.test(compact);
  const nominal = Math.round(fps);

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    if (seconds > 59) return null;
    return minutes * 60 + seconds;
  }
  if (parts.length === 3) {
    const [a, b, c] = parts;
    if (hasFractionalSeparator) {
      if (b > 59) return null;
      const fraction = Number(`0.${compact.split(".")[1]}`);
      return a * 60 + b + fraction;
    }
    if (b > 59) return null;
    const readAsFrames = style === "frames" || (style === "auto" && c < nominal && a >= 10 && c <= 59);
    if (readAsFrames) {
      if (c >= nominal) return null;
      return a * 60 + b + c / fps;
    }
    if (c > 59) return null;
    return a * 3600 + b * 60 + c;
  }
  if (parts.length === 4) {
    const [hours, minutes, seconds, frames] = parts;
    if (minutes > 59 || seconds > 59) return null;
    if (hasFractionalSeparator) {
      const fraction = Number(`0.${compact.split(".")[1]}`);
      return hours * 3600 + minutes * 60 + seconds + fraction;
    }
    if (frames >= nominal) return null;
    return hours * 3600 + minutes * 60 + seconds + frames / fps;
  }
  return null;
}

type ExtractedTimes = { start: number | null; end: number | null; others: number[]; stripped: string };

function extractTimecodes(line: string, fps: number, style: TimecodeStyle): ExtractedTimes {
  let start: number | null = null;
  let end: number | null = null;
  const others: number[] = [];
  const stripped = line.replace(TIMECODE_PATTERN, (match: string, first: string, second?: string) => {
    const firstSeconds = parseTimecodeToken(first, fps, style);
    if (firstSeconds === null) return match;
    const secondSeconds = second ? parseTimecodeToken(second, fps, style) : null;
    if (start === null) {
      start = firstSeconds;
      if (secondSeconds !== null && secondSeconds > firstSeconds) end = secondSeconds;
      else if (secondSeconds !== null) others.push(secondSeconds);
    } else {
      others.push(firstSeconds);
      if (secondSeconds !== null) others.push(secondSeconds);
    }
    return " ";
  });
  return { start, end, others, stripped };
}

const LEADING_PUNCTUATION = /^(?:[-–—:,;.@()[\]]+\s*)+/;
const LEADING_CONNECTOR = /^(?:at|around|near|from|starting at|starting|about)\b[\s:,-]*/i;

function cleanText(value: string): string {
  return value
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(LEADING_PUNCTUATION, "")
    .replace(LEADING_CONNECTOR, "")
    .replace(LEADING_PUNCTUATION, "")
    .replace(/\s*[-–—:,;]+\s*$/, "")
    .trim();
}

/** Labels that look like `Name:` prefixes but describe the note, not a reviewer. */
const NON_REVIEWER_LABELS = new Set([
  "note", "notes", "general", "overall", "feedback", "comment", "comments", "todo", "to do", "fix", "fixes",
  "question", "questions", "q", "a", "audio", "video", "color", "colour", "graphics", "text", "timing", "cut",
  "cuts", "legal", "delivery", "export", "music", "sound", "captions", "subtitles", "title", "titles", "logo",
  "intro", "outro", "ending", "opening", "section", "part", "scene", "shot", "sequence", "timeline", "v1", "v2", "v3",
  "round", "round 1", "round 2", "round 3", "priority", "urgent", "must", "should", "nice to have", "optional",
]);

function classifyCategory(text: string): NoteCategory {
  const lower = ` ${text.toLowerCase()} `;
  let best: NoteCategory = "other";
  let bestScore = 0;
  for (const { category, terms } of CATEGORY_LEXICON) {
    let score = 0;
    for (const term of terms) if (lower.includes(term)) score += term.length > 5 ? 2 : 1;
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  return best;
}

function classifyKind(text: string): NoteKind {
  const trimmed = text.trim();
  if (/\?\s*$/.test(trimmed) && !/\b(can you|could you|please)\b/i.test(trimmed)) return "question";
  if (APPROVAL_PATTERN.test(trimmed) && !NEGATION_NEAR_APPROVAL.test(trimmed)) return "approval";
  if (APPROVAL_ANYWHERE.test(trimmed) && !NEGATION_NEAR_APPROVAL.test(trimmed) && trimmed.split(/\s+/).length <= 8) return "approval";
  return "change";
}

function classifyPriority(text: string, kind: NoteKind): NotePriority {
  if (kind === "approval") return "nice";
  if (MUST_PATTERN.test(text)) return "must";
  if (NICE_PATTERN.test(text)) return "nice";
  return "should";
}

function extractReviewer(line: string): { reviewer: string | null; rest: string } {
  const match = line.match(SPEAKER_PREFIX);
  if (!match) return { reviewer: null, rest: line };
  const label = match[0].replace(/:\s*$/, "").trim();
  // A leading timecode like "1:23:" or a section label like "Audio:" is not a reviewer name.
  if (/\d/.test(label) || label.length > 40 || label.split(/\s+/).length > 3) return { reviewer: null, rest: line };
  if (NON_REVIEWER_LABELS.has(label.toLowerCase())) return { reviewer: null, rest: line };
  return { reviewer: label, rest: line.slice(match[0].length) };
}

function markerName(item: Pick<ClientNoteItem, "category" | "priority" | "text">, prefix: string): string {
  const head = `${prefix ? `${prefix} ` : ""}[${item.category}${item.priority === "must" ? "!" : ""}] `;
  const room = Math.max(8, MAX_MARKER_NAME_LENGTH - head.length);
  const body = item.text.length > room ? `${item.text.slice(0, room - 1).trimEnd()}…` : item.text;
  return `${head}${body}`;
}

function checklistLine(item: ClientNoteItem): string {
  const box = item.kind === "approval" ? "[x]" : "[ ]";
  const when = item.timecode ? `${item.timecode}${item.end_seconds !== null ? `→${secondsToTimecodeShort(item.end_seconds)}` : ""} ` : "";
  const meta = item.kind === "approval" ? "approval" : `${item.category}, ${item.priority}${item.kind === "question" ? ", question" : ""}`;
  const who = item.reviewer ? ` — ${item.reviewer}` : "";
  const flag = item.out_of_range ? " ⚠ beyond sequence duration" : "";
  return `- ${box} ${when}(${meta}) ${item.text}${who}${flag}`;
}

function secondsToTimecodeShort(seconds: number): string {
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function emptyCounts<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

/** Turns pasted reviewer feedback into a checklist and marker payloads. */
export function planClientNotesChecklist(options: ClientNoteOptions): ClientNotesPlan {
  if (typeof options.notes !== "string" || !options.notes.trim()) fail("notes must be a non-empty string");
  if (Buffer.byteLength(options.notes, "utf8") > MAX_NOTES_BYTES) fail(`notes must be at most ${MAX_NOTES_BYTES} bytes`);
  const fps = boundedNumber(options.frame_rate, "frame_rate", 1, 240, 30);
  const duration = options.sequence_duration_seconds === undefined
    ? null
    : boundedNumber(options.sequence_duration_seconds, "sequence_duration_seconds", 0, 86_400, 0);
  const style = optionalEnum(options.timecode_style, "timecode_style", TIMECODE_STYLES, "auto");
  const colorMode = optionalEnum(options.marker_color_mode, "marker_color_mode", MARKER_COLOR_MODES, "priority");
  const fixedColor = boundedNumber(options.fixed_marker_color, "fixed_marker_color", 0, 7, MARKER_COLORS.orange, true);
  const prefix = optionalShortString(options.marker_name_prefix, "marker_name_prefix", 24);
  const includeApprovals = optionalBoolean(options.include_approvals_as_markers, "include_approvals_as_markers", false);
  const maxItems = boundedNumber(options.max_items, "max_items", 1, MAX_NOTE_ITEMS, DEFAULT_MAX_NOTE_ITEMS, true);

  const warnings: string[] = [];
  const assumptions: string[] = [
    "Timecodes are read as sequence time, not source time; two-part values are mm:ss and four-part values are hh:mm:ss:ff.",
    `Three-part values follow timecode_style=${style}${style === "auto" ? " (hh:mm:ss unless the first field is 10 or more and the last field is below the frame rate)" : ""}.`,
    "Categories and priorities come from a fixed keyword lexicon; a human reviewer should confirm them before the notes drive edits.",
  ];

  const lines = options.notes.replace(/\r\n?/g, "\n").split("\n");
  const items: ClientNoteItem[] = [];
  let carriedReviewer: string | null = null;
  let truncated = 0;

  for (const [lineIndex, sourceLine] of lines.entries()) {
    const trimmed = sourceLine.trim();
    if (!trimmed) continue;
    const withoutBullet = trimmed.replace(BULLET_PREFIX, "");
    const { reviewer, rest } = extractReviewer(withoutBullet);
    if (reviewer && !rest.trim()) {
      carriedReviewer = reviewer;
      continue;
    }
    if (reviewer) carriedReviewer = reviewer;
    const times = extractTimecodes(rest, fps, style);
    if (times.start === null && /:\s*$/.test(withoutBullet)) {
      // "Round 2 notes:" style section headers carry no action of their own.
      continue;
    }
    const text = cleanText(times.stripped);
    if (!text) {
      // A bare timecode line such as "01:23" cannot become an actionable item.
      warnings.push(`Line ${lineIndex + 1} contains only a timecode and was skipped.`);
      continue;
    }
    if (items.length >= maxItems) {
      truncated++;
      continue;
    }
    const kind = classifyKind(text);
    const category = kind === "approval" ? "other" : classifyCategory(text);
    const priority = classifyPriority(text, kind);
    const start = times.start;
    const outOfRange = duration !== null && start !== null && start > duration + 1 / fps;
    const frame = start === null ? null : Math.round(start * fps);
    const end = times.end !== null && start !== null && times.end > start ? times.end : null;
    const item: ClientNoteItem = {
      index: items.length,
      text,
      raw_line: trimmed.slice(0, 1_000),
      line_number: lineIndex + 1,
      kind,
      category,
      priority,
      reviewer: reviewer ?? carriedReviewer,
      time_seconds: start === null ? null : round3(start),
      end_seconds: end === null ? null : round3(end),
      frame,
      timecode: start === null ? null : secondsToTimecode(start, fps),
      duration_seconds: end === null ? null : round3(end - start!),
      also_mentioned_seconds: times.others.map(round3),
      out_of_range: outOfRange,
      marker: null,
    };
    const wantsMarker = start !== null && !outOfRange && (kind !== "approval" || includeApprovals);
    if (wantsMarker) {
      const color = colorMode === "fixed" ? fixedColor : colorMode === "category" ? CATEGORY_COLORS[category] : PRIORITY_COLORS[priority];
      item.marker = {
        time_seconds: round3(frame! / fps),
        name: markerName(item, prefix),
        comments: `${priority.toUpperCase()} · ${category}${item.reviewer ? ` · ${item.reviewer}` : ""}\n${text}`,
        color,
        duration_seconds: end === null ? 0 : round3(Math.max(0, Math.round((end - start!) * fps) / fps)),
      };
    }
    items.push(item);
  }

  if (items.length === 0) fail("notes did not contain any actionable lines");
  if (truncated > 0) warnings.push(`${truncated} note line(s) beyond max_items=${maxItems} were not converted.`);
  const outOfRangeCount = items.filter((item) => item.out_of_range).length;
  if (outOfRangeCount > 0) warnings.push(`${outOfRangeCount} note(s) reference a time beyond sequence_duration_seconds and were kept in the checklist without a marker.`);
  const untimed = items.filter((item) => item.time_seconds === null).length;
  if (untimed > 0) warnings.push(`${untimed} note(s) have no timecode; they appear in the checklist but not in the marker payload.`);
  const ambiguousThreePart = /(?<!\d)\d{1,2}:\d{2}:\d{2}(?![:;.\d])/.test(options.notes);
  if (ambiguousThreePart && style === "auto") warnings.push("Three-part timecodes were found; pass timecode_style=frames if the reviewer meant mm:ss:ff.");

  const markers = items
    .map((item) => item.marker)
    .filter((marker): marker is ClientNoteMarker => marker !== null)
    .sort((left, right) => left.time_seconds - right.time_seconds);

  const counts = {
    lines: lines.filter((line) => line.trim()).length,
    items: items.length,
    timed: items.length - untimed,
    untimed,
    ranges: items.filter((item) => item.end_seconds !== null).length,
    out_of_range: outOfRangeCount,
    markers: markers.length,
    by_kind: emptyCounts(NOTE_KINDS),
    by_category: emptyCounts(NOTE_CATEGORIES),
    by_priority: emptyCounts(NOTE_PRIORITIES),
  };
  for (const item of items) {
    counts.by_kind[item.kind]++;
    counts.by_category[item.category]++;
    counts.by_priority[item.priority]++;
  }

  const ordered = [...items].sort((left, right) => {
    const priorityRank = NOTE_PRIORITIES.indexOf(left.priority) - NOTE_PRIORITIES.indexOf(right.priority);
    if (left.kind !== right.kind) return left.kind === "approval" ? 1 : right.kind === "approval" ? -1 : 0;
    if (priorityRank !== 0) return priorityRank;
    return (left.time_seconds ?? Number.POSITIVE_INFINITY) - (right.time_seconds ?? Number.POSITIVE_INFINITY);
  });
  const checklist = [
    `## Review checklist (${counts.items} items, ${counts.by_priority.must} must / ${counts.by_priority.should} should / ${counts.by_priority.nice} nice)`,
    ...ordered.map(checklistLine),
  ].join("\n");

  const revision = `sha256:${createHash("sha256")
    .update(JSON.stringify({ notes: options.notes, fps, duration, style, colorMode, fixedColor, prefix, includeApprovals, maxItems }))
    .digest("hex")}`;

  return {
    applied: false,
    plan_revision: revision,
    frame_rate: fps,
    counts,
    items,
    markers,
    checklist_markdown: checklist,
    routes: CLIENT_NOTES_ROUTES,
    next_steps: [
      markers.length > 0
        ? `Review the ${markers.length} marker payload(s), then call add_markers_batch with markers to place them on the active sequence.`
        : "No timed notes produced markers; work from checklist_markdown or ask the reviewer for timecodes.",
      "After edits, call list_markers or export_sequence_marker_review_frames to gather evidence for each resolved note.",
    ],
    warnings,
    assumptions,
  };
}
