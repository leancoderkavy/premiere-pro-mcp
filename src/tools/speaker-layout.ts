import { MAX_SPEAKER_REGIONS, MAX_FRAME_DIMENSION, planActiveSpeakerReframe, planSpeakerCheckerboard } from "../ai/speaker-layout.js";
import { WORD_TIMELINE_PARAMETER } from "../ai/word-timeline.js";

const FRAME_RATE_PARAMETER = { type: "number", minimum: 1, maximum: 240, description: "Sequence frame rate used to snap times to frames; defaults to 30." } as const;

function frameSizeParameter(description: string) {
  return {
    type: "object",
    additionalProperties: false,
    description,
    properties: {
      width: { type: "integer", minimum: 16, maximum: MAX_FRAME_DIMENSION, description: "Frame width in pixels." },
      height: { type: "integer", minimum: 16, maximum: MAX_FRAME_DIMENSION, description: "Frame height in pixels." },
    },
    required: ["width", "height"],
  } as const;
}

function wrap(plan: (args: Record<string, unknown>) => unknown) {
  return async (args: Record<string, unknown>) => {
    try {
      return { success: true as const, data: plan(args ?? {}) };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

export function getSpeakerLayoutTools() {
  return {
    plan_speaker_checkerboard: {
      description: "Plan a speaker checkerboard (each speaker's turns on their own video/audio track) from a caller-supplied word timeline. Returns frame-snapped segments, split points, track assignments, and the add_track/razor_all_tracks/move_clip_to_track routes. Local-only; never changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          word_timeline: WORD_TIMELINE_PARAMETER,
          frame_rate: FRAME_RATE_PARAMETER,
          min_turn_seconds: { type: "number", minimum: 0.2, maximum: 10, description: "Interior turns shorter than this are absorbed into the surrounding speaker; defaults to 0.8." },
          merge_gap_seconds: { type: "number", minimum: 0, maximum: 30, description: "Same-speaker words separated by at most this gap merge into one turn; defaults to 0.5." },
          handle_frames: { type: "integer", minimum: 0, maximum: 24, description: "Frames to pad each segment outward, clamped so adjacent turns never overlap; defaults to 2." },
          base_video_track_index: { type: "integer", minimum: 0, maximum: 99, description: "Video track holding the source clip; defaults to 0." },
          base_audio_track_index: { type: "integer", minimum: 0, maximum: 99, description: "Audio track holding the source clip; defaults to 0." },
          track_per_speaker: { type: "boolean", description: "true (default) assigns one track per speaker; false alternates consecutive segments between two tracks." },
          speaker_order: { type: "array", maxItems: 64, description: "Optional speaker labels fixing track slot order; unlisted speakers append in first-appearance order.", items: { type: "string", minLength: 1, maxLength: 128, description: "Speaker label exactly as used in word_timeline." } },
        },
        required: ["word_timeline"],
      },
      handler: wrap(planSpeakerCheckerboard),
    },
    plan_active_speaker_reframe: {
      description: "Plan an active-speaker vertical reframe (Motion Scale/Position keyframes that follow whoever is talking) or a static stacked/split layout from a word timeline and static speaker regions. Returns framings, switches, keyframes, and apply routes. Local-only; never changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          word_timeline: WORD_TIMELINE_PARAMETER,
          source_frame: frameSizeParameter("Source clip frame size in pixels, e.g. 1920x1080 or 3840x2160."),
          target_frame: frameSizeParameter("Target sequence frame size in pixels; defaults to 1080x1920."),
          speaker_regions: {
            type: "array",
            minItems: 1,
            maxItems: MAX_SPEAKER_REGIONS,
            description: "Normalized (0..1) face/body rectangle of every speaker that appears, measured in the source frame.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                speaker_label: { type: "string", minLength: 1, maxLength: 128, description: "Speaker label exactly as used in word_timeline." },
                x: { type: "number", minimum: 0, maximum: 1, description: "Left edge as a fraction of source width." },
                y: { type: "number", minimum: 0, maximum: 1, description: "Top edge as a fraction of source height." },
                width: { type: "number", minimum: 0, maximum: 1, description: "Width as a fraction of source width (> 0)." },
                height: { type: "number", minimum: 0, maximum: 1, description: "Height as a fraction of source height (> 0)." },
              },
              required: ["speaker_label", "x", "y", "width", "height"],
            },
          },
          layout: { type: "string", enum: ["active_speaker", "stacked", "split_left_right", "auto"], description: "auto (default) picks active_speaker for 3+ speakers or a region wider than 0.6, stacked for exactly 2 speakers." },
          min_hold_seconds: { type: "number", minimum: 0.5, maximum: 10, description: "Never switch faster than this; shorter turns are absorbed. Defaults to 1.5." },
          switch_lead_seconds: { type: "number", minimum: 0, maximum: 1, description: "Switch this long before the speaker starts; defaults to 0.15." },
          ease_frames: { type: "integer", minimum: 0, maximum: 30, description: "Frames to ease each switch with bezier keyframes; 0 (default) emits hold keyframes (hard cuts)." },
          frame_rate: FRAME_RATE_PARAMETER,
          headroom: { type: "number", minimum: 0, maximum: 0.5, description: "Fraction of the crop height reserved above the region top; defaults to 0.12." },
          base_video_track_index: { type: "integer", minimum: 0, maximum: 99, description: "Video track holding the source clip in the target sequence; defaults to 0." },
        },
        required: ["word_timeline", "source_frame", "speaker_regions"],
      },
      handler: wrap(planActiveSpeakerReframe),
    },
  };
}
