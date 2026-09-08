import { MAX_STOP_WORDS, planChapterMarkers } from "../ai/chapter-segmentation.js";
import { MAX_EVIDENCE_POINTS, MAX_HOOK_WORDS, MAX_KEYWORDS, rankShortFormCandidates } from "../ai/short-form-candidates.js";
import { WORD_TIMELINE_PARAMETER } from "../ai/word-timeline.js";

type ToolResult = { success: true; data: unknown } | { success: false; error: string };

function run(fn: () => unknown): ToolResult {
  try {
    return { success: true, data: fn() };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const FRAME_RATE = { type: "number", minimum: 1, maximum: 240, description: "Frame rate used to snap start/end frames; defaults to 30." } as const;

function secondsArray(description: string) {
  return { type: "array", maxItems: MAX_EVIDENCE_POINTS, description, items: { type: "number", minimum: 0, maximum: 86400, description: "Source time in seconds." } } as const;
}

export function getShortsIntelligenceTools() {
  return {
    rank_short_form_candidates: {
      description:
        "Rank long-video transcript windows as short-form clip candidates using explainable local heuristics (hook, completeness, density, supplied evidence peaks, keywords, duration fit, speaker consistency) with overlap suppression. Local-only plan; not a virality prediction and never changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          word_timeline: WORD_TIMELINE_PARAMETER,
          min_seconds: { type: "number", minimum: 5, maximum: 180, description: "Shortest allowed candidate duration in seconds; defaults to 15." },
          max_seconds: { type: "number", minimum: 10, maximum: 300, description: "Longest allowed candidate duration in seconds; defaults to 60." },
          max_candidates: { type: "integer", minimum: 1, maximum: 50, description: "Maximum candidates returned after overlap suppression; defaults to 8." },
          frame_rate: FRAME_RATE,
          hook_words: { type: "array", maxItems: MAX_HOOK_WORDS, description: "Extra single-word hook tokens added to the built-in lexicon.", items: { type: "string", minLength: 1, maxLength: 64, description: "Hook word." } },
          keywords: { type: "array", maxItems: MAX_KEYWORDS, description: "Topic keywords or short phrases whose presence is rewarded.", items: { type: "string", minLength: 1, maxLength: 64, description: "Keyword or phrase." } },
          audio_energy_peaks: secondsArray("Optional source-time audio energy peaks from local analysis (for example detect_audio_transients)."),
          motion_peaks: secondsArray("Optional source-time motion peaks from local analysis (for example detect_motion_peaks)."),
          laughter_seconds: secondsArray("Optional source-time laughter moments supplied by the caller."),
          marker_seconds: secondsArray("Optional source-time editor-flagged moments (markers)."),
        },
        required: ["word_timeline"],
      },
      handler: async (args: Record<string, unknown>) =>
        run(() =>
          rankShortFormCandidates({
            word_timeline: args.word_timeline,
            min_seconds: args.min_seconds,
            max_seconds: args.max_seconds,
            max_candidates: args.max_candidates,
            frame_rate: args.frame_rate,
            hook_words: args.hook_words,
            keywords: args.keywords,
            audio_energy_peaks: args.audio_energy_peaks,
            motion_peaks: args.motion_peaks,
            laughter_seconds: args.laughter_seconds,
            marker_seconds: args.marker_seconds,
          }),
        ),
    },
    plan_chapter_markers: {
      description:
        "Plan YouTube-style chapters from a word-timed transcript using local TextTiling-lite topic-shift detection, titling each chapter from its distinctive tokens. Returns chapters, a youtube_timestamps block and add_marker-ready Chapter markers. Local-only plan; never changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          word_timeline: WORD_TIMELINE_PARAMETER,
          min_chapter_seconds: { type: "number", minimum: 20, maximum: 1800, description: "Minimum chapter duration in seconds; defaults to 90." },
          max_chapters: { type: "integer", minimum: 2, maximum: 60, description: "Maximum number of chapters; deepest topic valleys win. Defaults to 12." },
          title_words: { type: "integer", minimum: 1, maximum: 8, description: "Maximum words in each generated chapter name; defaults to 4." },
          stop_words: { type: "array", maxItems: MAX_STOP_WORDS, description: "Extra stop words removed before similarity and titling.", items: { type: "string", minLength: 1, maxLength: 64, description: "Stop word." } },
          block_words: { type: "integer", minimum: 10, maximum: 400, description: "Approximate words compared on each side of a sentence gap; defaults to 60." },
          frame_rate: FRAME_RATE,
        },
        required: ["word_timeline"],
      },
      handler: async (args: Record<string, unknown>) =>
        run(() =>
          planChapterMarkers({
            word_timeline: args.word_timeline,
            min_chapter_seconds: args.min_chapter_seconds,
            max_chapters: args.max_chapters,
            title_words: args.title_words,
            stop_words: args.stop_words,
            block_words: args.block_words,
            frame_rate: args.frame_rate,
          }),
        ),
    },
  };
}
