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
 * Deterministic long-video → shorts candidate ranking.
 *
 * Windows of consecutive sentences are scored with explainable heuristic
 * components (hook, completeness, density, evidence, keyword, duration fit and
 * speaker consistency). Nothing here predicts virality, contacts a model, or
 * changes Premiere: the result is a plan a caller applies through subclip and
 * derivative-sequence tools.
 */

export const SHORT_FORM_WEIGHTS = Object.freeze({
  hook: 0.25,
  completeness: 0.15,
  density: 0.1,
  evidence: 0.2,
  keyword: 0.1,
  duration_fit: 0.1,
  speaker_consistency: 0.1,
});

export type ShortFormComponent = keyof typeof SHORT_FORM_WEIGHTS;

export const OVERLAP_SUPPRESSION_RATIO = 0.4;
export const MAX_EVIDENCE_POINTS = 2000;
export const MAX_HOOK_WORDS = 128;
export const MAX_KEYWORDS = 64;
const MAX_WINDOWS = 50_000;
const EVIDENCE_SATURATION_PER_SECOND = 0.15;
const HOOK_TEXT_LIMIT = 120;

/** Built-in contrast / curiosity lexicon rewarded in a window's opening sentence. */
export const HOOK_LEXICON: readonly string[] = Object.freeze([
  "but", "never", "secret", "secrets", "mistake", "mistakes", "why", "how", "what", "nobody", "everyone", "everybody",
  "truth", "actually", "wrong", "biggest", "best", "worst", "hack", "hacks", "trick", "tricks", "warning", "surprising",
  "shocking", "crazy", "insane", "hidden", "real", "problem", "reason", "reasons", "lesson", "lessons", "instead",
  "stop", "unless", "until", "finally", "honestly", "nobody's", "don't", "can't", "won't", "shouldn't", "impossible",
  "only", "most", "every", "always", "first", "last", "before", "after", "versus", "vs",
]);

const IMPERATIVE_OPENERS = new Set([
  "stop", "imagine", "listen", "watch", "think", "try", "never", "don't", "look", "remember", "here's", "let", "let's",
  "check", "forget", "consider", "picture", "take", "start", "avoid", "notice", "guess", "wait", "please", "pay",
]);
const SECOND_PERSON = new Set(["you", "your", "you're", "you've", "you'll", "you'd", "yours", "yourself"]);
const TRAILING_FRAGMENTS = new Set([
  "and", "but", "or", "so", "because", "which", "that", "then", "if", "when", "while", "although", "though", "since",
  "nor", "yet", "the", "a", "an", "to", "of", "with", "for", "in", "on", "at", "by", "from", "as", "than", "like",
]);
const HOOK_SET = new Set(HOOK_LEXICON);

export type ShortFormCandidateOptions = {
  word_timeline: unknown;
  min_seconds?: unknown;
  max_seconds?: unknown;
  max_candidates?: unknown;
  frame_rate?: unknown;
  hook_words?: unknown;
  keywords?: unknown;
  audio_energy_peaks?: unknown;
  motion_peaks?: unknown;
  laughter_seconds?: unknown;
  marker_seconds?: unknown;
};

export type ShortFormComponents = Record<ShortFormComponent, number>;

export type ShortFormCandidate = {
  rank: number;
  start_seconds: number;
  end_seconds: number;
  start_frame: number;
  end_frame: number;
  duration_seconds: number;
  score: number;
  components: ShortFormComponents;
  hook_text: string;
  reasons: string[];
  word_count: number;
  sentence_count: number;
  speakers: string[];
};

type Sentence = {
  index: number;
  start: number;
  end: number;
  wordCount: number;
  text: string;
  tokens: string[];
  speakers: Set<string>;
  keywordHits: Set<number>;
  endsWithPunctuation: boolean;
  lastToken: string;
};

type ScoredWindow = {
  firstSentence: number;
  lastSentence: number;
  start: number;
  end: number;
  score: number;
  components: ShortFormComponents;
  reasons: string[];
  hookText: string;
  wordCount: number;
  speakers: string[];
};

function fail(message: string): never {
  throw new Error(message);
}

export function boundedNumber(value: unknown, label: string, min: number, max: number, fallback: number, integer = false): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be a finite number`);
  if (integer && !Number.isInteger(value)) fail(`${label} must be an integer`);
  if (value < min || value > max) fail(`${label} must be between ${min} and ${max}`);
  return value;
}

/** Splits caller strings into normalized single tokens (deduplicated, sorted). */
function tokenList(value: unknown, label: string, maxItems: number, maxLength = 64): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) fail(`${label} must be an array of at most ${maxItems} strings`);
  const out = new Set<string>();
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || !entry.trim() || entry.length > maxLength) fail(`${label}[${index}] must be a non-empty string of at most ${maxLength} characters`);
    for (const piece of entry.split(/\s+/)) {
      const token = normalizeToken(piece);
      if (token) out.add(token);
    }
  });
  return [...out].sort();
}

/** Normalizes caller phrases (multi-word allowed) for whole-token matching. */
function phraseList(value: unknown, label: string, maxItems: number, maxLength = 64): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) fail(`${label} must be an array of at most ${maxItems} strings`);
  const out = new Set<string>();
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || !entry.trim() || entry.length > maxLength) fail(`${label}[${index}] must be a non-empty string of at most ${maxLength} characters`);
    const phrase = entry.split(/\s+/).map(normalizeToken).filter(Boolean).join(" ");
    if (phrase) out.add(phrase);
  });
  return [...out].sort();
}

function secondsList(value: unknown, label: string): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_POINTS) fail(`${label} must be an array of at most ${MAX_EVIDENCE_POINTS} numbers`);
  const out = value.map((entry, index) => {
    if (typeof entry !== "number" || !Number.isFinite(entry) || entry < 0 || entry > 86_400) fail(`${label}[${index}] must be a finite number of seconds between 0 and 86400`);
    return entry;
  });
  return out.sort((a, b) => a - b);
}

function lowerBound(sorted: readonly number[], target: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (sorted[mid] < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Count of sorted values within the inclusive range [start, end]. */
export function countInRange(sorted: readonly number[], start: number, end: number): number {
  if (end < start) return 0;
  return lowerBound(sorted, end + 1e-9) - lowerBound(sorted, start);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round3(value: number): number {
  return Number(value.toFixed(3));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >>> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function buildSentences(words: readonly TranscriptWord[], keywords: readonly string[]): Sentence[] {
  return sentenceRanges(words).map((range, index) => {
    const slice = words.slice(range.startIndex, range.endIndex + 1);
    const tokens = slice.map((word) => normalizeToken(word.text)).filter(Boolean);
    const joined = tokens.join(" ");
    const keywordHits = new Set<number>();
    keywords.forEach((phrase, keywordIndex) => {
      if (joined === phrase || joined.startsWith(`${phrase} `) || joined.endsWith(` ${phrase}`) || joined.includes(` ${phrase} `)) keywordHits.add(keywordIndex);
    });
    const speakers = new Set<string>();
    for (const word of slice) if (word.speaker_label) speakers.add(word.speaker_label);
    const last = slice[slice.length - 1];
    return {
      index,
      start: slice[0].start_seconds,
      end: last.end_seconds,
      wordCount: slice.length,
      text: slice.map((word) => word.text).join(" "),
      tokens,
      speakers,
      keywordHits,
      endsWithPunctuation: endsSentence(last.text),
      lastToken: tokens[tokens.length - 1] ?? "",
    };
  });
}

/** Explainable hook score for a window's opening sentence. */
export function scoreHook(sentence: { text: string; tokens: readonly string[] }, hookWords: ReadonlySet<string> = new Set()): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (sentence.text.includes("?")) {
    score += 0.4;
    reasons.push("Opens with a question");
  }
  const first = sentence.tokens[0];
  if (first && IMPERATIVE_OPENERS.has(first)) {
    score += 0.3;
    reasons.push(`Imperative opener "${first}"`);
  } else if (sentence.tokens.slice(0, 3).some((token) => SECOND_PERSON.has(token))) {
    score += 0.3;
    reasons.push("Addresses the viewer directly");
  }
  if (/\d/.test(sentence.text)) {
    score += 0.15;
    reasons.push("Contains a number");
  }
  const hits: string[] = [];
  for (const token of sentence.tokens) {
    if ((HOOK_SET.has(token) || hookWords.has(token)) && !hits.includes(token)) hits.push(token);
    if (hits.length >= 3) break;
  }
  if (hits.length) {
    score += Math.min(0.3, 0.15 * hits.length);
    reasons.push(`Hook words: ${hits.join(", ")}`);
  }
  return { score: clamp01(score), reasons };
}

function scoreCompleteness(first: Sentence, last: Sentence): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 1;
  if (last.lastToken && TRAILING_FRAGMENTS.has(last.lastToken)) {
    score -= 0.5;
    reasons.push(`Ends on a dangling word "${last.lastToken}"`);
  }
  if (!last.endsWithPunctuation) {
    score -= 0.2;
    reasons.push("Ends at a pause rather than sentence punctuation");
  }
  const opener = first.tokens[0];
  if (opener && TRAILING_FRAGMENTS.has(opener) && !IMPERATIVE_OPENERS.has(opener) && !HOOK_SET.has(opener)) {
    score -= 0.2;
    reasons.push(`Starts mid-thought with "${opener}"`);
  }
  if (score >= 1) reasons.push("Complete sentences from start to end");
  return { score: clamp01(score), reasons };
}

function overlapRatio(a: { start: number; end: number }, b: { start: number; end: number }): number {
  const intersection = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  if (intersection <= 0) return 0;
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  return shorter > 0 ? intersection / shorter : 1;
}

export const SHORT_FORM_ROUTES = Object.freeze([
  { step: "create_subclips", routes: ["create_subclip_uxp", "create_subclip"], note: "Create one subclip per approved candidate using start_seconds/end_seconds on the source item." },
  { step: "preview_derivative", routes: ["preview_derived_dialogue_sequence_uxp"], note: "Preview a derivative sequence from the approved candidate segments before applying." },
  { step: "recipe", routes: ["search_workflow_recipes", "preview_workflow_recipe"], recipe_id: "shorts-cutdown", note: "Expand the shorts-cutdown recipe for the reframe, caption and delivery steps." },
  { step: "reframe", routes: ["auto_reframe_sequence"], note: "Reframe the derivative to the vertical target." },
  { step: "captions", routes: ["build_caption_artifact", "create_caption_track"], note: "Build a caption artifact from the same word timeline and attach it." },
]);

export function rankShortFormCandidates(options: ShortFormCandidateOptions) {
  const timeline: WordTimeline = validateWordTimeline(options.word_timeline);
  const minSeconds = boundedNumber(options.min_seconds, "min_seconds", 5, 180, 15);
  const maxSeconds = boundedNumber(options.max_seconds, "max_seconds", 10, 300, 60);
  if (minSeconds > maxSeconds) fail("min_seconds must not exceed max_seconds");
  const maxCandidates = boundedNumber(options.max_candidates, "max_candidates", 1, 50, 8, true);
  const frameRate = boundedNumber(options.frame_rate, "frame_rate", 1, 240, 30);
  const hookWords = tokenList(options.hook_words, "hook_words", MAX_HOOK_WORDS);
  const keywords = phraseList(options.keywords, "keywords", MAX_KEYWORDS);
  const evidenceSeries = {
    audio_energy_peaks: secondsList(options.audio_energy_peaks, "audio_energy_peaks"),
    motion_peaks: secondsList(options.motion_peaks, "motion_peaks"),
    laughter_seconds: secondsList(options.laughter_seconds, "laughter_seconds"),
    marker_seconds: secondsList(options.marker_seconds, "marker_seconds"),
  };
  const evidenceWeights = { audio_energy_peaks: 1, motion_peaks: 1, laughter_seconds: 1.5, marker_seconds: 2 } as const;
  const hasEvidence = Object.values(evidenceSeries).some((series) => series.length > 0);
  const hookSet = new Set(hookWords);

  const sentences = buildSentences(timeline.words, keywords);
  const medianRate = median(sentences.filter((sentence) => sentence.end > sentence.start).map((sentence) => sentence.wordCount / (sentence.end - sentence.start)));
  const warnings: string[] = [];

  const windows: ScoredWindow[] = [];
  let truncated = false;
  outer: for (let first = 0; first < sentences.length; first += 1) {
    for (let last = first; last < sentences.length; last += 1) {
      const start = sentences[first].start;
      const end = sentences[last].end;
      const duration = end - start;
      if (duration > maxSeconds) break;
      if (duration < minSeconds) continue;
      if (windows.length >= MAX_WINDOWS) {
        truncated = true;
        break outer;
      }
      let wordCount = 0;
      const speakers = new Set<string>();
      const keywordHits = new Set<number>();
      for (let index = first; index <= last; index += 1) {
        const sentence = sentences[index];
        wordCount += sentence.wordCount;
        for (const speaker of sentence.speakers) speakers.add(speaker);
        for (const hit of sentence.keywordHits) keywordHits.add(hit);
      }
      const reasons: string[] = [];
      const hook = scoreHook(sentences[first], hookSet);
      reasons.push(...hook.reasons);
      const completeness = scoreCompleteness(sentences[first], sentences[last]);
      reasons.push(...completeness.reasons);

      const rate = wordCount / duration;
      const ratio = medianRate > 0 ? rate / medianRate : 1;
      const density = clamp01(0.5 + (ratio - 1) * 0.5);
      if (ratio >= 1.15) reasons.push(`Dense speech (${ratio.toFixed(2)}x transcript median)`);
      else if (ratio <= 0.85) reasons.push(`Slow speech (${ratio.toFixed(2)}x transcript median)`);

      let weighted = 0;
      const evidenceParts: string[] = [];
      for (const key of Object.keys(evidenceSeries) as Array<keyof typeof evidenceSeries>) {
        const count = countInRange(evidenceSeries[key], start, end);
        if (count > 0) {
          weighted += count * evidenceWeights[key];
          evidenceParts.push(`${count} ${key.replace(/_seconds$/, "").replace(/_/g, " ")}`);
        }
      }
      const evidence = hasEvidence ? clamp01(weighted / (duration * EVIDENCE_SATURATION_PER_SECOND)) : 0;
      if (evidenceParts.length) reasons.push(`Evidence inside window: ${evidenceParts.join(", ")}`);

      const keyword = keywords.length ? clamp01(keywordHits.size / Math.min(3, keywords.length)) : 0;
      if (keywordHits.size) reasons.push(`Keyword hits: ${[...keywordHits].sort((a, b) => a - b).map((index) => keywords[index]).join(", ")}`);

      const mid = (minSeconds + maxSeconds) / 2;
      const half = (maxSeconds - minSeconds) / 2;
      const durationFit = half > 0 ? clamp01(1 - Math.abs(duration - mid) / half) : 1;
      if (durationFit >= 0.7) reasons.push(`Duration ${duration.toFixed(1)}s sits near the ${mid.toFixed(0)}s sweet spot`);
      else if (durationFit <= 0.2) reasons.push(`Duration ${duration.toFixed(1)}s is at the edge of the allowed range`);

      const speakerCount = speakers.size;
      const speakerConsistency = speakerCount <= 1 ? 1 : speakerCount === 2 ? 0.8 : clamp01(0.8 - 0.3 * (speakerCount - 2));
      if (speakerCount > 2) reasons.push(`Spans ${speakerCount} speakers`);
      else if (speakerCount === 1) reasons.push("Single speaker");

      const components: ShortFormComponents = {
        hook: round3(hook.score),
        completeness: round3(completeness.score),
        density: round3(density),
        evidence: round3(evidence),
        keyword: round3(keyword),
        duration_fit: round3(durationFit),
        speaker_consistency: round3(speakerConsistency),
      };
      let score = 0;
      for (const key of Object.keys(SHORT_FORM_WEIGHTS) as ShortFormComponent[]) score += SHORT_FORM_WEIGHTS[key] * components[key];
      windows.push({
        firstSentence: first,
        lastSentence: last,
        start,
        end,
        score: round3(score),
        components,
        reasons,
        hookText: sentences[first].text.length > HOOK_TEXT_LIMIT ? `${sentences[first].text.slice(0, HOOK_TEXT_LIMIT - 1)}…` : sentences[first].text,
        wordCount,
        speakers: [...speakers].sort(),
      });
    }
  }

  windows.sort((a, b) => b.score - a.score || a.start - b.start || a.end - b.end);
  const kept: ScoredWindow[] = [];
  let suppressed = 0;
  for (const window of windows) {
    if (kept.length >= maxCandidates) break;
    if (kept.some((existing) => overlapRatio(existing, window) > OVERLAP_SUPPRESSION_RATIO)) {
      suppressed += 1;
      continue;
    }
    kept.push(window);
  }

  const candidates: ShortFormCandidate[] = kept.map((window, index) => ({
    rank: index + 1,
    start_seconds: round3(window.start),
    end_seconds: round3(window.end),
    start_frame: secondsToFrame(window.start, frameRate, "floor"),
    end_frame: secondsToFrame(window.end, frameRate, "ceil"),
    duration_seconds: round3(window.end - window.start),
    score: window.score,
    components: window.components,
    hook_text: window.hookText,
    reasons: window.reasons,
    word_count: window.wordCount,
    sentence_count: window.lastSentence - window.firstSentence + 1,
    speakers: window.speakers,
  }));

  if (!windows.length) warnings.push(`No sentence window fits between ${minSeconds}s and ${maxSeconds}s; widen the range or check sentence punctuation.`);
  if (truncated) warnings.push(`Window enumeration stopped after ${MAX_WINDOWS} windows; later parts of the transcript were not scored.`);
  if (!hasEvidence) warnings.push("No audio/motion/laughter/marker evidence supplied; the evidence component is 0 for every candidate.");
  if (timeline.speakers.length === 0) warnings.push("No speaker labels supplied; speaker_consistency is 1 for every candidate.");

  const parameters = { min_seconds: minSeconds, max_seconds: maxSeconds, max_candidates: maxCandidates, frame_rate: frameRate, hook_words: hookWords, keywords };
  const evidenceCounts = Object.fromEntries(Object.entries(evidenceSeries).map(([key, series]) => [key, series.length])) as Record<keyof typeof evidenceSeries, number>;

  return {
    candidates,
    candidate_count: candidates.length,
    windows_evaluated: windows.length,
    windows_suppressed: suppressed,
    weights: { ...SHORT_FORM_WEIGHTS },
    overlap_suppression_ratio: OVERLAP_SUPPRESSION_RATIO,
    parameters,
    evidence: {
      source_project_item_id: timeline.source_project_item_id,
      transcript_revision: timeline.transcript_revision,
      word_count: timeline.words.length,
      sentence_count: sentences.length,
      duration_seconds: round3(timeline.duration_seconds),
      speakers: timeline.speakers,
      median_words_per_second: round3(medianRate),
      evidence_counts: evidenceCounts,
    },
    plan_revision: digestWordTimeline(timeline, { algorithm: "short-form-candidates-v1", parameters, evidence: evidenceSeries }),
    applied: false,
    routes: SHORT_FORM_ROUTES.map((route) => ({ ...route, routes: [...route.routes] })),
    next_steps: [
      "Review candidates and approve the ones worth cutting.",
      "Create subclips with create_subclip_uxp (or create_subclip) using each candidate's start_seconds/end_seconds.",
      "Preview a derivative with preview_derived_dialogue_sequence_uxp using the approved segments.",
      "Run preview_workflow_recipe with recipe_id \"shorts-cutdown\" to route auto_reframe_sequence and caption steps.",
    ],
    warnings,
    assumptions: [
      "Scores are deterministic heuristics over transcript text and supplied evidence, not a virality prediction.",
      "Windows start and end on sentence boundaries derived from punctuation and pauses longer than 0.8 seconds.",
      `Candidates overlapping a higher-scored candidate by more than ${Math.round(OVERLAP_SUPPRESSION_RATIO * 100)}% of the shorter duration are suppressed.`,
      "Evidence saturates at roughly one weighted event per 6.7 seconds; markers weigh 2x, laughter 1.5x, audio and motion peaks 1x.",
    ],
  };
}
