import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";

type ItemSnapshot = {
  project_item_id: string;
  start_seconds: number; end_seconds: number; in_seconds: number; out_seconds: number;
  duration_seconds: number; speed: number; reversed: boolean;
};

type RippleDeleteArgs = {
  action: "inspect" | "apply";
  media_type: "video" | "audio";
  track_index: number;
  clip_index: number;
  expected_snapshot?: {
    project_guid: string; sequence_id: string; media_type: "video" | "audio";
    track_index: number; clip_index: number; track_item_count: number;
    target: ItemSnapshot; following: ItemSnapshot;
  };
  confirm_ripple_delete?: boolean;
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

function expectedRippleSnapshot(value: RippleDeleteArgs["expected_snapshot"]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected_snapshot is required for action: apply");
  const record = value as Record<string, unknown>;
  const allowed = ["project_guid", "sequence_id", "media_type", "track_index", "clip_index", "track_item_count", "target", "following"];
  for (const key of Object.keys(record)) if (!allowed.includes(key)) throw new Error(`expected_snapshot has an unknown field: ${key}`);
  for (const key of allowed) if (!(key in record)) throw new Error(`expected_snapshot.${key} is required`);
  return {
    projectGuid: record.project_guid, sequenceId: record.sequence_id, mediaType: record.media_type,
    trackIndex: record.track_index, clipIndex: record.clip_index, trackItemCount: record.track_item_count,
    target: strictItemSnapshot(record.target, "expected_snapshot.target"),
    following: strictItemSnapshot(record.following, "expected_snapshot.following"),
  };
}

/** A bounded documented-UXP ripple delete with contiguous-successor readback. */
export function getUxpRippleDeleteWorkflowTools(bridge: UxpWebSocketBridge) {
  return {
    ripple_delete_track_item_uxp: {
      description: "Inspect or perform one guarded ripple delete on an audio or video timeline item using documented UXP SequenceEditor actions. Apply requires complete target and contiguous-successor snapshots, explicit confirmation, and an operation ID; it serializes with guarded slips, slides, and append duplicates on that track, commits one transaction, and reads back the successor at the removed coordinate. It intentionally cannot ripple a final item, a gap, another track, or a linked A/V pair. It does not prove media handles, linked A/V synchronization, rendered frames, playback, persistence, or Undo behavior.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["inspect", "apply"] },
          media_type: { type: "string", enum: ["video", "audio"] },
          track_index: { type: "integer", minimum: 0, maximum: 511 },
          clip_index: { type: "integer", minimum: 0, maximum: 510, description: "One clip item with an immediately contiguous same-track successor." },
          expected_snapshot: {
            type: "object", additionalProperties: false,
            required: ["project_guid", "sequence_id", "media_type", "track_index", "clip_index", "track_item_count", "target", "following"],
            properties: {
              project_guid: { type: "string", minLength: 1, maxLength: 128 }, sequence_id: { type: "string", minLength: 1, maxLength: 128 },
              media_type: { type: "string", enum: ["video", "audio"] }, track_index: { type: "integer", minimum: 0, maximum: 511 },
              clip_index: { type: "integer", minimum: 0, maximum: 510 }, track_item_count: { type: "integer", minimum: 2, maximum: 512 },
              target: { type: "object", additionalProperties: false, required: itemSnapshotRequired, properties: itemSnapshotProperties },
              following: { type: "object", additionalProperties: false, required: itemSnapshotRequired, properties: itemSnapshotProperties },
            },
          },
          confirm_ripple_delete: { type: "boolean", description: "Must be true for action: apply." },
          operation_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$", description: "Required replay-safe operation identifier for action: apply." },
        },
        required: ["action", "media_type", "track_index", "clip_index"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
      availability: {
        backend: "uxp", minimumPremiereVersion: "25.6.0", capability: "trackItem.rippleDelete.inspect|trackItem.rippleDelete",
        notes: ["Requires an authenticated UXP bridge whose runtime capability handshake advertises trackItem.rippleDelete.inspect and trackItem.rippleDelete.", "A verification failure can follow a committed host transaction; inspect the successor before another edit."],
      },
      handler: async (args: RippleDeleteArgs) => {
        const target = { mediaType: args.media_type, trackIndex: args.track_index, clipIndex: args.clip_index };
        if (args.action === "inspect") return invoke(bridge, "trackItem.rippleDelete.inspect", target);
        if (args.action === "apply") return invoke(bridge, "trackItem.rippleDelete", {
          ...target, expectedSnapshot: expectedRippleSnapshot(args.expected_snapshot),
          confirmRippleDelete: args.confirm_ripple_delete, operationId: args.operation_id,
        });
        return { success: false, error: `Unsupported workflow action: ${String(args.action)}` };
      },
    },
  };
}
