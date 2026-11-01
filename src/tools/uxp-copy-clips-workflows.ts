import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";
import { withApplySnapshot } from "./uxp-apply-snapshot.js";

export type Schema = {
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  additionalProperties?: boolean;
  [key: string]: unknown;
};

type CopyClipsArgs = {
  action: "inspect" | "apply";
  source_sequence_id: string;
  destination_sequence_id: string;
  source_start_ticks?: string;
  source_end_ticks?: string;
  destination_start_ticks?: string;
  source_start_seconds?: number;
  source_end_seconds?: number;
  destination_start_seconds?: number;
  video_tracks?: number[];
  audio_tracks?: number[];
  video_track_offset?: number;
  audio_track_offset?: number;
  expected_snapshot?: Record<string, unknown>;
  confirm_copy?: boolean;
  operation_id?: string;
};

const ticks = { type: "string", pattern: "^-?\\d{1,30}$" };
const index = { type: "integer", minimum: 0, maximum: 511 };
const seconds = { type: "number", minimum: 0, maximum: 86400 };
const trackList = { type: "array", maxItems: 64, uniqueItems: true, items: index };
const trackOffset = { type: "integer", minimum: -511, maximum: 511 };
const sequenceId = { type: "string", minLength: 1, maxLength: 512 };

const clipSchema: Schema = {
  type: "object", additionalProperties: false,
  required: ["media_type", "source_track_index", "source_clip_index", "target_track_index", "name", "project_item_id",
    "start_ticks", "end_ticks", "in_ticks", "out_ticks", "trim_head_ticks", "trim_tail_ticks", "disabled"],
  properties: {
    media_type: { type: "string", enum: ["video", "audio"] }, source_track_index: index, source_clip_index: index, target_track_index: index,
    name: { type: "string", maxLength: 1024 }, project_item_id: { type: "string", minLength: 1, maxLength: 512 },
    start_ticks: ticks, end_ticks: ticks, in_ticks: ticks, out_ticks: ticks, trim_head_ticks: ticks, trim_tail_ticks: ticks,
    disabled: { type: "boolean" },
  },
};

/** The plan returned by inspect, passed back unchanged to apply. */
const expectedSnapshotSchema: Schema = {
  type: "object",
  description: "The expected_snapshot object returned by inspect, passed unchanged.",
  additionalProperties: false,
  required: ["project_guid", "source_sequence_id", "source_sequence_name", "destination_sequence_id", "destination_sequence_name",
    "source_start_ticks", "source_end_ticks", "destination_start_ticks", "clips"],
  properties: {
    project_guid: { type: "string", minLength: 1, maxLength: 512 },
    source_sequence_id: sequenceId,
    source_sequence_name: { type: "string", maxLength: 1024 },
    destination_sequence_id: sequenceId,
    destination_sequence_name: { type: "string", maxLength: 1024 },
    source_start_ticks: ticks,
    source_end_ticks: ticks,
    destination_start_ticks: ticks,
    clips: { type: "array", minItems: 1, maxItems: 512, items: clipSchema },
  },
};

function camelKey(snakeKey: string): string {
  return snakeKey.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

/** Convert a snake_case snapshot to the panel's camelCase shape, rejecting unknown or missing fields. */
function toPanelShape(value: unknown, schema: Schema, name: string): unknown {
  if (schema.type === "array") {
    if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
    return value.map((item, position) => toPanelShape(item, schema.items as Schema, `${name}[${position}]`));
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
    const record = value as Record<string, unknown>;
    const properties = schema.properties ?? {};
    for (const key of Object.keys(record)) if (!(key in properties)) throw new Error(`${name} has an unknown field: ${key}`);
    const out: Record<string, unknown> = {};
    for (const key of schema.required ?? []) {
      if (!(key in record)) throw new Error(`${name}.${key} is required`);
    }
    for (const [key, child] of Object.entries(properties)) {
      if (key in record) out[camelKey(key)] = toPanelShape(record[key], child, `${name}.${key}`);
    }
    return out;
  }
  return value;
}

function invoke(bridge: UxpWebSocketBridge, command: string, args: Record<string, unknown>) {
  return bridge.request(command, args)
    .then((result) => ({ success: true, data: { backend: "uxp", result } }))
    .catch((error: unknown) => ({ success: false, error: error instanceof Error ? error.message : String(error) }));
}

const REQUEST_KEYS = [
  "source_sequence_id", "destination_sequence_id",
  "source_start_ticks", "source_end_ticks", "destination_start_ticks",
  "source_start_seconds", "source_end_seconds", "destination_start_seconds",
  "video_tracks", "audio_tracks", "video_track_offset", "audio_track_offset",
] as const;

function panelRequest(args: CopyClipsArgs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of REQUEST_KEYS) if (args[key] !== undefined) out[camelKey(key)] = args[key];
  return out;
}

export function getUxpCopyClipsWorkflowTools(bridge: UxpWebSocketBridge) {
  return {
    copy_clips_between_sequences_uxp: {
      description: "Inspect or apply a copy of every clip in a time range of one sequence into another sequence (or elsewhere in the same one), the way an editor's copy and paste does, by cloning each clip with documented UXP SequenceEditor actions. Unlike placing a clip from its project item, a clone keeps the clip's effects (Motion, Opacity, Lumetri including curves and LUTs), keyframes, enabled state and source range. Choose the source range and the destination start in ticks or in seconds (seconds snap to the nearest frame of their sequence), which source tracks to copy (default all), and an optional track offset per media type. The relative layout of the copied clips is kept. A clip that crosses an edge of the range is trimmed to it; one that is retimed or reversed is refused instead. Inspect returns the full plan: every clip with its source track and clip index, destination track, tick-exact start and end, source in and out, trim, and enabled state. It refuses a missing track, an empty range, and any destination range already occupied, so nothing is ever overwritten. Apply requires that unchanged plan, confirm_copy: true and an operation_id; whole clips are cloned in one locked undoable transaction, and clips that need a trim are cloned to a parking spot past the end of the destination, trimmed there and moved into place, which adds two more Undo steps (undo_steps in the result says how many). It reads back each copy's start, end, source range, project item and enabled state. Transitions and links between a clip's picture and sound are not copied. It does not prove rendered frames, playback or persistence.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["inspect", "apply"] },
          source_sequence_id: { ...sequenceId, description: "GUID of the sequence to copy from." },
          destination_sequence_id: { ...sequenceId, description: "GUID of the sequence to copy into. May be the same as the source." },
          source_start_ticks: { ...ticks, description: "Range start on the source, in ticks. Give this or source_start_seconds." },
          source_end_ticks: { ...ticks, description: "Range end on the source, in ticks. Give this or source_end_seconds." },
          destination_start_ticks: { ...ticks, description: "Where the range start lands on the destination, in ticks. Give this or destination_start_seconds." },
          source_start_seconds: { ...seconds, description: "Range start on the source, in seconds, snapped to the source's nearest frame." },
          source_end_seconds: { ...seconds, description: "Range end on the source, in seconds, snapped to the source's nearest frame." },
          destination_start_seconds: { ...seconds, description: "Where the range start lands, in seconds, snapped to the destination's nearest frame." },
          video_tracks: { ...trackList, description: "Source video track indexes to copy. Omit for every video track; [] for none." },
          audio_tracks: { ...trackList, description: "Source audio track indexes to copy. Omit for every audio track; [] for none." },
          video_track_offset: { ...trackOffset, description: "Destination video track = source video track + this offset. Default 0." },
          audio_track_offset: { ...trackOffset, description: "Destination audio track = source audio track + this offset. Default 0." },
          expected_snapshot: expectedSnapshotSchema,
          confirm_copy: { type: "boolean", description: "Must be true for action: apply." },
          operation_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$", description: "Required replay-safe operation identifier for action: apply." },
        },
        required: ["action", "source_sequence_id", "destination_sequence_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
      availability: {
        backend: "uxp", minimumPremiereVersion: "25.6.0", capability: "sequence.copyClips.inspect|sequence.copyClips",
        notes: [
          "Requires an authenticated UXP bridge whose runtime capability handshake advertises sequence.copyClips.inspect and sequence.copyClips.",
          "A verification failure can follow a committed host transaction; undo_steps Premiere Undos remove the copy.",
        ],
      },
      handler: async (args: CopyClipsArgs) => {
        const request = panelRequest(args);
        if (args.action === "inspect") return withApplySnapshot(invoke(bridge, "sequence.copyClips.inspect", request), expectedSnapshotSchema);
        if (args.action === "apply") {
          if (!args.expected_snapshot) throw new Error("expected_snapshot is required for action: apply");
          return invoke(bridge, "sequence.copyClips", {
            ...request,
            expectedSnapshot: toPanelShape(args.expected_snapshot, expectedSnapshotSchema, "expected_snapshot"),
            confirmCopy: args.confirm_copy,
            operationId: args.operation_id,
          });
        }
        return { success: false, error: `Unsupported workflow action: ${String(args.action)}` };
      },
    },
  };
}
