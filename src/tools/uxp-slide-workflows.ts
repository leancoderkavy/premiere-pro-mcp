import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";

type ItemSnapshot = {
  start_seconds: number; end_seconds: number; in_seconds: number; out_seconds: number;
  duration_seconds: number; speed: number; reversed: boolean;
};

type SlideArgs = {
  action: "inspect" | "apply";
  media_type: "video" | "audio";
  track_index: number;
  clip_index: number;
  expected_snapshot?: {
    project_guid: string; sequence_id: string; media_type: "video" | "audio"; track_index: number; clip_index: number;
    previous: ItemSnapshot; target: ItemSnapshot; following: ItemSnapshot;
  };
  slide_by_seconds?: number;
  confirm_slide?: boolean;
  operation_id?: string;
};

const itemSnapshotProperties = {
  start_seconds: { type: "number", minimum: 0, maximum: 86400 },
  end_seconds: { type: "number", minimum: 0, maximum: 86400 },
  in_seconds: { type: "number", minimum: 0, maximum: 86400 },
  out_seconds: { type: "number", minimum: 0, maximum: 86400 },
  duration_seconds: { type: "number", minimum: 0, maximum: 86400 },
  speed: { type: "number", minimum: 0, maximum: 100 },
  reversed: { type: "boolean" },
} as const;
const itemSnapshotRequired = ["start_seconds", "end_seconds", "in_seconds", "out_seconds", "duration_seconds", "speed", "reversed"];

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
    startSeconds: record.start_seconds, endSeconds: record.end_seconds, inSeconds: record.in_seconds,
    outSeconds: record.out_seconds, durationSeconds: record.duration_seconds, speed: record.speed, reversed: record.reversed,
  };
}

function expectedSlideSnapshot(value: SlideArgs["expected_snapshot"]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected_snapshot is required for action: apply");
  const record = value as Record<string, unknown>;
  const allowed = ["project_guid", "sequence_id", "media_type", "track_index", "clip_index", "previous", "target", "following"];
  for (const key of Object.keys(record)) if (!allowed.includes(key)) throw new Error(`expected_snapshot has an unknown field: ${key}`);
  for (const key of allowed) if (!(key in record)) throw new Error(`expected_snapshot.${key} is required`);
  return {
    projectGuid: record.project_guid, sequenceId: record.sequence_id, mediaType: record.media_type,
    trackIndex: record.track_index, clipIndex: record.clip_index,
    previous: strictItemSnapshot(record.previous, "expected_snapshot.previous"),
    target: strictItemSnapshot(record.target, "expected_snapshot.target"),
    following: strictItemSnapshot(record.following, "expected_snapshot.following"),
  };
}

/** A bounded documented-UXP composition for one contiguous three-item slide. */
export function getUxpSlideWorkflowTools(bridge: UxpWebSocketBridge) {
  return {
    slide_track_item_uxp: {
      description: "Inspect or perform one guarded slide on an audio or video timeline item using documented UXP track-item actions. Apply requires the complete three-item snapshot, explicit confirmation, and an operation ID; it serializes slides and source-only slips on the affected track, commits one transaction, and verifies every affected source and timeline boundary. Only contiguous forward 1x clips are supported. It does not prove source handles, linked A/V synchronization, rendered frames, playback, persistence, or Undo behavior.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["inspect", "apply"] },
          media_type: { type: "string", enum: ["video", "audio"] },
          track_index: { type: "integer", minimum: 0, maximum: 511 },
          clip_index: { type: "integer", minimum: 0, maximum: 511, description: "The center item. It must have immediate previous and following clip items on the same track." },
          expected_snapshot: {
            type: "object", additionalProperties: false,
            required: ["project_guid", "sequence_id", "media_type", "track_index", "clip_index", "previous", "target", "following"],
            properties: {
              project_guid: { type: "string", minLength: 1, maxLength: 128 }, sequence_id: { type: "string", minLength: 1, maxLength: 128 },
              media_type: { type: "string", enum: ["video", "audio"] }, track_index: { type: "integer", minimum: 0, maximum: 511 }, clip_index: { type: "integer", minimum: 0, maximum: 511 },
              previous: { type: "object", additionalProperties: false, required: itemSnapshotRequired, properties: itemSnapshotProperties },
              target: { type: "object", additionalProperties: false, required: itemSnapshotRequired, properties: itemSnapshotProperties },
              following: { type: "object", additionalProperties: false, required: itemSnapshotRequired, properties: itemSnapshotProperties },
            },
          },
          slide_by_seconds: { type: "number", minimum: -60, maximum: 60, description: "Non-zero offset. Positive moves the center item later and lengthens the previous neighbour." },
          confirm_slide: { type: "boolean", description: "Must be true for action: apply." },
          operation_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$", description: "Required replay-safe operation identifier for action: apply." },
        },
        required: ["action", "media_type", "track_index", "clip_index"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
      availability: {
        backend: "uxp", minimumPremiereVersion: "25.6.0", capability: "trackItem.slide.inspect|trackItem.slide",
        notes: ["Requires an authenticated UXP bridge whose runtime capability handshake advertises trackItem.slide.inspect and trackItem.slide.", "A verification failure can follow a committed host transaction; inspect all three items before another edit."],
      },
      handler: async (args: SlideArgs) => {
        const target = { mediaType: args.media_type, trackIndex: args.track_index, clipIndex: args.clip_index };
        if (args.action === "inspect") return invoke(bridge, "trackItem.slide.inspect", target);
        if (args.action === "apply") return invoke(bridge, "trackItem.slide", {
          ...target, expectedSnapshot: expectedSlideSnapshot(args.expected_snapshot), slideBySeconds: args.slide_by_seconds,
          confirmSlide: args.confirm_slide, operationId: args.operation_id,
        });
        return { success: false, error: `Unsupported workflow action: ${String(args.action)}` };
      },
    },
  };
}
