import { WORD_TIMELINE_PARAMETER } from "../ai/word-timeline.js";
import {
  MAX_SHOT_CHANGES,
  MAX_SPEAKER_PALETTE,
  SHORT_BRANDS,
  planReactionCaptions,
  planShortExportFolder,
  planShortSubscribeCta,
} from "../ai/reaction-shorts.js";
import { SAFE_ZONE_PLATFORMS } from "../ai/caption-authoring.js";

function wrap(plan: (args: Record<string, unknown>) => unknown) {
  return async (args: Record<string, unknown>) => {
    try {
      return { success: true as const, data: plan(args ?? {}) };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

const FRAME_RATE = { type: "number", minimum: 1, maximum: 240, description: "Sequence frame rate used to snap times to frames; defaults to 30." } as const;
const BRAND = { type: "string", enum: [...SHORT_BRANDS], description: "Channel brand kit. cafe must not reuse watch_club fonts, name cards, or speaker colors." } as const;

export function getReactionShortsTools() {
  return {
    plan_reaction_captions: {
      description:
        "Plan stacked, speaker-colored reaction captions from a word timeline and an explicit speaker palette. Flash-length words merge, overlaps stack, and unknown speakers stay uncolored. Local-only; never changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          word_timeline: WORD_TIMELINE_PARAMETER,
          speaker_palette: {
            type: "array",
            minItems: 1,
            maxItems: MAX_SPEAKER_PALETTE,
            description: "Known speakers and their exact #RRGGBB colors. Missing labels are returned as uncertain and never receive a guessed color.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                speaker_label: { type: "string", minLength: 1, maxLength: 128, description: "Speaker label exactly as used in word_timeline." },
                color: { type: "string", minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$", description: "Caption color as #RRGGBB." },
              },
              required: ["speaker_label", "color"],
            },
          },
          shot_changes: {
            type: "array",
            maxItems: MAX_SHOT_CHANGES,
            description: "Optional labeled cut points. A matching speaker's caption will not start before they appear on screen when a readable hold remains.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                time_seconds: { type: "number", minimum: 0, maximum: 86400, description: "Shot-change time in source seconds; must be non-decreasing." },
                speaker_label: { type: "string", minLength: 1, maxLength: 128, description: "Speaker who becomes visible at this cut." },
              },
              required: ["time_seconds", "speaker_label"],
            },
          },
          frame_rate: FRAME_RATE,
          merge_gap_seconds: { type: "number", minimum: 0, maximum: 5, description: "Same-speaker words closer than this become one cue; defaults to 0.12 so a short pause can start a new line." },
          min_solo_cue_seconds: { type: "number", minimum: 0.15, maximum: 3, description: "Cues shorter than this merge with the next same-speaker cue; defaults to 0.45." },
          combine_gap_seconds: { type: "number", minimum: 0, maximum: 5, description: "Maximum gap when combining a flash cue with the next same-speaker cue; defaults to 0.8." },
          min_hold_seconds: { type: "number", minimum: 0.15, maximum: 3, description: "Minimum duration kept after clamping a cue to a shot change; defaults to 0.35." },
        },
        required: ["word_timeline", "speaker_palette"],
      },
      handler: wrap(planReactionCaptions),
    },
    plan_short_subscribe_cta: {
      description:
        "Plan a brief subscribe overlay about two-thirds through a Short, after an optional hook, in a platform-safe lower-third. Local-only; never changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          duration_seconds: { type: "number", minimum: 3, maximum: 180, description: "Finished Short duration in seconds." },
          at_ratio: { type: "number", minimum: 0.4, maximum: 0.9, description: "Placement as a fraction of duration; defaults to 2/3." },
          hold_seconds: { type: "number", minimum: 1, maximum: 5, description: "How long the prompt stays on screen; defaults to 2." },
          hook_end_seconds: { type: "number", minimum: 0, maximum: 180, description: "If the hook ends later than the default placement, the CTA starts after the hook." },
          frame_rate: FRAME_RATE,
          brand: BRAND,
          copy: { type: "string", minLength: 1, maxLength: 80, description: "Optional overlay text. Defaults to a brand-appropriate subscribe line." },
          platform: { type: "string", enum: [...SAFE_ZONE_PLATFORMS], description: "Safe-zone profile; defaults to youtube_shorts." },
        },
        required: ["duration_seconds"],
      },
      handler: wrap(planShortSubscribeCta),
    },
    plan_short_export_folder: {
      description:
        "Plan a series-named export folder inside an approved Shorts root and remind the caller to create it when missing. Local-only; never writes files or changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          export_root: { type: "string", minLength: 1, maxLength: 4096, description: "Absolute Shorts export root, for example the ALL Shorts or Cafe Exports folder." },
          series_name: { type: "string", minLength: 1, maxLength: 80, description: "Anime or series folder name to create under export_root when missing." },
          title: { type: "string", minLength: 1, maxLength: 120, description: "Short title used as the file stem." },
          brand: BRAND,
          extension: { type: "string", minLength: 2, maxLength: 8, description: "File extension without a dot; defaults to mp4." },
        },
        required: ["export_root", "series_name", "title"],
      },
      handler: wrap(planShortExportFolder),
    },
  };
}
