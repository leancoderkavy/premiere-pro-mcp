import { createHash } from "node:crypto";
import { type BridgeOptions, getTempDir, sendCommand, withBridgeWorkflow } from "../bridge/file-bridge.js";
import { acknowledgeHostRecovery, inspectHostRecovery } from "../bridge/host-lease.js";
import { buildToolScript } from "../bridge/script-builder.js";
import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";
import { OPERATION_LOG_LIMIT, recentOperations, runningOperations } from "../workflows/operation-log.js";

const HOST_STATE_SCRIPT = `
  var project = app.project;
  var sequence = project && project.activeSequence;
  var snapshot = { projectId: project ? String(project.documentID || "") : null, sequenceId: sequence ? String(sequence.sequenceID) : null, clips: [] };
  if (sequence) {
    var kinds = ["video", "audio"];
    for (var kind = 0; kind < kinds.length; kind++) {
      var tracks = kind === 0 ? sequence.videoTracks : sequence.audioTracks;
      if (tracks.numTracks > 256) return __error("Recovery inspection exceeds 256 tracks");
      for (var t = 0; t < tracks.numTracks; t++) {
        for (var c = 0; c < tracks[t].clips.numItems; c++) {
          if (snapshot.clips.length >= 5000) return __error("Recovery inspection exceeds 5000 clips");
          var clip = tracks[t].clips[c];
          snapshot.clips.push({ nodeId: String(clip.nodeId), sourceId: clip.projectItem ? String(clip.projectItem.nodeId) : null, mediaType: kinds[kind], trackIndex: t, startTicks: String(clip.start.ticks), endTicks: String(clip.end.ticks), inTicks: String(clip.inPoint.ticks), outTicks: String(clip.outPoint.ticks) });
        }
      }
    }
  }
  return __result(snapshot);
`;
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function getOperationRecoveryTools(uxpBridge: UxpWebSocketBridge | undefined, bridgeOptions?: BridgeOptions) {
  const properties = {
    backend: { type: "string", enum: ["cep", "uxp"], description: "Execution backend whose uncertain operations should be inspected." },
  };
  async function inspect(backend: "cep" | "uxp") {
    if (backend === "uxp") {
      if (!uxpBridge) throw new Error("UXP bridge is not configured");
      const panel = await uxpBridge.request("operations.recovery.inspect") as { recoveryRevision: string; identityRevision: string; operations: { id: string }[] };
      const transport = uxpBridge.getOperationRecovery();
      const shared = inspectHostRecovery(getTempDir(bridgeOptions));
      return { backend, recoveryRequired: Boolean((panel as { recoveryRequired?: boolean }).recoveryRequired || transport.recoveryRequired || shared.recoveryRequired), panel, transport, shared, hostStateRevision: panel.identityRevision };
    }
    if (backend !== "cep") throw new Error("backend must be cep or uxp");
    const state = inspectHostRecovery(getTempDir(bridgeOptions));
    const snapshot = await sendCommand(buildToolScript(HOST_STATE_SCRIPT), { ...bridgeOptions, mutating: false, mutationOnTimeout: false });
    if (!snapshot.success) throw new Error(snapshot.error || "Host recovery snapshot unavailable");
    return { backend, ...state, hostStateRevision: digest(snapshot.data), snapshotBoundary: "bounded_active_sequence_clip_identity_and_ranges", snapshot: snapshot.data };
  }
  return {
    get_last_operations: {
      description: "Read-only: list the most recent state-changing tool calls this MCP server process handled, newest first, with status (running, succeeded, failed), receipt outcome and timing. Use it after a client-side timeout before retrying an edit: a call still running, or one that already succeeded, must not be sent again. The running count includes all active calls, even outside the history window; runningOperations lists up to limit active calls and runningOperationsTruncated flags omitted entries. Entries made with idempotency_key carry idempotencyKeyHash, a 12-character SHA-256 prefix (never the raw key). Records only tool names, timing and outcomes; it does not prove Premiere state, and it starts empty when the server restarts.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      parameters: { type: "object", additionalProperties: false, properties: {
        limit: { type: "integer", minimum: 1, maximum: OPERATION_LOG_LIMIT, description: `How many operations to return, newest first (default 10, max ${OPERATION_LOG_LIMIT}).` },
      } },
      handler: async (args: { limit?: number }) => {
        const limit = args.limit ?? 10;
        if (!Number.isInteger(limit) || limit < 1 || limit > OPERATION_LOG_LIMIT) return { success: false, error: `limit must be an integer from 1 through ${OPERATION_LOG_LIMIT}` };
        const operations = recentOperations(limit);
        const active = runningOperations(limit);
        return { success: true, data: { operations, running: active.count, runningOperations: active.operations, runningOperationsTruncated: active.truncated, scope: "this_server_process_memory", boundary: "Tool-call bookkeeping only; read the timeline back before relying on an edit's effect." } };
      },
    },
    inspect_operation_recovery: {
      description: "Inspect unknown execution outcomes and a bounded current host-state revision. Inspection remains available while dependent mutations are blocked. No edit is replayed.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      parameters: { type: "object", additionalProperties: false, properties, required: ["backend"] },
      handler: async (args: { backend: "cep" | "uxp" }) => {
        try { return { success: true, data: await inspect(args.backend) }; } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
      },
    },
    acknowledge_operation_recovery: {
      description: "Acknowledge user-reviewed reconciliation of uncertain execution after current-state inspection. Requires the exact latest recovery and host-state revisions. Consumed operation IDs remain unavailable for replay; acknowledgement does not undo or retry a host edit.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      parameters: { type: "object", additionalProperties: false, properties: {
        ...properties,
        expected_recovery_revision: { type: "string", maxLength: 256, description: "CEP recoveryRevision or UXP transport.recoveryRevision returned by inspection." },
        expected_host_state_revision: { type: "string", maxLength: 256, description: "Exact hostStateRevision returned by the latest inspected bounded host state." },
        expected_panel_recovery_revision: { type: "string", maxLength: 256, description: "UXP panel.recoveryRevision returned by inspection; required for UXP." },
        expected_shared_recovery_revision: { type: "string", maxLength: 256, description: "UXP shared.recoveryRevision when shared Premiere execution recovery is required." },
        reviewed: { type: "boolean", const: true, description: "True only after reviewing current host state and reconciling the uncertain operations." },
      }, required: ["backend", "expected_recovery_revision", "expected_host_state_revision", "reviewed"] },
      handler: async (args: { backend: "cep" | "uxp"; expected_recovery_revision: string; expected_host_state_revision: string; expected_panel_recovery_revision?: string; expected_shared_recovery_revision?: string; reviewed: boolean }) => {
        const work = async () => {
          if (args.reviewed !== true) throw new Error("reviewed must be true after reconciliation");
          const view = await inspect(args.backend);
          if (view.hostStateRevision !== args.expected_host_state_revision) throw new Error("HOST_STALE_RECOVERY: current host state changed; inspect again");
          if (view.backend === "uxp" && "panel" in view) {
            if (!uxpBridge) throw new Error("UXP bridge is not configured");
            if (view.panel.recoveryRevision !== args.expected_panel_recovery_revision || view.transport.recoveryRevision !== args.expected_recovery_revision) throw new Error("UXP_STALE_RECOVERY: recovery ledger changed; inspect again");
            if (view.shared.recoveryRequired && view.shared.recoveryRevision !== args.expected_shared_recovery_revision) throw new Error("HOST_STALE_RECOVERY: shared recovery revision changed; inspect again");
            await uxpBridge.request("operations.recovery.acknowledge", { expectedRecoveryRevision: view.panel.recoveryRevision, expectedIdentityRevision: view.panel.identityRevision, operationIds: view.panel.operations.map((item) => item.id), reviewed: true });
            uxpBridge.acknowledgeOperationRecovery(args.expected_recovery_revision, true);
            if (view.shared.recoveryRequired) acknowledgeHostRecovery(getTempDir(bridgeOptions), args.expected_shared_recovery_revision!, true);
          } else acknowledgeHostRecovery(getTempDir(bridgeOptions), args.expected_recovery_revision, true);
          return { success: true, data: { acknowledged: true, replayAuthorized: false, boundary: "user_reviewed_current_host_state", outcome: "verified" } };
        };
        try { return await withBridgeWorkflow(bridgeOptions, work); } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
      },
    },
  };
}
