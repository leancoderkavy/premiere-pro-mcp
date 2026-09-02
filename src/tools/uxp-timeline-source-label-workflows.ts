import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";

type SourceLabelSnapshot = {
  project_guid: string; sequence_id: string; media_type: "video" | "audio";
  track_index: number; clip_index: number; track_item_count: number;
  source_project_item_id: string; source_color_label_index: number;
  start_seconds: number; end_seconds: number;
};

type SourceLabelArgs = {
  action: "inspect" | "update";
  media_type: "video" | "audio";
  track_index: number;
  clip_index: number;
  color_index?: number;
  expected_snapshot?: SourceLabelSnapshot;
  confirm_set_label?: boolean;
  operation_id?: string;
};

const snapshotProperties = {
  project_guid: { type: "string", minLength: 1, maxLength: 128 },
  sequence_id: { type: "string", minLength: 1, maxLength: 128 },
  media_type: { type: "string", enum: ["video", "audio"] },
  track_index: { type: "integer", minimum: 0, maximum: 511 },
  clip_index: { type: "integer", minimum: 0, maximum: 511 },
  track_item_count: { type: "integer", minimum: 1, maximum: 512 },
  source_project_item_id: { type: "string", minLength: 1, maxLength: 512 },
  source_color_label_index: { type: "integer", minimum: 0, maximum: 15 },
  start_seconds: { type: "number", minimum: 0, maximum: 86400 },
  end_seconds: { type: "number", minimum: 0, maximum: 86400 },
} as const;
const snapshotRequired = ["project_guid", "sequence_id", "media_type", "track_index", "clip_index", "track_item_count", "source_project_item_id", "source_color_label_index", "start_seconds", "end_seconds"];

function invoke(bridge: UxpWebSocketBridge, command: string, args: Record<string, unknown>) {
  return bridge.request(command, args)
    .then((result) => ({ success: true, data: { backend: "uxp", result } }))
    .catch((error: unknown) => ({ success: false, error: error instanceof Error ? error.message : String(error) }));
}

function strictSnapshot(value: SourceLabelArgs["expected_snapshot"]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected_snapshot is required for action: update");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!(key in snapshotProperties)) throw new Error(`expected_snapshot has an unknown field: ${key}`);
  for (const key of snapshotRequired) if (!(key in record)) throw new Error(`expected_snapshot.${key} is required`);
  return {
    projectGuid: record.project_guid, sequenceId: record.sequence_id, mediaType: record.media_type,
    trackIndex: record.track_index, clipIndex: record.clip_index, trackItemCount: record.track_item_count,
    sourceProjectItemId: record.source_project_item_id, sourceColorLabelIndex: record.source_color_label_index,
    startSeconds: record.start_seconds, endSeconds: record.end_seconds,
  };
}

/** A bounded documented-UXP source-label workflow resolved from one active timeline coordinate. */
export function getUxpTimelineSourceLabelWorkflowTools(bridge: UxpWebSocketBridge) {
  return {
    manage_timeline_source_label_uxp: {
      description: "Inspect or set the documented source Project-item color label resolved from one active audio or video timeline coordinate. Update requires the complete reviewed snapshot, explicit confirmation, and an operation ID; it serializes color-label changes by source item, commits one undoable transaction, then re-reads the coordinate and source label. A source label is project-global: another use of the same source can reflect the change. It does not label a timeline-only instance, change clip timing, prove rendered appearance, playback, persistence, or Undo behavior.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["inspect", "update"] },
          media_type: { type: "string", enum: ["video", "audio"] },
          track_index: { type: "integer", minimum: 0, maximum: 511 },
          clip_index: { type: "integer", minimum: 0, maximum: 511 },
          color_index: { type: "integer", minimum: 0, maximum: 15, description: "Requested native source color-label index." },
          expected_snapshot: { type: "object", additionalProperties: false, required: snapshotRequired, properties: snapshotProperties },
          confirm_set_label: { type: "boolean", description: "Must be true for action: update after reviewing expected_snapshot." },
          operation_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$", description: "Required replay-safe operation identifier for action: update." },
        },
        required: ["action", "media_type", "track_index", "clip_index"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
      availability: {
        backend: "uxp", minimumPremiereVersion: "25.6.0", capability: "timeline.sourceLabel.inspect|timeline.sourceLabel.update",
        notes: ["Requires an authenticated UXP bridge whose runtime capability handshake advertises timeline.sourceLabel.inspect and timeline.sourceLabel.update.", "Source labels are project-item state rather than timeline-instance state; an unrelated use of the same source can reflect a successful update."],
      },
      handler: async (args: SourceLabelArgs) => {
        const target = { mediaType: args.media_type, trackIndex: args.track_index, clipIndex: args.clip_index };
        if (args.action === "inspect") return invoke(bridge, "timeline.sourceLabel.inspect", target);
        if (args.action === "update") return invoke(bridge, "timeline.sourceLabel.update", {
          ...target, colorIndex: args.color_index, expectedSnapshot: strictSnapshot(args.expected_snapshot),
          confirmSetLabel: args.confirm_set_label, operationId: args.operation_id,
        });
        return { success: false, error: `Unsupported workflow action: ${String(args.action)}` };
      },
    },
  };
}
