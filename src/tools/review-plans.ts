import {
  DEFAULT_MAX_NOTE_ITEMS,
  MARKER_COLOR_MODES,
  MAX_NOTE_ITEMS,
  MAX_NOTES_BYTES,
  planClientNotesChecklist,
  TIMECODE_STYLES,
} from "../ai/client-notes.js";
import {
  CAMERA_ROLES,
  MAX_CAMERA_ID_LENGTH,
  MAX_CAMERAS,
  MAX_SPEAKER_LABEL_LENGTH,
  MAX_SPEAKER_SEGMENTS,
  planMulticamAngleSwitches,
} from "../ai/multicam-switching.js";

/**
 * Review-and-conversation planners: local, deterministic tools for two of
 * the most requested "AI in Premiere" jobs that are really triage work —
 * turning reviewer feedback into a checklist with markers, and following the
 * active speaker across stacked camera tracks. Neither contacts a model or
 * changes Premiere; both return payloads for existing verified tools.
 */

function toolResult<T>(run: () => T): { success: true; data: T } | { success: false; error: string } {
  try {
    return { success: true, data: run() };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function getReviewPlanTools() {
  return {
    plan_client_notes_checklist: {
      description:
        "Turn pasted client or reviewer feedback into a prioritized checklist: finds timecodes and ranges, classifies each note (audio, color, graphics, text, timing, cut, legal, delivery), infers must/should/nice priority, separates approvals and questions, and emits an add_markers_batch payload. Local-only and deterministic; never changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          notes: { type: "string", minLength: 1, maxLength: MAX_NOTES_BYTES, description: "Free-text feedback (email, chat, review-tool export). One note per line works best; bullets, 'Name:' prefixes, mm:ss, hh:mm:ss, hh:mm:ss:ff, 1m23s, and ranges like 1:23-1:30 are understood." },
          frame_rate: { type: "number", minimum: 1, maximum: 240, description: "Sequence frame rate used to snap marker times and read ff fields; defaults to 30." },
          sequence_duration_seconds: { type: "number", minimum: 0, maximum: 86400, description: "Optional sequence duration; notes past it are kept in the checklist but get no marker." },
          timecode_style: { type: "string", enum: [...TIMECODE_STYLES], description: "How a three-part a:b:c value is read: auto (default), clock (hh:mm:ss), or frames (mm:ss:ff)." },
          marker_color_mode: { type: "string", enum: [...MARKER_COLOR_MODES], description: "Marker color by priority (default: must=red, should=orange, nice=green), by category, or one fixed color." },
          fixed_marker_color: { type: "integer", minimum: 0, maximum: 7, description: "Color index used when marker_color_mode is fixed (default 3 = orange)." },
          marker_name_prefix: { type: "string", maxLength: 24, description: "Optional prefix for every marker name, such as a round label like 'R2'." },
          include_approvals_as_markers: { type: "boolean", description: "Also create markers for approval notes (default false)." },
          max_items: { type: "integer", minimum: 1, maximum: MAX_NOTE_ITEMS, description: `Maximum checklist items to produce (default ${DEFAULT_MAX_NOTE_ITEMS}).` },
        },
        required: ["notes"],
      },
      handler: async (args: Record<string, unknown>) => toolResult(() => planClientNotesChecklist(args ?? {})),
    },
    plan_multicam_angle_switches: {
      description:
        "Plan active-speaker camera switching for stacked, synced camera tracks: from speaker segments and a camera-to-speaker map it produces an angle cut list with minimum holds, crosstalk cover shots, optional lead-in cuts and periodic cutaways, plus razor times, per-camera enable/disable ranges, and markers. Local-only and deterministic; never changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          speaker_segments: {
            type: "array",
            minItems: 1,
            maxItems: MAX_SPEAKER_SEGMENTS,
            description: "Who is speaking when, in sequence seconds (from a transcript, diarization, or plan_speaker_checkerboard turns). Overlaps are allowed.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                speaker: { type: "string", minLength: 1, maxLength: MAX_SPEAKER_LABEL_LENGTH, description: "Speaker label." },
                start_seconds: { type: "number", minimum: 0, maximum: 86400, description: "Segment start in sequence seconds." },
                end_seconds: { type: "number", minimum: 0, maximum: 86400, description: "Segment end in sequence seconds (greater than start)." },
              },
              required: ["speaker", "start_seconds", "end_seconds"],
            },
          },
          cameras: {
            type: "array",
            minItems: 1,
            maxItems: MAX_CAMERAS,
            description: "Camera angles. A camera with one speaker is a single, two or more is a two_shot, none is a wide cover unless role says otherwise.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                camera_id: { type: "string", minLength: 1, maxLength: MAX_CAMERA_ID_LENGTH, description: "Stable camera identifier such as 'A' or 'cam2'." },
                label: { type: "string", minLength: 1, maxLength: 128, description: "Display label used in marker names (default camera_id)." },
                speakers: { type: "array", maxItems: 32, items: { type: "string", minLength: 1, maxLength: MAX_SPEAKER_LABEL_LENGTH, description: "Speaker label framed by this camera." }, description: "Speakers this camera frames." },
                role: { type: "string", enum: [...CAMERA_ROLES], description: "Override the inferred role: single, two_shot, or wide." },
                video_track_index: { type: "integer", minimum: 0, maximum: 255, description: "Video track holding this camera's synced clip(s); used in enable_plan." },
              },
              required: ["camera_id"],
            },
          },
          frame_rate: { type: "number", minimum: 1, maximum: 240, description: "Sequence frame rate for snapping cut points; defaults to 30." },
          min_hold_seconds: { type: "number", minimum: 0.2, maximum: 60, description: "Minimum time an angle stays on air; shorter changes are absorbed (default 2)." },
          start_seconds: { type: "number", minimum: 0, maximum: 86400, description: "Plan start in sequence seconds (default 0)." },
          total_duration_seconds: { type: "number", minimum: 0.04, maximum: 86400, description: "Plan end in sequence seconds (default: last segment end)." },
          cover_on_overlap: { type: "boolean", description: "Cut to a two_shot or wide camera when speakers overlap (default true)." },
          overlap_min_seconds: { type: "number", minimum: 0, maximum: 30, description: "Minimum crosstalk length before the cover shot is used (default 0.6)." },
          lead_switch_seconds: { type: "number", minimum: 0, maximum: 5, description: "Cut to the incoming speaker this many seconds before they start, when the outgoing hold allows (default 0)." },
          cutaway_every_seconds: { type: "number", minimum: 4, maximum: 3600, description: "Insert a cover cutaway during monologues longer than this many seconds (default: none)." },
          cutaway_seconds: { type: "number", minimum: 0.2, maximum: 60, description: "Length of each cutaway (default 2.5; must be at least min_hold_seconds)." },
          marker_color: { type: "integer", minimum: 0, maximum: 7, description: "Marker color index for the cut markers (default 6 = blue)." },
        },
        required: ["speaker_segments", "cameras"],
      },
      handler: async (args: Record<string, unknown>) => toolResult(() => planMulticamAngleSwitches(args ?? {})),
    },
  };
}
