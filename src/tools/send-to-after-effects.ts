import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { sendAfterEffectsCommand } from "../bridge/after-effects-bridge.js";
import { buildAfterEffectsScript, escapeForAfterEffects } from "../bridge/after-effects-script-builder.js";
import { sendCommand, type BridgeOptions, type CommandResult } from "../bridge/file-bridge.js";
import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { type CapabilityConfig, createOperationId, requireCapability, resolveCapabilities } from "../security/index.js";
import { getTimelineTools } from "./timeline.js";

/**
 * Premiere -> After Effects, like Premiere's "Replace with After Effects
 * Composition": build a comp from one timeline clip's source range in the open
 * AE project, import it back over Dynamic Link and swap it in at the clip's
 * exact span. Measured on Premiere 26.5.2 / AE 26.5: a comp whose footage layer
 * has audio disabled imports as a video-only Dynamic Link item, which
 * replace_clip accepts on a video track; the original's linked audio stays.
 */

const TICKS_PER_SECOND = 254016000000;

interface ClipEvidence {
  projectPath: string;
  projectId: string;
  sequenceId: string;
  nodeId: string;
  trackIndex: number;
  startTicks: string;
  endTicks: string;
  inTicks: string;
  clipName: string;
  itemId: string;
  mediaPath: string;
  width: number;
  height: number;
  pixelAspect: number;
  frameTicks: string;
  effectsNotCarried: string[];
}

interface Plan extends ClipEvidence {
  workspace: string;
  aeProjectPath: string;
  targetBinId: string;
  compName: string;
  inSeconds: number;
  durationSeconds: number;
  frameRate: number;
}

interface Dependencies {
  capabilities?: CapabilityConfig;
  sendAfterEffects?: typeof sendAfterEffectsCommand;
  sendPremiere?: typeof sendCommand;
  replaceClip?: (args: { node_id: string; new_item_id: string }) => Promise<CommandResult>;
  now?: () => number;
}

function inputObject(args: unknown, keys: string[]): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  for (const key of Object.keys(args)) if (!keys.includes(key)) throw new Error(`Unsupported field: ${key}`);
  return args as Record<string, unknown>;
}

function text(value: unknown, field: string, max = 4096): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) throw new Error(`Invalid ${field}`);
  return value;
}

function contained(root: string, candidate: string): string {
  if (!path.isAbsolute(candidate)) throw new Error("Paths must be absolute");
  const resolved = realpathSync(candidate);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("ae_project_path must remain inside approved_workspace_path after resolving links");
  if (!statSync(resolved).isFile() || !/\.aep$/i.test(resolved)) throw new Error("ae_project_path must be a saved .aep file");
  return resolved;
}

function data(result: CommandResult): Record<string, unknown> {
  if (!result.success) throw new Error(result.error || "Host check failed");
  if (!result.data || typeof result.data !== "object") throw new Error("Host returned no evidence");
  return result.data as Record<string, unknown>;
}

const pp = (value: string) => `"${escapeForExtendScript(value)}"`;
const ae = (value: string) => `"${escapeForAfterEffects(value)}"`;

/** Reads the clip, its source and the sequence; with `plan` it also requires them unchanged. */
function premiereClipScript(nodeId: string, plan?: Plan): string {
  return buildToolScript(`
    var project = app.project;
    var seq = project ? project.activeSequence : null;
    if (!seq) return __error("No active sequence");
    var found = __findClip(${pp(nodeId)});
    if (!found) return __error("Clip not found: ${escapeForExtendScript(nodeId)}");
    if (found.trackType !== "video") return __error("Only a video clip can be sent to After Effects; its linked audio stays in Premiere");
    var clip = found.clip;
    var item = clip.projectItem;
    if (!item) return __error("The clip has no source project item");
    var mediaPath = "";
    try { mediaPath = item.getMediaPath ? String(item.getMediaPath()) : ""; } catch (mediaError) {}
    if (!mediaPath) return __error("Only clips from a media file can be sent; this clip's source has no file path");
    var lower = mediaPath.toLowerCase();
    if (lower.slice(-4) === ".aep" || lower.slice(-7) === ".prproj" || lower.slice(-6) === ".mogrt") return __error("The clip is already a linked composition, sequence or graphic; send its source media instead");
    if (!new File(mediaPath).exists) return __error("The clip's source media is offline");
    var speed = 1, reversed = false;
    try { if (clip.getSpeed) speed = clip.getSpeed(); if (clip.isSpeedReversed) reversed = clip.isSpeedReversed(); } catch (speedError) {}
    if (speed !== 1 || reversed) return __error("Speed-changed or reversed clips are not sent, so the comp cannot drift from the edit; reset speed to 100% first");
    var settings = seq.getSettings();
    var par = 1;
    try {
      var rawPar = String(settings.videoPixelAspectRatio);
      var colon = rawPar.indexOf(":");
      par = colon > 0 ? parseFloat(rawPar.slice(0, colon)) / parseFloat(rawPar.slice(colon + 1)) : parseFloat(rawPar);
      if (!(par > 0)) par = 1;
    } catch (parError) { par = 1; }
    // Anything beyond default Motion and Opacity stays on the Premiere clip and is lost by the swap.
    var notCarried = [];
    for (var ci = 0; ci < clip.components.numItems; ci++) {
      var component = clip.components[ci];
      var match = String(component.matchName);
      if (match === "AE.ADBE Opacity") {
        for (var op = 0; op < component.properties.numItems; op++) {
          var opProp = component.properties[op];
          if (String(opProp.displayName) === "Opacity" && (opProp.isTimeVarying() || Math.abs(Number(opProp.getValue()) - 100) > 0.001)) notCarried.push("Opacity");
        }
      } else if (match === "AE.ADBE Motion") {
        var changed = false;
        for (var mp = 0; mp < component.properties.numItems; mp++) {
          var motionProp = component.properties[mp];
          var label = String(motionProp.displayName);
          var value = null;
          try { if (motionProp.isTimeVarying()) { changed = true; continue; } value = motionProp.getValue(); } catch (motionError) { continue; }
          if ((label === "Position" || label === "Anchor Point") && value && value.length === 2 && (Math.abs(value[0] - 0.5) > 0.0001 || Math.abs(value[1] - 0.5) > 0.0001)) changed = true;
          if ((label === "Scale" || label === "Scale Width") && Math.abs(Number(value) - 100) > 0.001) changed = true;
          if (label === "Rotation" && Math.abs(Number(value)) > 0.001) changed = true;
        }
        if (changed) notCarried.push("Motion");
      } else if (match !== "AE.ADBE Time Remapping") {
        notCarried.push(String(component.displayName));
      }
    }
    var evidence = {
      projectPath: String(project.path), projectId: String(project.documentID), sequenceId: String(seq.sequenceID),
      nodeId: String(clip.nodeId), trackIndex: found.trackIndex, startTicks: String(clip.start.ticks), endTicks: String(clip.end.ticks),
      inTicks: String(clip.inPoint.ticks), clipName: String(clip.name), itemId: String(item.nodeId), mediaPath: new File(mediaPath).fsName,
      width: Number(seq.frameSizeHorizontal), height: Number(seq.frameSizeVertical), pixelAspect: par,
      frameTicks: String(settings.videoFrameRate.ticks), effectsNotCarried: notCarried
    };
    ${plan ? `
    var keys = ["projectPath", "projectId", "sequenceId", "nodeId", "startTicks", "endTicks", "inTicks", "itemId", "mediaPath", "frameTicks"];
    var expected = { projectPath: ${pp(plan.projectPath)}, projectId: ${pp(plan.projectId)}, sequenceId: ${pp(plan.sequenceId)}, nodeId: ${pp(plan.nodeId)}, startTicks: ${pp(plan.startTicks)}, endTicks: ${pp(plan.endTicks)}, inTicks: ${pp(plan.inTicks)}, itemId: ${pp(plan.itemId)}, mediaPath: ${pp(plan.mediaPath)}, frameTicks: ${pp(plan.frameTicks)} };
    for (var ki = 0; ki < keys.length; ki++) if (String(evidence[keys[ki]]) !== expected[keys[ki]]) return __error("The previewed clip changed (" + keys[ki] + "); preview again. Nothing was changed.");
    if (evidence.effectsNotCarried.join("|") !== ${pp(plan.effectsNotCarried.join("|"))}) return __error("The clip's effects changed since preview; preview again. Nothing was changed.");
    ` : ""}
    return __result(evidence);
  `);
}

function aeProjectScript(plan: Pick<Plan, "aeProjectPath">, body: string): string {
  return buildAfterEffectsScript(`
    if (!app.project || !app.project.file || app.project.file.fsName !== new File(${ae(plan.aeProjectPath)}).fsName) return __aeError("Open and save the approved After Effects project first");
    if (app.project.renderQueue.rendering) return __aeError("Wait for After Effects rendering to finish");
    ${body}
  `);
}

function aeNameScript(plan: Pick<Plan, "aeProjectPath">, base: string): string {
  return aeProjectScript(plan, `
    var base = ${ae(base)}, taken = {};
    for (var i = 1; i <= app.project.numItems; i++) taken[String(app.project.item(i).name)] = true;
    var name = base, n = 2;
    while (taken[name] && n < 1000) { name = base + " " + (n < 10 ? "0" : "") + n; n++; }
    if (taken[name]) return __aeError("Could not find a free composition name");
    return __aeResult({ compName: name });
  `);
}

function aeBuildScript(plan: Plan): string {
  return aeProjectScript(plan, `
    for (var i = 1; i <= app.project.numItems; i++) if (String(app.project.item(i).name) === ${ae(plan.compName)}) return __aeError("A composition named " + ${ae(plan.compName)} + " already exists; preview again");
    var media = new File(${ae(plan.mediaPath)});
    if (!media.exists) return __aeError("The source media is not reachable from After Effects");
    app.beginUndoGroup("Send clip from Premiere");
    var footage = null;
    for (var f = 1; f <= app.project.numItems && !footage; f++) {
      var candidate = app.project.item(f);
      if (candidate instanceof FootageItem && candidate.file && candidate.file.fsName === media.fsName) footage = candidate;
    }
    var importedFootage = false;
    if (!footage) { footage = app.project.importFile(new ImportOptions(media)); importedFootage = true; }
    var comp = app.project.items.addComp(${ae(plan.compName)}, ${plan.width}, ${plan.height}, ${plan.pixelAspect}, ${plan.durationSeconds}, ${plan.frameRate});
    var layer = comp.layers.add(footage);
    layer.startTime = ${-plan.inSeconds};
    if (layer.hasAudio) layer.audioEnabled = false;
    app.endUndoGroup();
    app.project.save();
    return __aeResult({ compId: String(comp.id), compName: String(comp.name), duration: comp.duration, frameRate: comp.frameRate,
      width: comp.width, height: comp.height, layerStart: layer.startTime, sourcePath: layer.source.file.fsName, importedFootage: importedFootage,
      audioEnabled: layer.hasAudio ? layer.audioEnabled : false, saved: true });
  `);
}

function premiereImportScript(plan: Plan): string {
  return buildToolScript(`
    var project = app.project;
    if (!project || String(project.documentID) !== ${pp(plan.projectId)}) return __error("The Premiere project changed; nothing was imported");
    var bin = ${plan.targetBinId ? `__findProjectItem(${pp(plan.targetBinId)})` : "project.rootItem"};
    if (!bin || !bin.children) return __error("The target bin no longer exists; nothing was imported");
    var before = {};
    for (var b = 0; b < bin.children.numItems; b++) before[String(bin.children[b].nodeId)] = true;
    var aep = new File(${pp(plan.aeProjectPath)});
    try { project.importAEComps(aep.fsName, [${pp(plan.compName)}], bin); } catch (importError) { return __error("Premiere could not import the composition: " + importError.toString(), { mutationOutcome: "unknown", timelineChanged: false }); }
    var item = null, extra = 0;
    for (var a = 0; a < bin.children.numItems; a++) {
      var added = bin.children[a];
      if (before[String(added.nodeId)]) continue;
      var addedPath = "";
      try { addedPath = String(added.getMediaPath()); } catch (pathError) {}
      if (String(added.name).indexOf(${pp(`${plan.compName}/`)}) === 0 && addedPath && new File(addedPath).fsName === aep.fsName) item = added; else extra++;
    }
    if (!item) return __error("The composition import could not be read back; inspect the bin before retrying", { mutationOutcome: "unknown", timelineChanged: false });
    var videoIn = item.getInPoint(1).seconds, videoOut = item.getOutPoint(1).seconds, audioSpan = 0;
    try { audioSpan = item.getOutPoint(2).seconds - item.getInPoint(2).seconds; } catch (audioError) {}
    return __result({ itemId: String(item.nodeId), itemName: String(item.name), videoIn: videoIn, videoOut: videoOut, audioSpan: audioSpan, unexpectedItems: extra });
  `);
}

export function getSendToAfterEffectsTools(options: BridgeOptions, dependencies: Dependencies = {}) {
  const capabilities = dependencies.capabilities ?? resolveCapabilities();
  const sendAe = dependencies.sendAfterEffects ?? sendAfterEffectsCommand;
  const premiere = dependencies.sendPremiere ?? sendCommand;
  const replaceClip = dependencies.replaceClip ?? ((args) => getTimelineTools(options).replace_clip.handler(args) as Promise<CommandResult>);
  const now = dependencies.now ?? Date.now;
  const plans = new Map<string, { plan: Plan; expiresAt: number }>();
  const previewKeys = ["node_id", "ae_project_path", "approved_workspace_path", "target_bin_id", "comp_name"];
  return {
    preview_send_clip_to_after_effects: {
      description: "Preview sending one video timeline clip to After Effects, like Premiere's Replace with After Effects Composition. Reads the clip, its source media and the sequence, and the open saved AE project. Refuses speed-changed, reversed, offline or non-file clips. Lists effects and Motion/Opacity changes on the clip that the swap would not carry over. Changes nothing; returns a ten-minute token for apply_send_clip_to_after_effects.",
      parameters: { type: "object" as const, additionalProperties: false, properties: {
        node_id: { type: "string", description: "Node ID of the video clip on the active sequence." },
        ae_project_path: { type: "string", description: "The After Effects project open in AE, saved to disk. The comp is added to it and it is saved." },
        approved_workspace_path: { type: "string", description: "Existing absolute folder that must contain ae_project_path." },
        target_bin_id: { type: "string", description: "Optional node ID of the Premiere bin for the linked comp (default: project root)." },
        comp_name: { type: "string", maxLength: 255, description: "Optional composition name (default: '<clip name> Linked Comp'); a number is added if it is taken." },
      }, required: ["node_id", "ae_project_path", "approved_workspace_path"] },
      handler: async (args: unknown) => {
        const operationId = createOperationId();
        requireCapability(capabilities, "inspect", operationId);
        requireCapability(capabilities, "filesystem", operationId);
        const input = inputObject(args, previewKeys);
        const root = text(input.approved_workspace_path, "approved_workspace_path");
        if (!path.isAbsolute(root)) throw new Error("approved_workspace_path must be absolute");
        const workspace = realpathSync(root);
        if (!statSync(workspace).isDirectory()) throw new Error("approved_workspace_path must be a directory");
        const aeProjectPath = contained(workspace, text(input.ae_project_path, "ae_project_path"));
        const nodeId = text(input.node_id, "node_id", 512);
        const targetBinId = input.target_bin_id === undefined ? "" : text(input.target_bin_id, "target_bin_id", 512);
        const requestedName = input.comp_name === undefined ? "" : text(input.comp_name, "comp_name", 255);
        const clip = data(await premiere(premiereClipScript(nodeId), options)) as unknown as ClipEvidence;
        const frameTicks = Number(clip.frameTicks);
        const start = Number(clip.startTicks), end = Number(clip.endTicks), inTicks = Number(clip.inTicks);
        if (!(frameTicks > 0) || !(end > start) || !(inTicks >= 0)) throw new Error("The clip or sequence timing could not be read");
        const frameRate = Math.round((TICKS_PER_SECOND / frameTicks) * 1000) / 1000;
        const frames = Math.round((end - start) / frameTicks);
        const base = requestedName || `${clip.clipName.slice(0, 200)} Linked Comp`;
        const naming = data(await sendAe(aeNameScript({ aeProjectPath }, base), options));
        const plan: Plan = { ...clip, workspace, aeProjectPath, targetBinId, compName: text(naming.compName, "compName", 255),
          inSeconds: inTicks / TICKS_PER_SECOND, durationSeconds: frames / frameRate, frameRate };
        for (const [token, entry] of plans) if (entry.expiresAt <= now()) plans.delete(token);
        if (plans.size >= 100) throw new Error("Too many pending previews; wait for expiry");
        const previewToken = randomUUID();
        plans.set(previewToken, { plan, expiresAt: now() + 600000 });
        return { success: true, data: { operationId, previewToken, expiresInSeconds: 600,
          plan: { clip: { nodeId: plan.nodeId, name: plan.clipName, trackIndex: plan.trackIndex, startSeconds: start / TICKS_PER_SECOND, endSeconds: end / TICKS_PER_SECOND, sourceInSeconds: plan.inSeconds, sourceMedia: plan.mediaPath },
            composition: { name: plan.compName, width: plan.width, height: plan.height, pixelAspect: plan.pixelAspect, frameRate, durationSeconds: plan.durationSeconds },
            aeProjectPath, targetBin: targetBinId || "project root", effectsNotCarried: plan.effectsNotCarried },
          warnings: plan.effectsNotCarried.length ? [`These stay on the original clip and are not on the linked comp clip: ${plan.effectsNotCarried.join(", ")}. Recreate them in After Effects or on the new clip.`] : [],
          verificationScope: "Reads only. Apply rechecks the clip, adds the comp to the AE project and saves it, imports it into Premiere over Dynamic Link and swaps it in with replace_clip." } };
      },
    },
    apply_send_clip_to_after_effects: {
      description: "Send the previewed clip to After Effects: recheck the clip, add a comp with its exact source range (footage layer audio off) to the open AE project and save it, import the comp into Premiere over Dynamic Link, then replace the clip with it at the same timeline span. The original's linked audio stays. Requires confirmation; the token is single-use. A failure after the AE save leaves the comp in AE and reports where it stopped.",
      parameters: { type: "object" as const, additionalProperties: false, properties: {
        preview_token: { type: "string", description: "One-time token from preview_send_clip_to_after_effects." },
        confirm_send: { type: "boolean", description: "Must be true after reviewing the plan and any effects that will not carry over." },
      }, required: ["preview_token", "confirm_send"] },
      handler: async (args: unknown) => {
        const operationId = createOperationId();
        requireCapability(capabilities, "inspect", operationId);
        requireCapability(capabilities, "edit", operationId);
        requireCapability(capabilities, "filesystem", operationId);
        const input = inputObject(args, ["preview_token", "confirm_send"]);
        if (input.confirm_send !== true) throw new Error("confirm_send must be true");
        const token = text(input.preview_token, "preview_token");
        const entry = plans.get(token);
        plans.delete(token);
        if (!entry || entry.expiresAt <= now()) throw new Error("Preview token missing, expired, or already used; preview again");
        const { plan } = entry;
        let stage = "premiere_recheck";
        const partial: Record<string, unknown> = {};
        try {
          data(await premiere(premiereClipScript(plan.nodeId, plan), options));
          stage = "after_effects_comp";
          const comp = data(await sendAe(aeBuildScript(plan), options));
          partial.composition = comp;
          if (comp.compName !== plan.compName || comp.saved !== true) throw new Error("After Effects did not confirm the saved composition");
          stage = "premiere_import";
          const imported = data(await premiere(premiereImportScript(plan), options));
          partial.import = imported;
          if (typeof imported.itemId !== "string" || !imported.itemId) throw new Error("Premiere returned no imported item");
          if (Number(imported.audioSpan) > 0) throw new Error("The linked comp carries audio, so it cannot replace a video-only span; inspect the comp's audio");
          stage = "replace_clip";
          const replaced = await replaceClip({ node_id: plan.nodeId, new_item_id: imported.itemId });
          if (!replaced.success) throw new Error(replaced.error || "replace_clip failed");
          const replaceData = (replaced.data ?? {}) as Record<string, unknown>;
          return { success: true, data: { operationId, stage: "complete", outcome: replaceData.outcome === "verified" ? "verified" : "committed_unverified",
            composition: { id: comp.compId, name: comp.compName, aeProjectPath: plan.aeProjectPath }, linkedItemId: imported.itemId,
            replace: replaceData, effectsNotCarried: plan.effectsNotCarried, timelineChanged: true, visualVerified: false } };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error), data: {
            operationId, failedStage: stage, ...partial, timelineChanged: stage === "replace_clip" ? null : false,
            mutationOutcome: stage === "premiere_recheck" ? "not_applied" : "unknown",
            nextStep: stage === "premiere_recheck" ? "Preview again." : stage === "replace_clip"
              ? "The comp is in After Effects and in the Premiere bin; inspect the timeline, then use replace_clip with the linked item if the clip was not swapped."
              : "Inspect the After Effects project and the Premiere bin before any new preview; nothing is rolled back.",
          } };
        }
      },
    },
  };
}
