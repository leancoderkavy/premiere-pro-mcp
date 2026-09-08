import { MAX_BEATS, MAX_CLIPS, MIN_BEATS, planBeatMontage } from "../ai/beat-montage.js";
import { MAX_EMPHASIS_WORDS, MAX_TRIGGER_SECONDS, MAX_ZOOMS, planEmphasisZoomKeyframes } from "../ai/emphasis-zoom.js";
import { WORD_TIMELINE_PARAMETER } from "../ai/word-timeline.js";

/**
 * Rhythm plan tools: CapCut/Submagic-style punch-in zoom keyframes and
 * beat-synced montage assembly. Both are plan-only, local, deterministic, and
 * never change Premiere; callers apply results through the routes returned.
 */

const point = (description: string, min: number, max: number) => ({
  type: "object",
  additionalProperties: false,
  description,
  properties: {
    x: { type: "number", minimum: min, maximum: max, description: "Horizontal component." },
    y: { type: "number", minimum: min, maximum: max, description: "Vertical component." },
  },
});

/** Runs a pure planner and converts any validation error into a tool failure instead of throwing. */
function toolResult<T>(run: () => T): { success: true; data: T } | { success: false; error: string } {
  try {
    return { success: true, data: run() };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function getRhythmPlanTools() {
  return {
    plan_emphasis_zoom_keyframes: {
      description: "Plan CapCut-style punch-in zoom keyframes (Motion Scale + subject-anchored Position) from a word timeline or supplied trigger times, with cooldown, easing, and hold controls. Local-only and deterministic; returns a keyframe plan for automate_effect_parameters_uxp or add_keyframe and never changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          word_timeline: WORD_TIMELINE_PARAMETER,
          trigger_seconds: { type: "array", minItems: 1, maxItems: MAX_TRIGGER_SECONDS, items: { type: "number", minimum: 0, maximum: 86400 }, description: "Clip-relative trigger times in seconds; use instead of word_timeline (exactly one is required)." },
          trigger: { type: "string", enum: ["sentence_start", "emphasis_words", "every_n_seconds", "supplied"], description: "Trigger mode. Defaults to sentence_start with word_timeline and supplied with trigger_seconds." },
          emphasis_words: { type: "array", maxItems: MAX_EMPHASIS_WORDS, items: { type: "string", minLength: 1, maxLength: 128 }, description: "Words or short phrases that trigger a zoom in emphasis_words mode (case and punctuation insensitive)." },
          every_n_seconds: { type: "number", minimum: 0.5, maximum: 3600, description: "Trigger interval for every_n_seconds mode, measured from the start of the word timeline." },
          frame_rate: { type: "number", minimum: 1, maximum: 240, description: "Sequence frame rate used to snap keyframe times; defaults to 30." },
          base_scale: { type: "number", minimum: 1, maximum: 400, description: "Resting Motion Scale percent; defaults to 100." },
          zoom_scale: { type: "number", minimum: 101, maximum: 200, description: "Peak Motion Scale percent for each punch-in; defaults to 112 and must exceed base_scale." },
          ease_in_frames: { type: "integer", minimum: 0, maximum: 30, description: "Frames to ramp from base to zoom (0 = instant cut zoom); defaults to 3." },
          hold_seconds: { type: "number", minimum: 0, maximum: 10, description: "Seconds to hold the zoomed scale before easing out; defaults to 1.2." },
          ease_out_frames: { type: "integer", minimum: 0, maximum: 30, description: "Frames to ramp back to base (0 = instant); defaults to 6." },
          cooldown_seconds: { type: "number", minimum: 0, maximum: 600, description: "Minimum spacing between accepted triggers; closer triggers are dropped with a warning. Defaults to 2.5." },
          alternate: { type: "boolean", description: "When true, triggers alternate between a punch-in that stays zoomed and a punch-out back to base instead of every trigger zooming and returning." },
          subject_point: point("Normalized (0..1) subject location the zoom should stay anchored on; defaults to x 0.5, y 0.4 for talking heads.", 0, 1),
          frame: {
            type: "object",
            additionalProperties: false,
            description: "Sequence frame size in pixels; defaults to 1080x1920.",
            properties: {
              width: { type: "integer", minimum: 16, maximum: 16384, description: "Frame width in pixels." },
              height: { type: "integer", minimum: 16, maximum: 16384, description: "Frame height in pixels." },
            },
          },
          max_zooms: { type: "integer", minimum: 1, maximum: MAX_ZOOMS, description: "Maximum accepted zoom events; defaults to 120." },
          clip_start_seconds: { type: "number", minimum: 0, maximum: 86400, description: "Timeline offset of the clip; added to produce timeline_seconds on every keyframe. Defaults to 0." },
        },
      },
      handler: async (args: Record<string, unknown>) => toolResult(() => planEmphasisZoomKeyframes(args ?? {})),
    },
    plan_beat_montage: {
      description: "Plan a beat-synced montage: carve a detect_beats grid into shots every N beats (merging short and splitting long spans), assign clips in order, and emit add_to_timeline_batch chunks, trim ranges, and cut markers. Local-only and deterministic; never changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          beat_seconds: { type: "array", minItems: MIN_BEATS, maxItems: MAX_BEATS, items: { type: "number", minimum: 0, maximum: 86400 }, description: "Strictly ascending beat times in sequence seconds, such as beatTimesSeconds from detect_beats." },
          clips: {
            type: "array",
            minItems: 1,
            maxItems: MAX_CLIPS,
            description: "Source clips available for the montage, in the caller's preferred order.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                item_id: { type: "string", minLength: 1, maxLength: 512, description: "Project item node ID or unique name." },
                duration_seconds: { type: "number", exclusiveMinimum: 0, maximum: 86400, description: "Usable source duration in seconds." },
                in_seconds: { type: "number", minimum: 0, maximum: 86400, description: "Source in point in seconds; defaults to 0." },
                priority: { type: "integer", minimum: -1000000, maximum: 1000000, description: "Optional priority; higher values are used first in priority and round_robin orders." },
              },
              required: ["item_id", "duration_seconds"],
            },
          },
          cut_every_n_beats: { type: "integer", minimum: 1, maximum: 16, description: "Beats per shot; defaults to 2." },
          min_shot_seconds: { type: "number", minimum: 0.05, maximum: 60, description: "Shorter spans merge with the next beats; defaults to 0.4." },
          max_shot_seconds: { type: "number", minimum: 0.05, maximum: 600, description: "Longer spans split at intermediate beats; defaults to 6." },
          start_beat_index: { type: "integer", minimum: 0, maximum: MAX_BEATS - 2, description: "Index of the first beat to cut on; defaults to 0." },
          order: { type: "string", enum: ["as_given", "priority", "round_robin"], description: "Clip assignment order; defaults to as_given. round_robin interleaves priority groups." },
          allow_reuse: { type: "boolean", description: "When true, cycle through clips again once they run out (continuing from where each stopped); otherwise the montage stops." },
          video_track_index: { type: "integer", minimum: 0, maximum: 99, description: "Target video track for every placement; defaults to 0." },
          audio_track_index: { type: "integer", minimum: 0, maximum: 99, description: "Target audio track for linked audio; defaults to 0." },
          frame_rate: { type: "number", minimum: 1, maximum: 240, description: "Sequence frame rate used to snap shot boundaries; defaults to 30." },
          total_duration_seconds: { type: "number", exclusiveMinimum: 0, maximum: 86400, description: "Optional cap on montage length measured from the first cut." },
        },
        required: ["beat_seconds", "clips"],
      },
      handler: async (args: Record<string, unknown>) => toolResult(() => planBeatMontage(args ?? {})),
    },
  };
}
