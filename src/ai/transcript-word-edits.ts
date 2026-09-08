import {
  digestWordTimeline,
  endsSentence,
  normalizeToken,
  secondsToFrame,
  sentenceRanges,
  validateWordTimeline,
  type TranscriptWord,
  type WordTimeline,
} from "./word-timeline.js";

/**
 * Word-level transcript cleanup planners (Descript/CapCut-style).
 *
 * Every function here is pure and deterministic: it reads a caller-supplied,
 * revision-bound word timeline and returns a plan of source-time ranges. The
 * plans are applied later through existing tools; nothing here contacts
 * Premiere, a model, or the network.
 */

export const DEFAULT_FILLER_WORDS = ["um", "uh", "er", "ah", "hmm", "you know", "i mean", "sort of", "kind of"] as const;
export const MAX_REMOVALS = 512;
export const MAX_PHRASES = 64;
export const MAX_MUTE_WORDS = 256;
export const MAX_TAKE_GROUPS = 256;
export const DERIVED_SEQUENCE_SEGMENT_LIMIT = 64;

export const CUT_ROUTES = {
  primary: ["preview_derived_dialogue_sequence_uxp", "apply_derived_dialogue_sequence_uxp"],
  fallback: ["split_clip", "ripple_delete"],
} as const;

const CUT_NEXT_STEPS = [
  "Review removal_ranges and keep_ranges; edit them locally if needed.",
  "Call preview_derived_dialogue_sequence_uxp with derived_segments (keep_ranges) as the approved segments, then apply_derived_dialogue_sequence_uxp with the previewed plan.",
  "Fallback on the original sequence: split_clip at each removal boundary, then ripple_delete the removal ranges from last to first.",
];

export type TimeRange = {
  start_seconds: number;
  end_seconds: number;
  start_frame: number;
  end_frame: number;
};

export type RemovalRange = TimeRange & { text: string; reason: string };

export type PlanEvidence = {
  source_project_item_id: string;
  transcript_revision: string;
  word_count: number;
};

export type DerivedSegment = {
  id: string;
  source_project_item_id: string;
  transcript_revision: string;
  source_start_seconds: number;
  source_end_seconds: number;
};

export type CutPlanSummary = {
  removal_ranges: RemovalRange[];
  keep_ranges: TimeRange[];
  derived_segments: DerivedSegment[];
  removed_seconds: number;
  kept_seconds: number;
  estimated_duration_seconds: number;
  original_duration_seconds: number;
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function fail(message: string): never {
  throw new Error(message);
}

export function boundedNumber(value: unknown, label: string, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) fail(`${label} must be a finite number between ${minimum} and ${maximum}`);
  return value;
}

export function boundedInteger(value: unknown, label: string, minimum: number, maximum: number, fallback: number): number {
  const number = boundedNumber(value, label, minimum, maximum, fallback);
  if (!Number.isInteger(number)) fail(`${label} must be an integer between ${minimum} and ${maximum}`);
  return number;
}

export function frameRateOption(value: unknown): number {
  return boundedNumber(value, "frame_rate", 1, 240, 30);
}

function enumOption<T extends string>(value: unknown, label: string, allowed: readonly T[], fallback: T): T {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) fail(`${label} must be one of: ${allowed.join(", ")}`);
  return value as T;
}

/** Splits a phrase into normalized tokens; empty tokens (pure punctuation) are dropped. */
export function normalizePhrase(text: string): string[] {
  return text.split(/\s+/u).map(normalizeToken).filter(Boolean);
}

/** Validates a caller-supplied list of words/phrases into deduplicated token arrays. */
export function phraseListOption(value: unknown, label: string, options: { maxItems: number; fallback?: readonly string[]; required?: boolean }): string[][] {
  if (value === undefined) {
    if (options.required) fail(`${label} is required`);
    return (options.fallback ?? []).map(normalizePhrase);
  }
  if (!Array.isArray(value) || value.length > options.maxItems) fail(`${label} must be an array with at most ${options.maxItems} entries`);
  if (options.required && value.length === 0) fail(`${label} must contain at least one entry`);
  const seen = new Set<string>();
  const phrases: string[][] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || !entry.trim() || entry.length > 64) fail(`${label}[${index}] must be a non-empty string of at most 64 characters`);
    const tokens = normalizePhrase(entry);
    if (tokens.length === 0) fail(`${label}[${index}] contains no matchable letters or digits`);
    if (tokens.length > 8) fail(`${label}[${index}] must contain at most 8 words`);
    const key = tokens.join(" ");
    if (seen.has(key)) return;
    seen.add(key);
    phrases.push(tokens);
  });
  return phrases;
}

// ---------------------------------------------------------------------------
// Range helpers
// ---------------------------------------------------------------------------

export function roundSeconds(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * Snaps a seconds range to whole frames. `inward` shrinks the range (never
 * removes more than requested); `outward` grows it (never covers less than
 * requested). Returns undefined when the snapped range is empty.
 */
export function snapRange(startSeconds: number, endSeconds: number, frameRate: number, direction: "inward" | "outward"): TimeRange | undefined {
  // Math.max(0, -0) yields +0, which keeps JSON output free of "-0" frames.
  const startFrame = Math.max(0, secondsToFrame(Math.max(0, startSeconds), frameRate, direction === "inward" ? "ceil" : "floor"));
  const endFrame = Math.max(0, secondsToFrame(Math.max(0, endSeconds), frameRate, direction === "inward" ? "floor" : "ceil"));
  if (endFrame <= startFrame) return undefined;
  return { start_seconds: roundSeconds(startFrame / frameRate), end_seconds: roundSeconds(endFrame / frameRate), start_frame: startFrame, end_frame: endFrame };
}

/** Sorts ranges by time and merges any that overlap or sit closer than `gapSeconds`. */
export function mergeRemovalRanges<T extends RemovalRange>(ranges: readonly T[], gapSeconds: number): T[] {
  const sorted = [...ranges].sort((a, b) => a.start_frame - b.start_frame || a.end_frame - b.end_frame);
  const merged: T[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start_seconds - last.end_seconds <= gapSeconds + 1e-9) {
      if (range.end_frame > last.end_frame) {
        last.end_frame = range.end_frame;
        last.end_seconds = range.end_seconds;
      }
      if (range.text) last.text = last.text ? `${last.text} ${range.text}` : range.text;
      if (range.reason !== last.reason && !last.reason.split("+").includes(range.reason)) last.reason = `${last.reason}+${range.reason}`;
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

/** Complement of the removal ranges inside [0, totalSeconds]. */
export function buildKeepRanges(removals: readonly TimeRange[], totalSeconds: number, frameRate: number): TimeRange[] {
  const totalFrame = secondsToFrame(totalSeconds, frameRate, "ceil");
  const keeps: TimeRange[] = [];
  let cursor = 0;
  for (const removal of removals) {
    if (removal.start_frame > cursor) keeps.push({ start_frame: cursor, end_frame: removal.start_frame, start_seconds: roundSeconds(cursor / frameRate), end_seconds: roundSeconds(removal.start_frame / frameRate) });
    cursor = Math.max(cursor, removal.end_frame);
  }
  if (totalFrame > cursor) keeps.push({ start_frame: cursor, end_frame: totalFrame, start_seconds: roundSeconds(cursor / frameRate), end_seconds: roundSeconds(totalFrame / frameRate) });
  return keeps;
}

export function sumRanges(ranges: readonly TimeRange[]): number {
  return roundSeconds(ranges.reduce((sum, range) => sum + (range.end_seconds - range.start_seconds), 0));
}

export function planEvidence(timeline: WordTimeline): PlanEvidence {
  return { source_project_item_id: timeline.source_project_item_id, transcript_revision: timeline.transcript_revision, word_count: timeline.words.length };
}

export function planRevision(timeline: WordTimeline, tool: string, options: Record<string, unknown>): string {
  return digestWordTimeline(timeline, { tool, options });
}

function derivedSegments(timeline: WordTimeline, keeps: readonly TimeRange[]): DerivedSegment[] {
  return keeps.map((keep, index) => ({
    id: `keep-${String(index + 1).padStart(4, "0")}`,
    source_project_item_id: timeline.source_project_item_id,
    transcript_revision: timeline.transcript_revision,
    source_start_seconds: keep.start_seconds,
    source_end_seconds: keep.end_seconds,
  }));
}

export function summarizeCutPlan(timeline: WordTimeline, removals: RemovalRange[], frameRate: number, warnings: string[]): CutPlanSummary {
  const keeps = buildKeepRanges(removals, timeline.duration_seconds, frameRate);
  const removed = sumRanges(removals);
  const kept = sumRanges(keeps);
  if (keeps.length > DERIVED_SEQUENCE_SEGMENT_LIMIT) warnings.push(`keep_ranges has ${keeps.length} entries, above the ${DERIVED_SEQUENCE_SEGMENT_LIMIT}-segment limit of apply_derived_dialogue_sequence_uxp; split the plan into batches or merge more aggressively.`);
  return {
    removal_ranges: removals,
    keep_ranges: keeps,
    derived_segments: derivedSegments(timeline, keeps),
    removed_seconds: removed,
    kept_seconds: kept,
    estimated_duration_seconds: kept,
    original_duration_seconds: roundSeconds(timeline.duration_seconds),
  };
}

const KEEP_RANGE_ASSUMPTION = "keep_ranges span 0 through the last transcribed word end; source media beyond the transcript is not covered by this plan.";

// ---------------------------------------------------------------------------
// Phrase matching shared by filler removal and word muting
// ---------------------------------------------------------------------------

export type PhraseMatch = { startIndex: number; endIndex: number; phrase: string };

/**
 * Greedy left-to-right scan for consecutive-token phrase matches. Longer
 * phrases win at the same position; matches never overlap.
 */
export function findPhraseMatches(words: readonly TranscriptWord[], phrases: readonly string[][]): PhraseMatch[] {
  const tokens = words.map((word) => normalizeToken(word.text));
  const ordered = [...phrases].sort((a, b) => b.length - a.length || a.join(" ").localeCompare(b.join(" ")));
  const matches: PhraseMatch[] = [];
  let index = 0;
  while (index < tokens.length) {
    let matched: PhraseMatch | undefined;
    for (const phrase of ordered) {
      if (index + phrase.length > tokens.length) continue;
      let ok = true;
      for (let offset = 0; offset < phrase.length; offset += 1) {
        if (tokens[index + offset] !== phrase[offset]) { ok = false; break; }
      }
      if (ok) { matched = { startIndex: index, endIndex: index + phrase.length - 1, phrase: phrase.join(" ") }; break; }
    }
    if (matched) { matches.push(matched); index = matched.endIndex + 1; } else index += 1;
  }
  return matches;
}

function wordsText(words: readonly TranscriptWord[], startIndex: number, endIndex: number): string {
  return words.slice(startIndex, endIndex + 1).map((word) => word.text).join(" ");
}

// ---------------------------------------------------------------------------
// 1. Filler word removal
// ---------------------------------------------------------------------------

export function planFillerWordRemoval(args: Record<string, unknown>) {
  const timeline = validateWordTimeline(args.word_timeline);
  const frameRate = frameRateOption(args.frame_rate);
  const fillers = phraseListOption(args.filler_words, "filler_words", { maxItems: MAX_PHRASES, fallback: DEFAULT_FILLER_WORDS });
  if (fillers.length === 0) fail("filler_words must contain at least one entry");
  const handleFrames = boundedInteger(args.handle_frames, "handle_frames", 0, 24, 1);
  const mergeGap = boundedNumber(args.merge_gap_seconds, "merge_gap_seconds", 0, 5, 0.15);
  const maxRemovals = boundedInteger(args.max_removals, "max_removals", 1, MAX_REMOVALS, 256);
  const minConfidence = args.min_confidence === undefined ? undefined : boundedNumber(args.min_confidence, "min_confidence", 0, 1, 0);

  const warnings: string[] = [];
  const assumptions: string[] = [KEEP_RANGE_ASSUMPTION, `Each removal keeps ${handleFrames} frame(s) of handle inside the filler boundaries and is snapped inward to whole frames at ${frameRate} fps.`];
  const handleSeconds = handleFrames / frameRate;
  const counts = new Map<string, { matches: number; removed: number }>();
  for (const phrase of fillers) counts.set(phrase.join(" "), { matches: 0, removed: 0 });

  let skippedConfidence = 0;
  let skippedMissingConfidence = 0;
  let skippedTooShort = 0;
  const removals: RemovalRange[] = [];
  for (const match of findPhraseMatches(timeline.words, fillers)) {
    const count = counts.get(match.phrase)!;
    count.matches += 1;
    const span = timeline.words.slice(match.startIndex, match.endIndex + 1);
    if (minConfidence !== undefined) {
      if (span.some((word) => word.confidence === undefined)) { skippedMissingConfidence += 1; continue; }
      if (span.some((word) => (word.confidence as number) < minConfidence)) { skippedConfidence += 1; continue; }
    }
    const first = span[0];
    const last = span[span.length - 1];
    const range = snapRange(first.start_seconds + handleSeconds, last.end_seconds - handleSeconds, frameRate, "inward");
    if (!range) { skippedTooShort += 1; continue; }
    count.removed += 1;
    removals.push({ ...range, text: wordsText(timeline.words, match.startIndex, match.endIndex), reason: "filler_word" });
  }

  let merged = mergeRemovalRanges(removals, mergeGap);
  const truncated = merged.length > maxRemovals;
  if (truncated) {
    merged = merged.slice(0, maxRemovals);
    warnings.push(`Only the first ${maxRemovals} merged removals are included; ${removals.length} filler matches were found. Raise max_removals or plan in batches.`);
  }
  if (skippedConfidence > 0) warnings.push(`${skippedConfidence} filler match(es) were kept because their confidence is below ${minConfidence}.`);
  if (skippedMissingConfidence > 0) warnings.push(`${skippedMissingConfidence} filler match(es) were kept because min_confidence was set but those words carry no confidence.`);
  if (skippedTooShort > 0) warnings.push(`${skippedTooShort} filler match(es) were kept because they are shorter than two handles at ${frameRate} fps; lower handle_frames to remove them.`);
  if (merged.length === 0) warnings.push("No filler words matched; nothing to remove.");

  const options = { fillers: fillers.map((phrase) => phrase.join(" ")), frameRate, handleFrames, mergeGap, maxRemovals, minConfidence: minConfidence ?? null };
  const summary = summarizeCutPlan(timeline, merged, frameRate, warnings);
  return {
    plan_revision: planRevision(timeline, "plan_filler_word_removal", options),
    evidence: planEvidence(timeline),
    applied: false as const,
    frame_rate: frameRate,
    handle_frames: handleFrames,
    filler_counts: [...counts.entries()].map(([filler, count]) => ({ filler, matches: count.matches, removed: count.removed })).sort((a, b) => b.matches - a.matches || a.filler.localeCompare(b.filler)),
    match_count: removals.length,
    removal_count: merged.length,
    truncated,
    ...summary,
    routes: { ...CUT_ROUTES },
    next_steps: CUT_NEXT_STEPS,
    warnings,
    assumptions,
  };
}

// ---------------------------------------------------------------------------
// 2. Pause tightening
// ---------------------------------------------------------------------------

export type PauseRemoval = RemovalRange & { pause_seconds: number; target_pause_seconds: number; after_word_index: number };

export function planPauseTightening(args: Record<string, unknown>) {
  const timeline = validateWordTimeline(args.word_timeline);
  const frameRate = frameRateOption(args.frame_rate);
  const maxPause = boundedNumber(args.max_pause_seconds, "max_pause_seconds", 0.2, 30, 1);
  const targetPause = boundedNumber(args.target_pause_seconds, "target_pause_seconds", 0, 30, 0.35);
  const sentencePause = boundedNumber(args.sentence_pause_seconds, "sentence_pause_seconds", 0, 30, 0.6);
  const maxEdits = boundedInteger(args.max_edits, "max_edits", 1, MAX_REMOVALS, 256);
  if (targetPause > maxPause) fail("target_pause_seconds must not exceed max_pause_seconds");

  const warnings: string[] = [];
  const assumptions: string[] = [
    KEEP_RANGE_ASSUMPTION,
    `Pauses longer than ${maxPause}s are shortened to ${targetPause}s (${sentencePause}s after sentence-ending punctuation); the kept pause is split evenly on both sides of the cut and snapped inward to whole frames at ${frameRate} fps.`,
    "Pauses are inter-word gaps in the transcript; untranscribed speech inside a gap is not detected here (cross-check with detect_silence).",
  ];

  const candidates: PauseRemoval[] = [];
  let examined = 0;
  let tooShortToSnap = 0;
  for (let index = 0; index + 1 < timeline.words.length; index += 1) {
    const previous = timeline.words[index];
    const next = timeline.words[index + 1];
    const pause = next.start_seconds - previous.end_seconds;
    if (pause <= 0) continue;
    examined += 1;
    const sentenceEnd = endsSentence(previous.text);
    const target = sentenceEnd ? sentencePause : targetPause;
    if (pause <= maxPause || pause <= target) continue;
    const keepEach = target / 2;
    const range = snapRange(previous.end_seconds + keepEach, next.start_seconds - keepEach, frameRate, "inward");
    if (!range) { tooShortToSnap += 1; continue; }
    candidates.push({
      ...range,
      text: `${previous.text} [${roundSeconds(pause)}s pause] ${next.text}`,
      reason: sentenceEnd ? "sentence_pause" : "long_pause",
      pause_seconds: roundSeconds(pause),
      target_pause_seconds: target,
      after_word_index: index,
    });
  }

  let selected = candidates;
  const truncated = candidates.length > maxEdits;
  if (truncated) {
    selected = [...candidates].sort((a, b) => b.pause_seconds - a.pause_seconds || a.start_frame - b.start_frame).slice(0, maxEdits).sort((a, b) => a.start_frame - b.start_frame);
    warnings.push(`Only the ${maxEdits} longest pauses are included; ${candidates.length} qualified. Raise max_edits or plan in batches.`);
  }
  if (tooShortToSnap > 0) warnings.push(`${tooShortToSnap} pause(s) qualified but shrink to less than one frame at ${frameRate} fps and were left alone.`);
  if (selected.length === 0) warnings.push("No pauses exceed max_pause_seconds; nothing to tighten.");

  const options = { frameRate, maxPause, targetPause, sentencePause, maxEdits };
  const summary = summarizeCutPlan(timeline, selected, frameRate, warnings);
  return {
    plan_revision: planRevision(timeline, "plan_pause_tightening", options),
    evidence: planEvidence(timeline),
    applied: false as const,
    frame_rate: frameRate,
    pauses_examined: examined,
    pauses_tightened: selected.length,
    truncated,
    ...summary,
    routes: { ...CUT_ROUTES },
    next_steps: CUT_NEXT_STEPS,
    warnings,
    assumptions,
  };
}

// ---------------------------------------------------------------------------
// 3. Word mute / bleep ranges
// ---------------------------------------------------------------------------

/** Redacts a token to its first letter plus asterisks; phrases are redacted per token. */
export function redactText(text: string): string {
  return text
    .split(/\s+/u)
    .filter(Boolean)
    .map((token) => {
      const normalized = normalizeToken(token);
      if (!normalized) return "*";
      const chars = [...normalized];
      return chars.length === 1 ? "*" : `${chars[0]}${"*".repeat(chars.length - 1)}`;
    })
    .join(" ");
}

export type MuteRange = RemovalRange & { word_count: number };

export function planWordMuteRanges(args: Record<string, unknown>) {
  const timeline = validateWordTimeline(args.word_timeline);
  const frameRate = frameRateOption(args.frame_rate);
  const words = phraseListOption(args.words, "words", { maxItems: MAX_MUTE_WORDS, required: true });
  const padding = boundedNumber(args.padding_seconds, "padding_seconds", 0, 1, 0.04);
  const mode = enumOption(args.mode, "mode", ["mute", "bleep"] as const, "mute");
  const muteLevel = boundedNumber(args.mute_level_db, "mute_level_db", -96, 0, -60);

  const warnings: string[] = [];
  const assumptions: string[] = [
    `Each flagged word is padded by ${padding}s on both sides and snapped outward to whole frames at ${frameRate} fps so the mute always covers the word.`,
    "Flagged text is returned redacted (first letter plus asterisks); the plan never echoes the full flagged word.",
    "audio_keyframes times are source-relative seconds; if the clip is trimmed on the timeline, offset them by the clip's in point before add_audio_keyframes.",
  ];

  const matches = findPhraseMatches(timeline.words, words);
  const raw: MuteRange[] = [];
  for (const match of matches) {
    const first = timeline.words[match.startIndex];
    const last = timeline.words[match.endIndex];
    const range = snapRange(first.start_seconds - padding, last.end_seconds + padding, frameRate, "outward");
    if (!range) continue;
    raw.push({ ...range, text: redactText(wordsText(timeline.words, match.startIndex, match.endIndex)), reason: mode, word_count: match.endIndex - match.startIndex + 1 });
  }
  const mergedBase = mergeRemovalRanges(raw, 0);
  const muteRanges: MuteRange[] = mergedBase.map((range) => {
    const contributors = raw.filter((item) => item.start_frame >= range.start_frame && item.end_frame <= range.end_frame);
    return { ...range, word_count: contributors.reduce((sum, item) => sum + item.word_count, 0) };
  });
  if (muteRanges.length === 0) warnings.push("No listed words matched the transcript; nothing to mute.");

  const frameSeconds = 1 / frameRate;
  const audioKeyframes: Array<{ time_seconds: number; level_db: number }> = [];
  for (const range of muteRanges) {
    const rampIn = range.start_seconds - frameSeconds;
    if (rampIn >= 0) audioKeyframes.push({ time_seconds: roundSeconds(rampIn), level_db: 0 });
    audioKeyframes.push({ time_seconds: range.start_seconds, level_db: muteLevel });
    audioKeyframes.push({ time_seconds: range.end_seconds, level_db: muteLevel });
    audioKeyframes.push({ time_seconds: roundSeconds(range.end_seconds + frameSeconds), level_db: 0 });
  }
  for (let index = 1; index < audioKeyframes.length; index += 1) {
    if (audioKeyframes[index].time_seconds < audioKeyframes[index - 1].time_seconds) {
      warnings.push("Adjacent mute ranges are closer than one frame; review audio_keyframes ordering before applying.");
      break;
    }
  }

  const tonePlacements = mode === "bleep"
    ? muteRanges.map((range) => ({ start_seconds: range.start_seconds, duration_seconds: roundSeconds(range.end_seconds - range.start_seconds), start_frame: range.start_frame, duration_frames: range.end_frame - range.start_frame }))
    : [];
  const routes = mode === "bleep"
    ? { primary: ["add_audio_keyframes", "create_bars_and_tone", "add_to_timeline"], fallback: ["set_clip_volume"] }
    : { primary: ["add_audio_keyframes"], fallback: ["set_clip_volume"] };
  const nextSteps = mode === "bleep"
    ? [
      "Call add_audio_keyframes on the dialogue clip with audio_keyframes to duck the flagged words.",
      "Create one tone item with create_bars_and_tone, then place it on a free audio track with add_to_timeline at each tone_placements entry (start_seconds, duration_seconds), trimming to duration.",
      "Fallback: split_clip around each mute range and set_clip_volume on the isolated piece.",
    ]
    : [
      "Call add_audio_keyframes on the dialogue clip with audio_keyframes; levels return to 0 dB one frame outside each range.",
      "Fallback: split_clip around each mute range and set_clip_volume on the isolated piece.",
    ];

  const options = { words: words.map((phrase) => phrase.join(" ")), frameRate, padding, mode, muteLevel };
  return {
    plan_revision: planRevision(timeline, "plan_word_mute_ranges", options),
    evidence: planEvidence(timeline),
    applied: false as const,
    frame_rate: frameRate,
    mode,
    mute_level_db: muteLevel,
    padding_seconds: padding,
    match_count: matches.length,
    mute_ranges: muteRanges,
    muted_seconds: sumRanges(muteRanges),
    audio_keyframes: audioKeyframes,
    tone_placements: tonePlacements,
    routes,
    next_steps: nextSteps,
    warnings,
    assumptions,
  };
}

// ---------------------------------------------------------------------------
// 4. Repeated take detection
// ---------------------------------------------------------------------------

type SentenceInfo = {
  index: number;
  startIndex: number;
  endIndex: number;
  start_seconds: number;
  end_seconds: number;
  tokens: string[];
  tokenSet: Set<string>;
};

export function tokenSimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): { jaccard: number; containment: number; similarity: number } {
  if (a.size === 0 || b.size === 0) return { jaccard: 0, containment: 0, similarity: 0 };
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = a.size + b.size - intersection;
  const jaccard = intersection / union;
  const containment = intersection / Math.min(a.size, b.size);
  return { jaccard: roundSeconds(jaccard), containment: roundSeconds(containment), similarity: roundSeconds(Math.max(jaccard, containment)) };
}

export function textPreview(words: readonly TranscriptWord[], startIndex: number, endIndex: number, limit = 80): string {
  const text = wordsText(words, startIndex, endIndex);
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

export type TakeGroup = {
  group_index: number;
  takes: Array<{ index: number; start_seconds: number; end_seconds: number; word_count: number; text_preview: string; similarity_to_previous: number | null }>;
  kept_index: number;
};

export function detectRepeatedTakes(args: Record<string, unknown>) {
  const timeline = validateWordTimeline(args.word_timeline);
  const frameRate = frameRateOption(args.frame_rate);
  const minWords = boundedInteger(args.min_words, "min_words", 3, 20, 4);
  const threshold = boundedNumber(args.similarity_threshold, "similarity_threshold", 0.6, 1, 0.8);
  const keep = enumOption(args.keep, "keep", ["last", "first"] as const, "last");
  const maxGroups = boundedInteger(args.max_groups, "max_groups", 1, MAX_TAKE_GROUPS, 64);
  const maxGap = boundedNumber(args.max_gap_seconds, "max_gap_seconds", 1, 120, 20);
  const handleFrames = boundedInteger(args.handle_frames, "handle_frames", 0, 24, 1);

  const warnings: string[] = [];
  const assumptions: string[] = [
    KEEP_RANGE_ASSUMPTION,
    `Sentences are split on terminal punctuation or gaps over 0.8s; only sentences with at least ${minWords} tokens are compared, and only against sentences starting within ${maxGap}s of each other.`,
    `Similarity is max(token Jaccard, token containment) over normalized tokens; groups form when it reaches ${threshold}.`,
    `The ${keep} take in each group is kept; removed takes span from their first word to ${handleFrames} frame(s) before the following word, snapped inward at ${frameRate} fps.`,
  ];

  const sentences: SentenceInfo[] = sentenceRanges(timeline.words).map((range, index) => {
    const tokens = timeline.words.slice(range.startIndex, range.endIndex + 1).map((word) => normalizeToken(word.text)).filter(Boolean);
    return { index, startIndex: range.startIndex, endIndex: range.endIndex, start_seconds: timeline.words[range.startIndex].start_seconds, end_seconds: timeline.words[range.endIndex].end_seconds, tokens, tokenSet: new Set(tokens) };
  });
  const candidates = sentences.filter((sentence) => sentence.tokens.length >= minWords);

  const groupOf = new Map<number, number>();
  const groups: Array<{ members: number[]; similarities: number[] }> = [];
  for (let current = 0; current < candidates.length; current += 1) {
    const sentence = candidates[current];
    let best: { earlier: number; similarity: number } | undefined;
    for (let earlier = current - 1; earlier >= 0; earlier -= 1) {
      const other = candidates[earlier];
      if (sentence.start_seconds - other.end_seconds > maxGap) break;
      const { similarity } = tokenSimilarity(other.tokenSet, sentence.tokenSet);
      if (similarity >= threshold && (!best || similarity > best.similarity)) best = { earlier, similarity };
    }
    if (!best) continue;
    const earlierSentence = candidates[best.earlier];
    let groupIndex = groupOf.get(earlierSentence.index);
    if (groupIndex === undefined) {
      groupIndex = groups.length;
      groups.push({ members: [earlierSentence.index], similarities: [] });
      groupOf.set(earlierSentence.index, groupIndex);
    }
    groups[groupIndex].members.push(sentence.index);
    groups[groupIndex].similarities.push(best.similarity);
    groupOf.set(sentence.index, groupIndex);
  }

  const truncated = groups.length > maxGroups;
  if (truncated) warnings.push(`Only the first ${maxGroups} take groups are included; ${groups.length} were found. Raise max_groups or plan in batches.`);
  const limited = groups.slice(0, maxGroups);

  const handleSeconds = handleFrames / frameRate;
  const removals: RemovalRange[] = [];
  const takeGroups: TakeGroup[] = limited.map((group, groupIndex) => {
    const keptIndex = keep === "last" ? group.members.length - 1 : 0;
    const takes = group.members.map((sentenceIndex, position) => {
      const sentence = sentences[sentenceIndex];
      if (position !== keptIndex) {
        const following = timeline.words[sentence.endIndex + 1];
        const end = following ? following.start_seconds - handleSeconds : sentence.end_seconds;
        const range = snapRange(sentence.start_seconds, Math.max(end, sentence.end_seconds), frameRate, "inward");
        if (range) removals.push({ ...range, text: textPreview(timeline.words, sentence.startIndex, sentence.endIndex), reason: "repeated_take" });
      }
      return {
        index: position,
        start_seconds: roundSeconds(sentence.start_seconds),
        end_seconds: roundSeconds(sentence.end_seconds),
        word_count: sentence.endIndex - sentence.startIndex + 1,
        text_preview: textPreview(timeline.words, sentence.startIndex, sentence.endIndex),
        similarity_to_previous: position === 0 ? null : group.similarities[position - 1],
      };
    });
    return { group_index: groupIndex, takes, kept_index: keptIndex };
  });
  // Consecutive removed takes are separated only by a handle; merge them into one cut.
  const merged = mergeRemovalRanges(removals, handleSeconds + 1e-6);
  if (takeGroups.length === 0) warnings.push("No repeated takes detected.");

  const options = { frameRate, minWords, threshold, keep, maxGroups, maxGap, handleFrames };
  const summary = summarizeCutPlan(timeline, merged, frameRate, warnings);
  return {
    plan_revision: planRevision(timeline, "detect_repeated_takes", options),
    evidence: planEvidence(timeline),
    applied: false as const,
    frame_rate: frameRate,
    keep,
    sentence_count: sentences.length,
    compared_sentence_count: candidates.length,
    group_count: takeGroups.length,
    truncated,
    groups: takeGroups,
    ...summary,
    routes: { ...CUT_ROUTES },
    next_steps: CUT_NEXT_STEPS,
    warnings,
    assumptions,
  };
}
