import { createHash } from "node:crypto";
import { BridgeOptions, sendCommand } from "../bridge/file-bridge.js";
import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { rippleDeleteScriptBody } from "./ripple-delete-script.js";
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

type RemoveClip = { type: "remove_clip"; node_id: string; ripple?: boolean; include_linked?: boolean };

const OPERATION_KEYS: Record<EditPlanOperation["type"], string[]> = {
  insert_clip: ["type", "item_id", "start_seconds", "video_track_index", "audio_track_index"],
  remove_clip: ["type", "node_id", "ripple", "include_linked"],
};
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

  for (const key of Object.keys(plan)) {
    if (key !== "sequence_id" && key !== "operations") throw new Error(`plan has unknown key ${key}; plans accept sequence_id and operations`);
  }
  for (const [index, operation] of plan.operations.entries()) {
    if (!operation || typeof operation !== "object") throw new Error(`operation ${index} must be an object`);
    const allowed = OPERATION_KEYS[operation.type as EditPlanOperation["type"]];
    if (allowed) {
      const unknown = Object.keys(operation).filter((key) => !allowed.includes(key));
      if (unknown.length) throw new Error(`operation ${index} has unknown key(s) ${unknown.join(", ")}; ${operation.type} accepts ${allowed.join(", ")}`);
    }
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
      for (const key of ["ripple", "include_linked"] as const) {
        if (operation[key] !== undefined && typeof operation[key] !== "boolean") throw new Error(`operation ${index} ${key} must be a boolean`);
      }
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
  // Removals go through __findClip and the ripple-delete script, which work on
  // the active sequence, so a named target sequence is activated first.
  const sequence = plan.sequence_id
    ? `var seq = __findSequence("${escapeForExtendScript(plan.sequence_id)}"); if (!seq) return __error("Sequence not found");
       if (!app.project.activeSequence || String(app.project.activeSequence.sequenceID) !== String(seq.sequenceID)) {
         app.project.activeSequence = seq;
         if (!app.project.activeSequence || String(app.project.activeSequence.sequenceID) !== String(seq.sequenceID)) return __error("Could not activate the plan's sequence; nothing was changed");
       }`
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
  // A failure part-way through leaves earlier operations applied; report them.
  // undoSteps (EXPERIMENTAL, QE undoStackIndex) is data only: it counts
  // QE-recorded actions and misses DOM-only operations such as removals, so it
  // is never offered as a way to reverse the plan.
  const failure = `
    var planUndoStart = __readUndoIndex();
    function __planFail(index, message, extraData) {
      var now = __readUndoIndex();
      var steps = planUndoStart !== null && now !== null ? now - planUndoStart : null;
      var changed = results.length > 0 || (extraData && extraData.timelineChanged === true) || (steps !== null && steps > 0) || /timeline changed/.test(message);
      // An operation's own "Nothing was changed" is wrong once anything was applied
      // or Premiere recorded undo entries.
      if (changed) message = String(message).replace(/\\s*Nothing was changed\\.?/g, "");
      var summary = results.length
        ? " The timeline changed: the " + results.length + " operation(s) before it were applied and were not rolled back."
        : (changed ? (/timeline changed/.test(message) ? "" : " The timeline may have changed during the failed operation and was not rolled back.") : (/Nothing was changed/.test(message) ? "" : " Nothing was changed."));
      var data = { appliedOperations: results, timelineChanged: changed, undoSteps: steps, undoStackIndex: now,
        undoStepsNote: "undoSteps counts only actions Premiere recorded in its undo history (QE edits such as inserts). DOM-only operations, such as clip removals, add no entry, so undoing this many steps does not necessarily reverse the plan." };
      if (extraData) {
        for (var field in extraData) if (extraData.hasOwnProperty(field)) data[field] = extraData[field];
      }
      data.timelineChanged = changed;
      return __jsonStringify({ success: false,
        error: "Operation " + index + " failed: " + message + summary,
        data: data });
    }
  `;


  plan.operations.forEach((operation, index) => {
    if (operation.type === "insert_clip") {
      validation.push(`var item${index} = __findProjectItem("${escapeForExtendScript(operation.item_id)}"); if (!item${index}) return __error("Project item not found for operation ${index}");`);
      mutations.push(`var outcome${index} = __insertClipHonoringSyncLock(seq, item${index}, __secondsToTicks(${operation.start_seconds}).toString(), ${operation.video_track_index ?? 0}, ${operation.audio_track_index ?? 0}, "sync_locked"); if (!outcome${index}.ok) return __planFail(${index}, outcome${index}.error, outcome${index}.changed ? { timelineChanged:true, outcome:"committed_unverified", verified:false, displacedTails:outcome${index}.displacedTails } : null); results.push({index:${index}, type:"insert_clip", applied:true, verified:true, syncLockHonored: outcome${index}.data.syncLockHonored});`);
    } else {
      const nodeId = escapeForExtendScript(operation.node_id);
      validation.push(`if (!__planFindClip(seq, "${nodeId}")) return __error("Clip not found for operation ${index}");`);
      if (operation.ripple === true) {
        const body = rippleDeleteScriptBody({ nodeId, scope: "sync_locked", rangeDelete: false, dryRun: false });
        // __result/__error are shadowed so the body hands back a plain object.
        mutations.push(`var ripple${index} = (function () { var __result = function (d) { return { success: true, data: d }; }; var __error = function (m) { return { success: false, error: String(m) }; }; ${body} })(); if (!ripple${index}.success) return __planFail(${index}, ripple${index}.error); results.push({index:${index}, type:"remove_clip", ripple:true, applied:true, verified:true, gapClosedSeconds: ripple${index}.data.gapClosedSeconds, clipsShifted: ripple${index}.data.clipsShifted});`);
      } else {
        mutations.push(`var found${index} = __findClip("${nodeId}"); if (!found${index}) return __planFail(${index}, "clip ${nodeId} is no longer on the timeline"); var removed${index} = __removeClipAndPartners(found${index}, ${operation.include_linked !== false}); if (!removed${index}.ok) return __planFail(${index}, removed${index}.error); results.push({index:${index}, type:"remove_clip", ripple:false, applied:true, verified:true, linkedPartnersRemoved: removed${index}.data.linkedPartnersRemoved});`);
      }
    }
  });

  return buildToolScript(`${sequence}\n${clipLookup}\n${validation.join("\n")}\nvar results = [];\n${failure}\n${mutations.join("\n")}\nreturn __result({applied:true, sequence: seq.name, operations:results});`);
}

export function getEditPlanTools(bridgeOptions: BridgeOptions, dependencies: EditPlanDependencies = {}) {
  const capabilities = dependencies.capabilities ?? resolveCapabilities();
  const auditSink = dependencies.auditSink ?? stderrAuditSink;
  const nextId = dependencies.operationIdFactory ?? createOperationId;
  const planParameter = {
    type: "object",
    description:
      "An edit plan: { sequence_id?, operations: [...] } with up to 100 insert_clip and remove_clip operations. Operations run in order, and each one's times refer to the timeline as the operations before it left it.",
    properties: {
      sequence_id: { type: "string", description: "Sequence name or ID to edit (activated first); defaults to the active sequence" },
      operations: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["insert_clip", "remove_clip"] },
            item_id: { type: "string", description: "insert_clip: project item node ID or name" },
            start_seconds: { type: "number", minimum: 0, description: "insert_clip: timeline insert time in seconds (insert edit, sync-locked tracks shift)" },
            video_track_index: { type: "integer", minimum: 0, description: "insert_clip: video track (default 0)" },
            audio_track_index: { type: "integer", minimum: 0, description: "insert_clip: audio track (default 0)" },
            node_id: { type: "string", description: "remove_clip: timeline clip node ID" },
            ripple: { type: "boolean", description: "remove_clip: close the gap with a verified sync-locked ripple delete (always takes linked partners)" },
            include_linked: { type: "boolean", description: "remove_clip without ripple: also remove linked audio/video partners (default true)" },
          },
          required: ["type"],
        },
      },
    },
    required: ["operations"],
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
