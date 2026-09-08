import { createHash } from "node:crypto";

/**
 * Word-timed transcript evidence shared by local planning tools.
 *
 * The timeline is caller-supplied and revision-bound: every plan derived from
 * it carries the transcript revision so a later apply step can refuse stale
 * evidence. Nothing here contacts Premiere, a provider, or a model.
 */
export type TranscriptWord = {
  text: string;
  start_seconds: number;
  end_seconds: number;
  speaker_label?: string;
  confidence?: number;
};

export type WordTimeline = {
  source_project_item_id: string;
  transcript_revision: string;
  words: TranscriptWord[];
  duration_seconds: number;
  speakers: string[];
};

export const MAX_TIMELINE_WORDS = 20_000;
export const MAX_WORD_SECONDS = 86_400;
const OVERLAP_TOLERANCE_SECONDS = 0.05;
const TRANSCRIPT_REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/;

/** JSON-schema fragment for a `word_timeline` tool parameter. */
export const WORD_TIMELINE_PARAMETER = {
  type: "object",
  additionalProperties: false,
  description:
    "Caller-supplied word-timed transcript for one Premiere source item. Words must be ordered by start time and bound to the transcript revision returned by get_clip_transcript_uxp.",
  properties: {
    source_project_item_id: { type: "string", minLength: 1, maxLength: 512, description: "Exact Premiere source project-item ID." },
    transcript_revision: { type: "string", pattern: "^sha256:[a-f0-9]{64}$", description: "Revision returned by get_clip_transcript_uxp." },
    words: {
      type: "array",
      minItems: 1,
      maxItems: MAX_TIMELINE_WORDS,
      description: "Ordered word tokens with source-time boundaries.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string", minLength: 1, maxLength: 128, description: "Word token, punctuation allowed." },
          start_seconds: { type: "number", minimum: 0, maximum: MAX_WORD_SECONDS, description: "Word start in source seconds." },
          end_seconds: { type: "number", exclusiveMinimum: 0, maximum: MAX_WORD_SECONDS, description: "Word end in source seconds." },
          speaker_label: { type: "string", minLength: 1, maxLength: 128, description: "Optional caller-normalized speaker label." },
          confidence: { type: "number", minimum: 0, maximum: 1, description: "Optional recognizer confidence." },
        },
        required: ["text", "start_seconds", "end_seconds"],
      },
    },
  },
  required: ["source_project_item_id", "transcript_revision", "words"],
} as const;

function fail(message: string): never {
  throw new Error(message);
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be a finite number`);
  return value;
}

export function validateWordTimeline(input: unknown, options: { maxWords?: number } = {}): WordTimeline {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("word_timeline must be an object");
  const raw = input as Record<string, unknown>;
  const allowed = new Set(["source_project_item_id", "transcript_revision", "words"]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) fail(`word_timeline has an unknown field: ${key}`);
  const sourceId = raw.source_project_item_id;
  if (typeof sourceId !== "string" || !sourceId.trim() || sourceId.length > 512) fail("word_timeline.source_project_item_id must be a non-empty string of at most 512 characters");
  const revision = raw.transcript_revision;
  if (typeof revision !== "string" || !TRANSCRIPT_REVISION_PATTERN.test(revision)) fail("word_timeline.transcript_revision must match ^sha256:[a-f0-9]{64}$");
  const maxWords = options.maxWords ?? MAX_TIMELINE_WORDS;
  if (!Array.isArray(raw.words) || raw.words.length < 1 || raw.words.length > maxWords) fail(`word_timeline.words must contain between 1 and ${maxWords} words`);

  const words: TranscriptWord[] = [];
  const speakers = new Set<string>();
  let previousStart = -1;
  let previousEnd = 0;
  raw.words.forEach((entry, index) => {
    const label = `word_timeline.words[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`${label} must be an object`);
    const word = entry as Record<string, unknown>;
    for (const key of Object.keys(word)) {
      if (!["text", "start_seconds", "end_seconds", "speaker_label", "confidence"].includes(key)) fail(`${label} has an unknown field: ${key}`);
    }
    if (typeof word.text !== "string" || !word.text.trim() || word.text.length > 128) fail(`${label}.text must be a non-empty string of at most 128 characters`);
    const start = finiteNumber(word.start_seconds, `${label}.start_seconds`);
    const end = finiteNumber(word.end_seconds, `${label}.end_seconds`);
    if (start < 0 || end > MAX_WORD_SECONDS) fail(`${label} must lie within 0 and ${MAX_WORD_SECONDS} seconds`);
    if (end <= start) fail(`${label}.end_seconds must be greater than start_seconds`);
    if (start < previousStart) fail(`${label} is out of order; words must be sorted by start_seconds`);
    if (start + OVERLAP_TOLERANCE_SECONDS < previousEnd) fail(`${label} overlaps the previous word by more than ${OVERLAP_TOLERANCE_SECONDS} seconds`);
    const normalized: TranscriptWord = { text: word.text.trim(), start_seconds: start, end_seconds: end };
    if (word.speaker_label !== undefined) {
      if (typeof word.speaker_label !== "string" || !word.speaker_label.trim() || word.speaker_label.length > 128) fail(`${label}.speaker_label must be a non-empty string of at most 128 characters`);
      normalized.speaker_label = word.speaker_label.trim();
      speakers.add(normalized.speaker_label);
    }
    if (word.confidence !== undefined) {
      const confidence = finiteNumber(word.confidence, `${label}.confidence`);
      if (confidence < 0 || confidence > 1) fail(`${label}.confidence must be between 0 and 1`);
      normalized.confidence = confidence;
    }
    words.push(normalized);
    previousStart = start;
    previousEnd = Math.max(previousEnd, end);
  });

  return {
    source_project_item_id: sourceId.trim(),
    transcript_revision: revision,
    words,
    duration_seconds: previousEnd,
    speakers: [...speakers].sort(),
  };
}

/** Lower-cases a token and strips surrounding punctuation for matching. */
export function normalizeToken(text: string): string {
  return text.toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").replace(/['’]/g, "'");
}

/** True when the token ends a sentence by punctuation. */
export function endsSentence(text: string): boolean {
  return /[.!?…]["'”’)\]]*$/.test(text.trim());
}

/**
 * Indexes of words that end a sentence. A sentence also ends when the gap to
 * the next word exceeds `gapSeconds`, so untranscribed pauses still produce
 * usable boundaries.
 */
export function sentenceEndIndexes(words: readonly TranscriptWord[], gapSeconds = 0.8): number[] {
  const ends: number[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const next = words[index + 1];
    const gap = next ? next.start_seconds - words[index].end_seconds : Number.POSITIVE_INFINITY;
    if (!next || endsSentence(words[index].text) || gap > gapSeconds) ends.push(index);
  }
  return ends;
}

/** Contiguous word ranges by sentence, as inclusive [startIndex, endIndex]. */
export function sentenceRanges(words: readonly TranscriptWord[], gapSeconds = 0.8): Array<{ startIndex: number; endIndex: number }> {
  const ranges: Array<{ startIndex: number; endIndex: number }> = [];
  let start = 0;
  for (const end of sentenceEndIndexes(words, gapSeconds)) {
    ranges.push({ startIndex: start, endIndex: end });
    start = end + 1;
  }
  return ranges;
}

/** Stable digest binding a plan to the exact transcript evidence it used. */
export function digestWordTimeline(timeline: WordTimeline, extra: unknown = null): string {
  const hash = createHash("sha256");
  hash.update(timeline.transcript_revision);
  hash.update("\n");
  hash.update(timeline.source_project_item_id);
  hash.update("\n");
  for (const word of timeline.words) hash.update(`${word.start_seconds}|${word.end_seconds}|${word.text}|${word.speaker_label ?? ""}\n`);
  hash.update(JSON.stringify(extra));
  return `sha256:${hash.digest("hex")}`;
}

/** Snaps a seconds value to a frame index. */
export function secondsToFrame(seconds: number, frameRate: number, mode: "floor" | "ceil" | "round" = "round"): number {
  const raw = seconds * frameRate;
  if (mode === "floor") return Math.floor(raw + 1e-7);
  if (mode === "ceil") return Math.ceil(raw - 1e-7);
  return Math.round(raw);
}
