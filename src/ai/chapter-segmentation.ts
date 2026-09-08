import { boundedNumber } from "./short-form-candidates.js";
import {
  digestWordTimeline,
  normalizeToken,
  secondsToFrame,
  sentenceRanges,
  validateWordTimeline,
  type TranscriptWord,
  type WordTimeline,
} from "./word-timeline.js";

/**
 * TextTiling-lite chapter segmentation over a word-timed transcript.
 *
 * At every sentence gap the term-frequency vectors of the preceding and
 * following ~N words are compared with cosine similarity. Valleys below
 * mean − 0.5·stddev become chapter boundaries, subject to a minimum chapter
 * duration and a chapter cap (deepest valleys win). Chapters are titled from
 * their most distinctive tokens (tf × idf across chapters). Nothing here
 * contacts a model or changes Premiere.
 */

export const DEFAULT_BLOCK_WORDS = 60;
export const MAX_STOP_WORDS = 256;
export const VALLEY_STDDEV_FACTOR = 0.5;
const MAX_KEYWORDS_PER_CHAPTER = 8;

export const DEFAULT_STOP_WORDS: readonly string[] = Object.freeze([
  "a", "about", "above", "after", "again", "against", "all", "also", "am", "an", "and", "any", "are", "aren't", "as", "at",
  "be", "because", "been", "before", "being", "below", "between", "both", "but", "by", "can", "can't", "cannot", "could",
  "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down", "during", "each", "few", "for", "from",
  "further", "get", "got", "had", "hadn't", "has", "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's",
  "her", "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've",
  "if", "in", "into", "is", "isn't", "it", "it's", "its", "itself", "just", "kind", "let's", "like", "lot", "me", "more",
  "most", "mustn't", "my", "myself", "no", "nor", "not", "now", "of", "off", "oh", "okay", "on", "once", "only", "or",
  "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "really", "right", "same", "shan't", "she", "she'd",
  "she'll", "she's", "should", "shouldn't", "so", "some", "something", "such", "than", "that", "that's", "the", "their",
  "theirs", "them", "themselves", "then", "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've",
  "thing", "things", "this", "those", "through", "to", "too", "uh", "um", "under", "until", "up", "very", "was", "wasn't",
  "way", "we", "we'd", "we'll", "we're", "we've", "well", "were", "weren't", "what", "what's", "when", "when's", "where",
  "where's", "which", "while", "who", "who's", "whom", "why", "why's", "will", "with", "won't", "would", "wouldn't", "yeah",
  "yes", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself", "yourselves",
]);

export type ChapterPlanOptions = {
  word_timeline: unknown;
  min_chapter_seconds?: unknown;
  max_chapters?: unknown;
  title_words?: unknown;
  stop_words?: unknown;
  frame_rate?: unknown;
  block_words?: unknown;
};

export type ChapterPlanChapter = {
  index: number;
  start_seconds: number;
  end_seconds: number;
  start_frame: number;
  end_frame: number;
  duration_seconds: number;
  name: string;
  keywords: string[];
  word_count: number;
  boundary_similarity: number | null;
};

type Sentence = { start: number; end: number; tokens: string[]; wordCount: number };

function fail(message: string): never {
  throw new Error(message);
}

function round3(value: number): number {
  return Number(value.toFixed(3));
}

/** Formats seconds as m:ss or h:mm:ss, the way YouTube chapter lists expect. */
export function formatYoutubeTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

function termFrequencies(tokens: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const token of tokens) map.set(token, (map.get(token) ?? 0) + 1);
  return map;
}

/** Cosine similarity between two term-frequency maps; 1 when either side is empty. */
export function cosineSimilarity(left: Map<string, number>, right: Map<string, number>): number {
  if (!left.size || !right.size) return 1;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const [token, count] of left) {
    leftNorm += count * count;
    const other = right.get(token);
    if (other) dot += count * other;
  }
  for (const count of right.values()) rightNorm += count * count;
  if (!leftNorm || !rightNorm) return 1;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function stopWordList(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_STOP_WORDS) fail(`stop_words must be an array of at most ${MAX_STOP_WORDS} strings`);
  const out = new Set<string>();
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || !entry.trim() || entry.length > 64) fail(`stop_words[${index}] must be a non-empty string of at most 64 characters`);
    const token = normalizeToken(entry);
    if (token) out.add(token);
  });
  return [...out].sort();
}

function buildSentences(words: readonly TranscriptWord[], stopWords: ReadonlySet<string>): Sentence[] {
  return sentenceRanges(words).map((range) => {
    const slice = words.slice(range.startIndex, range.endIndex + 1);
    const tokens = slice.map((word) => normalizeToken(word.text)).filter((token) => token.length >= 2 && !stopWords.has(token));
    return { start: slice[0].start_seconds, end: slice[slice.length - 1].end_seconds, tokens, wordCount: slice.length };
  });
}

/** Tokens from sentences adjacent to a gap, walking outward until `blockWords` tokens are gathered. */
function blockTokens(sentences: readonly Sentence[], gapIndex: number, direction: -1 | 1, blockWords: number): string[] {
  const tokens: string[] = [];
  let index = direction === -1 ? gapIndex - 1 : gapIndex;
  while (index >= 0 && index < sentences.length && tokens.length < blockWords) {
    tokens.push(...sentences[index].tokens);
    index += direction;
  }
  return tokens;
}

function titleCase(token: string): string {
  return token.charAt(0).toLocaleUpperCase() + token.slice(1);
}

export const CHAPTER_ROUTES = Object.freeze([
  { step: "add_markers", routes: ["add_marker", "manage_markers_uxp"], note: "Add each entry in `markers` as a Chapter marker on the sequence." },
  { step: "verify_markers", routes: ["get_sequence_markers_by_type"], note: "Read back Chapter markers to confirm placement." },
]);

export function planChapterMarkers(options: ChapterPlanOptions) {
  const timeline: WordTimeline = validateWordTimeline(options.word_timeline);
  const minChapterSeconds = boundedNumber(options.min_chapter_seconds, "min_chapter_seconds", 20, 1800, 90);
  const maxChapters = boundedNumber(options.max_chapters, "max_chapters", 2, 60, 12, true);
  const titleWords = boundedNumber(options.title_words, "title_words", 1, 8, 4, true);
  const frameRate = boundedNumber(options.frame_rate, "frame_rate", 1, 240, 30);
  const blockWords = boundedNumber(options.block_words, "block_words", 10, 400, DEFAULT_BLOCK_WORDS, true);
  const extraStopWords = stopWordList(options.stop_words);
  const stopWords = new Set([...DEFAULT_STOP_WORDS, ...extraStopWords]);
  const warnings: string[] = [];

  const sentences = buildSentences(timeline.words, stopWords);
  const duration = timeline.duration_seconds;

  // Similarity at every sentence gap (gap k sits before sentence k).
  const gaps: Array<{ index: number; time: number; similarity: number }> = [];
  for (let gap = 1; gap < sentences.length; gap += 1) {
    const left = termFrequencies(blockTokens(sentences, gap, -1, blockWords));
    const right = termFrequencies(blockTokens(sentences, gap, 1, blockWords));
    gaps.push({ index: gap, time: sentences[gap].start, similarity: cosineSimilarity(left, right) });
  }
  const mean = gaps.length ? gaps.reduce((sum, gap) => sum + gap.similarity, 0) / gaps.length : 1;
  const variance = gaps.length ? gaps.reduce((sum, gap) => sum + (gap.similarity - mean) ** 2, 0) / gaps.length : 0;
  const stddev = Math.sqrt(variance);
  const threshold = mean - VALLEY_STDDEV_FACTOR * stddev;

  const valleys = gaps
    .filter((gap, position) => {
      if (stddev === 0 || gap.similarity >= threshold) return false;
      const previous = gaps[position - 1];
      const next = gaps[position + 1];
      return (!previous || gap.similarity <= previous.similarity) && (!next || gap.similarity <= next.similarity);
    })
    .map((gap) => ({ ...gap, depth: round3(threshold - gap.similarity) }))
    .sort((a, b) => b.depth - a.depth || a.time - b.time);

  const accepted: Array<(typeof valleys)[number]> = [];
  const rejected: Array<{ time_seconds: number; similarity: number; reason: string }> = [];
  for (const valley of valleys) {
    if (accepted.length >= maxChapters - 1) {
      rejected.push({ time_seconds: round3(valley.time), similarity: round3(valley.similarity), reason: "max_chapters reached" });
      continue;
    }
    const anchors = [0, duration, ...accepted.map((entry) => entry.time)];
    if (anchors.some((anchor) => Math.abs(anchor - valley.time) < minChapterSeconds)) {
      rejected.push({ time_seconds: round3(valley.time), similarity: round3(valley.similarity), reason: "min_chapter_seconds" });
      continue;
    }
    accepted.push(valley);
  }
  accepted.sort((a, b) => a.time - b.time);

  const boundaries = [0, ...accepted.map((entry) => entry.time), duration];
  const chapterTokens: string[][] = [];
  const chapterWordCounts: number[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const tokens: string[] = [];
    let wordCount = 0;
    for (const sentence of sentences) {
      if (sentence.start >= start && (sentence.start < end || index === boundaries.length - 2)) {
        tokens.push(...sentence.tokens);
        wordCount += sentence.wordCount;
      }
    }
    chapterTokens.push(tokens);
    chapterWordCounts.push(wordCount);
  }

  const chapterCount = chapterTokens.length;
  const documentFrequency = new Map<string, number>();
  for (const tokens of chapterTokens) for (const token of new Set(tokens)) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);

  const chapters: ChapterPlanChapter[] = chapterTokens.map((tokens, index) => {
    const tf = termFrequencies(tokens);
    const firstSeen = new Map<string, number>();
    tokens.forEach((token, position) => {
      if (!firstSeen.has(token)) firstSeen.set(token, position);
    });
    const ranked = [...tf.entries()]
      .map(([token, count]) => ({ token, score: count * (Math.log((chapterCount + 1) / ((documentFrequency.get(token) ?? 0) + 1)) + 1) }))
      .sort((a, b) => b.score - a.score || (firstSeen.get(a.token) ?? 0) - (firstSeen.get(b.token) ?? 0) || a.token.localeCompare(b.token));
    const keywords = ranked.slice(0, MAX_KEYWORDS_PER_CHAPTER).map((entry) => entry.token);
    const titleTokens = ranked.slice(0, titleWords).map((entry) => entry.token).sort((a, b) => (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0));
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const boundary = accepted[index - 1];
    return {
      index,
      start_seconds: round3(start),
      end_seconds: round3(end),
      start_frame: secondsToFrame(start, frameRate, "floor"),
      end_frame: secondsToFrame(end, frameRate, "ceil"),
      duration_seconds: round3(end - start),
      name: titleTokens.length ? titleTokens.map(titleCase).join(" ") : `Chapter ${index + 1}`,
      keywords,
      word_count: chapterWordCounts[index],
      boundary_similarity: boundary ? round3(boundary.similarity) : null,
    };
  });

  if (duration < 2 * minChapterSeconds) warnings.push(`Transcript spans ${round3(duration)}s, shorter than two chapters of ${minChapterSeconds}s; a single chapter was produced.`);
  else if (chapters.length < 3) warnings.push("YouTube requires at least three chapters; lower min_chapter_seconds or block_words to find more boundaries.");
  if (gaps.length && stddev === 0) warnings.push("Adjacent blocks have identical similarity everywhere; no topic shifts were detected.");
  if (chapters.length < valleys.length + 1 && valleys.length > accepted.length) warnings.push(`${valleys.length - accepted.length} valley(s) were rejected by min_chapter_seconds or max_chapters.`);

  const markers = chapters.map((chapter) => ({
    time_seconds: chapter.start_seconds,
    name: chapter.name,
    type: "Chapter" as const,
    comment: `Chapter ${chapter.index + 1} (${formatYoutubeTimestamp(chapter.start_seconds)}–${formatYoutubeTimestamp(chapter.end_seconds)}): ${chapter.keywords.join(", ") || "no distinctive keywords"}`,
  }));
  const parameters = { min_chapter_seconds: minChapterSeconds, max_chapters: maxChapters, title_words: titleWords, frame_rate: frameRate, block_words: blockWords, stop_words: extraStopWords };

  return {
    chapters,
    chapter_count: chapters.length,
    youtube_timestamps: chapters.map((chapter) => `${formatYoutubeTimestamp(chapter.start_seconds)} ${chapter.name}`).join("\n"),
    markers,
    parameters,
    evidence: {
      source_project_item_id: timeline.source_project_item_id,
      transcript_revision: timeline.transcript_revision,
      word_count: timeline.words.length,
      sentence_count: sentences.length,
      duration_seconds: round3(duration),
      gap_count: gaps.length,
      similarity_mean: round3(mean),
      similarity_stddev: round3(stddev),
      valley_threshold: round3(threshold),
      valleys_found: valleys.length,
      accepted_boundaries: accepted.map((entry) => ({ time_seconds: round3(entry.time), similarity: round3(entry.similarity), depth: entry.depth })),
      rejected_boundaries: rejected,
    },
    plan_revision: digestWordTimeline(timeline, { algorithm: "texttiling-lite-v1", parameters }),
    applied: false,
    routes: CHAPTER_ROUTES.map((route) => ({ ...route, routes: [...route.routes] })),
    next_steps: [
      "Review chapter names and adjust wording before publishing.",
      "Add each marker with add_marker (or manage_markers_uxp) using time_seconds, name and type Chapter.",
      "Confirm placement with get_sequence_markers_by_type marker_type Chapter.",
      "Paste youtube_timestamps into the video description for YouTube chapters.",
    ],
    warnings,
    assumptions: [
      "Boundaries are lexical topic shifts (TextTiling-lite cosine valleys), not semantic understanding.",
      "Chapter names are the most distinctive tokens by tf-idf across chapters, title-cased; they are drafts.",
      "The first chapter always starts at 0:00 as YouTube requires.",
      "Times are source seconds from the supplied word timeline; offset them if the sequence does not start at the source head.",
    ],
  };
}
