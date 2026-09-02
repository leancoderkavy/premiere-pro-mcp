import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";

type PreviewFrameSnapshot = {
  project_guid: string;
  sequence_id: string;
  preview_width: number;
  preview_height: number;
};

type PreviewFrameArgs = {
  action: "inspect" | "update";
  sequence_id: string;
  preview_width?: number;
  preview_height?: number;
  expected_snapshot?: PreviewFrameSnapshot;
  confirm_set_preview_frame?: boolean;
  operation_id?: string;
};

const snapshotProperties = {
  project_guid: { type: "string", minLength: 1, maxLength: 128 },
  sequence_id: { type: "string", minLength: 1, maxLength: 128 },
  preview_width: { type: "integer", minimum: 16, maximum: 10240 },
  preview_height: { type: "integer", minimum: 16, maximum: 8192 },
} as const;
const snapshotRequired = ["project_guid", "sequence_id", "preview_width", "preview_height"];

function invoke(bridge: UxpWebSocketBridge, command: string, args: Record<string, unknown>) {
  return bridge.request(command, args)
    .then((result) => ({ success: true, data: { backend: "uxp", result } }))
    .catch((error: unknown) => ({ success: false, error: error instanceof Error ? error.message : String(error) }));
}

function strictSnapshot(value: PreviewFrameArgs["expected_snapshot"]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected_snapshot is required for action: update");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!(key in snapshotProperties)) throw new Error(`expected_snapshot has an unknown field: ${key}`);
  for (const key of snapshotRequired) if (!(key in record)) throw new Error(`expected_snapshot.${key} is required`);
  return {
    projectGuid: record.project_guid,
    sequenceId: record.sequence_id,
    previewWidth: record.preview_width,
    previewHeight: record.preview_height,
  };
}

/** A bounded documented-UXP preview-frame workflow for one explicit sequence GUID. */
export function getUxpSequencePreviewFrameWorkflowTools(bridge: UxpWebSocketBridge) {
  return {
    manage_sequence_preview_frame_uxp: {
      description: "Inspect or set one explicit sequence's documented preview-frame rectangle. Update requires the complete inspected snapshot, explicit confirmation, and an operation ID; it serializes preview-frame updates by reviewed project and sequence, commits one undoable settings transaction, then reads the same sequence back. It does not set sequence video dimensions, alter media or exports, prove rendered preview output, persistence, Undo behavior, or coordinate with Premiere UI or other extensions between native calls.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["inspect", "update"] },
          sequence_id: { type: "string", minLength: 1, maxLength: 128, description: "Exact sequence GUID returned by an existing sequence inspector." },
          preview_width: { type: "integer", minimum: 16, maximum: 10240, description: "Requested native preview-frame width. Required for action: update." },
          preview_height: { type: "integer", minimum: 16, maximum: 8192, description: "Requested native preview-frame height. Required for action: update." },
          expected_snapshot: { type: "object", additionalProperties: false, required: snapshotRequired, properties: snapshotProperties },
          confirm_set_preview_frame: { type: "boolean", description: "Must be true for action: update after reviewing expected_snapshot." },
          operation_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$", description: "Required replay-safe operation identifier for action: update." },
        },
        required: ["action", "sequence_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
      availability: {
        backend: "uxp", minimumPremiereVersion: "26.3.0", capability: "sequence.previewFrame.inspect|sequence.previewFrame.update",
        notes: [
          "Requires an authenticated UXP bridge whose runtime capability handshake advertises sequence.previewFrame.inspect and sequence.previewFrame.update.",
          "The reviewed snapshot is revalidated and updates are serialized inside this bridge process per project/sequence. Native UXP does not provide compare-and-swap or a cross-extension/UI lock, so it cannot prove another actor did not change the setting between native calls.",
        ],
      },
      handler: async (args: PreviewFrameArgs) => {
        if (args.action === "inspect") return invoke(bridge, "sequence.previewFrame.inspect", { sequenceId: args.sequence_id });
        if (args.action === "update") return invoke(bridge, "sequence.previewFrame.update", {
          sequenceId: args.sequence_id,
          previewWidth: args.preview_width,
          previewHeight: args.preview_height,
          expectedSnapshot: strictSnapshot(args.expected_snapshot),
          confirmSetPreviewFrame: args.confirm_set_preview_frame,
          operationId: args.operation_id,
        });
        return { success: false, error: `Unsupported workflow action: ${String(args.action)}` };
      },
    },
  };
}
