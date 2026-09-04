import { randomUUID } from "node:crypto";
import {
  constants as fsConstants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { sendAfterEffectsCommand } from "../bridge/after-effects-bridge.js";
import { buildAfterEffectsScript, escapeForAfterEffects } from "../bridge/after-effects-script-builder.js";
import { sendCommand, type BridgeOptions, type CommandResult } from "../bridge/file-bridge.js";
import {
  buildMogrtPlan,
  buildMogrtRecipeScript,
  inspectMogrtArtifact,
  type MogrtArtifactStatus,
  type MogrtBrandKit,
  type MogrtPlan,
  validateMogrtBrandKit,
} from "./mogrt-authoring.js";
import { type CapabilityConfig, createOperationId, requireCapability, resolveCapabilities } from "../security/index.js";

const MAX_PATH = 4096;
const MAX_BATCH_ITEMS = 20;
const PLAN_TTL_MS = 10 * 60 * 1000;
const MAX_DATA_FILE_BYTES = 512 * 1024;

interface IssuedPlan<T> {
  value: T;
  expiresAt: number;
}

interface BatchPlan {
  workspace: string;
  dataFilePath: string;
  plans: MogrtPlan[];
}

interface LibraryPublishPlan {
  workspace: string;
  source: string;
  destination: string;
  templateName: string;
  version: string;
}

interface RenderPlan {
  workspace: string;
  compositionName: string;
  outputPath: string;
  renderSettingsTemplate: string;
  outputModuleTemplate: string;
}

interface PremiereHandoffPlan {
  workspace: string;
  mogrtPath: string;
  sequenceId: string;
  disposableSequenceName: string;
  videoTrackIndex: number;
  audioTrackIndex: number;
  startSeconds: number;
}

export interface MogrtStudioDependencies {
  capabilities?: CapabilityConfig;
  sendAfterEffects?: (script: string, options: BridgeOptions) => Promise<CommandResult>;
  sendPremiere?: (script: string, options: BridgeOptions) => Promise<CommandResult>;
  directoryExists?: (candidate: string) => boolean;
  fileExists?: (candidate: string) => boolean;
  readText?: (candidate: string) => string;
  copyFile?: (source: string, destination: string) => void;
  makeDirectory?: (candidate: string) => void;
  listDirectory?: (candidate: string) => string[];
  artifactStatus?: (candidate: string) => MogrtArtifactStatus;
  now?: () => number;
  tokenFactory?: () => string;
  operationIdFactory?: () => string;
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function assertOnlyKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`${field} contains unsupported field: ${key}`);
  }
}

function text(value: unknown, field: string, maxLength = 160): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${field} must be at most ${maxLength} characters`);
  return normalized;
}

function finiteNumber(value: unknown, field: string, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${field} must be a finite number between ${min} and ${max}`);
  }
  return value;
}

function wholeNumber(value: unknown, field: string, fallback: number, min: number, max: number): number {
  const parsed = finiteNumber(value, field, fallback, min, max);
  if (!Number.isInteger(parsed)) throw new Error(`${field} must be an integer between ${min} and ${max}`);
  return parsed;
}

function resolvePath(value: string): { api: typeof path.win32; resolved: string; windows: boolean } {
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\")) {
    return { api: path.win32, resolved: path.win32.resolve(value), windows: true };
  }
  if (path.posix.isAbsolute(value)) return { api: path.posix, resolved: path.posix.resolve(value), windows: false };
  throw new Error("Path must be absolute");
}

function containedPath(workspace: string, candidate: string, field: string): { root: string; candidate: string; api: typeof path.win32 } {
  const root = resolvePath(workspace);
  const target = resolvePath(candidate);
  if (root.windows !== target.windows) throw new Error(`${field} must use the same path format as approved_workspace_path`);
  const relative = root.api.relative(root.resolved, target.resolved);
  if (relative === ".." || relative.startsWith(`..${root.api.sep}`) || root.api.isAbsolute(relative)) {
    throw new Error(`${field} must be inside approved_workspace_path`);
  }
  return { root: root.resolved, candidate: target.resolved, api: root.api };
}

function mogrtArtifact(workspace: unknown, mogrtPath: unknown): { root: string; artifact: string; api: typeof path.win32 } {
  const root = text(workspace, "approved_workspace_path", MAX_PATH);
  const artifact = text(mogrtPath, "mogrt_path", MAX_PATH);
  if (!/\.mogrt$/i.test(artifact)) throw new Error("mogrt_path must end in .mogrt");
  const contained = containedPath(root, artifact, "mogrt_path");
  return { root: contained.root, artifact: contained.candidate, api: contained.api };
}

function safeTemplateName(value: unknown, field = "template_name"): string {
  const name = text(value, field, 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(name) || /[. ]$/.test(name)) {
    throw new Error(`${field} must use letters, numbers, spaces, underscores, or hyphens and cannot end with a dot or space`);
  }
  return name;
}

function parseCsv(textValue: string): Record<string, unknown>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < textValue.length; index += 1) {
    const character = textValue[index];
    if (character === '"') {
      if (quoted && textValue[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field); field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && textValue[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((entry) => entry.trim())) rows.push(row);
      row = [];
    } else field += character;
  }
  if (quoted) throw new Error("CSV data file has an unterminated quoted field");
  row.push(field);
  if (row.some((entry) => entry.trim())) rows.push(row);
  if (rows.length < 2) throw new Error("CSV data file must include a header row and at least one template row");
  const [headers, ...data] = rows;
  const allowed = new Set(["recipe", "template_name", "headline", "subtitle", "accent_color", "text_color", "duration_seconds", "width", "height", "frame_rate"]);
  for (const header of headers) {
    if (!allowed.has(header.trim())) throw new Error(`CSV data file contains unsupported column: ${header}`);
  }
  return data.map((values) => Object.fromEntries(headers.map((header, index) => [header.trim(), values[index]?.trim() || undefined])));
}

function parseBatchRows(contents: string, dataFilePath: string): Record<string, unknown>[] {
  const parsed = dataFilePath.toLowerCase().endsWith(".json")
    ? JSON.parse(contents) as unknown
    : parseCsv(contents);
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_BATCH_ITEMS) {
    throw new Error(`Batch data must contain between 1 and ${MAX_BATCH_ITEMS} rows`);
  }
  return parsed.map((row, index) => {
    const input = asObject(row, `batch row ${index + 1}`);
    assertOnlyKeys(input, ["recipe", "template_name", "headline", "subtitle", "accent_color", "text_color", "duration_seconds", "width", "height", "frame_rate"], `batch row ${index + 1}`);
    const numericKeys = ["duration_seconds", "width", "height", "frame_rate"];
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      normalized[key] = numericKeys.includes(key) && typeof value === "string" && value !== "" ? Number(value) : value;
    }
    return normalized;
  });
}

function outputDoesNotExist(fileExists: (candidate: string) => boolean, candidate: string, field: string): void {
  if (fileExists(candidate)) throw new Error(`${field} already exists; this workflow never overwrites artifacts`);
}

function renderPlan(value: unknown, directoryExists: (candidate: string) => boolean, fileExists: (candidate: string) => boolean): RenderPlan {
  const input = asObject(value, "arguments");
  assertOnlyKeys(input, ["approved_workspace_path", "composition_name", "output_path", "render_settings_template", "output_module_template"], "arguments");
  const root = text(input.approved_workspace_path, "approved_workspace_path", MAX_PATH);
  const output = containedPath(root, text(input.output_path, "output_path", MAX_PATH), "output_path");
  if (!directoryExists(output.api.dirname(output.candidate))) throw new Error("output_path parent directory must already exist");
  outputDoesNotExist(fileExists, output.candidate, "output_path");
  return {
    workspace: output.root,
    compositionName: safeTemplateName(input.composition_name, "composition_name"),
    outputPath: output.candidate,
    renderSettingsTemplate: text(input.render_settings_template, "render_settings_template", 120),
    outputModuleTemplate: text(input.output_module_template, "output_module_template", 120),
  };
}

function premiereHandoffPlan(value: unknown, artifactStatus: (candidate: string) => MogrtArtifactStatus): PremiereHandoffPlan {
  const input = asObject(value, "arguments");
  assertOnlyKeys(input, ["approved_workspace_path", "mogrt_path", "sequence_id", "disposable_sequence_name", "video_track_index", "audio_track_index", "start_seconds"], "arguments");
  const artifact = mogrtArtifact(input.approved_workspace_path, input.mogrt_path);
  const inspected = artifactStatus(artifact.artifact);
  if (!inspected.exists || !inspected.zip_header_valid) throw new Error("mogrt_path must exist and have a ZIP header before Premiere handoff");
  const sequenceName = text(input.disposable_sequence_name, "disposable_sequence_name", 120);
  if (!/^MOGRT Verify - /i.test(sequenceName)) {
    throw new Error("disposable_sequence_name must begin with 'MOGRT Verify - ' to make the verification target explicit");
  }
  return {
    workspace: artifact.root,
    mogrtPath: artifact.artifact,
    sequenceId: text(input.sequence_id, "sequence_id", 160),
    disposableSequenceName: sequenceName,
    videoTrackIndex: wholeNumber(input.video_track_index, "video_track_index", 0, 0, 99),
    audioTrackIndex: wholeNumber(input.audio_track_index, "audio_track_index", 0, 0, 99),
    startSeconds: finiteNumber(input.start_seconds, "start_seconds", 0, 0, 86_400),
  };
}

function buildPremiereHandoffScript(plan: PremiereHandoffPlan): string {
  return `
    var seq = __findSequence("${escapeForAfterEffects(plan.sequenceId)}");
    if (!seq) return __error("The previewed verification sequence no longer exists");
    if (String(seq.name) !== "${escapeForAfterEffects(plan.disposableSequenceName)}") return __error("The sequence name no longer matches the explicit disposable verification target");
    var titleTrack = seq.videoTracks[${plan.videoTrackIndex}];
    if (!titleTrack) return __error("The requested verification video track does not exist");
    if (titleTrack.clips.numItems !== 0) return __error("The requested verification video track is not empty; no MOGRT was imported");
    var before = titleTrack.clips.numItems;
    var imported = seq.importMGT("${escapeForAfterEffects(plan.mogrtPath)}", __secondsToTicks(${plan.startSeconds}).toString(), ${plan.videoTrackIndex}, ${plan.audioTrackIndex});
    var after = titleTrack.clips.numItems;
    if (after <= before) return __error("Premiere returned from importMGT without inserting a verification track item");
    var inserted = titleTrack.clips[after - 1];
    var component = inserted && inserted.getMGTComponent ? inserted.getMGTComponent() : null;
    var controls = [];
    if (component && component.properties) {
      for (var i = 0; i < component.properties.numItems && i < 32; i++) {
        var property = component.properties[i];
        controls.push({ displayName: String(property.displayName || ""), matchName: String(property.matchName || "") });
      }
    }
    return __result({
      imported: imported === true || after > before,
      insertedTrackItems: after - before,
      componentDetected: !!component,
      exposedControlDescriptors: controls,
      importVerified: true,
      visualVerified: false,
      verificationScope: "Premiere inserted the MOGRT into the explicit empty verification track and returned control descriptors. Capture and inspect a rendered frame before delivery."
    });
  `;
}

export function getMogrtStudioTools(bridgeOptions: BridgeOptions, dependencies: MogrtStudioDependencies = {}) {
  const capabilities = dependencies.capabilities ?? resolveCapabilities();
  const sendAfterEffects = dependencies.sendAfterEffects ?? sendAfterEffectsCommand;
  const sendPremiere = dependencies.sendPremiere ?? sendCommand;
  const directoryExists = dependencies.directoryExists ?? ((candidate) => {
    try { return statSync(candidate).isDirectory(); } catch { return false; }
  });
  const fileExists = dependencies.fileExists ?? existsSync;
  const readText = dependencies.readText ?? ((candidate) => readFileSync(candidate, "utf8"));
  const copyFile = dependencies.copyFile ?? ((source, destination) => copyFileSync(source, destination, fsConstants.COPYFILE_EXCL));
  const makeDirectory = dependencies.makeDirectory ?? ((candidate) => mkdirSync(candidate, { recursive: true }));
  const listDirectory = dependencies.listDirectory ?? ((candidate) => readdirSync(candidate));
  const artifactStatus = dependencies.artifactStatus ?? inspectMogrtArtifact;
  const now = dependencies.now ?? Date.now;
  const tokenFactory = dependencies.tokenFactory ?? randomUUID;
  const nextOperationId = dependencies.operationIdFactory ?? createOperationId;
  const batchPlans = new Map<string, IssuedPlan<BatchPlan>>();
  const libraryPlans = new Map<string, IssuedPlan<LibraryPublishPlan>>();
  const renderPlans = new Map<string, IssuedPlan<RenderPlan>>();
  const handoffPlans = new Map<string, IssuedPlan<PremiereHandoffPlan>>();

  const issue = <T>(store: Map<string, IssuedPlan<T>>, value: T) => {
    const token = tokenFactory();
    store.set(token, { value, expiresAt: now() + PLAN_TTL_MS });
    return token;
  };
  const take = <T>(store: Map<string, IssuedPlan<T>>, token: unknown, field: string): T => {
    const key = text(token, field, 128);
    const issued = store.get(key);
    if (!issued || issued.expiresAt <= now()) {
      store.delete(key);
      throw new Error(`${field} is missing, expired, or already used; preview again`);
    }
    store.delete(key);
    return issued.value;
  };

  return {
    validate_mogrt_brand_kit: {
      description: "Validate an operator-approved local MOGRT brand kit before using it in a template or batch preview. It never reads font inventories, image pixels, or writes files.",
      parameters: {
        type: "object" as const, additionalProperties: false,
        properties: {
          approved_workspace_path: { type: "string", description: "Absolute operator-approved workspace root." },
          brand_kit: { type: "object", description: "Approved brand-kit values to validate before recipe use.", additionalProperties: false, properties: { name: { type: "string" }, name_prefix: { type: "string" }, font_family: { type: "string" }, logo_path: { type: "string" }, accent_color: { type: "string" }, text_color: { type: "string" }, safe_margin_percent: { type: "number" } }, required: ["name"] },
        }, required: ["approved_workspace_path", "brand_kit"],
      },
      handler: async (args: unknown) => {
        const operationId = nextOperationId();
        requireCapability(capabilities, "inspect", operationId);
        requireCapability(capabilities, "filesystem", operationId);
        const input = asObject(args, "arguments");
        assertOnlyKeys(input, ["approved_workspace_path", "brand_kit"], "arguments");
        const workspace = text(input.approved_workspace_path, "approved_workspace_path", MAX_PATH);
        const brandKit = validateMogrtBrandKit(input.brand_kit, workspace);
        return { success: true, data: { operationId, brandKit, logoPathExists: brandKit?.logo_path ? fileExists(brandKit.logo_path) : null, verificationScope: "Local path and schema validation only. Font availability is verified by After Effects only when a recipe is created." } };
      },
    },
    preview_mogrt_batch: {
      description: "Preview up to 20 bounded MOGRT recipe exports from a workspace-contained JSON or CSV data file. It does not contact Adobe or create any compositions or files.",
      parameters: {
        type: "object" as const, additionalProperties: false,
        properties: {
          approved_workspace_path: { type: "string", description: "Absolute operator-approved workspace root." }, output_directory: { type: "string", description: "Existing workspace-contained directory for every batch artifact." }, data_file_path: { type: "string", description: "Existing workspace-contained .json or .csv file with recipe rows." },
          brand_kit: { type: "object", description: "Optional validated brand-kit values applied to every batch recipe.", additionalProperties: false, properties: { name: { type: "string" }, name_prefix: { type: "string" }, font_family: { type: "string" }, logo_path: { type: "string" }, accent_color: { type: "string" }, text_color: { type: "string" }, safe_margin_percent: { type: "number" } }, required: ["name"] },
        }, required: ["approved_workspace_path", "output_directory", "data_file_path"],
      },
      handler: async (args: unknown) => {
        const operationId = nextOperationId();
        requireCapability(capabilities, "inspect", operationId);
        requireCapability(capabilities, "filesystem", operationId);
        const input = asObject(args, "arguments");
        assertOnlyKeys(input, ["approved_workspace_path", "output_directory", "data_file_path", "brand_kit"], "arguments");
        const workspace = text(input.approved_workspace_path, "approved_workspace_path", MAX_PATH);
        const dataPath = containedPath(workspace, text(input.data_file_path, "data_file_path", MAX_PATH), "data_file_path");
        if (!/\.(?:json|csv)$/i.test(dataPath.candidate)) throw new Error("data_file_path must end in .json or .csv");
        if (!fileExists(dataPath.candidate)) throw new Error("data_file_path does not exist");
        const raw = readText(dataPath.candidate);
        if (Buffer.byteLength(raw, "utf8") > MAX_DATA_FILE_BYTES) throw new Error(`data_file_path must be at most ${MAX_DATA_FILE_BYTES} bytes`);
        const rows = parseBatchRows(raw, dataPath.candidate);
        const plans = rows.map((row) => buildMogrtPlan({ ...row, approved_workspace_path: workspace, output_directory: input.output_directory, ...(input.brand_kit === undefined ? {} : { brand_kit: input.brand_kit }) }, directoryExists));
        const outputs = new Set<string>();
        for (const plan of plans) {
          if (outputs.has(plan.output_path)) throw new Error("Batch rows must have unique template_name values");
          outputs.add(plan.output_path);
          outputDoesNotExist(fileExists, plan.output_path, "Planned MOGRT artifact");
        }
        const previewToken = issue(batchPlans, { workspace: dataPath.root, dataFilePath: dataPath.candidate, plans });
        return { success: true, data: { operationId, previewToken, expiresInSeconds: PLAN_TTL_MS / 1000, plans, batchAtomic: false, verificationScope: "This is a local preview. Batch creation exports recipes serially and stops at the first host failure; it cannot roll back already-created AE compositions or artifacts." } };
      },
    },
    create_mogrt_batch: {
      description: "Create the exact MOGRT recipes from a one-time batch preview. Requires explicit export confirmation and stops on the first After Effects failure without claiming rollback.",
      parameters: { type: "object" as const, additionalProperties: false, properties: { preview_token: { type: "string", description: "One-time token returned by preview_mogrt_batch." }, confirm_export: { type: "boolean", description: "Must be true to request every planned export." } }, required: ["preview_token", "confirm_export"] },
      handler: async (args: unknown) => {
        const operationId = nextOperationId();
        requireCapability(capabilities, "edit", operationId);
        requireCapability(capabilities, "export", operationId);
        requireCapability(capabilities, "filesystem", operationId);
        const input = asObject(args, "arguments");
        assertOnlyKeys(input, ["preview_token", "confirm_export"], "arguments");
        if (input.confirm_export !== true) throw new Error("confirm_export must be true to create the batch");
        const batch = take(batchPlans, input.preview_token, "preview_token");
        const completed: Array<Record<string, unknown>> = [];
        for (const plan of batch.plans) {
          const result = await sendAfterEffects(buildMogrtRecipeScript(plan), bridgeOptions);
          if (!result.success) {
            return { success: false, error: `${result.error ?? "MOGRT batch creation failed"} (operation ${operationId})`, data: { operationId, completed, failedTemplate: plan.template_name, batchAtomic: false } };
          }
          completed.push({ templateName: plan.template_name, artifactPath: plan.output_path, artifact: artifactStatus(plan.output_path) });
        }
        return { success: true, data: { operationId, completed, batchAtomic: false, visualVerified: false, verificationScope: "After Effects accepted each serial export request. Verify every artifact and use the Premiere handoff workflow before delivery." } };
      },
    },
    inspect_after_effects_template_source: {
      description: "Inspect a saved After Effects source composition for MOGRT-relevant dimensions, duration, text fonts, layer-source kinds, and Essential Graphics controller names when the host exposes the AE 16.1+ readback API. It never creates a composition or returns asset paths.",
      parameters: { type: "object" as const, additionalProperties: false, properties: { composition_name: { type: "string", description: "Optional exact composition name; omit to inspect the active composition." } } },
      handler: async (args: { composition_name?: unknown } = {}) => {
        const operationId = nextOperationId();
        requireCapability(capabilities, "inspect", operationId);
        const compositionName = args.composition_name === undefined ? "" : safeTemplateName(args.composition_name, "composition_name");
        const result = await sendAfterEffects(buildAfterEffectsScript(`
          var project = app.project;
          if (!project) return __aeError("No After Effects project is open");
          var comp = null;
          if ("${escapeForAfterEffects(compositionName)}") {
            for (var i = 1; i <= project.numItems; i++) {
              if (project.item(i) instanceof CompItem && String(project.item(i).name) === "${escapeForAfterEffects(compositionName)}") { comp = project.item(i); break; }
            }
          } else if (project.activeItem instanceof CompItem) comp = project.activeItem;
          if (!comp) return __aeError("No matching active or named composition was found");
          var fonts = {}; var layers = [];
          for (var layerIndex = 1; layerIndex <= comp.numLayers && layerIndex <= 100; layerIndex++) {
            var layer = comp.layer(layerIndex);
            var descriptor = { name: String(layer.name), kind: String(layer.matchName || "layer"), hasSource: !!layer.source };
            if (layer.matchName === "ADBE Text Layer") {
              try { var documentValue = layer.property("ADBE Text Properties").property("ADBE Text Document").value; if (documentValue && documentValue.font) fonts[String(documentValue.font)] = true; } catch (fontReadError) {}
            }
            layers.push(descriptor);
          }
          var fontNames = []; for (var fontName in fonts) if (fonts.hasOwnProperty(fontName)) fontNames.push(fontName);
          var controllerNames = [];
          var supportsControllerReadback = typeof comp.motionGraphicsTemplateControllerCount === "number" && typeof comp.getMotionGraphicsTemplateControllerName === "function";
          if (supportsControllerReadback) {
            for (var controllerIndex = 1; controllerIndex <= comp.motionGraphicsTemplateControllerCount && controllerIndex <= 100; controllerIndex++) {
              try { controllerNames.push(String(comp.getMotionGraphicsTemplateControllerName(controllerIndex))); } catch (controllerReadError) { controllerNames.push("<unreadable controller>"); }
            }
          }
          return __aeResult({
            compositionName: String(comp.name), width: comp.width, height: comp.height, durationSeconds: comp.duration, frameRate: comp.frameRate,
            motionGraphicsTemplateName: String(comp.motionGraphicsTemplateName || ""), layerCount: comp.numLayers, layers: layers, requiredFonts: fontNames,
            exposedControlNames: controllerNames, exposedControlsReadbackAvailable: supportsControllerReadback,
            verificationScope: "Controller names are read from the After Effects source composition only when its AE 16.1+ API is available. This does not establish exported-MOGRT compatibility, Premiere import, or visual verification."
          });
        `), bridgeOptions);
        return result.success ? { ...result, data: { ...(result.data as object), operationId } } : { ...result, error: `${result.error ?? "After Effects inspection failed"} (operation ${operationId})` };
      },
    },
    preview_mogrt_library_publish: {
      description: "Preview a no-overwrite publish of a validated MOGRT into a workspace-contained, versioned local library. The library root must already exist; no file or directory is created during preview.",
      parameters: { type: "object" as const, additionalProperties: false, properties: { approved_workspace_path: { type: "string", description: "Absolute operator-approved workspace root." }, mogrt_path: { type: "string", description: "Existing workspace-contained MOGRT artifact." }, library_directory: { type: "string", description: "Existing workspace-contained local library root." }, template_name: { type: "string", description: "Safe immutable library template name." } }, required: ["approved_workspace_path", "mogrt_path", "library_directory", "template_name"] },
      handler: async (args: unknown) => {
        const operationId = nextOperationId();
        requireCapability(capabilities, "inspect", operationId);
        requireCapability(capabilities, "filesystem", operationId);
        const input = asObject(args, "arguments");
        assertOnlyKeys(input, ["approved_workspace_path", "mogrt_path", "library_directory", "template_name"], "arguments");
        const artifact = mogrtArtifact(input.approved_workspace_path, input.mogrt_path);
        const inspected = artifactStatus(artifact.artifact);
        if (!inspected.exists || !inspected.zip_header_valid) throw new Error("mogrt_path must exist and have a ZIP header before publishing");
        const library = containedPath(artifact.root, text(input.library_directory, "library_directory", MAX_PATH), "library_directory");
        if (!directoryExists(library.candidate)) throw new Error("library_directory must already exist; this workflow will not create a new library root");
        const templateName = safeTemplateName(input.template_name);
        let version = "";
        let destination = "";
        for (let index = 1; index <= 999; index += 1) {
          const candidateVersion = `v${String(index).padStart(3, "0")}`;
          const candidate = library.api.join(library.candidate, templateName, candidateVersion, `${templateName}.mogrt`);
          if (!fileExists(candidate)) { version = candidateVersion; destination = candidate; break; }
        }
        if (!destination) throw new Error("No unused version slot remains for this template");
        const previewToken = issue(libraryPlans, { workspace: artifact.root, source: artifact.artifact, destination, templateName, version });
        return { success: true, data: { operationId, previewToken, expiresInSeconds: PLAN_TTL_MS / 1000, sourceArtifact: artifact.artifact, destination, version, verificationScope: "This preview does not create a library entry. Publishing copies the exact ZIP-checked source file into a new version directory and never overwrites a prior version." } };
      },
    },
    publish_mogrt_to_library: {
      description: "Publish the exact previewed MOGRT as an immutable local-library version. Requires explicit confirmation and will fail instead of replacing an existing version.",
      parameters: { type: "object" as const, additionalProperties: false, properties: { preview_token: { type: "string", description: "One-time token returned by preview_mogrt_library_publish." }, confirm_publish: { type: "boolean", description: "Must be true to copy the immutable library version." } }, required: ["preview_token", "confirm_publish"] },
      handler: async (args: unknown) => {
        const operationId = nextOperationId();
        requireCapability(capabilities, "filesystem", operationId);
        const input = asObject(args, "arguments");
        assertOnlyKeys(input, ["preview_token", "confirm_publish"], "arguments");
        if (input.confirm_publish !== true) throw new Error("confirm_publish must be true to publish the MOGRT");
        const plan = take(libraryPlans, input.preview_token, "preview_token");
        if (!artifactStatus(plan.source).zip_header_valid) return { success: false, error: "The previewed source artifact is no longer a recognizable ZIP-based MOGRT" };
        if (fileExists(plan.destination)) return { success: false, error: "The previewed library destination now exists; preview publishing again to select a new immutable version" };
        makeDirectory(resolvePath(plan.destination).api.dirname(plan.destination));
        copyFile(plan.source, plan.destination);
        return { success: true, data: { operationId, templateName: plan.templateName, version: plan.version, libraryArtifactPath: plan.destination, artifact: artifactStatus(plan.destination), overwrite: false } };
      },
    },
    inspect_mogrt_library: {
      description: "List bounded top-level template names and version directories in an existing workspace-contained local MOGRT library. It never reads MOGRT contents or changes the library.",
      parameters: { type: "object" as const, additionalProperties: false, properties: { approved_workspace_path: { type: "string", description: "Absolute operator-approved workspace root." }, library_directory: { type: "string", description: "Existing workspace-contained local library root." } }, required: ["approved_workspace_path", "library_directory"] },
      handler: async (args: unknown) => {
        const operationId = nextOperationId();
        requireCapability(capabilities, "inspect", operationId);
        requireCapability(capabilities, "filesystem", operationId);
        const input = asObject(args, "arguments");
        assertOnlyKeys(input, ["approved_workspace_path", "library_directory"], "arguments");
        const library = containedPath(text(input.approved_workspace_path, "approved_workspace_path", MAX_PATH), text(input.library_directory, "library_directory", MAX_PATH), "library_directory");
        if (!directoryExists(library.candidate)) return { success: false, error: "library_directory does not exist" };
        const templates = listDirectory(library.candidate).slice(0, 100).map((name) => ({ name, versions: directoryExists(library.api.join(library.candidate, name)) ? listDirectory(library.api.join(library.candidate, name)).filter((version) => /^v\d{3}$/.test(version)).slice(0, 100) : [] }));
        return { success: true, data: { operationId, libraryDirectory: library.candidate, templates, truncated: listDirectory(library.candidate).length > 100 } };
      },
    },
    inspect_after_effects_render_templates: {
      description: "Read available render and output-module template names from the first existing After Effects render-queue item. It never queues or renders a composition.",
      parameters: { type: "object" as const, additionalProperties: false, properties: {} },
      handler: async () => {
        const operationId = nextOperationId();
        requireCapability(capabilities, "inspect", operationId);
        const result = await sendAfterEffects(buildAfterEffectsScript(`
          var project = app.project;
          if (!project || project.renderQueue.numItems < 1) return __aeError("After Effects has no existing render-queue item to inspect; use known approved template names or add one manually before this read-only check");
          var item = project.renderQueue.item(1);
          var renderTemplates = item.templates || [];
          var outputTemplates = item.outputModule(1).templates || [];
          return __aeResult({ renderSettingsTemplates: renderTemplates, outputModuleTemplates: outputTemplates, readOnly: true });
        `), bridgeOptions);
        return result.success ? { ...result, data: { ...(result.data as object), operationId } } : { ...result, error: `${result.error ?? "After Effects render-template inspection failed"} (operation ${operationId})` };
      },
    },
    preview_after_effects_render: {
      description: "Preview a bounded queue-only After Effects render request for one named composition and existing workspace output directory. It does not contact Adobe, enqueue, or render.",
      parameters: { type: "object" as const, additionalProperties: false, properties: { approved_workspace_path: { type: "string", description: "Absolute operator-approved workspace root." }, composition_name: { type: "string", description: "Exact existing After Effects composition name." }, output_path: { type: "string", description: "New workspace-contained output file path whose parent already exists." }, render_settings_template: { type: "string", description: "Exact After Effects render-settings template name." }, output_module_template: { type: "string", description: "Exact After Effects output-module template name." } }, required: ["approved_workspace_path", "composition_name", "output_path", "render_settings_template", "output_module_template"] },
      handler: async (args: unknown) => {
        const operationId = nextOperationId();
        requireCapability(capabilities, "inspect", operationId);
        requireCapability(capabilities, "filesystem", operationId);
        const plan = renderPlan(args, directoryExists, fileExists);
        const previewToken = issue(renderPlans, plan);
        return { success: true, data: { operationId, previewToken, expiresInSeconds: PLAN_TTL_MS / 1000, plan, verificationScope: "This does not verify that the named composition or installed render templates exist. Enqueue performs that host check but does not render or verify the output file." } };
      },
    },
    enqueue_after_effects_render: {
      description: "Queue exactly one previewed After Effects render with named host templates. Requires explicit confirmation; it saves the open project but never starts rendering or overwrites output.",
      parameters: { type: "object" as const, additionalProperties: false, properties: { preview_token: { type: "string", description: "One-time token returned by preview_after_effects_render." }, confirm_enqueue: { type: "boolean", description: "Must be true to queue the planned render." } }, required: ["preview_token", "confirm_enqueue"] },
      handler: async (args: unknown) => {
        const operationId = nextOperationId();
        requireCapability(capabilities, "edit", operationId);
        requireCapability(capabilities, "export", operationId);
        requireCapability(capabilities, "filesystem", operationId);
        const input = asObject(args, "arguments");
        assertOnlyKeys(input, ["preview_token", "confirm_enqueue"], "arguments");
        if (input.confirm_enqueue !== true) throw new Error("confirm_enqueue must be true to queue the render");
        const plan = take(renderPlans, input.preview_token, "preview_token");
        const result = await sendAfterEffects(buildAfterEffectsScript(`
          function normalizedPath(value) { return String(value).replace(/\\\\/g, "/").replace(/\\/+$/, "").toLowerCase(); }
          function isInside(root, candidate) { var normalizedRoot = normalizedPath(root); var normalizedCandidate = normalizedPath(candidate); return normalizedCandidate === normalizedRoot || normalizedCandidate.indexOf(normalizedRoot + "/") === 0; }
          var project = app.project;
          if (!project || !project.file) return __aeError("Open a saved After Effects project inside approved_workspace_path before queuing a render");
          if (!isInside("${escapeForAfterEffects(plan.workspace)}", project.file.fsName)) return __aeError("The open After Effects project is outside approved_workspace_path; no render was queued");
          var outputFile = new File("${escapeForAfterEffects(plan.outputPath)}");
          if (outputFile.exists) return __aeError("The planned output now exists; no render was queued");
          var comp = null;
          for (var i = 1; i <= project.numItems; i++) if (project.item(i) instanceof CompItem && String(project.item(i).name) === "${escapeForAfterEffects(plan.compositionName)}") { comp = project.item(i); break; }
          if (!comp) return __aeError("The previewed composition does not exist in the open project");
          var item = project.renderQueue.items.add(comp);
          try { item.applyTemplate("${escapeForAfterEffects(plan.renderSettingsTemplate)}"); } catch (renderTemplateError) { item.remove(); return __aeError("After Effects could not apply the requested render-settings template: " + String(renderTemplateError)); }
          var outputModule = item.outputModule(1);
          try { outputModule.applyTemplate("${escapeForAfterEffects(plan.outputModuleTemplate)}"); } catch (outputTemplateError) { item.remove(); return __aeError("After Effects could not apply the requested output-module template: " + String(outputTemplateError)); }
          outputModule.file = outputFile;
          project.save(project.file);
          return __aeResult({ queued: true, queueItemIndex: item.index, compositionName: String(comp.name), outputPath: outputFile.fsName, renderStarted: false, renderVerified: false, verificationScope: "The item was queued only. Start the queue in After Effects, then verify the resulting media file separately." });
        `), bridgeOptions);
        return result.success ? { ...result, data: { ...(result.data as object), operationId } } : { ...result, error: `${result.error ?? "After Effects render enqueue failed"} (operation ${operationId})` };
      },
    },
    preview_mogrt_premiere_handoff: {
      description: "Preview a contained MOGRT import into one explicitly named disposable Premiere verification sequence and empty video track. It does not contact Premiere or alter a sequence.",
      parameters: { type: "object" as const, additionalProperties: false, properties: { approved_workspace_path: { type: "string", description: "Absolute operator-approved workspace root." }, mogrt_path: { type: "string", description: "Existing workspace-contained MOGRT artifact." }, sequence_id: { type: "string", description: "Exact Premiere sequence identifier to recheck before import." }, disposable_sequence_name: { type: "string", description: "Must begin with 'MOGRT Verify - '." }, video_track_index: { type: "integer", description: "Empty video track index for the imported MOGRT; defaults to 0." }, audio_track_index: { type: "integer", description: "Audio track index passed to Premiere; defaults to 0." }, start_seconds: { type: "number", description: "Insertion start time in seconds; defaults to 0." } }, required: ["approved_workspace_path", "mogrt_path", "sequence_id", "disposable_sequence_name"] },
      handler: async (args: unknown) => {
        const operationId = nextOperationId();
        requireCapability(capabilities, "inspect", operationId);
        requireCapability(capabilities, "filesystem", operationId);
        const plan = premiereHandoffPlan(args, artifactStatus);
        const previewToken = issue(handoffPlans, plan);
        return { success: true, data: { operationId, previewToken, expiresInSeconds: PLAN_TTL_MS / 1000, plan, verificationScope: "This validates the artifact and exact intended Premiere target locally. Applying rechecks the sequence name and requires the requested video track to be empty." } };
      },
    },
    apply_mogrt_premiere_handoff: {
      description: "Import exactly one previewed MOGRT into the empty track of the explicit disposable Premiere verification sequence, then read back insertion and control descriptors. Requires explicit confirmation; no rendered-frame claim is made.",
      parameters: { type: "object" as const, additionalProperties: false, properties: { preview_token: { type: "string", description: "One-time token returned by preview_mogrt_premiere_handoff." }, confirm_import: { type: "boolean", description: "Must be true to import into the explicit verification sequence." } }, required: ["preview_token", "confirm_import"] },
      handler: async (args: unknown) => {
        const operationId = nextOperationId();
        requireCapability(capabilities, "edit", operationId);
        requireCapability(capabilities, "filesystem", operationId);
        const input = asObject(args, "arguments");
        assertOnlyKeys(input, ["preview_token", "confirm_import"], "arguments");
        if (input.confirm_import !== true) throw new Error("confirm_import must be true to import the MOGRT into Premiere");
        const plan = take(handoffPlans, input.preview_token, "preview_token");
        if (!artifactStatus(plan.mogrtPath).zip_header_valid) return { success: false, error: "The previewed MOGRT artifact is no longer a recognizable ZIP-based file" };
        const result = await sendPremiere(buildPremiereHandoffScript(plan), bridgeOptions);
        return result.success ? { ...result, data: { ...(result.data as object), operationId } } : { ...result, error: `${result.error ?? "Premiere MOGRT handoff failed"} (operation ${operationId})` };
      },
    },
  };
}
