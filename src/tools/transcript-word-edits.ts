import { WORD_TIMELINE_PARAMETER } from "../ai/word-timeline.js";
import {
  DEFAULT_FILLER_WORDS,
  MAX_MUTE_WORDS,
  MAX_PHRASES,
  MAX_REMOVALS,
  MAX_TAKE_GROUPS,
  detectRepeatedTakes,
  planFillerWordRemoval,
  planPauseTightening,
  planWordMuteRanges,
} from "../ai/transcript-word-edits.js";

type ToolResult = { success: true; data: unknown } | { success: false; error: string };

function run(fn: (args: Record<string, unknown>) => unknown) {
  return async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const input = args && typeof args === "object" && !Array.isArray(args) ? args : {};
      return { success: true, data: fn(input) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

const FRAME_RATE = { type: "number", minimum: 1, maximum: 240, description: "Timebase used to snap ranges to whole frames; defaults to 30." } as const;
const HANDLE_FRAMES = { type: "integer", minimum: 0, maximum: 24, description: "Frames of handle left inside each removal so cuts are not tight; defaults to 1." } as const;

export function getTranscriptWordEditTools() {
  return {
    plan_filler_word_removal: {
      description: "Plan word-level filler removal (um, uh, you know...) from a revision-bound word timeline. Returns frame-snapped removal and keep ranges plus apply routes. Local-only; never changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          word_timeline: WORD_TIMELINE_PARAMETER,
          filler_words: { type: "array", maxItems: MAX_PHRASES, items: { type: "string", minLength: 1, maxLength: 64 }, description: `Filler words or multi-word phrases to remove (matched as consecutive normalized tokens). Defaults to: ${DEFAULT_FILLER_WORDS.join(", ")}. 'like' is only removed when listed explicitly.` },
          frame_rate: FRAME_RATE,
          handle_frames: HANDLE_FRAMES,
          merge_gap_seconds: { type: "number", minimum: 0, maximum: 5, description: "Removals separated by less than this are merged into one cut; defaults to 0.15." },
          max_removals: { type: "integer", minimum: 1, maximum: MAX_REMOVALS, description: "Maximum merged removals to return; defaults to 256." },
          min_confidence: { type: "number", minimum: 0, maximum: 1, description: "Optional: only remove fillers whose every word carries a confidence at or above this value." },
        },
        required: ["word_timeline"],
      },
      handler: run(planFillerWordRemoval),
    },
    plan_pause_tightening: {
      description: "Plan shortening (not deleting) of inter-word pauses longer than max_pause_seconds down to a target, respecting sentence boundaries. Returns centered removal ranges, keep ranges, savings and apply routes. Local-only; never changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          word_timeline: WORD_TIMELINE_PARAMETER,
          max_pause_seconds: { type: "number", minimum: 0.2, maximum: 30, description: "Pauses longer than this are tightened; defaults to 1.0." },
          target_pause_seconds: { type: "number", minimum: 0, maximum: 30, description: "Pause length kept after tightening (split evenly around the cut); defaults to 0.35 and must not exceed max_pause_seconds." },
          sentence_pause_seconds: { type: "number", minimum: 0, maximum: 30, description: "Pause length kept after sentence-ending punctuation; defaults to 0.6." },
          frame_rate: FRAME_RATE,
          max_edits: { type: "integer", minimum: 1, maximum: MAX_REMOVALS, description: "Maximum pauses to tighten (longest first when capped); defaults to 256." },
        },
        required: ["word_timeline"],
      },
      handler: run(planPauseTightening),
    },
    plan_word_mute_ranges: {
      description: "Plan mute or bleep ranges for listed words/phrases in a word timeline. Returns redacted, frame-snapped mute ranges, ready-to-apply audio keyframes and (for bleep) tone placements. Local-only; never changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          word_timeline: WORD_TIMELINE_PARAMETER,
          words: { type: "array", minItems: 1, maxItems: MAX_MUTE_WORDS, items: { type: "string", minLength: 1, maxLength: 64 }, description: "Exact words or phrases to mute, matched as consecutive normalized tokens." },
          padding_seconds: { type: "number", minimum: 0, maximum: 1, description: "Seconds added before and after each flagged word; defaults to 0.04." },
          mode: { type: "string", enum: ["mute", "bleep"], description: "mute ducks the dialogue only; bleep also emits tone placements. Defaults to mute." },
          mute_level_db: { type: "number", minimum: -96, maximum: 0, description: "Level inside each range for add_audio_keyframes; defaults to -60." },
          frame_rate: FRAME_RATE,
        },
        required: ["word_timeline", "words"],
      },
      handler: run(planWordMuteRanges),
    },
    detect_repeated_takes: {
      description: "Detect repeated sentence takes (retakes) in a word timeline using token similarity within a time window, and plan removal of all but the kept take. Returns take groups, removal and keep ranges, and apply routes. Local-only; never changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          word_timeline: WORD_TIMELINE_PARAMETER,
          min_words: { type: "integer", minimum: 3, maximum: 20, description: "Minimum tokens a sentence needs before it is compared; defaults to 4." },
          similarity_threshold: { type: "number", minimum: 0.6, maximum: 1, description: "Token Jaccard/containment similarity needed to group two sentences; defaults to 0.8." },
          keep: { type: "string", enum: ["last", "first"], description: "Which take in each group to keep; defaults to last." },
          max_groups: { type: "integer", minimum: 1, maximum: MAX_TAKE_GROUPS, description: "Maximum take groups to return; defaults to 64." },
          max_gap_seconds: { type: "number", minimum: 1, maximum: 120, description: "Only sentences starting within this many seconds of an earlier candidate are compared; defaults to 20." },
          frame_rate: FRAME_RATE,
          handle_frames: HANDLE_FRAMES,
        },
        required: ["word_timeline"],
      },
      handler: run(detectRepeatedTakes),
    },
  };
}
