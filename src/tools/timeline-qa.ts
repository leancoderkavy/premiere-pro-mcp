import {
  auditTimelineHealth,
  diffSequenceSnapshots,
  MAX_CLIPS_PER_TRACK,
  MAX_SNAPSHOT_TRACKS,
  normalizeSequenceSnapshot,
} from "../ai/timeline-qa.js";

const CLIP_SCHEMA = {
  type: "object",
  description: "One timeline clip. Accepts the normalized keys below or raw get_sequence_structure / inspect_sequence_structure_uxp keys (nodeId, startSeconds, endSeconds, inPointSeconds, outPointSeconds, enabled, speed, sourceProjectItemId).",
  properties: {
    id: { type: "string", minLength: 1, maxLength: 128, description: "Stable clip id (nodeId). Synthesized from position when omitted." },
    name: { type: "string", maxLength: 255, description: "Clip display name." },
    start_seconds: { type: "number", minimum: -1000000, maximum: 1000000, description: "Timeline start in seconds." },
    end_seconds: { type: "number", minimum: -1000000, maximum: 1000000, description: "Timeline end in seconds." },
    in_seconds: { type: "number", minimum: -1000000, maximum: 1000000, description: "Source in point in seconds." },
    out_seconds: { type: "number", minimum: -1000000, maximum: 1000000, description: "Source out point in seconds." },
    media_path: { type: "string", maxLength: 4096, description: "Optional media path; only its basename and sha256 are ever returned." },
    project_item_id: { type: "string", maxLength: 512, description: "Source project-item id used for move and repeated-shot matching." },
    disabled: { type: "boolean", description: "True when the clip is disabled." },
    speed_percent: { type: "number", minimum: -100000, maximum: 100000, description: "Playback speed as a percentage (100 = normal)." },
    linked_ids: { type: "array", maxItems: 16, items: { type: "string", minLength: 1, maxLength: 128, description: "Linked clip id." }, description: "Ids of linked clips." },
  },
} as const;

const TRACK_SCHEMA = {
  type: "object",
  description: "One track with its clips. Accepts type/index/clips or raw mediaType/trackIndex/items keys.",
  properties: {
    type: { type: "string", enum: ["video", "audio"], description: "Track media type." },
    index: { type: "integer", minimum: 0, maximum: 1023, description: "Zero-based track index." },
    name: { type: "string", maxLength: 255, description: "Track name." },
    clips: { type: "array", maxItems: MAX_CLIPS_PER_TRACK, items: CLIP_SCHEMA, description: "Clips on this track." },
  },
} as const;

function snapshotSchema(description: string) {
  return {
    type: "object",
    description,
    properties: {
      sequence_id: { type: "string", maxLength: 128, description: "Sequence id." },
      name: { type: "string", maxLength: 255, description: "Sequence name." },
      frame_rate: { type: "number", minimum: 1, maximum: 240, description: "Sequence frame rate; defaults to the tool frame_rate or 30." },
      duration_seconds: { type: "number", minimum: 0, maximum: 1000000, description: "Sequence duration in seconds." },
      tracks: { type: "array", maxItems: MAX_SNAPSHOT_TRACKS, items: TRACK_SCHEMA, description: "Normalized tracks (video and audio)." },
      videoTracks: { type: "array", maxItems: MAX_SNAPSHOT_TRACKS, items: TRACK_SCHEMA, description: "Raw get_sequence_structure video tracks." },
      audioTracks: { type: "array", maxItems: MAX_SNAPSHOT_TRACKS, items: TRACK_SCHEMA, description: "Raw get_sequence_structure audio tracks." },
    },
  } as const;
}

const FRAME_RATE = { type: "number", minimum: 1, maximum: 240, description: "Frame rate override for frame math and timecodes (1..240). Defaults to the snapshot frame rate or 30." } as const;

function failure(error: unknown) {
  return { success: false as const, error: error instanceof Error ? error.message : String(error) };
}

export function getTimelineQaTools() {
  return {
    diff_sequence_snapshots: {
      description: "Diff two sequence snapshots (from get_sequence_structure or inspect_sequence_structure_uxp) into added, removed, moved, trimmed, retimed, enabled, and renamed clip changes with frame deltas, per-track counts, and EDL-like timecode lines. Local-only; never reads or changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          before: snapshotSchema("Earlier sequence snapshot."),
          after: snapshotSchema("Later sequence snapshot."),
          frame_rate: FRAME_RATE,
          tolerance_frames: { type: "integer", minimum: 0, maximum: 10, description: "Deltas of at most this many frames count as unchanged (default 0)." },
        },
        required: ["before", "after"],
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          const before = normalizeSequenceSnapshot(args.before, { frameRateOverride: args.frame_rate, label: "before" });
          const after = normalizeSequenceSnapshot(args.after, { frameRateOverride: args.frame_rate, label: "after" });
          const data = diffSequenceSnapshots(before, after, { frameRate: args.frame_rate, toleranceFrames: args.tolerance_frames });
          return { success: true as const, data: { ...data, routes: { inspect: ["get_sequence_structure", "inspect_sequence_structure_uxp"], review: ["inspect_sequence_review_report", "export_sequence_review_frames"], apply: ["transform_track_item_uxp", "move_clip_to_track", "trim_clip", "enable_disable_clip", "speed_change"] }, next_steps: ["inspect_sequence_review_report", "export_sequence_review_frames"] } };
        } catch (error) { return failure(error); }
      },
    },
    audit_timeline_health: {
      description: "Audit one sequence snapshot for flash frames, gaps, overlaps, disabled clips, repeated shots, video without audio, extreme speed, invalid times, empty tracks, leading black, and trailing gaps; returns a 0..100 score, findings with timecodes, and fix routes. Local-only; never changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          snapshot: snapshotSchema("Sequence snapshot to audit."),
          frame_rate: FRAME_RATE,
          flash_frame_max_frames: { type: "integer", minimum: 1, maximum: 12, description: "Clips lasting this many frames or fewer are flagged as flash frames (default 3)." },
          gap_min_frames: { type: "integer", minimum: 1, maximum: 10000, description: "Minimum gap length in frames to report (default 1)." },
          max_speed_percent: { type: "number", minimum: 1, maximum: 100000, description: "Absolute speed above this percentage is flagged (default 400)." },
          expected_duration_seconds: { type: "number", minimum: 0, maximum: 86400, description: "Optional target duration; clips past it and trailing gaps before it are flagged." },
          expected_frame_rate: { type: "number", minimum: 1, maximum: 240, description: "Optional expected frame rate; a mismatch is an error." },
        },
        required: ["snapshot"],
      },
      handler: async (args: Record<string, unknown>) => {
        try {
          const snapshot = normalizeSequenceSnapshot(args.snapshot, { frameRateOverride: args.frame_rate, label: "snapshot" });
          const data = auditTimelineHealth(snapshot, {
            frameRate: args.frame_rate,
            flashFrameMaxFrames: args.flash_frame_max_frames,
            gapMinFrames: args.gap_min_frames,
            maxSpeedPercent: args.max_speed_percent,
            expectedDurationSeconds: args.expected_duration_seconds,
            expectedFrameRate: args.expected_frame_rate,
          });
          return { success: true as const, data };
        } catch (error) { return failure(error); }
      },
    },
  };
}
