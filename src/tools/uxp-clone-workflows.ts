import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";

type ItemSnapshot = {
  project_item_id: string;
  start_seconds: number; end_seconds: number; in_seconds: number; out_seconds: number;
  duration_seconds: number; speed: number; reversed: boolean;
};

type CloneArgs = {
  action: "inspect" | "apply";
  media_type: "video" | "audio";
  track_index: number;
  clip_index: number;
  expected_snapshot?: {
    project_guid: string; sequence_id: string; media_type: "video" | "audio";
    track_index: number; clip_index: number; track_item_count: number; source: ItemSnapshot;
  };
  confirm_duplicate?: boolean;
  operation_id?: string;
};

const itemSnapshotProperties = {
  project_item_id: { type: "string", minLength: 1, maxLength: 512 },
  start_seconds: { type: "number", minimum: 0, maximum: 86400 },
  end_seconds: { type: "number", minimum: 0, maximum: 86400 },
  in_seconds: { type: "number", minimum: 0, maximum: 86400 },
  out_seconds: { type: "number", minimum: 0, maximum: 86400 },
  duration_seconds: { type: "number", minimum: 0, maximum: 86400 },
  speed: { type: "number", minimum: 0, maximum: 100 },
  reversed: { type: "boolean" },
} as const;
const itemSnapshotRequired = ["project_item_id", "start_seconds", "end_seconds", "in_seconds", "out_seconds", "duration_seconds", "speed", "reversed"];

function invoke(bridge: UxpWebSocketBridge, command: string, args: Record<string, unknown>) {
  return bridge.request(command, args)
    .then((result) => ({ success: true, data: { backend: "uxp", result } }))
    .catch((error: unknown) => ({ success: false, error: error instanceof Error ? error.message : String(error) }));
}

function strictItemSnapshot(value: unknown, name: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!(key in itemSnapshotProperties)) throw new Error(`${name} has an unknown field: ${key}`);
  for (const key of itemSnapshotRequired) if (!(key in record)) throw new Error(`${name}.${key} is required`);
  return {
    projectItemId: record.project_item_id,
    startSeconds: record.start_seconds, endSeconds: record.end_seconds, inSeconds: record.in_seconds,
    outSeconds: record.out_seconds, durationSeconds: record.duration_seconds, speed: record.speed, reversed: record.reversed,
  };
}

function expectedCloneSnapshot(value: CloneArgs["expected_snapshot"]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected_snapshot is required for action: apply");
  const record = value as Record<string, unknown>;
  const allowed = ["project_guid", "sequence_id", "media_type", "track_index", "clip_index", "track_item_count", "source"];
  for (const key of Object.keys(record)) if (!allowed.includes(key)) throw new Error(`expected_snapshot has an unknown field: ${key}`);
  for (const key of allowed) if (!(key in record)) throw new Error(`expected_snapshot.${key} is required`);
  return {
    projectGuid: record.project_guid, sequenceId: record.sequence_id, mediaType: record.media_type,
    trackIndex: record.track_index, clipIndex: record.clip_index, trackItemCount: record.track_item_count,
    source: strictItemSnapshot(record.source, "expected_snapshot.source"),
  };
}

/** A bounded documented-UXP append-only counterpart to a timeline duplicate. */
export function getUxpCloneWorkflowTools(bridge: UxpWebSocketBridge) {
  return {
    duplicate_track_item_uxp: {
      description: "Inspect or append one guarded duplicate of the final audio or video clip on a track using documented UXP SequenceEditor actions. Apply requires the complete source snapshot, explicit confirmation, and an operation ID; it serializes with guarded slips and slides on that track, commits one transaction, and reads back only the original and appended item. It intentionally cannot duplicate into an occupied range, another track, or a linked A/V pair. It does not prove media handles, linked A/V synchronization, rendered frames, playback, persistence, or Undo behavior.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["inspect", "apply"] },
          media_type: { type: "string", enum: ["video", "audio"] },
          track_index: { type: "integer", minimum: 0, maximum: 511 },
          clip_index: { type: "integer", minimum: 0, maximum: 511, description: "The final clip item on the requested track. Inspection rejects a non-final item." },
          expected_snapshot: {
            type: "object", additionalProperties: false,
            required: ["project_guid", "sequence_id", "media_type", "track_index", "clip_index", "track_item_count", "source"],
            properties: {
              project_guid: { type: "string", minLength: 1, maxLength: 128 }, sequence_id: { type: "string", minLength: 1, maxLength: 128 },
              media_type: { type: "string", enum: ["video", "audio"] }, track_index: { type: "integer", minimum: 0, maximum: 511 },
              clip_index: { type: "integer", minimum: 0, maximum: 511 }, track_item_count: { type: "integer", minimum: 1, maximum: 512 },
              source: { type: "object", additionalProperties: false, required: itemSnapshotRequired, properties: itemSnapshotProperties },
            },
          },
          confirm_duplicate: { type: "boolean", description: "Must be true for action: apply." },
          operation_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$", description: "Required replay-safe operation identifier for action: apply." },
        },
        required: ["action", "media_type", "track_index", "clip_index"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
      availability: {
        backend: "uxp", minimumPremiereVersion: "25.6.0", capability: "trackItem.clone.inspect|trackItem.clone",
        notes: ["Requires an authenticated UXP bridge whose runtime capability handshake advertises trackItem.clone.inspect and trackItem.clone.", "A verification failure can follow a committed host transaction; inspect the source and appended item before another edit."],
      },
      handler: async (args: CloneArgs) => {
        const target = { mediaType: args.media_type, trackIndex: args.track_index, clipIndex: args.clip_index };
        if (args.action === "inspect") return invoke(bridge, "trackItem.clone.inspect", target);
        if (args.action === "apply") return invoke(bridge, "trackItem.clone", {
          ...target, expectedSnapshot: expectedCloneSnapshot(args.expected_snapshot),
          confirmDuplicate: args.confirm_duplicate, operationId: args.operation_id,
        });
        return { success: false, error: `Unsupported workflow action: ${String(args.action)}` };
      },
    },
  };
}
