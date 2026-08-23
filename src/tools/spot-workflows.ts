import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
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

type WorkflowKind = "motion_graphics_demo" | "product_spot" | "brand_spot";
type MotionStyle = "none" | "push_in" | "pull_out" | "alternate" | "demo";

interface TransitionSpec {
  name: string;
  duration_seconds: number;
}

interface MogrtSpec {
  path: string;
  approved_workspace_path: string;
  title_track_index: number;
  title_start_seconds: number;
}

export interface SpotWorkflowPlan {
  schema_version: 1;
  workflow: WorkflowKind;
  sequence_id: string;
  asset_item_ids: string[];
  clip_duration_seconds: number;
  video_track_index: number;
  audio_track_index: number;
  motion_style: MotionStyle;
  transition?: TransitionSpec;
  mogrt?: MogrtSpec;
}

export interface SpotWorkflowDependencies {
  capabilities?: CapabilityConfig;
  auditSink?: AuditSink;
  operationIdFactory?: () => string;
  fileExists?: (value: string) => boolean;
}

const MAX_ASSETS = 12;
const MAX_TEXT = 512;
const MAX_PATH = 4096;

function text(value: unknown, field: string, maxLength = MAX_TEXT): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${field} must be at most ${maxLength} characters`);
  return normalized;
}

function optionalText(value: unknown, field: string, maxLength = MAX_TEXT): string | undefined {
  return value === undefined ? undefined : text(value, field, maxLength);
}

function positiveNumber(value: unknown, field: string, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new Error(`${field} must be a finite number greater than 0 and at most ${maximum}`);
  }
  return value;
}

function nonNegativeNumber(value: unknown, field: string, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new Error(`${field} must be a finite number between 0 and ${maximum}`);
  }
  return value;
}

function trackIndex(value: unknown, field: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 32) {
    throw new Error(`${field} must be an integer between 0 and 32`);
  }
  return value;
}

function assetItemIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ASSETS) {
    throw new Error(`asset_item_ids must contain between 1 and ${MAX_ASSETS} project item IDs`);
  }
  return value.map((item, index) => text(item, `asset_item_ids[${index}]`, 256));
}

function motionStyle(value: unknown, fallback: MotionStyle): MotionStyle {
  if (value === undefined) return fallback;
  if (value === "none" || value === "push_in" || value === "pull_out" || value === "alternate") return value;
  throw new Error("motion_style must be one of none, push_in, pull_out, or alternate");
}

function transition(value: unknown, duration: unknown, fallbackName: string, fallbackDuration: number): TransitionSpec | undefined {
  const name = optionalText(value, "transition_name", 128) ?? fallbackName;
  if (name.toLowerCase() === "none") return undefined;
  return {
    name,
    duration_seconds: positiveNumber(duration, "transition_duration_seconds", fallbackDuration, 10),
  };
}

function isAbsolutePortable(value: string): boolean {
  return path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

function isWithinApprovedWorkspace(approvedWorkspacePath: string, candidatePath: string): boolean {
  // Plans can be created on Windows and later inspected on macOS (or vice versa),
  // so do not let the runner's host OS reinterpret a Windows absolute path as a
  // relative POSIX path. Mixed path families are not contained by definition.
  const windowsPaths = path.win32.isAbsolute(approvedWorkspacePath) && path.win32.isAbsolute(candidatePath);
  const posixPaths = path.posix.isAbsolute(approvedWorkspacePath) && path.posix.isAbsolute(candidatePath);
  if (!windowsPaths && !posixPaths) return false;
  const pathApi = windowsPaths ? path.win32 : path.posix;
  const root = pathApi.resolve(approvedWorkspacePath);
  const candidate = pathApi.resolve(candidatePath);
  const relative = pathApi.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative);
}

function mogrt(value: Record<string, unknown>, videoTrackIndex: number): MogrtSpec | undefined {
  const mogrtPath = optionalText(value.mogrt_path, "mogrt_path", MAX_PATH);
  if (!mogrtPath) return undefined;
  if (!/\.mogrt$/i.test(mogrtPath)) throw new Error("mogrt_path must point to a .mogrt file");
  const approvedWorkspacePath = text(value.approved_workspace_path, "approved_workspace_path", MAX_PATH);
  if (!isAbsolutePortable(mogrtPath) || !isAbsolutePortable(approvedWorkspacePath)) {
    throw new Error("mogrt_path and approved_workspace_path must be absolute paths");
  }
  if (!isWithinApprovedWorkspace(approvedWorkspacePath, mogrtPath)) {
    throw new Error("mogrt_path must be within approved_workspace_path");
  }
  const titleTrackIndex = trackIndex(value.title_track_index, "title_track_index", 1);
  if (titleTrackIndex === videoTrackIndex) {
    throw new Error("title_track_index must differ from video_track_index so the branding overlay remains separate from the edit");
  }
  return {
    path: mogrtPath,
    approved_workspace_path: approvedWorkspacePath,
    title_track_index: titleTrackIndex,
    title_start_seconds: nonNegativeNumber(value.title_start_seconds, "title_start_seconds", 0.4, 36000),
  };
}

function rawObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function assertOnlyKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`${field} contains unsupported field: ${key}`);
  }
}

function buildPlan(workflow: WorkflowKind, value: unknown): SpotWorkflowPlan {
  const input = rawObject(value, "arguments");
  const baseKeys = [
    "sequence_id", "asset_item_ids", "clip_duration_seconds", "video_track_index", "audio_track_index",
    "motion_style", "transition_name", "transition_duration_seconds",
  ];
  const brandKeys = [...baseKeys, "mogrt_path", "approved_workspace_path", "title_track_index", "title_start_seconds"];
  assertOnlyKeys(input, workflow === "brand_spot" ? brandKeys : baseKeys, "arguments");

  const videoTrackIndex = trackIndex(input.video_track_index, "video_track_index", 0);
  const plan: SpotWorkflowPlan = {
    schema_version: 1,
    workflow,
    sequence_id: text(input.sequence_id, "sequence_id", 256),
    asset_item_ids: assetItemIds(input.asset_item_ids),
    clip_duration_seconds: positiveNumber(input.clip_duration_seconds, "clip_duration_seconds", workflow === "motion_graphics_demo" ? 5 : 4, 300),
    video_track_index: videoTrackIndex,
    audio_track_index: trackIndex(input.audio_track_index, "audio_track_index", 0),
    motion_style: workflow === "motion_graphics_demo" ? "demo" : motionStyle(input.motion_style, "alternate"),
    transition: transition(input.transition_name, input.transition_duration_seconds, "Cross Dissolve", workflow === "motion_graphics_demo" ? 0.75 : 0.5),
  };
  if (workflow === "brand_spot") {
    const overlay = mogrt(input, videoTrackIndex);
    if (overlay) plan.mogrt = overlay;
  }
  return plan;
}

/** Reconstruct a bounded, canonical plan before deriving its confirmation token. */
export function validateSpotWorkflowPlan(value: unknown): SpotWorkflowPlan {
  const raw = rawObject(value, "plan");
  assertOnlyKeys(raw, [
    "schema_version", "workflow", "sequence_id", "asset_item_ids", "clip_duration_seconds", "video_track_index",
    "audio_track_index", "motion_style", "transition", "mogrt",
  ], "plan");
  if (raw.schema_version !== 1) throw new Error("plan.schema_version must be 1");
  if (raw.workflow !== "motion_graphics_demo" && raw.workflow !== "product_spot" && raw.workflow !== "brand_spot") {
    throw new Error("plan.workflow is unsupported");
  }

  const workflow = raw.workflow;
  const input: Record<string, unknown> = {
    sequence_id: raw.sequence_id,
    asset_item_ids: raw.asset_item_ids,
    clip_duration_seconds: raw.clip_duration_seconds,
    video_track_index: raw.video_track_index,
    audio_track_index: raw.audio_track_index,
  };
  if (workflow !== "motion_graphics_demo") input.motion_style = raw.motion_style;
  else if (raw.motion_style !== "demo") throw new Error("motion_graphics_demo plans must use demo motion_style");

  if (raw.transition !== undefined) {
    const rawTransition = rawObject(raw.transition, "plan.transition");
    assertOnlyKeys(rawTransition, ["name", "duration_seconds"], "plan.transition");
    input.transition_name = rawTransition.name;
    input.transition_duration_seconds = rawTransition.duration_seconds;
  } else {
    input.transition_name = "none";
  }
  if (raw.mogrt !== undefined) {
    if (workflow !== "brand_spot") throw new Error("only brand_spot plans may include mogrt");
    const rawMogrt = rawObject(raw.mogrt, "plan.mogrt");
    assertOnlyKeys(rawMogrt, ["path", "approved_workspace_path", "title_track_index", "title_start_seconds"], "plan.mogrt");
    input.mogrt_path = rawMogrt.path;
    input.approved_workspace_path = rawMogrt.approved_workspace_path;
    input.title_track_index = rawMogrt.title_track_index;
    input.title_start_seconds = rawMogrt.title_start_seconds;
  }
  return buildPlan(workflow, input);
}

export function spotWorkflowConfirmationToken(plan: SpotWorkflowPlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

function changes(plan: SpotWorkflowPlan) {
  const placementChanges = plan.asset_item_ids.map((itemId, index) => ({
    type: "insert_clip" as const,
    project_item_id: itemId,
    start_seconds: index * plan.clip_duration_seconds,
    video_track_index: plan.video_track_index,
    audio_track_index: plan.audio_track_index,
  }));
  return {
    target: { sequence_id: plan.sequence_id, requires_empty_target_tracks: true },
    placements: placementChanges,
    transition: plan.transition
      ? { ...plan.transition, applies_only_to_observed_adjacent_cuts: true }
      : { skipped: true, reason: "No transition was requested" },
    motion: plan.motion_style === "none"
      ? { skipped: true }
      : { style: plan.motion_style, parameter_readback_only: true },
    mogrt: plan.mogrt
      ? { title_track_index: plan.mogrt.title_track_index, start_seconds: plan.mogrt.title_start_seconds, workspace_contained: true }
      : { skipped: true },
  };
}

function quotedArray(values: readonly string[]): string {
  return `[${values.map((value) => `"${escapeForExtendScript(value)}"`).join(",")}]`;
}

function buildApplyScript(plan: SpotWorkflowPlan): string {
  const sequenceId = escapeForExtendScript(plan.sequence_id);
  const itemIds = quotedArray(plan.asset_item_ids);
  const transitionName = plan.transition ? `"${escapeForExtendScript(plan.transition.name)}"` : "null";
  const transitionDuration = plan.transition?.duration_seconds ?? 0;
  const mogrtScript = plan.mogrt
    ? `
      var titleTrack = seq.videoTracks[${plan.mogrt.title_track_index}];
      if (!titleTrack) return __error("Title video track index ${plan.mogrt.title_track_index} is out of range");
      if (titleTrack.clips.numItems !== 0) return __error("Title video track must be empty before applying this brand-spot plan");
    `
    : "";
  const mogrtApplyScript = plan.mogrt
    ? `
      var mogrtCountBefore = titleTrack.clips.numItems;
      var mogrtImportResult = null;
      try {
        mogrtImportResult = seq.importMGT("${escapeForExtendScript(plan.mogrt.path)}", __secondsToTicks(${plan.mogrt.title_start_seconds}).toString(), ${plan.mogrt.title_track_index}, ${plan.audio_track_index});
      } catch (mogrtError) {
        mogrtVerification = { applied: false, verified: false, error: String(mogrtError) };
      }
      if (!mogrtVerification) {
        var mogrtCountAfter = titleTrack.clips.numItems;
        mogrtVerification = mogrtCountAfter > mogrtCountBefore
          ? { applied: true, verified: true, insertedTrackItems: mogrtCountAfter - mogrtCountBefore }
          : { applied: false, verified: false, error: "Premiere returned from importMGT without adding a title-track item" };
      }
    `
    : 'var mogrtVerification = { skipped: true, reason: "No MOGRT was requested" };';

  return buildToolScript(`
    var seq = __findSequence("${sequenceId}");
    if (!seq) return __error("Target sequence was not found");
    if (!app.project.activeSequence || String(app.project.activeSequence.sequenceID) !== String(seq.sequenceID)) {
      return __error("Target sequence must be active before applying a spot workflow plan; activate it and preview again");
    }
    var videoTrack = seq.videoTracks[${plan.video_track_index}];
    if (!videoTrack) return __error("Video track index ${plan.video_track_index} is out of range");
    var audioTrack = seq.audioTracks[${plan.audio_track_index}];
    if (!audioTrack) return __error("Audio track index ${plan.audio_track_index} is out of range");
    if (videoTrack.clips.numItems !== 0 || audioTrack.clips.numItems !== 0) {
      return __error("Target video and audio tracks must be empty before applying a spot workflow plan");
    }
    ${mogrtScript}
    var requestedItemIds = ${itemIds};
    var requestedItems = [];
    for (var requestIndex = 0; requestIndex < requestedItemIds.length; requestIndex++) {
      var requestedItem = __findProjectItem(requestedItemIds[requestIndex]);
      if (!requestedItem || String(requestedItem.nodeId) !== String(requestedItemIds[requestIndex])) {
        return __error("Project item ID was not found exactly: " + requestedItemIds[requestIndex]);
      }
      requestedItems.push(requestedItem);
    }
    var transitionName = ${transitionName};
    var transitionDuration = ${transitionDuration};
    var transitionReady = false;
    var qeTrack = null;
    var transitionQE = null;
    var transitionPreflight = { requested: !!transitionName, ready: false };
    if (transitionName) {
      try {
        app.enableQE();
        var qeSequence = qe.project.getActiveSequence();
        qeTrack = qeSequence ? qeSequence.getVideoTrackAt(${plan.video_track_index}) : null;
        if (qeTrack && typeof qeTrack.addTransition === "function" && qe.project.getVideoTransitionByName) {
          transitionQE = qe.project.getVideoTransitionByName(transitionName);
        }
        transitionReady = !!transitionQE;
        transitionPreflight = transitionReady
          ? { requested: true, ready: true }
          : { requested: true, ready: false, reason: "The active Premiere build did not expose the requested transition write path" };
      } catch (transitionProbeError) {
        transitionPreflight = { requested: true, ready: false, reason: String(transitionProbeError) };
      }
    }
    var frameTicks = parseFloat(seq.timebase);
    if (!frameTicks || isNaN(frameTicks)) frameTicks = TICKS_PER_SECOND / 24;
    var frameTolerance = __ticksToSeconds(frameTicks) + 0.000001;
    var placed = [];
    var usedNodeIds = {};
    function findPlacedVideo(itemId, expectedStart) {
      for (var clipIndex = 0; clipIndex < videoTrack.clips.numItems; clipIndex++) {
        var candidate = videoTrack.clips[clipIndex];
        if (!candidate.projectItem || String(candidate.projectItem.nodeId) !== String(itemId) || usedNodeIds[String(candidate.nodeId)]) continue;
        if (Math.abs(__ticksToSeconds(candidate.start.ticks) - expectedStart) <= frameTolerance) return candidate;
      }
      return null;
    }
    for (var placementIndex = 0; placementIndex < requestedItems.length; placementIndex++) {
      var targetStart = placementIndex * ${plan.clip_duration_seconds};
      seq.insertClip(requestedItems[placementIndex], __secondsToTicks(targetStart).toString(), ${plan.video_track_index}, ${plan.audio_track_index});
      var placedClip = findPlacedVideo(requestedItemIds[placementIndex], targetStart);
      if (!placedClip) return __error("Premiere did not add the requested video item at the planned frame; the assembly is not reported as verified");
      usedNodeIds[String(placedClip.nodeId)] = true;
      placed.push({
        nodeId: String(placedClip.nodeId),
        projectItemId: requestedItemIds[placementIndex],
        startSeconds: __ticksToSeconds(placedClip.start.ticks),
        endSeconds: __ticksToSeconds(placedClip.end.ticks),
        verified: true
      });
    }
    function scaleRange(style, index) {
      if (style === "push_in") return { from: 100, to: 108 };
      if (style === "pull_out") return { from: 108, to: 100 };
      if (style === "demo") {
        if (index === 1) return { from: 112, to: 100 };
        return { from: 100, to: index === 2 ? 106 : 108 };
      }
      return index % 2 === 1 ? { from: 110, to: 100 } : { from: 100, to: 108 };
    }
    function addScaleMotion(clip, index) {
      if ("${plan.motion_style}" === "none") return { skipped: true };
      var motionComponent = null;
      for (var componentIndex = 0; componentIndex < clip.components.numItems; componentIndex++) {
        var component = clip.components[componentIndex];
        if (component.displayName === "Motion" || component.matchName === "AE.ADBE Motion") { motionComponent = component; break; }
      }
      if (!motionComponent) return { applied: false, verified: false, reason: "Motion component was not available on the placed clip" };
      var scaleProperty = null;
      for (var propertyIndex = 0; propertyIndex < motionComponent.properties.numItems; propertyIndex++) {
        var property = motionComponent.properties[propertyIndex];
        if (property.displayName === "Scale") { scaleProperty = property; break; }
      }
      if (!scaleProperty) return { applied: false, verified: false, reason: "Motion Scale property was not available on the placed clip" };
      var start = __ticksToSeconds(clip.start.ticks);
      var end = __ticksToSeconds(clip.end.ticks) - 0.1;
      if (end <= start) return { applied: false, verified: false, reason: "Placed clip is too short for the requested scale motion" };
      var range = scaleRange("${plan.motion_style}", index);
      try {
        if (!scaleProperty.isTimeVarying()) scaleProperty.setTimeVarying(true);
        var startTime = new Time(); startTime.ticks = __secondsToTicks(start).toString();
        var endTime = new Time(); endTime.ticks = __secondsToTicks(end).toString();
        scaleProperty.addKey(startTime); scaleProperty.setValueAtKey(startTime, range.from, true);
        scaleProperty.addKey(endTime); scaleProperty.setValueAtKey(endTime, range.to, true);
        var readStart = scaleProperty.getValueAtKey(startTime);
        var readEnd = scaleProperty.getValueAtKey(endTime);
        if (typeof readStart === "number" && Math.abs(readStart - range.from) > 0.0001) throw new Error("start keyframe readback differed");
        if (typeof readEnd === "number" && Math.abs(readEnd - range.to) > 0.0001) throw new Error("end keyframe readback differed");
        return { applied: true, verified: true, startSeconds: start, endSeconds: end, from: range.from, to: range.to };
      } catch (motionError) {
        return { applied: false, verified: false, reason: String(motionError) };
      }
    }
    var motionResults = [];
    for (var motionIndex = 0; motionIndex < placed.length; motionIndex++) {
      var verifiedClip = __findClip(placed[motionIndex].nodeId);
      motionResults.push(verifiedClip ? addScaleMotion(verifiedClip.clip, motionIndex) : { applied: false, verified: false, reason: "Placed clip could not be re-resolved for motion" });
    }
    var transitionResults = [];
    for (var cutIndex = 0; cutIndex < placed.length - 1; cutIndex++) {
      if (!transitionName) { transitionResults.push({ skipped: true, reason: "No transition was requested" }); continue; }
      if (!transitionReady) { transitionResults.push({ skipped: true, reason: transitionPreflight.reason || "Transition API unavailable" }); continue; }
      if (Math.abs(placed[cutIndex].endSeconds - placed[cutIndex + 1].startSeconds) > frameTolerance) {
        transitionResults.push({ skipped: true, reason: "Placed clips were not adjacent, so no transition was added" }); continue;
      }
      var transitionCountBefore = videoTrack.transitions.numItems;
      try {
        qeTrack.addTransition(transitionQE, true, __secondsToTicks(placed[cutIndex].endSeconds).toString(), __secondsToTicks(transitionDuration).toString(), "0", false);
        var transitionCountAfter = videoTrack.transitions.numItems;
        transitionResults.push(transitionCountAfter > transitionCountBefore
          ? { applied: true, verified: true, atSeconds: placed[cutIndex].endSeconds }
          : { applied: false, verified: false, reason: "Premiere did not add a transition to the track" });
      } catch (transitionError) {
        transitionResults.push({ applied: false, verified: false, reason: String(transitionError) });
      }
    }
    ${mogrtApplyScript}
    return __result({
      applied: true,
      workflow: "${plan.workflow}",
      targetSequenceId: String(seq.sequenceID),
      placements: placed,
      transitions: transitionResults,
      transitionPreflight: transitionPreflight,
      motion: motionResults,
      mogrt: mogrtVerification,
      renderVerified: false,
      verificationScope: "Placement, transition-count, MOGRT track-count, and Motion keyframe readback only. Inspect the resulting sequence and verify playback or an exported frame before delivery."
    });
  `);
}

function previewResult(plan: SpotWorkflowPlan, operationId: string) {
  return {
    success: true,
    data: {
      operationId,
      applied: false,
      plan,
      changes: changes(plan),
      confirmationToken: spotWorkflowConfirmationToken(plan),
      verificationScope: "This is a local plan preview. It does not inspect Premiere, prove assets exist, or make project changes.",
    },
  };
}

const sharedProperties = {
  sequence_id: { type: "string", description: "Exact ID of an existing empty destination sequence. It must be active at apply time." },
  asset_item_ids: { type: "array", description: "Exact existing project-item node IDs in playback order; external media paths are deliberately not imported by this workflow.", items: { type: "string" } },
  clip_duration_seconds: { type: "number", description: "Planned spacing between asset starts; defaults to 5 seconds for a motion demo and 4 seconds for spots." },
  video_track_index: { type: "number", description: "Empty destination video track index, default 0." },
  audio_track_index: { type: "number", description: "Empty destination audio track index, default 0." },
  motion_style: { type: "string", enum: ["none", "push_in", "pull_out", "alternate"], description: "Scale-motion style for product and brand spots; defaults to alternate." },
  transition_name: { type: "string", description: "Transition name; defaults to Cross Dissolve. Use none to disable transitions." },
  transition_duration_seconds: { type: "number", description: "Transition duration, default 0.75 seconds for demos and 0.5 seconds for spots." },
};

const planParameter = { type: "object", description: "Exact plan returned by a preview_*_spot tool" };

export function getSpotWorkflowTools(bridgeOptions: BridgeOptions, dependencies: SpotWorkflowDependencies = {}) {
  const capabilities = dependencies.capabilities ?? resolveCapabilities();
  const auditSink = dependencies.auditSink ?? stderrAuditSink;
  const nextId = dependencies.operationIdFactory ?? createOperationId;
  const fileExists = dependencies.fileExists ?? existsSync;

  const preview = (workflow: WorkflowKind) => async (args: Record<string, unknown>) => {
    const operationId = nextId();
    requireCapability(capabilities, "inspect", operationId);
    return previewResult(buildPlan(workflow, args), operationId);
  };

  return {
    preview_motion_graphics_demo: {
      description: "Preview a contained motion-graphics demo assembly from existing project items. It never creates demo assets, imports files, creates a sequence, or changes Premiere; apply requires an exact confirmation token.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          sequence_id: sharedProperties.sequence_id,
          asset_item_ids: sharedProperties.asset_item_ids,
          clip_duration_seconds: sharedProperties.clip_duration_seconds,
          video_track_index: sharedProperties.video_track_index,
          audio_track_index: sharedProperties.audio_track_index,
          transition_name: sharedProperties.transition_name,
          transition_duration_seconds: sharedProperties.transition_duration_seconds,
        },
        required: ["sequence_id", "asset_item_ids"],
      },
      handler: preview("motion_graphics_demo"),
    },
    preview_product_spot: {
      description: "Preview a product-spot assembly from existing project items. The eventual apply is limited to explicit empty tracks, revalidates item IDs, and reports host readback without claiming visual delivery verification.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: sharedProperties,
        required: ["sequence_id", "asset_item_ids"],
      },
      handler: preview("product_spot"),
    },
    preview_brand_spot: {
      description: "Preview a brand-spot assembly from existing project items with an optional workspace-contained MOGRT overlay. Preview is local-only; it does not read or import the MOGRT file.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          ...sharedProperties,
          mogrt_path: { type: "string", description: "Optional absolute .mogrt path, which must be inside approved_workspace_path." },
          approved_workspace_path: { type: "string", description: "Operator-approved root containing mogrt_path; required whenever mogrt_path is supplied." },
          title_track_index: { type: "number", description: "Empty title-overlay video track index, default 1 and distinct from video_track_index." },
          title_start_seconds: { type: "number", description: "MOGRT start time in seconds, default 0.4." },
        },
        required: ["sequence_id", "asset_item_ids"],
      },
      handler: preview("brand_spot"),
    },
    apply_spot_workflow_plan: {
      description: "Apply one exact previewed motion-demo, product-spot, or brand-spot plan. Requires edit authority, requires filesystem authority for a MOGRT, and only targets empty explicitly named tracks. Host readback is not playback or render verification.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          plan: planParameter,
          confirmation_token: { type: "string", description: "Exact token returned by the corresponding preview tool." },
        },
        required: ["plan", "confirmation_token"],
      },
      handler: async (args: { plan: unknown; confirmation_token: string }) => {
        const operationId = nextId();
        try {
          requireCapability(capabilities, "edit", operationId);
          const plan = validateSpotWorkflowPlan(args.plan);
          if (args.confirmation_token !== spotWorkflowConfirmationToken(plan)) {
            throw new Error("Confirmation token does not match this spot workflow plan; preview it again");
          }
          if (plan.mogrt) {
            requireCapability(capabilities, "filesystem", operationId);
            if (!fileExists(plan.mogrt.path)) {
              return { success: false, error: "The previewed MOGRT file no longer exists; preview the plan again after correcting it" };
            }
          }
          emitAudit(auditSink, { operationId, action: "apply_spot_workflow_plan", outcome: "started", details: { workflow: plan.workflow, placements: plan.asset_item_ids.length, hasMogrt: !!plan.mogrt } });
          const result = await sendCommand(buildApplyScript(plan), bridgeOptions);
          emitAudit(auditSink, { operationId, action: "apply_spot_workflow_plan", outcome: result.success ? "succeeded" : "failed" });
          return result.success
            ? { ...result, data: { ...(result.data as object), operationId } }
            : { ...result, error: `${result.error ?? "Spot workflow plan failed"} (operation ${operationId})` };
        } catch (error) {
          emitAudit(auditSink, { operationId, action: "apply_spot_workflow_plan", outcome: error instanceof Error && error.name === "CapabilityDeniedError" ? "denied" : "failed" });
          throw error;
        }
      },
    },
  };
}
