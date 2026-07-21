import { createHash } from "node:crypto";
import { BridgeOptions, sendCommand } from "../bridge/file-bridge.js";
import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import {
  AuditSink,
  CapabilityConfig,
  createOperationId,
  emitAudit,
  requireCapability,
  resolveCapabilities,
  stderrAuditSink,
} from "../security/index.js";

type InsertClip = {
  type: "insert_clip";
  item_id: string;
  start_seconds: number;
  video_track_index?: number;
  audio_track_index?: number;
};

type RemoveClip = { type: "remove_clip"; node_id: string; ripple?: boolean };
export type EditPlanOperation = InsertClip | RemoveClip;
export interface EditPlan { sequence_id?: string; operations: EditPlanOperation[] }

export interface EditPlanDependencies {
  capabilities?: CapabilityConfig;
  auditSink?: AuditSink;
  operationIdFactory?: () => string;
}

function canonicalPlan(plan: EditPlan): string {
  return JSON.stringify(plan);
}

export function confirmationToken(plan: EditPlan): string {
  return createHash("sha256").update(canonicalPlan(plan)).digest("hex");
}

export function validateEditPlan(value: unknown): EditPlan {
  if (!value || typeof value !== "object") throw new Error("plan must be an object");
  const plan = value as Partial<EditPlan>;
  if (!Array.isArray(plan.operations) || plan.operations.length === 0) {
    throw new Error("plan.operations must contain at least one operation");
  }
  if (plan.operations.length > 100) throw new Error("edit plans are limited to 100 operations");

  for (const [index, operation] of plan.operations.entries()) {
    if (!operation || typeof operation !== "object") throw new Error(`operation ${index} must be an object`);
    if (operation.type === "insert_clip") {
      if (!operation.item_id) throw new Error(`operation ${index} requires item_id`);
      if (!Number.isFinite(operation.start_seconds) || operation.start_seconds < 0) {
        throw new Error(`operation ${index} start_seconds must be a non-negative number`);
      }
      for (const key of ["video_track_index", "audio_track_index"] as const) {
        const n = operation[key];
        if (n !== undefined && (!Number.isInteger(n) || n < 0)) throw new Error(`operation ${index} ${key} must be a non-negative integer`);
      }
    } else if (operation.type === "remove_clip") {
      if (!operation.node_id) throw new Error(`operation ${index} requires node_id`);
    } else {
      throw new Error(`operation ${index} has unsupported type`);
    }
  }
  return plan as EditPlan;
}

function describe(plan: EditPlan) {
  return plan.operations.map((operation, index) => ({
    index,
    type: operation.type,
    target: operation.type === "insert_clip" ? operation.item_id : operation.node_id,
    destructive: operation.type === "remove_clip",
  }));
}

function buildApplyScript(plan: EditPlan): string {
  const sequence = plan.sequence_id
    ? `var seq = __findSequence("${escapeForExtendScript(plan.sequence_id)}"); if (!seq) return __error("Sequence not found");`
    : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;
  const validation: string[] = [];
  const mutations: string[] = [];

  const needsClipLookup = plan.operations.some((operation) => operation.type === "remove_clip");
  const clipLookup = needsClipLookup ? `
    function __planFindClip(sequence, nodeId) {
      var groups = [sequence.videoTracks, sequence.audioTracks];
      for (var g = 0; g < groups.length; g++) {
        for (var t = 0; t < groups[g].numTracks; t++) {
          for (var c = 0; c < groups[g][t].clips.numItems; c++) {
            if (String(groups[g][t].clips[c].nodeId) === String(nodeId)) return groups[g][t].clips[c];
          }
        }
      }
      return null;
    }
  ` : "";

  plan.operations.forEach((operation, index) => {
    if (operation.type === "insert_clip") {
      validation.push(`var item${index} = __findProjectItem("${escapeForExtendScript(operation.item_id)}"); if (!item${index}) return __error("Project item not found for operation ${index}");`);
      mutations.push(`seq.insertClip(item${index}, __secondsToTicks(${operation.start_seconds}).toString(), ${operation.video_track_index ?? 0}, ${operation.audio_track_index ?? 0}); results.push({index:${index}, type:"insert_clip", applied:true});`);
    } else {
      validation.push(`var found${index} = __planFindClip(seq, "${escapeForExtendScript(operation.node_id)}"); if (!found${index}) return __error("Clip not found for operation ${index}");`);
      mutations.push(`found${index}.remove(${operation.ripple === true ? "true" : "false"}, true); results.push({index:${index}, type:"remove_clip", applied:true});`);
    }
  });

  return buildToolScript(`${sequence}\n${clipLookup}\n${validation.join("\n")}\nvar results = [];\n${mutations.join("\n")}\nreturn __result({applied:true, operations:results});`);
}

export function getEditPlanTools(bridgeOptions: BridgeOptions, dependencies: EditPlanDependencies = {}) {
  const capabilities = dependencies.capabilities ?? resolveCapabilities();
  const auditSink = dependencies.auditSink ?? stderrAuditSink;
  const nextId = dependencies.operationIdFactory ?? createOperationId;
  const planParameter = {
    type: "object",
    description: "An edit plan containing insert_clip and remove_clip operations (maximum 100)",
  };

  return {
    preview_edit_plan: {
      description: "Validate and preview a compound timeline edit without changing Premiere. Returns a confirmation token required by apply_edit_plan.",
      parameters: { type: "object" as const, properties: { plan: planParameter }, required: ["plan"] },
      handler: async (args: { plan: unknown }) => {
        const operationId = nextId();
        requireCapability(capabilities, "inspect", operationId);
        const plan = validateEditPlan(args.plan);
        return { success: true, data: { operationId, changes: describe(plan), confirmationToken: confirmationToken(plan), applied: false } };
      },
    },
    apply_edit_plan: {
      description: "Apply a previously previewed compound edit after revalidating every target. Requires the edit capability and exact preview confirmation token.",
      parameters: {
        type: "object" as const,
        properties: { plan: planParameter, confirmation_token: { type: "string", description: "Exact token returned by preview_edit_plan" } },
        required: ["plan", "confirmation_token"],
      },
      handler: async (args: { plan: unknown; confirmation_token: string }) => {
        const operationId = nextId();
        try {
          requireCapability(capabilities, "edit", operationId);
          const plan = validateEditPlan(args.plan);
          if (args.confirmation_token !== confirmationToken(plan)) throw new Error("Confirmation token does not match this edit plan; preview it again");
          emitAudit(auditSink, { operationId, action: "apply_edit_plan", outcome: "started", details: { operationCount: plan.operations.length } });
          const result = await sendCommand(buildApplyScript(plan), bridgeOptions);
          emitAudit(auditSink, { operationId, action: "apply_edit_plan", outcome: result.success ? "succeeded" : "failed" });
          return result.success ? { ...result, data: { ...(result.data as object), operationId } } : { ...result, error: `${result.error ?? "Edit plan failed"} (operation ${operationId})` };
        } catch (error) {
          emitAudit(auditSink, { operationId, action: "apply_edit_plan", outcome: error instanceof Error && error.name === "CapabilityDeniedError" ? "denied" : "failed" });
          throw error;
        }
      },
    },
  };
}
