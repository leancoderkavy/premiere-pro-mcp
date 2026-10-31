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

type UnnestArgs = {
  action: "inspect" | "apply";
  media_type: "video" | "audio";
  track_index: number;
  clip_index: number;
  expected_snapshot?: Record<string, unknown>;
  confirm_unnest?: boolean;
  operation_id?: string;
};

const ticks = { type: "string", pattern: "^-?\\d{1,30}$" };
const mediaType = { type: "string", enum: ["video", "audio"] };
const index = { type: "integer", minimum: 0, maximum: 511 };

const referenceSchema: Schema = {
  type: "object", additionalProperties: false,
  required: ["media_type", "track_index", "clip_index", "start_ticks", "end_ticks", "in_ticks", "out_ticks"],
  properties: { media_type: mediaType, track_index: index, clip_index: index, start_ticks: ticks, end_ticks: ticks, in_ticks: ticks, out_ticks: ticks },
};

const placementSchema: Schema = {
  type: "object", additionalProperties: false,
  required: ["media_type", "source_track_index", "target_track_index", "name", "project_item_id", "start_ticks", "end_ticks", "in_ticks", "out_ticks", "disabled"],
  properties: {
    media_type: mediaType, source_track_index: index, target_track_index: index,
    name: { type: "string", maxLength: 1024 }, project_item_id: { type: "string", minLength: 1, maxLength: 512 },
    start_ticks: ticks, end_ticks: ticks, in_ticks: ticks, out_ticks: ticks, disabled: { type: "boolean" },
  },
};

/** The plan returned by inspect, passed back unchanged to apply. */
const expectedSnapshotSchema: Schema = {
  type: "object",
  description: "The expected_snapshot object returned by inspect, passed unchanged.",
  additionalProperties: false,
  required: ["project_guid", "sequence_id", "nested_sequence_id", "nested_sequence_name", "references", "offset_ticks", "clones"],
  properties: {
    project_guid: { type: "string", minLength: 1, maxLength: 512 },
    sequence_id: { type: "string", minLength: 1, maxLength: 512 },
    nested_sequence_id: { type: "string", minLength: 1, maxLength: 512 },
    nested_sequence_name: { type: "string", maxLength: 1024 },
    references: { type: "array", minItems: 1, maxItems: 2, items: referenceSchema },
    offset_ticks: ticks,
    clones: { type: "array", minItems: 1, maxItems: 512, items: placementSchema },
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

export function getUxpUnnestWorkflowTools(bridge: UxpWebSocketBridge) {
  return {
    unnest_sequence_uxp: {
      description: "Inspect or apply an unnest of a nested sequence clip in the active sequence by cloning the nested clips into the parent with documented UXP SequenceEditor actions. Unlike the legacy CEP unnest_sequence, which re-places clips from their project items and cannot carry effects, a clone keeps each clip's effects (including Lumetri curves and LUTs), keyframes, enabled state and source range. A nest placed with picture and sound (one video and one audio clip of the same nested sequence at the same position) is handled as one pair. Inspect returns the full plan: the nest references, the tick offset, and every clone with its destination track and timing. It refuses a trimmed, retimed or ambiguous nest, a missing destination track, and any destination range occupied by another clip. Apply requires that unchanged plan, confirm_unnest: true and an operation_id; it removes the nest and clones every clip in one locked undoable transaction (one Undo restores the nest) and reads back each clone's start, source range, project item and enabled state. It does not prove rendered frames, playback or persistence.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["inspect", "apply"] },
          media_type: { type: "string", enum: ["video", "audio"], description: "Track type of the nest clip to unnest (either half of a picture-and-sound nest)." },
          track_index: { type: "integer", minimum: 0, maximum: 511 },
          clip_index: { type: "integer", minimum: 0, maximum: 511, description: "Clip index of the nest clip on that track." },
          expected_snapshot: expectedSnapshotSchema,
          confirm_unnest: { type: "boolean", description: "Must be true for action: apply." },
          operation_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$", description: "Required replay-safe operation identifier for action: apply." },
        },
        required: ["action", "media_type", "track_index", "clip_index"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
      availability: {
        backend: "uxp", minimumPremiereVersion: "25.6.0", capability: "sequence.unnest.inspect|sequence.unnest",
        notes: [
          "Requires an authenticated UXP bridge whose runtime capability handshake advertises sequence.unnest.inspect and sequence.unnest.",
          "A verification failure can follow a committed host transaction; one Premiere Undo restores the nest.",
        ],
      },
      handler: async (args: UnnestArgs) => {
        const target = { mediaType: args.media_type, trackIndex: args.track_index, clipIndex: args.clip_index };
        if (args.action === "inspect") return withApplySnapshot(invoke(bridge, "sequence.unnest.inspect", target), expectedSnapshotSchema);
        if (args.action === "apply") {
          if (!args.expected_snapshot) throw new Error("expected_snapshot is required for action: apply");
          return invoke(bridge, "sequence.unnest", {
            ...target,
            expectedSnapshot: toPanelShape(args.expected_snapshot, expectedSnapshotSchema, "expected_snapshot"),
            confirmUnnest: args.confirm_unnest,
            operationId: args.operation_id,
          });
        }
        return { success: false, error: `Unsupported workflow action: ${String(args.action)}` };
      },
    },
  };
}
