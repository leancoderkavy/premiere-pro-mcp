import { randomUUID } from "node:crypto";
import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, type BridgeOptions } from "../bridge/file-bridge.js";
import { runWithExpectedHostTarget, runWithExpectedProject } from "../bridge/project-guard.js";
import { ticks, secondsToTicks, frameToTicks, PREMIERE_TICKS_PER_SECOND } from "../ai/exact-time.js";
import { boundedObject, identity, validateSnapshot, mapTimeDomain, sourceHandlePreflight, type TimelineSnapshot, type TimelineClip } from "../ai/timeline-contract.js";
import { requireCapability, resolveCapabilities, createOperationId } from "../security/index.js";
import type { TimelineEditorialDependencies } from "./timeline-editorial.js";

const ROUTES = ["trim_clip", "split_clip", "move_clip", "enable_disable_clip", "set_effect_property", "add_keyframe"] as const;
type Route = typeof ROUTES[number];
interface Step { tool: Route; clip_id: string; args: Record<string, unknown>; time_domain?: "source" | "clip_relative" | "sequence"; time_ticks?: string; effect_identity?: string; parameter_identity?: string }
interface Plan { project_path: string; snapshot: TimelineSnapshot; steps: Step[] }
const KEYS: Record<Route, string[]> = { trim_clip: ["node_id", "new_in_seconds", "new_out_seconds", "include_linked", "keyframe_policy"], split_clip: ["time_seconds", "track_type", "track_index"], move_clip: ["node_id", "new_start_seconds"], enable_disable_clip: ["node_id", "enabled"], set_effect_property: ["node_id", "effect_name", "property_name", "property_index", "value"], add_keyframe: ["node_id", "effect_name", "property_name", "property_index", "time_seconds", "value"] };
const lit = (value: string) => `"${escapeForExtendScript(value)}"`;
export function validateExtendedEditPlan(input: unknown): Plan {
  const raw = boundedObject(input, ["project_path", "snapshot", "steps"], "extended edit plan");
  if (typeof raw.project_path !== "string" || raw.project_path.length > 4096 || !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(raw.project_path)) throw new Error("project_path must be an absolute saved project path");
  const snapshot = validateSnapshot(raw.snapshot);
  if (snapshot.backend !== "cep" || !snapshot.completeness.clips || !snapshot.completeness.links || !snapshot.completeness.locks) throw new Error("Complete CEP clips, links and lock evidence required");
  if (!Array.isArray(raw.steps) || !raw.steps.length || raw.steps.length > 100) throw new Error("extended edit plans require1to100 steps");
  const seen = new Set<string>();
  const steps = raw.steps.map((input, index): Step => {
    const step = boundedObject(structuredClone(input), ["tool", "clip_id", "args", "time_domain", "time_ticks", "effect_identity", "parameter_identity"], `step${index}`) as unknown as Step;
    if (!ROUTES.includes(step.tool)) throw new Error(`Unsupported compound route ${step.tool}`);
    identity(step.clip_id, "clip_id");
    const clip = snapshot.clips.find(c => c.id === step.clip_id);
    if (!clip || clip.identity !== "host") throw new Error("Each step requires an exact stable host clip");
    const track = snapshot.tracks.find(t => t.id === clip.track_id);
    if (track?.locked !== false) throw new Error("Step track is locked or unknown");
    // A topology-changing operation consumes its original identity. Re-query
    // before another operation on that target instead of guessing new IDs.
    if (seen.has(clip.id)) throw new Error("Repeated compound targets require a separate fresh preview"); seen.add(clip.id);
    boundedObject(step.args, KEYS[step.tool], `step${index}.args`);
    for (const field of ["new_in_seconds", "new_out_seconds", "new_start_seconds", "time_seconds"]) if (step.args[field] !== undefined && (typeof step.args[field] !== "number" || !Number.isFinite(step.args[field]) || Number(step.args[field]) < 0)) throw new Error(`${field} requires finite nonnegative seconds`);
    if (step.args.include_linked !== undefined && typeof step.args.include_linked !== "boolean") throw new Error("include_linked must be boolean");
    if (step.args.keyframe_policy !== undefined && !["reject", "preserve", "hold_last_value"].includes(String(step.args.keyframe_policy))) throw new Error("unsupported keyframe_policy");
    if (step.tool !== "split_clip" && step.args.node_id !== clip.id) throw new Error("step node_id differs from bound clip_id");
    if (step.tool === "enable_disable_clip") { if (typeof step.args.enabled !== "boolean") throw new Error("enabled must be boolean"); }
    else if (step.tool === "move_clip") {
      if (clip.linked_ids.length) throw new Error("Compound move requires separately reviewed linked group");
      if (typeof step.args.new_start_seconds !== "number") throw new Error("new_start_seconds must be number");
      const start = secondsToTicks(step.args.new_start_seconds), end = (ticks(start) + ticks(clip.end_ticks) - ticks(clip.start_ticks)).toString();
      sourceHandlePreflight(snapshot, clip, clip.in_ticks, clip.out_ticks, start, end);
    } else if (step.tool === "trim_clip") {
      if ((step.args.new_in_seconds === undefined) === (step.args.new_out_seconds === undefined)) throw new Error("trim requires exactly one source boundary");
      // Existing trim_clip handles physical probing and linked preflight; the
      // compound subset requires singleton targets to avoid unbound partners.
      if (clip.linked_ids.length || step.args.include_linked === true) throw new Error("Compound trim requires singleton target and include_linked:false");
      const i = step.args.new_in_seconds === undefined ? clip.in_ticks : secondsToTicks(step.args.new_in_seconds as number), o = step.args.new_out_seconds === undefined ? clip.out_ticks : secondsToTicks(step.args.new_out_seconds as number);
      sourceHandlePreflight(snapshot, clip, i, o, (ticks(clip.start_ticks) + ticks(i) - ticks(clip.in_ticks)).toString(), (ticks(clip.end_ticks) + ticks(o) - ticks(clip.out_ticks)).toString());
      step.args.include_linked = false;
    } else if (step.tool === "split_clip") {
      if (clip.linked_ids.length || clip.nested || clip.reversed || clip.speed.numerator !== clip.speed.denominator || clip.effects.length) throw new Error("Compound split refuses linked/nested/retimed/effected source");
      if (step.args.track_type !== track?.type || step.args.track_index !== track.index || typeof step.args.time_seconds !== "number") throw new Error("Split must bind exact inspected track and finite time");
      const at = ticks(secondsToTicks(step.args.time_seconds)); if (at <= ticks(clip.start_ticks) || at >= ticks(clip.end_ticks)) throw new Error("Split boundary must be inside bound clip");
      if (track.type === "video") { const frame = ticks(frameToTicks("1", snapshot.frame_rate)); if (at - ticks(clip.start_ticks) < frame || ticks(clip.end_ticks) - at < frame) throw new Error("Split would create a subframe video sliver"); }
      if (snapshot.clips.some(c => c.id !== clip.id && c.track_id === clip.track_id && ticks(c.start_ticks) < at && ticks(c.end_ticks) > at)) throw new Error("Split would affect another unbound clip");
    } else {
      if (!snapshot.completeness.effects) throw new Error("Effect steps require complete descriptor evidence");
      const effect = clip.effects.find(e => e.identity === step.effect_identity), parameter = effect?.parameters.find(p => p.identity === step.parameter_identity);
      if (!effect?.match_name || !parameter || parameter.writable !== true || clip.effects.filter(e => e.match_name === effect.match_name).length !== 1) throw new Error("Effect/parameter identity or verified writability unavailable");
      if (effect.parameters.filter(p => p.display_name === parameter.display_name).length !== 1) throw new Error("Duplicate parameter names cannot bind a stable CEP indexed identity");
      if (step.args.effect_name !== effect.match_name || step.args.property_name !== parameter.display_name || step.args.property_index !== effect.parameters.indexOf(parameter)) throw new Error("Effect arguments must match stable descriptor and exact indexed parameter");
      if (effect.built_in) throw new Error("Built-in component writes are protected in compound plans");
      if (step.tool === "add_keyframe") {
        if (!step.time_domain || step.time_ticks === undefined) throw new Error("keyframe requires explicit time_domain and exact time_ticks");
        const mapped = mapTimeDomain(clip, step.time_ticks, step.time_domain); if (mapped.outside_visible_range) throw new Error("compound keyframe must lie inside visible range");
        if (ticks(mapped.clip_relative_ticks) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Legacy CEP keyframe convenience route cannot safely represent these ticks");
        const seconds = Number(ticks(mapped.clip_relative_ticks)) / Number(PREMIERE_TICKS_PER_SECOND);
        if (Math.abs(Number(ticks(secondsToTicks(seconds.toFixed(12))) - ticks(mapped.clip_relative_ticks))) > 1) throw new Error("Keyframe seconds conversion would lose requested tick precision");
        step.args.time_seconds = seconds;
        if (typeof step.args.value !== "number" || !Number.isFinite(step.args.value)) throw new Error("Compound keyframe value must be finite scalar");
      } else if (parameter.animated !== false || parameter.type === "unknown" || typeof step.args.value !== parameter.type || (typeof step.args.value === "number" && !Number.isFinite(step.args.value)) || (typeof step.args.value === "string" && step.args.value.length > 8192)) throw new Error("Effect scalar type/animation must match verified descriptor");
    }
    return structuredClone(step);
  });
  return { project_path: raw.project_path, snapshot, steps };
}
function preflightScript(plan: Plan): string {
  const targets = plan.steps.map(step => {
    const clip = plan.snapshot.clips.find(c => c.id === step.clip_id)!;
    return `var located = __findClip(${lit(clip.id)}); if (!located || String(located.clip.projectItem.nodeId)!==${lit(clip.source_id)} || String(located.clip.start.ticks)!==${lit(clip.start_ticks)} || String(located.clip.end.ticks)!==${lit(clip.end_ticks)} || String(located.clip.inPoint.ticks)!==${lit(clip.in_ticks)} || String(located.clip.outPoint.ticks)!==${lit(clip.out_ticks)} || located.trackType!==${lit(plan.snapshot.tracks.find(t=>t.id===clip.track_id)!.type)} || located.trackIndex!==${plan.snapshot.tracks.find(t=>t.id===clip.track_id)!.index}) return __error("Compound target changed; preview again"); ${["trim_clip", "move_clip", "split_clip"].includes(step.tool) ? `var transitionScopes = [{type:located.trackType,index:located.trackIndex,start:Number(located.clip.start.ticks),end:Number(located.clip.end.ticks)}]; ${step.tool === "move_clip" ? `var destinationStart = __snapSequenceTicks(app.project.activeSequence, __secondsToTicks(${Number(step.args.new_start_seconds)})); transitionScopes.push({type:located.trackType,index:located.trackIndex,start:destinationStart,end:destinationStart+Number(located.clip.end.ticks)-Number(located.clip.start.ticks)});` : ""} var transitionFailure = __transitionEditGuard(app.project.activeSequence, transitionScopes); if (transitionFailure) return transitionFailure;` : ""}`;
  }).join("\n");
  return buildToolScript(`if (!app.project || String(app.project.documentID)!==${lit(plan.snapshot.project_id)} || !app.project.activeSequence || String(app.project.activeSequence.sequenceID)!==${lit(plan.snapshot.sequence_id)}) return __error("Compound project/active sequence changed; preview again"); ${targets} return __result({targetsValidated:true});`);
}
function target(snapshot: TimelineSnapshot, clip: TimelineClip, step: Step) {
  const track = snapshot.tracks.find(t => t.id === clip.track_id)!;
  const effect = clip.effects.find(e => e.identity === step.effect_identity), parameter = effect?.parameters.find(p => p.identity === step.parameter_identity);
  return { backend: "cep", project_document_id: snapshot.project_id, sequence_id: snapshot.sequence_id, clip: { node_id: clip.id, track_type: track.type, track_index: track.index, project_item_id: clip.source_id, start_ticks: clip.start_ticks, end_ticks: clip.end_ticks, in_ticks: clip.in_ticks, out_ticks: clip.out_ticks, ...(effect?.match_name && parameter ? { effect: { match_name: effect.match_name, parameter_index: effect.parameters.indexOf(parameter), parameter_name: parameter.display_name } } : {}) } };
}
export function getExtendedEditPlanTools(options: BridgeOptions, dependencies: TimelineEditorialDependencies = {}) {
  const capabilities = dependencies.capabilities ?? resolveCapabilities(), send = dependencies.send ?? sendCommand, now = dependencies.now ?? Date.now;
  const plans = new Map<string, { plan: Plan; expires: number }>();
  return {
    preview_extended_edit_plan: {
      description: "Refuses attached transitions or unreadable transition collections before structural edits; inspect transitionsAffected and use remove_transition first. Preview up to100 distinct bound CEP targets for supported trim, experimental QE split, same-track move, enable, scalar effect and keyframe steps. All targets and descriptor identities validate before token issuance; unsupported links/retiming/unknown source handles refuse. Requires exact saved project path and active sequence. No mutation or atomicity claim.", annotations: { readOnlyHint: true, destructiveHint: false },
      parameters: { type: "object" as const, additionalProperties: false, properties: { plan: { type: "object", additionalProperties: false, description: "Strict compound plan; one operation per host clip, canonical state binds identities and source handles.", properties: { project_path: { type: "string", description: "Exact saved project path." }, snapshot: { type: "object", additionalProperties: true, description: "Complete canonical CEP snapshot with host identities and descriptor evidence." }, steps: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", additionalProperties: false, properties: { tool: { type: "string", enum: [...ROUTES], description: "Allowlisted existing supported route." }, clip_id: { type: "string", description: "Exact inspected target clip ID." }, args: { type: "object", additionalProperties: true, description: "Strict arguments for the selected route; runtime validates allowed keys and cross-fields." }, time_domain: { type: "string", enum: ["source", "clip_relative", "sequence"], description: "Required for keyframes." }, time_ticks: { type: "string", description: "Exact keyframe ticks in time_domain." }, effect_identity: { type: "string", description: "Stable inspected effect descriptor identity." }, parameter_identity: { type: "string", description: "Stable inspected parameter descriptor identity." } }, required: ["tool", "clip_id", "args"] }, description: "Sequential reviewed steps; repeat targets require fresh preview." } }, required: ["project_path", "snapshot", "steps"] } }, required: ["plan"] },
      handler: async (args: { plan: unknown }) => { requireCapability(capabilities, "inspect", createOperationId()); boundedObject(args, ["plan"], "arguments"); const plan = validateExtendedEditPlan(args.plan); for (const step of plan.steps) if (!dependencies.getToolCatalog?.()[step.tool]) throw new Error(`Supported tool ${step.tool} unavailable`); const inspected = await runWithExpectedProject(plan.project_path, () => send(preflightScript(plan), options)); if (!inspected.success || (inspected.data as { targetsValidated?: boolean })?.targetsValidated !== true) return inspected; for (const [token, p] of plans) if (p.expires < now()) plans.delete(token); if (plans.size >= 100) throw new Error("Too many pending compound plans"); const token = randomUUID(); plans.set(token, { plan, expires: now() + 600000 }); return { success: true, data: { confirmation_token: token, expires_seconds: 600, snapshot_revision: plan.snapshot.revision, steps: plan.steps, atomic: false, experimental_routes: plan.steps.filter(s => s.tool === "split_clip").map(s => s.tool) } }; },
    },
    apply_extended_edit_plan: {
      description: "Consume a reviewed compound CEP token once and invoke only its existing typed tools with same-command project/sequence/clip/effect guards. Stops at first failed or unverified receipt, reports completed and unknown steps, and never retries or rolls back partial work. Rendering and audible synchronization remain separate evidence.", annotations: { readOnlyHint: false, destructiveHint: true }, parameters: { type: "object" as const, additionalProperties: false, properties: { confirmation_token: { type: "string", description: "Single-use token from preview_extended_edit_plan." } }, required: ["confirmation_token"] },
      handler: async (args: { confirmation_token: string }) => {
        requireCapability(capabilities, "edit", createOperationId()); boundedObject(args, ["confirmation_token"], "arguments"); const entry = plans.get(args.confirmation_token); plans.delete(args.confirmation_token); if (!entry || entry.expires < now()) throw new Error("Compound token missing, consumed or expired");
        const { plan } = entry, completed: Array<{ index: number; tool: string; receipt: unknown }> = [];
        const before = await runWithExpectedProject(plan.project_path, () => send(preflightScript(plan), options)); if (!before.success || (before.data as { targetsValidated?: boolean })?.targetsValidated !== true) return { ...before, success: false, error: before.error ?? "Compound target validation readback unavailable" };
        for (let index = 0; index < plan.steps.length; index++) {
          const step = plan.steps[index], clip = plan.snapshot.clips.find(c => c.id === step.clip_id)!, tool = dependencies.getToolCatalog?.()[step.tool];
          if (!tool) return { success: false, error: "Previously supported route unavailable; inspect partial state", data: { outcome: completed.length ? "committed_unverified" : "not_applied", completed, failed_index: index, atomic: false } };
          try {
            const receipt = await runWithExpectedProject(plan.project_path, () => runWithExpectedHostTarget(target(plan.snapshot, clip, step), () => tool.handler(step.args)));
            if (receipt?.success !== true || receipt?.data?.verified !== true || receipt?.data?.outcome === "committed_unverified") return { success: false, error: "Compound step failed or lacked readback; inspect before continuing", data: { outcome: "committed_unverified", completed, failed_index: index, receipt, atomic: false, retry_safe: false } };
            completed.push({ index, tool: step.tool, receipt });
          } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error), data: { outcome: "unknown", completed, failed_index: index, atomic: false, retry_safe: false } }; }
        }
        return { success: true, data: { outcome: "verified", verified: true, completed, atomic: false, verification_scope: "Each existing typed tool's stored-data/structural readback; no render or audible proof" } };
      },
    },
  };
}
