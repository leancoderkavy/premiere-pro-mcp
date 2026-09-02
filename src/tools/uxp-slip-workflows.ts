import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";

type SlipArgs = Record<string, unknown> & {
  action?: string;
  operation_id?: string;
  expected_snapshot?: unknown;
};

const operationId = {
  type: "string" as const,
  pattern: "^[A-Za-z0-9._:-]{1,128}$",
  description: "Required replay key for a source-only slip mutation.",
};

const targetProperties = {
  media_type: { type: "string" as const, enum: ["video", "audio"] },
  track_index: { type: "integer" as const, minimum: 0, maximum: 511 },
  clip_index: { type: "integer" as const, minimum: 0, maximum: 511 },
};

const expectedSnapshot = {
  type: "object" as const,
  additionalProperties: false,
  description: "Complete snapshot returned by inspect. Apply rejects any changed project, sequence, coordinate, timeline, source, speed, or reverse state.",
  properties: {
    project_guid: { type: "string" as const, minLength: 1, maxLength: 128 },
    sequence_id: { type: "string" as const, minLength: 1, maxLength: 128 },
    media_type: { type: "string" as const, enum: ["video", "audio"] },
    track_index: { type: "integer" as const, minimum: 0, maximum: 511 },
    clip_index: { type: "integer" as const, minimum: 0, maximum: 511 },
    start_seconds: { type: "number" as const, minimum: 0, maximum: 86400 },
    end_seconds: { type: "number" as const, minimum: 0, maximum: 86400 },
    in_seconds: { type: "number" as const, minimum: 0, maximum: 86400 },
    out_seconds: { type: "number" as const, minimum: 0, maximum: 86400 },
    duration_seconds: { type: "number" as const, minimum: 0, maximum: 86400 },
    speed: { type: "number" as const, minimum: 0, maximum: 100 },
    reversed: { type: "boolean" as const },
  },
  required: [
    "project_guid", "sequence_id", "media_type", "track_index", "clip_index",
    "start_seconds", "end_seconds", "in_seconds", "out_seconds", "duration_seconds", "speed", "reversed",
  ],
};

function invoke(bridge: UxpWebSocketBridge, command: string, args: Record<string, unknown>) {
  return bridge.request(command, args)
    .then((result) => ({ success: true, data: { backend: "uxp", result } }))
    .catch((error: unknown) => ({ success: false, error: error instanceof Error ? error.message : String(error) }));
}

function expectedSlipSnapshot(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expected_snapshot must be the complete object returned by inspect");
  }
  const snapshot = value as Record<string, unknown>;
  const allowed = [
    "project_guid", "sequence_id", "media_type", "track_index", "clip_index",
    "start_seconds", "end_seconds", "in_seconds", "out_seconds", "duration_seconds", "speed", "reversed",
  ];
  const unknown = Object.keys(snapshot).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`expected_snapshot has an unknown field: ${unknown}`);
  const missing = allowed.find((key) => !(key in snapshot));
  if (missing) throw new Error(`expected_snapshot.${missing} is required`);
  return {
    projectGuid: snapshot.project_guid,
    sequenceId: snapshot.sequence_id,
    mediaType: snapshot.media_type,
    trackIndex: snapshot.track_index,
    clipIndex: snapshot.clip_index,
    startSeconds: snapshot.start_seconds,
    endSeconds: snapshot.end_seconds,
    inSeconds: snapshot.in_seconds,
    outSeconds: snapshot.out_seconds,
    durationSeconds: snapshot.duration_seconds,
    speed: snapshot.speed,
    reversed: snapshot.reversed,
  };
}

export function getUxpSlipWorkflowTools(bridge: UxpWebSocketBridge) {
  return {
    slip_track_item_uxp: {
      description: "Inspect or perform one guarded source-only slip on an audio or video timeline item. Apply requires the complete inspected snapshot, explicit confirmation, and an operation ID; it serializes slip operations per target, creates the documented source in/out actions in one undoable transaction, and reads back unchanged timeline timing plus the exact shifted source range. It supports only forward 1x clips, does not infer available media handles, and does not prove rendered frames, playback, linked-item sync, persistence, or Undo behavior.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string" as const, enum: ["inspect", "apply"] },
          ...targetProperties,
          expected_snapshot: expectedSnapshot,
          slip_by_seconds: { type: "number" as const, minimum: -60, maximum: 60, description: "Non-zero source-time offset. Timeline start/end remain unchanged." },
          confirm_slip: { type: "boolean" as const, description: "Required true after reviewing the complete inspect snapshot." },
          operation_id: operationId,
        },
        required: ["action", "media_type", "track_index", "clip_index"],
      },
      operationalCapability: {
        backend: "UXP" as const,
        backends: ["uxp" as const],
        minimumPremiereVersion: "25.6",
        verificationBoundary: "structured_uxp_readback" as const,
        hostVerificationRequired: true,
        notes: [
          "Requires an authenticated UXP bridge whose runtime capability handshake advertises trackItem.slip.inspect and trackItem.slip.",
          "An apply verification failure can follow a committed host transaction; inspect before issuing another edit.",
        ],
      },
      handler: async (args: SlipArgs) => {
        const target = {
          mediaType: args.media_type,
          trackIndex: args.track_index,
          clipIndex: args.clip_index,
        };
        if (args.action === "inspect") return invoke(bridge, "trackItem.slip.inspect", target);
        if (args.action === "apply") {
          return invoke(bridge, "trackItem.slip", {
            ...target,
            expectedSnapshot: expectedSlipSnapshot(args.expected_snapshot),
            slipBySeconds: args.slip_by_seconds,
            confirmSlip: args.confirm_slip,
            operationId: args.operation_id,
          });
        }
        return { success: false, error: `Unsupported workflow action: ${String(args.action)}` };
      },
    },
  };
}
