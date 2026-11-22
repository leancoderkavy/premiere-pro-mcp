import { createHash } from "node:crypto";
import { BridgeOptions, sendCommand } from "../bridge/file-bridge.js";
import { validateBridgeScriptSize } from "../bridge/script-size.js";
import { buildToolScript, escapeForExtendScript, escapeUnsafeLiteralCharacters } from "../bridge/script-builder.js";
import { rippleDeleteScriptBody } from "./ripple-delete-script.js";
import { rippleTimeoutMs } from "./ripple-timeout.js";
import { createEditPlanTokenStore, EditPlanTokenStore, EditPlanHostBinding, validateEditPlanHostBinding } from "./edit-plan-token-store.js";
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

type RemoveClip = { type: "remove_clip"; node_id: string; ripple?: boolean; include_linked?: boolean; allow_large_ripple?: boolean; large_ripple_threshold?: number };

const OPERATION_KEYS: Record<EditPlanOperation["type"], string[]> = {
  insert_clip: ["type", "item_id", "start_seconds", "video_track_index", "audio_track_index"],
  remove_clip: ["type", "node_id", "ripple", "include_linked", "allow_large_ripple", "large_ripple_threshold"],
};
export type EditPlanOperation = InsertClip | RemoveClip;
export interface EditPlan { sequence_id?: string; operations: EditPlanOperation[] }

export interface EditPlanDependencies {
  capabilities?: CapabilityConfig;
  auditSink?: AuditSink;
  operationIdFactory?: () => string;
  tokenStore?: EditPlanTokenStore;
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
      if (operation.allow_large_ripple !== undefined && typeof operation.allow_large_ripple !== "boolean") throw new Error(`operation ${index} allow_large_ripple must be a boolean`);
      if (operation.large_ripple_threshold !== undefined && (!Number.isInteger(operation.large_ripple_threshold) || operation.large_ripple_threshold < 1 || operation.large_ripple_threshold > 5000)) throw new Error(`operation ${index} large_ripple_threshold must be an integer from 1 to 5000`);
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

/** Build ES3 object literals without raw host strings or a JSON.parse dependency. */
function linkedBindingLiteral(partners: Extract<EditPlanHostBinding["targets"][number], { type: "remove_clip" }>["linkedPartners"]): string {
  return "[" + partners.map((partner) => {
    const fields = Object.entries(partner).map(([key, value]) => {
      const literal = typeof value === "string" ? `"${escapeForExtendScript(value)}"` : JSON.stringify(value);
      return `"${escapeForExtendScript(key)}":${literal}`;
    });
    return "{" + fields.join(",") + "}";
  }).join(",") + "]";
}

/** Resolve and snapshot every target without activating a sequence or editing the host. */
function hostBindingScript(plan: EditPlan, boundPartners?: EditPlanHostBinding): string {
  const sequence = plan.sequence_id
    ? `var seq = __findSequence("${escapeForExtendScript(plan.sequence_id)}"); if (!seq) return __error("Sequence not found");`
    : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;
  const checks = plan.operations.map((operation, index) => {
    if (operation.type === "insert_clip") {
      const video = operation.video_track_index ?? 0;
      const audio = operation.audio_track_index ?? 0;
      return `var item${index} = __findProjectItem("${escapeForExtendScript(operation.item_id)}"); if (!item${index}) return __error("Project item not found for operation ${index}");
        if (!seq.videoTracks || ${video} >= seq.videoTracks.numTracks) return __error("video track not found for operation ${index}");
        if (!seq.audioTracks || ${audio} >= seq.audioTracks.numTracks) return __error("audio track not found for operation ${index}");
        targets.push({type:"insert_clip",targetId:__bindingIdentity(item${index}.nodeId),videoTrackIndex:${video},audioTrackIndex:${audio}});`;
    }
    const reuseBoundPartners = boundPartners !== undefined && (operation.ripple === true || operation.include_linked !== false);
    const linkedBindings = boundPartners?.targets[index]?.type === "remove_clip" ? boundPartners.targets[index].linkedPartners : [];
    const partnerPrelude = reuseBoundPartners
      ? `var partnerBindings${index} = ${linkedBindingLiteral(linkedBindings)};
        for (var pb${index} = 0; pb${index} < partnerBindings${index}.length; pb${index}++) {
          var partnerLocated${index} = __planLocateClip(seq, partnerBindings${index}[pb${index}].targetId);
          if (!partnerLocated${index} || __jsonStringify(__planClipBinding(partnerLocated${index})) !== __jsonStringify(partnerBindings${index}[pb${index}])) return __error("A linked removal target changed since preview for operation ${index}");
          validatedPartners${index}.push(partnerLocated${index});
        }`
      : "";
    const partnerExpression = reuseBoundPartners ? `partnerBindings${index}` : `__planLinkedBindings(seq, located${index}, validatedPartners${index})`;
    return `var located${index} = __planLocateClip(seq, "${escapeForExtendScript(operation.node_id)}"); if (!located${index}) return __error("Clip not found for operation ${index}");
      var removal${index} = __planClipBinding(located${index});
      var validatedPartners${index} = [];
      ${partnerPrelude}
      var boundRemoval${index} = {type:"remove_clip",targetId:removal${index}.targetId,sourceProjectItemId:removal${index}.sourceProjectItemId,trackType:removal${index}.trackType,trackIndex:removal${index}.trackIndex,startTicks:removal${index}.startTicks,endTicks:removal${index}.endTicks,inTicks:removal${index}.inTicks,outTicks:removal${index}.outTicks,linkedPartners: ${operation.ripple === true || operation.include_linked !== false ? partnerExpression : "[]"}};
      targets.push(boundRemoval${index});`;
  });
  return `${sequence}
    if (!__isCurrentProjectSequence(seq)) return __error("Sequence is not in the current project");
    function __bindingIdentity(value) {
      if ((typeof value !== "string" && typeof value !== "number") || String(value).replace(/\\s/g, "") === "") throw new Error("Premiere did not expose stable target identities; preview cannot be bound safely");
      return String(value);
    }
    function __planLocateClip(sequence, nodeId) {
      var groups = [sequence.videoTracks, sequence.audioTracks];
      for (var g = 0; g < groups.length; g++) {
        if (!groups[g]) continue;
        for (var t = 0; t < groups[g].numTracks; t++) {
          for (var c = 0; c < groups[g][t].clips.numItems; c++) {
            var clip = groups[g][t].clips[c];
            if (String(clip.nodeId) === String(nodeId)) return {clip:clip,trackType:g === 0 ? "video" : "audio",trackIndex:t};
          }
        }
      }
      return null;
    }
    function __planClipBinding(located) {
      var clip = located.clip;
      return {targetId:__bindingIdentity(clip.nodeId),sourceProjectItemId:__bindingIdentity(clip.projectItem && clip.projectItem.nodeId),trackType:located.trackType,trackIndex:located.trackIndex,startTicks:__bindingIdentity(clip.start && clip.start.ticks),endTicks:__bindingIdentity(clip.end && clip.end.ticks),inTicks:__bindingIdentity(clip.inPoint && clip.inPoint.ticks),outTicks:__bindingIdentity(clip.outPoint && clip.outPoint.ticks)};
    }
    function __planLinkedBindings(sequence, located, validatedPartners) {
      if (typeof located.clip.getLinkedItems !== "function") throw new Error("Premiere cannot expose linked removal targets; preview cannot be bound safely");
      var linked = null;
      try { linked = located.clip.getLinkedItems(); }
      catch (linkageError) { throw new Error("Linked removal targets could not be read; nothing was changed: " + linkageError.toString()); }
      if (linked !== null && (!linked || typeof linked !== "object" || typeof linked.numItems !== "number" || linked.numItems < 0 || linked.numItems > 256 || Math.floor(linked.numItems) !== linked.numItems)) throw new Error("Linked removal targets cannot be enumerated safely");
      var partners = [], seen = {};
      for (var li = 0; linked && li < linked.numItems; li++) {
        var id = __bindingIdentity(linked[li] && linked[li].nodeId);
        if (id === String(located.clip.nodeId) || seen[id]) continue;
        var partner = __planLocateClip(sequence, id);
        if (!partner) throw new Error("A linked removal target is no longer in the inspected sequence");
        // Match __linkedPartnerClips: same-track group members are not removed.
        if (partner.trackType === located.trackType && partner.trackIndex === located.trackIndex) continue;
        seen[id] = true;
        validatedPartners.push(partner);
        partners.push(__planClipBinding(partner));
      }
      partners.sort(function (left, right) { return left.targetId < right.targetId ? -1 : (left.targetId > right.targetId ? 1 : 0); });
      return partners;
    }
    function __planFindClip(sequence, nodeId) { var located = __planLocateClip(sequence, nodeId); return located ? located.clip : null; }
    var projectDocumentId = __bindingIdentity(app.project.documentID);
    var sequenceId = __bindingIdentity(seq.sequenceID);
    var targets = [];
    ${checks.join("\n")}
    var hostBinding = {version:1,projectDocumentId:projectDocumentId,sequenceId:sequenceId,targets:targets};`;
}

function buildPreviewScript(plan: EditPlan): string {
  return buildToolScript(`${hostBindingScript(plan)}\nreturn __result({targetsValidated:true, hostBinding:hostBinding, applied:false});`);
}

/** Keep nested ripple results as objects until the plan reports its own outcome. */
function wrapRippleBody(body: string): string {
  return `(function () {
    function __result(data) { return { success: true, data: data }; }
    function __error(message, data) { return { success: false, error: String(message), data: data }; }
    function __refuse(message) {
      // This receipt covers just the ripple operation. The standalone helper's
      // bridge marker applies to a whole command and must not propagate here.
      return __error(message, { mutationOutcome: "not_applied", timelineChanged: false });
    }
    ${body}
  })()`;
}

/** Read-only estimate, bound to the same inspected host targets as the apply. */
function buildApplyPreflightScript(plan: EditPlan, binding: EditPlanHostBinding): string {
  const probes: string[] = [];
  plan.operations.forEach((operation, index) => {
    if (operation.type !== "remove_clip" || operation.ripple !== true) return;
    const nodeId = escapeForExtendScript(operation.node_id);
    const body = rippleDeleteScriptBody({
      nodeId,
      scope: "sync_locked",
      rangeDelete: false,
      dryRun: true,
      allowLargeRipple: true,
      largeRippleThreshold: operation.large_ripple_threshold ?? 400,
      validatedPartnersExpression: `validatedPartners${index}`,
    });
    probes.push(`var estimate${index} = ${wrapRippleBody(body)}; if (!estimate${index}.success) return __error("Ripple preflight operation ${index} failed: " + estimate${index}.error, estimate${index}.data); rippleEstimates.push({index:${index}, movers:estimate${index}.data.totalMovers || 0, removals:(estimate${index}.data.alsoRemoves || []).length + 1, estimatedSeconds:estimate${index}.data.estimatedSeconds || 0}); totalMovers += estimate${index}.data.totalMovers || 0;`);
  });
  return buildToolScript(`${hostBindingScript(plan, binding)}
    if (__jsonStringify(hostBinding) !== "${escapeForExtendScript(escapeUnsafeLiteralCharacters(JSON.stringify(binding)))}") return __error("Edit-plan host targets changed since preview; preview the edit again. No sequence activation or mutation was attempted.");
    if (!app.project.activeSequence || String(app.project.activeSequence.sequenceID) !== String(seq.sequenceID)) return __error("Activate the reviewed sequence in Premiere and preview the ripple plan again; its QE sync-lock state cannot be inspected while another sequence is active. Nothing was changed.");
    var rippleEstimates = [], totalMovers = 0;
    ${probes.join("\n")}
    return __result({preflight:true, totalMovers:totalMovers, ripples:rippleEstimates});`);
}

function buildApplyScript(plan: EditPlan, binding: EditPlanHostBinding): string {
  const activation = plan.sequence_id ? `
    if (!app.project.activeSequence || String(app.project.activeSequence.sequenceID) !== String(seq.sequenceID)) {
      app.project.activeSequence = seq;
      if (!app.project.activeSequence || String(app.project.activeSequence.sequenceID) !== String(seq.sequenceID)) return __error("Could not activate the plan's sequence; no timeline edits were attempted");
    }` : "";
  const mutations: string[] = [];
  // A failure part-way through leaves earlier operations applied; report them.
  // undoSteps (EXPERIMENTAL, QE undoStackIndex) is data only: it counts
  // QE-recorded actions and misses DOM-only operations such as removals, so it
  // is never offered as a way to reverse the plan.
  const failure = `
    var planUndoStart = __readUndoIndex();
    function __planFail(index, message, extraData) {
      var now = __readUndoIndex();
      var steps = planUndoStart !== null && now !== null ? now - planUndoStart : null;
      var unknown = extraData && extraData.mutationOutcome === "unknown";
      var changed = results.length > 0 || (extraData && extraData.timelineChanged === true) || (steps !== null && steps > 0) || /timeline changed/.test(message);
      // An operation's own "Nothing was changed" is wrong once anything was applied
      // or Premiere recorded undo entries.
      if (changed || unknown) message = String(message).replace(/\\s*Nothing was changed\\.?|; nothing changed\\.?/gi, "");
      var summary = results.length
        ? " The timeline changed: the " + results.length + " operation(s) before it were applied and were not rolled back."
        : (changed ? (/timeline changed/.test(message) ? "" : " The timeline may have changed during the failed operation and was not rolled back.") : (unknown ? " The mutation outcome is unknown; inspect the timeline before retrying." : (/Nothing was changed/.test(message) ? "" : " Nothing was changed.")));
      var data = { appliedOperations: results, timelineChanged: changed, undoSteps: steps, undoStackIndex: now,
        undoStepsNote: "undoSteps counts only actions Premiere recorded in its undo history (QE edits such as inserts). DOM-only operations, such as clip removals, add no entry, so undoing this many steps does not necessarily reverse the plan." };
      if (extraData) {
        for (var field in extraData) if (extraData.hasOwnProperty(field)) data[field] = extraData[field];
      }
      data.timelineChanged = changed ? true : (unknown ? null : false);
      if (changed && data.mutationOutcome === "not_applied") {
        data.mutationOutcome = "changed";
        data.mutationAttempted = true;
      }
      return __jsonStringify({ success: false,
        error: "Operation " + index + " failed: " + message + summary,
        data: data });
    }
  `;


  plan.operations.forEach((operation, index) => {
    if (operation.type === "insert_clip") {
      mutations.push(`var outcome${index} = __insertClipHonoringSyncLock(seq, item${index}, __secondsToTicks(${operation.start_seconds}).toString(), ${operation.video_track_index ?? 0}, ${operation.audio_track_index ?? 0}, "sync_locked"); if (!outcome${index}.ok) return __planFail(${index}, outcome${index}.error, outcome${index}.changed ? { timelineChanged:true, outcome:"committed_unverified", verified:false, displacedTails:outcome${index}.displacedTails, placedOn:outcome${index}.placedOn } : null); results.push({index:${index}, type:"insert_clip", applied:true, verified:true, syncLockHonored: outcome${index}.data.syncLockHonored});`);
    } else {
      const nodeId = escapeForExtendScript(operation.node_id);
      if (operation.ripple === true) {
        const body = rippleDeleteScriptBody({ nodeId, scope: "sync_locked", rangeDelete: false, dryRun: false, allowLargeRipple: operation.allow_large_ripple === true, largeRippleThreshold: operation.large_ripple_threshold ?? 400, validatedPartnersExpression: `validatedPartners${index}` });
        mutations.push(`var ripple${index} = ${wrapRippleBody(body)}; if (!ripple${index}.success) return __planFail(${index}, ripple${index}.error, ripple${index}.data); results.push({index:${index}, type:"remove_clip", ripple:true, applied:true, verified:true, gapClosedSeconds: ripple${index}.data.gapClosedSeconds, clipsShifted: ripple${index}.data.clipsShifted});`);
      } else {
        mutations.push(`var found${index} = __findClip("${nodeId}"); if (!found${index}) return __planFail(${index}, "clip ${nodeId} is no longer on the timeline"); var removed${index} = __removeClipAndPartners(found${index}, ${operation.include_linked !== false}, validatedPartners${index}); if (!removed${index}.ok) return __planFail(${index}, removed${index}.error, removed${index}.data); results.push({index:${index}, type:"remove_clip", ripple:false, applied:true, verified:true, linkedPartnersRemoved: removed${index}.data.linkedPartnersRemoved});`);
      }
    }
  });

  return buildToolScript(`${hostBindingScript(plan)}
    if (__jsonStringify(hostBinding) !== "${escapeForExtendScript(escapeUnsafeLiteralCharacters(JSON.stringify(binding)))}") return __error("Edit-plan host targets changed since preview; preview the edit again. No sequence activation or mutation was attempted.");
    ${activation}\nvar results = [];\n${failure}\n${mutations.join("\n")}\nreturn __result({applied:true, sequence: seq.name, operations:results});`);
}

export function getEditPlanTools(bridgeOptions: BridgeOptions, dependencies: EditPlanDependencies = {}) {
  const capabilities = dependencies.capabilities ?? resolveCapabilities();
  const auditSink = dependencies.auditSink ?? stderrAuditSink;
  const nextId = dependencies.operationIdFactory ?? createOperationId;
  const tokenStore = dependencies.tokenStore ?? createEditPlanTokenStore(bridgeOptions);
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
            allow_large_ripple: { type: "boolean", description: "ripple remove_clip: allow execution above large_ripple_threshold after the read-only mover estimate" },
            large_ripple_threshold: { type: "integer", minimum: 1, maximum: 5000, description: "ripple remove_clip: refuse above this mover count unless allow_large_ripple is true (default 400)" },
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
      description: "Inspect sequence, project item, clip and requested track targets before previewing a compound timeline edit without changing Premiere. Returns a single-use confirmation token bound to stable project, sequence and target identities; it expires after 30 minutes and is required by apply_edit_plan.",
      parameters: { type: "object" as const, properties: { plan: planParameter }, required: ["plan"] },
      handler: async (args: { plan: unknown }) => {
        const operationId = nextId();
        requireCapability(capabilities, "inspect", operationId);
        const plan = validateEditPlan(args.plan);
        const inspected = await sendCommand(buildPreviewScript(plan), bridgeOptions);
        if (!inspected.success) return inspected;
        if ((inspected.data as { targetsValidated?: boolean } | undefined)?.targetsValidated !== true) {
          return { success: false, error: "Premiere did not verify the preview targets; no confirmation token was issued" };
        }
        let binding: EditPlanHostBinding;
        try { binding = validateEditPlanHostBinding((inspected.data as { hostBinding?: unknown }).hostBinding); }
        catch { return { success: false, error: "Premiere did not expose a valid host-target binding; no confirmation token was issued" }; }
        if (binding.targets.length !== plan.operations.length || binding.targets.some((target, index) => target.type !== plan.operations[index].type)) {
          return { success: false, error: "Premiere returned an incomplete host-target binding; no confirmation token was issued" };
        }
        try { validateBridgeScriptSize(buildApplyScript(plan, binding)); }
        catch { return { success: false, error: "The bound apply command exceeds the bridge's 500KB size limit; split the plan into smaller previews. No confirmation token was issued" }; }
        return { success: true, data: { operationId, changes: describe(plan), confirmationToken: tokenStore.issue(confirmationToken(plan), binding), targetsValidated: true, applied: false } };
      },
    },
    apply_edit_plan: {
      description: "Apply a previously previewed compound edit after revalidating stable project, sequence and target identities before activation or mutation. Requires the edit capability and exact preview confirmation token; changed targets require a fresh preview. Ripple plans require the reviewed sequence to be active for the read-only QE sync-lock preflight.",
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
          const binding = validateEditPlanHostBinding(tokenStore.consume(args.confirmation_token, confirmationToken(plan)));
          emitAudit(auditSink, { operationId, action: "apply_edit_plan", outcome: "started", details: { operationCount: plan.operations.length } });
          const rippleOps = plan.operations.filter((operation) => operation.type === "remove_clip" && operation.ripple === true).length;
          let result;
          if (rippleOps === 0) {
            result = await sendCommand(buildApplyScript(plan, binding), { ...bridgeOptions, mutationOnTimeout: true });
          } else {
            const preflight = await sendCommand(buildApplyPreflightScript(plan, binding), bridgeOptions);
            if (!preflight.success) return preflight;
            const estimate = preflight.data as { totalMovers?: number; ripples?: Array<{ index: number; movers: number; removals: number }> } | undefined;
            const moverCount = estimate?.totalMovers ?? 0;
            const refused = plan.operations.flatMap((operation, index) => {
              if (operation.type !== "remove_clip" || operation.ripple !== true) return [];
              const rippleEstimate = estimate?.ripples?.find((entry) => entry.index === index);
              const movers = rippleEstimate?.movers ?? 0;
              const threshold = operation.large_ripple_threshold ?? 400;
              return movers > threshold && operation.allow_large_ripple !== true ? [{ index, movers, threshold, estimatedSeconds: Math.ceil(movers * 0.15 + (rippleEstimate?.removals ?? 1) * 0.5) }] : [];
            });
            if (refused.length) {
              const first = refused[0];
              return { success: false, error: `Large ripple refused before mutation in operation ${first.index}: ${first.movers} clips would move (estimated ${first.estimatedSeconds} seconds). Pass allow_large_ripple: true to proceed.`, data: { mutationOutcome: "not_applied", timelineChanged: false, refusedRipples: refused } };
            }
            // Read-only host preflight counts ripple movers. Give 400 ms per
            // mover plus 30 s startup/readback headroom, bounded at 15 minutes.
            const timeoutMs = Math.max(bridgeOptions.timeoutMs ?? 30000, Math.min(900000, rippleTimeoutMs(moverCount) + Math.max(0, rippleOps - 1) * 30000));
            result = await sendCommand(buildApplyScript(plan, binding), { ...bridgeOptions, timeoutMs, mutationOnTimeout: true });
          }
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
