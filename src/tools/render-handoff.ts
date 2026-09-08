import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { sendAfterEffectsCommand } from "../bridge/after-effects-bridge.js";
import { buildAfterEffectsScript } from "../bridge/after-effects-script-builder.js";
import { sendCommand, type BridgeOptions, type CommandResult } from "../bridge/file-bridge.js";
import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { type CapabilityConfig, createOperationId, requireCapability, resolveCapabilities } from "../security/index.js";

interface Plan {
  workspace: string;
  outputPath: string;
  aeProjectPath: string;
  premiereProjectPath: string;
  queueItemIndex: number;
  targetBinId: string;
  fingerprint: string;
  projectId: string;
  binName: string;
  compositionId: string;
}

interface Dependencies {
  capabilities?: CapabilityConfig;
  sendAfterEffects?: typeof sendAfterEffectsCommand;
  sendPremiere?: typeof sendCommand;
  now?: () => number;
}

function inputObject(args: unknown, keys: string[]): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  for (const key of Object.keys(args)) if (!keys.includes(key)) throw new Error(`Unsupported field: ${key}`);
  return args as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096 || /[\x00-\x1f]/.test(value)) throw new Error(`Invalid ${field}`);
  return value;
}

function contained(root: string, candidate: string): string {
  if (!path.isAbsolute(candidate)) throw new Error("Paths must be absolute");
  const resolved = realpathSync(candidate);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Path must remain inside approved_workspace_path after resolving links");
  return resolved;
}

function fingerprint(plan: Pick<Plan, "workspace" | "outputPath" | "aeProjectPath" | "premiereProjectPath">): string {
  for (const candidate of [plan.outputPath, plan.aeProjectPath, plan.premiereProjectPath]) {
    if (contained(plan.workspace, candidate) !== candidate) throw new Error("A previewed path changed; preview again");
    if (!statSync(candidate).isFile()) throw new Error("Handoff paths must be regular files");
  }
  const stat = statSync(plan.outputPath, { bigint: true });
  if (stat.size <= 0n) throw new Error("Rendered media must be nonempty");
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}

const literal = (value: string) => `"${escapeForExtendScript(value)}"`;

function aeScript(plan: Plan): string {
  return buildAfterEffectsScript(`
    if (!app.project || !app.project.file || app.project.file.fsName !== new File(${literal(plan.aeProjectPath)}).fsName) return __aeError("The source After Effects project changed");
    if (app.project.renderQueue.rendering) return __aeError("Wait for After Effects rendering to finish");
    if (app.project.renderQueue.numItems < ${plan.queueItemIndex}) return __aeError("The render queue item no longer exists");
    var item = app.project.renderQueue.item(${plan.queueItemIndex});
    if (item.status !== RQItemStatus.DONE) return __aeError("The requested render has not completed successfully");
    if (item.numOutputModules !== 1) return __aeError("Only single-output renders are supported");
    var output = item.outputModule(1).file;
    if (!output || output.fsName !== new File(${literal(plan.outputPath)}).fsName || !output.exists) return __aeError("The render output does not match the approved media");
    ${plan.compositionId ? `if (String(item.comp.id) !== ${literal(plan.compositionId)}) return __aeError("The previewed composition changed");` : ""}
    return __aeResult({ renderComplete: true, compositionId: String(item.comp.id) });
  `);
}

function premiereScript(plan: Plan, apply: boolean): string {
  return buildToolScript(`
    var project = app.project;
    if (!project || !project.path || new File(project.path).fsName !== new File(${literal(plan.premiereProjectPath)}).fsName) return __error("The target Premiere project changed");
    ${apply ? `if (String(project.documentID) !== ${literal(plan.projectId)}) return __error("The target project identity changed");` : ""}
    var target = __findProjectItem(${literal(plan.targetBinId)});
    if (!target || String(target.nodeId) !== ${literal(plan.targetBinId)} || target.type !== 2) return __error("The exact target bin no longer exists");
    ${apply ? `if (String(target.name) !== ${literal(plan.binName)}) return __error("The target bin was renamed; preview again");` : ""}
    var media = new File(${literal(plan.outputPath)});
    if (!media.exists) return __error("The rendered media no longer exists");
    function matches(item) {
      return item && item.getMediaPath && item.getMediaPath() && new File(item.getMediaPath()).fsName === media.fsName;
    }
    var before = {};
    for (var i = 0; i < target.children.numItems; i++) {
      var child = target.children[i];
      if (matches(child)) return __error("The rendered media is already in the target bin; inspect it instead of importing again");
      before[String(child.nodeId)] = true;
    }
    ${apply ? `
      var accepted = project.importFiles([media.fsName], true, target, false);
      var importedIds = [];
      for (var j = 0; j < target.children.numItems; j++) {
        var added = target.children[j];
        if (!before[String(added.nodeId)] && matches(added)) importedIds.push(String(added.nodeId));
      }
      if (importedIds.length !== 1) return __error("Import was attempted but exact output readback failed. Inspect the target bin before retrying; no rollback was attempted");
      return __result({ importVerified: true, importAccepted: accepted === true, projectItemId: importedIds[0], timelineChanged: false, visualVerified: false });
    ` : `return __result({ projectId: String(project.documentID), binName: String(target.name) });`}
  `);
}

function data(result: CommandResult): Record<string, unknown> {
  if (!result.success) throw new Error(result.error || "Host check failed");
  if (!result.data || typeof result.data !== "object") throw new Error("Host returned no evidence");
  return result.data as Record<string, unknown>;
}

export function getRenderHandoffTools(options: BridgeOptions, dependencies: Dependencies = {}) {
  const capabilities = dependencies.capabilities ?? resolveCapabilities();
  const ae = dependencies.sendAfterEffects ?? sendAfterEffectsCommand;
  const premiere = dependencies.sendPremiere ?? sendCommand;
  const now = dependencies.now ?? Date.now;
  const plans = new Map<string, { plan: Plan; expiresAt: number }>();
  const keys = ["approved_workspace_path", "output_path", "ae_project_path", "premiere_project_path", "queue_item_index", "target_bin_id"];
  return {
    preview_after_effects_render_handoff: {
      description: "Preview import of one completed After Effects single-file render into an existing Premiere bin. Reads both connected hosts and binds approval to file metadata and project/bin identity. Does not render, import, or edit a timeline.",
      parameters: { type: "object" as const, additionalProperties: false, properties: {
        approved_workspace_path: { type: "string", description: "Existing absolute workspace containing both saved projects and the rendered media." },
        output_path: { type: "string", description: "Existing completed .mov, .mp4, .mxf, .avi or .wav render; image sequences are not supported." },
        ae_project_path: { type: "string", description: "Exact open, saved After Effects project path." },
        premiere_project_path: { type: "string", description: "Exact open, saved Premiere project path." },
        queue_item_index: { type: "integer", minimum: 1, maximum: 10000, description: "One-based AE render queue item index, as returned by enqueue_after_effects_render." },
        target_bin_id: { type: "string", description: "Exact node ID of an existing destination bin, never a name." },
      }, required: keys },
      handler: async (args: unknown) => {
        const operationId = createOperationId();
        requireCapability(capabilities, "inspect", operationId);
        requireCapability(capabilities, "filesystem", operationId);
        const input = inputObject(args, keys);
        const root = text(input.approved_workspace_path, "approved_workspace_path");
        if (!path.isAbsolute(root)) throw new Error("Workspace must be absolute");
        const workspace = realpathSync(root);
        if (!statSync(workspace).isDirectory()) throw new Error("Workspace must be a directory");
        const index = input.queue_item_index;
        if (typeof index !== "number" || !Number.isInteger(index) || index < 1 || index > 10000) throw new Error("Invalid queue_item_index");
        const plan: Plan = {
          workspace, outputPath: contained(workspace, text(input.output_path, "output_path")),
          aeProjectPath: contained(workspace, text(input.ae_project_path, "ae_project_path")),
          premiereProjectPath: contained(workspace, text(input.premiere_project_path, "premiere_project_path")),
          queueItemIndex: index, targetBinId: text(input.target_bin_id, "target_bin_id"),
          fingerprint: "", projectId: "", binName: "", compositionId: "",
        };
        if (!/\.(mov|mp4|mxf|avi|wav)$/i.test(plan.outputPath)) throw new Error("Unsupported rendered media extension");
        plan.fingerprint = fingerprint(plan);
        const render = data(await ae(aeScript(plan), options));
        if (render.renderComplete !== true) throw new Error("After Effects did not confirm render completion");
        plan.compositionId = text(render.compositionId, "compositionId");
        const target = data(await premiere(premiereScript(plan, false), options));
        plan.projectId = text(target.projectId, "projectId");
        plan.binName = text(target.binName, "binName");
        if (fingerprint(plan) !== plan.fingerprint) throw new Error("Rendered media changed during preview");
        for (const [token, entry] of plans) if (entry.expiresAt <= now()) plans.delete(token);
        if (plans.size >= 100) throw new Error("Too many pending handoff previews; wait for expiry");
        const previewToken = randomUUID();
        plans.set(previewToken, { plan, expiresAt: now() + 600000 });
        return { success: true, data: { operationId, previewToken, expiresInSeconds: 600, plan,
          verificationScope: "AE reports DONE and the local file is nonempty. File metadata is bound to approval; this is not a content hash or visual/media-decode validation. Confirmation imports into the shown bin only." } };
      },
    },
    apply_after_effects_render_handoff: {
      description: "Import exactly one previewed completed AE render into its approved Premiere bin after rechecking both hosts and file metadata. Requires confirmation and consumes the token before dispatch. Does not save, render, or change a timeline.",
      parameters: { type: "object" as const, additionalProperties: false, properties: {
        preview_token: { type: "string", description: "One-time ten-minute token from preview_after_effects_render_handoff." },
        confirm_import: { type: "boolean", description: "Must be true after reviewing the exact file and destination." },
      }, required: ["preview_token", "confirm_import"] },
      handler: async (args: unknown) => {
        const operationId = createOperationId();
        requireCapability(capabilities, "inspect", operationId);
        requireCapability(capabilities, "edit", operationId);
        requireCapability(capabilities, "filesystem", operationId);
        const input = inputObject(args, ["preview_token", "confirm_import"]);
        if (input.confirm_import !== true) throw new Error("confirm_import must be true");
        const token = text(input.preview_token, "preview_token");
        const entry = plans.get(token);
        plans.delete(token);
        if (!entry || entry.expiresAt <= now()) throw new Error("Preview token missing, expired, or already used; preview again");
        let stage = "file_recheck";
        try {
          const { plan } = entry;
          if (fingerprint(plan) !== plan.fingerprint) throw new Error("Rendered media changed; preview again");
          stage = "after_effects_recheck";
          const render = data(await ae(aeScript(plan), options));
          if (render.renderComplete !== true || render.compositionId !== plan.compositionId) throw new Error("Render evidence changed");
          if (fingerprint(plan) !== plan.fingerprint) throw new Error("Rendered media changed during host recheck");
          stage = "premiere_import";
          const receipt = data(await premiere(premiereScript(plan, true), options));
          if (receipt.importVerified !== true || typeof receipt.projectItemId !== "string" || !receipt.projectItemId) throw new Error("Premiere returned no verified import receipt");
          return { success: true, data: { ...receipt, operationId, stage: "complete", timelineChanged: false, visualVerified: false } };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error), data: {
            operationId, failedStage: stage, importMayHaveOccurred: stage === "premiere_import", rollbackAttempted: false,
            nextStep: stage === "premiere_import" ? "Inspect the target bin before any new preview; do not retry the consumed token." : "Resolve the failed prerequisite and preview again.",
          } };
        }
      },
    },
  };
}
