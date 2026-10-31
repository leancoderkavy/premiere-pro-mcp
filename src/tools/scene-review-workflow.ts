import { randomUUID } from "node:crypto";
import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, type BridgeOptions } from "../bridge/file-bridge.js";
import { runWithExpectedHostTarget, runWithExpectedProject } from "../bridge/project-guard.js";
import { requireCapability, resolveCapabilities, createOperationId } from "../security/index.js";
import { boundedObject, identity } from "../ai/timeline-contract.js";
import { planSceneSegmentation } from "../ai/editorial-workflows.js";
import { ticks, PREMIERE_TICKS_PER_SECOND } from "../ai/exact-time.js";
import { probeMediaDurationTicks } from "./media-evidence.js";
import type { TimelineEditorialDependencies } from "./timeline-editorial.js";

export function getSceneReviewWorkflowTools(options: BridgeOptions, dependencies: TimelineEditorialDependencies & { probeDuration?: typeof probeMediaDurationTicks } = {}) {
  const capabilities = dependencies.capabilities ?? resolveCapabilities(), send = dependencies.send ?? sendCommand, now = dependencies.now ?? Date.now;
  const plans = new Map<string, { projectPath: string; projectId: string; mediaPath: string; name: string; parentBinId?: string; mode: "markers" | "subclips" | "both"; segmentation: ReturnType<typeof planSceneSegmentation>; expires: number }>();
  const invoke = async (name: string, args: Record<string, unknown>) => { const tool = dependencies.getToolCatalog?.()[name]; if (!tool) throw new Error(`Supported route ${name} unavailable`); return tool.handler(args); };
  return {
    preview_scene_review_workflow: {
      description: "Preview reviewed scene candidates against one exact CEP source and measured physical media duration. Binds project document/source path, explicit marker/subclip mode and destination bin name. No mutation; flashes/pans/fades remain in review evidence rather than automatic cuts.", annotations: { readOnlyHint: true, destructiveHint: false },
      parameters: { type: "object" as const, additionalProperties: false, properties: { project_path: { type: "string", description: "Exact saved Premiere project path." }, segmentation: { type: "object", additionalProperties: true, description: "Strict input accepted by plan_scene_segments, including approved indices and exact source duration/handles." }, mode: { type: "string", enum: ["markers", "subclips", "both"], description: "Explicit supported source-marker and/or subclip workflow." }, bin_name: { type: "string", minLength: 1, maxLength: 128, description: "New bin/name prefix used for approved scenes." }, parent_bin_id: { type: "string", description: "Optional exact existing parent bin ID." } }, required: ["project_path", "segmentation", "mode", "bin_name"] },
      handler: async (args: { project_path: string; segmentation: Parameters<typeof planSceneSegmentation>[0]; mode: "markers" | "subclips" | "both"; bin_name: string; parent_bin_id?: string }) => {
        requireCapability(capabilities, "inspect", createOperationId()); requireCapability(capabilities, "filesystem", createOperationId()); boundedObject(args, ["project_path", "segmentation", "mode", "bin_name", "parent_bin_id"], "arguments"); identity(args.bin_name, "bin_name"); if (args.bin_name.length > 128 || !["markers", "subclips", "both"].includes(args.mode)) throw new Error("invalid scene mode/name"); if (args.parent_bin_id !== undefined) identity(args.parent_bin_id, "parent_bin_id");
        const segmentation = planSceneSegmentation(args.segmentation); if (segmentation.segments.length > 100 || ticks(args.segmentation.source_duration_ticks) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Scene workflow limited to100 segments and safely representable legacy CEP source duration");
        const required = args.mode === "markers" ? ["add_marker_to_project_item"] : args.mode === "subclips" ? ["create_bin", "create_subclip", "move_item_to_bin"] : ["add_marker_to_project_item", "create_bin", "create_subclip", "move_item_to_bin"];
        for (const route of required) if (!dependencies.getToolCatalog?.()[route]) throw new Error(`Supported route ${route} unavailable`);
        const inspected = await runWithExpectedProject(args.project_path, () => send(buildToolScript(`var source=__findProjectItem("${escapeForExtendScript(segmentation.source_id)}"); if(!source||String(source.nodeId)!=="${escapeForExtendScript(segmentation.source_id)}"||typeof source.getMediaPath!=="function") return __refuse("Exact source identity unavailable"); ${args.parent_bin_id ? `var parent=__findProjectItem("${escapeForExtendScript(args.parent_bin_id)}");if(!parent||String(parent.nodeId)!=="${escapeForExtendScript(args.parent_bin_id)}"||!__isBinItem(parent))return __error("Exact parent bin unavailable");` : ""} return __result({projectId:String(app.project.documentID),mediaPath:String(source.getMediaPath())});`), options));
        if (!inspected.success) return inspected;
        const source = inspected.data as { projectId: string; mediaPath: string }; identity(source.projectId, "projectId"); if (!source.mediaPath || source.mediaPath.length > 4096) throw new Error("Source path unavailable");
        const duration = await (dependencies.probeDuration ?? probeMediaDurationTicks)(source.mediaPath); if (duration === null || !Number.isSafeInteger(duration) || BigInt(duration) < ticks(args.segmentation.source_duration_ticks)) throw new Error("Physical source duration unknown or shorter than approved scene evidence");
        for (const [token, plan] of plans) if (plan.expires < now()) plans.delete(token); if (plans.size >= 100) throw new Error("Too many pending scene plans"); const token = randomUUID(); plans.set(token, { projectPath: args.project_path, projectId: source.projectId, mediaPath: source.mediaPath, name: args.bin_name, parentBinId: args.parent_bin_id, mode: args.mode, segmentation, expires: now() + 600000 });
        return { success: true, data: { confirmation_token: token, expires_seconds: 600, segmentation, mode: args.mode, source_duration_measured: true, timeline_changed: false } };
      },
    },
    apply_scene_review_workflow: {
      description: "Consume approved source-scene preview once, create reviewed source markers and/or subclips requesting audio in a new verified bin using existing typed CEP tools. Same-command source/project guards refuse relinks or project changes. Stops on failed/unverified receipt and retains bounded partial results; no rollback or false-positive correctness claim.", annotations: { readOnlyHint: false, destructiveHint: true }, parameters: { type: "object" as const, additionalProperties: false, properties: { confirmation_token: { type: "string", description: "Single-use preview_scene_review_workflow token." } }, required: ["confirmation_token"] },
      handler: async (args: { confirmation_token: string }) => {
        requireCapability(capabilities, "edit", createOperationId()); boundedObject(args, ["confirmation_token"], "arguments"); const plan = plans.get(args.confirmation_token); plans.delete(args.confirmation_token); if (!plan || plan.expires < now()) throw new Error("Scene token missing, consumed or expired");
        const completed: Array<{ tool: string; receipt: unknown }> = [], guard = { backend: "cep", project_document_id: plan.projectId, source_item: { node_id: plan.segmentation.source_id, media_path: plan.mediaPath } }; let binId: string | null = null;
        const call = async (tool: string, payload: Record<string, unknown>) => { const receipt = await runWithExpectedProject(plan.projectPath, () => runWithExpectedHostTarget(guard, () => invoke(tool, payload))); completed.push({ tool, receipt }); if (receipt?.success !== true || receipt?.data?.verified !== true) throw new Error(`Scene route ${tool} failed or lacks verified readback`); return receipt; };
        try {
          if (plan.mode !== "markers") { const bin = await call("create_bin", { name: plan.name, ...(plan.parentBinId ? { parent_bin_id: plan.parentBinId } : {}) }); binId = identity(bin.data.nodeId, "created bin ID"); }
          for (const segment of plan.segmentation.segments) {
            const name = `${plan.name} ${String(segment.index + 1).padStart(3, "0")}`;
            if (plan.mode !== "subclips") await call("add_marker_to_project_item", { item_id: plan.segmentation.source_id, time_seconds: Number(ticks(segment.start_ticks)) / Number(PREMIERE_TICKS_PER_SECOND), name, comments: "Reviewed source-scene segment", duration_seconds: Number(ticks(segment.end_ticks) - ticks(segment.start_ticks)) / Number(PREMIERE_TICKS_PER_SECOND), type: "Segmentation" });
            if (plan.mode !== "markers") { const subclip = await call("create_subclip", { item_id: plan.segmentation.source_id, name, in_seconds: Number(ticks(segment.handle_in_ticks)) / Number(PREMIERE_TICKS_PER_SECOND), out_seconds: Number(ticks(segment.handle_out_ticks)) / Number(PREMIERE_TICKS_PER_SECOND) }); const subclipId = identity(subclip.data.nodeId, "subclip ID"); await call("move_item_to_bin", { item_id: subclipId, target_bin: binId! }); }
          }
          return { success: true, data: { outcome: "verified", verified: true, bin_id: binId, completed, timeline_changed: false, audio_requested: plan.mode !== "markers", audio_preservation_verified: false, verification_scope: "Existing source-marker/subclip/bin structural readback; source cut classification, audio contents and audible review remain separate." } };
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error), data: { outcome: completed.length ? "committed_unverified" : "unknown", completed, bin_id: binId, retry_safe: false, rollback_attempted: false } }; }
      },
    },
  };
}
