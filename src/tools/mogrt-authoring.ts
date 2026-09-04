import { randomUUID } from "node:crypto";
import { existsSync, openSync, closeSync, readSync, statSync } from "node:fs";
import path from "node:path";
import type { BridgeOptions, CommandResult } from "../bridge/file-bridge.js";
import { sendAfterEffectsCommand } from "../bridge/after-effects-bridge.js";
import {
  buildAfterEffectsScript,
  escapeForAfterEffects,
} from "../bridge/after-effects-script-builder.js";
import {
  type CapabilityConfig,
  createOperationId,
  requireCapability,
  resolveCapabilities,
} from "../security/index.js";

type Recipe = "lower_third";

interface MogrtPlan {
  schema_version: 1;
  recipe: Recipe;
  template_name: string;
  headline: string;
  subtitle?: string;
  accent_color: string;
  text_color: string;
  duration_seconds: number;
  width: number;
  height: number;
  frame_rate: number;
  approved_workspace_path: string;
  output_directory: string;
  output_path: string;
}

interface IssuedPlan {
  plan: MogrtPlan;
  expiresAt: number;
}

export interface MogrtAuthoringDependencies {
  capabilities?: CapabilityConfig;
  send?: (script: string, options: BridgeOptions) => Promise<CommandResult>;
  directoryExists?: (candidate: string) => boolean;
  artifactStatus?: (candidate: string) => MogrtArtifactStatus;
  now?: () => number;
  tokenFactory?: () => string;
  operationIdFactory?: () => string;
}

export interface MogrtArtifactStatus {
  exists: boolean;
  size_bytes: number | null;
  zip_header_valid: boolean;
}

const MAX_TEXT = 160;
const MAX_PATH = 4096;
const PLAN_TTL_MS = 10 * 60 * 1000;
const FRAME_RATES = new Set([23.976, 24, 25, 29.97, 30, 50, 59.94, 60]);

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function assertOnlyKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`${field} contains unsupported field: ${key}`);
  }
}

function requiredText(value: unknown, field: string, maxLength = MAX_TEXT): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${field} must be at most ${maxLength} characters`);
  return normalized;
}

function optionalText(value: unknown, field: string, maxLength = MAX_TEXT): string | undefined {
  return value === undefined ? undefined : requiredText(value, field, maxLength);
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

function templateName(value: unknown): string {
  const name = requiredText(value, "template_name", 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(name) || /[. ]$/.test(name)) {
    throw new Error("template_name must use letters, numbers, spaces, underscores, or hyphens and cannot end with a dot or space");
  }
  return name;
}

function color(value: unknown, field: string, fallback: string): string {
  const selected = value === undefined ? fallback : requiredText(value, field, 7);
  if (!/^#[0-9a-fA-F]{6}$/.test(selected)) throw new Error(`${field} must be a #RRGGBB color`);
  return selected.toUpperCase();
}

function isAbsolutePortable(value: string): boolean {
  return path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

function resolvePathFamily(value: string): { api: typeof path.win32; resolved: string; windows: boolean } {
  if (path.win32.isAbsolute(value) && !path.posix.isAbsolute(value)) {
    return { api: path.win32, resolved: path.win32.resolve(value), windows: true };
  }
  if (path.posix.isAbsolute(value)) return { api: path.posix, resolved: path.posix.resolve(value), windows: false };
  throw new Error("Path must be absolute");
}

function workspaceOutput(root: string, outputDirectory: string, name: string): { root: string; directory: string; output: string } {
  if (!isAbsolutePortable(root) || !isAbsolutePortable(outputDirectory)) {
    throw new Error("approved_workspace_path and output_directory must be absolute paths");
  }
  const rootPath = resolvePathFamily(root);
  const directoryPath = resolvePathFamily(outputDirectory);
  if (rootPath.windows !== directoryPath.windows) {
    throw new Error("approved_workspace_path and output_directory must use the same path format");
  }
  const relative = rootPath.api.relative(rootPath.resolved, directoryPath.resolved);
  if (relative === ".." || relative.startsWith(`..${rootPath.api.sep}`) || rootPath.api.isAbsolute(relative)) {
    throw new Error("output_directory must be inside approved_workspace_path");
  }
  return {
    root: rootPath.resolved,
    directory: directoryPath.resolved,
    output: rootPath.api.join(directoryPath.resolved, `${name}.mogrt`),
  };
}

function buildPlan(value: unknown, directoryExists: (candidate: string) => boolean): MogrtPlan {
  const input = asObject(value, "arguments");
  assertOnlyKeys(input, [
    "recipe", "template_name", "headline", "subtitle", "accent_color", "text_color",
    "duration_seconds", "width", "height", "frame_rate", "approved_workspace_path", "output_directory",
  ], "arguments");
  const recipe = input.recipe === undefined ? "lower_third" : input.recipe;
  if (recipe !== "lower_third") throw new Error("recipe must be lower_third");
  const name = templateName(input.template_name);
  const output = workspaceOutput(
    requiredText(input.approved_workspace_path, "approved_workspace_path", MAX_PATH),
    requiredText(input.output_directory, "output_directory", MAX_PATH),
    name,
  );
  if (!directoryExists(output.directory)) {
    throw new Error("output_directory must already exist; this workflow never creates output folders");
  }
  const frameRate = finiteNumber(input.frame_rate, "frame_rate", 30, 1, 120);
  if (!FRAME_RATES.has(frameRate)) {
    throw new Error("frame_rate must be one of 23.976, 24, 25, 29.97, 30, 50, 59.94, or 60");
  }
  return {
    schema_version: 1,
    recipe,
    template_name: name,
    headline: requiredText(input.headline, "headline"),
    subtitle: optionalText(input.subtitle, "subtitle"),
    accent_color: color(input.accent_color, "accent_color", "#2563EB"),
    text_color: color(input.text_color, "text_color", "#FFFFFF"),
    duration_seconds: finiteNumber(input.duration_seconds, "duration_seconds", 5, 2, 30),
    width: wholeNumber(input.width, "width", 1920, 320, 7680),
    height: wholeNumber(input.height, "height", 1080, 240, 4320),
    frame_rate: frameRate,
    approved_workspace_path: output.root,
    output_directory: output.directory,
    output_path: output.output,
  };
}

function rgb(value: string): [number, number, number] {
  return [
    Number.parseInt(value.slice(1, 3), 16) / 255,
    Number.parseInt(value.slice(3, 5), 16) / 255,
    Number.parseInt(value.slice(5, 7), 16) / 255,
  ];
}

function scriptForPlan(plan: MogrtPlan): string {
  const accent = rgb(plan.accent_color).join(", ");
  const text = rgb(plan.text_color).join(", ");
  const subtitleLayer = plan.subtitle
    ? `
      var subtitleLayer = comp.layers.addText("${escapeForAfterEffects(plan.subtitle)}");
      subtitleLayer.name = "Subtitle";
      var subtitleSource = subtitleLayer.property("ADBE Text Properties").property("ADBE Text Document");
      var subtitleDocument = subtitleSource.value;
      subtitleDocument.fontSize = ${Math.max(24, Math.round(plan.height * 0.032))};
      subtitleDocument.fillColor = [${text}];
      subtitleDocument.applyFill = true;
      subtitleSource.setValue(subtitleDocument);
      subtitleLayer.property("ADBE Transform Group").property("ADBE Position").setValue([${Math.round(plan.width * 0.12)}, ${Math.round(plan.height * 0.83)}]);
      subtitleExposed = expose(subtitleSource);
    `
    : "";

  return buildAfterEffectsScript(`
    function normalizedPath(value) {
      return String(value).replace(/\\\\/g, "/").replace(/\\/+$/, "").toLowerCase();
    }
    function isInside(root, candidate) {
      var normalizedRoot = normalizedPath(root);
      var normalizedCandidate = normalizedPath(candidate);
      return normalizedCandidate === normalizedRoot || normalizedCandidate.indexOf(normalizedRoot + "/") === 0;
    }
    function expose(property) {
      try {
        if (!property || typeof property.addToMotionGraphicsTemplate !== "function") return false;
        if (typeof property.canAddToMotionGraphicsTemplate === "function" && !property.canAddToMotionGraphicsTemplate()) return false;
        return property.addToMotionGraphicsTemplate() === true;
      } catch (exposeError) {
        return false;
      }
    }
    var workspacePath = "${escapeForAfterEffects(plan.approved_workspace_path)}";
    var outputDirectory = "${escapeForAfterEffects(plan.output_directory)}";
    var outputPath = "${escapeForAfterEffects(plan.output_path)}";
    var project = app.project;
    if (!project || !project.file) return __aeError("Open a saved After Effects project inside approved_workspace_path before creating a MOGRT; this workflow never creates or replaces projects");
    if (!isInside(workspacePath, project.file.fsName)) return __aeError("The open After Effects project is outside approved_workspace_path; no composition was created");
    var destination = new Folder(outputDirectory);
    if (!destination.exists) return __aeError("The approved output directory no longer exists; no composition was created");
    var existing = new File(outputPath);
    if (existing.exists) return __aeError("A MOGRT already exists at the planned output path; preview a new plan only after moving or deliberately replacing it");
    app.beginUndoGroup("Create ${escapeForAfterEffects(plan.template_name)} MOGRT");
    try {
      var comp = project.items.addComp("${escapeForAfterEffects(plan.template_name)}", ${plan.width}, ${plan.height}, 1, ${plan.duration_seconds}, ${plan.frame_rate});
      comp.motionGraphicsTemplateName = "${escapeForAfterEffects(plan.template_name)}";
      var backing = comp.layers.addShape();
      backing.name = "Accent bar";
      var shapeContents = backing.property("ADBE Root Vectors Group");
      var rect = shapeContents.addProperty("ADBE Vector Shape - Rect");
      rect.property("ADBE Vector Rect Size").setValue([${Math.round(plan.width * 0.78)}, ${Math.round(plan.height * 0.2)}]);
      var fill = shapeContents.addProperty("ADBE Vector Graphic - Fill");
      var fillColor = fill.property("ADBE Vector Fill Color");
      fillColor.setValue([${accent}]);
      backing.property("ADBE Transform Group").property("ADBE Position").setValue([${Math.round(plan.width * 0.45)}, ${Math.round(plan.height * 0.79)}]);
      var accentControl = backing.property("ADBE Effect Parade").addProperty("ADBE Color Control");
      accentControl.name = "Accent Color";
      var accentProperty = accentControl.property(1);
      accentProperty.setValue([${accent}]);
      try { fillColor.expression = 'effect("Accent Color")("Color")'; } catch (expressionError) {}
      var headlineLayer = comp.layers.addText("${escapeForAfterEffects(plan.headline)}");
      headlineLayer.name = "Headline";
      var headlineSource = headlineLayer.property("ADBE Text Properties").property("ADBE Text Document");
      var headlineDocument = headlineSource.value;
      headlineDocument.fontSize = ${Math.max(32, Math.round(plan.height * 0.06))};
      headlineDocument.fillColor = [${text}];
      headlineDocument.applyFill = true;
      headlineSource.setValue(headlineDocument);
      headlineLayer.property("ADBE Transform Group").property("ADBE Position").setValue([${Math.round(plan.width * 0.12)}, ${Math.round(plan.height * 0.75)}]);
      var headlineExposed = expose(headlineSource);
      var accentExposed = expose(accentProperty);
      var subtitleExposed = false;
      ${subtitleLayer}
      project.save(project.file);
      var hostExportReturn = comp.exportAsMotionGraphicsTemplate(false, outputDirectory);
      return __aeResult({
        exportRequested: true,
        hostExportReturn: hostExportReturn === true,
        artifactExistsAtHostReturn: new File(outputPath).exists,
        outputPath: outputPath,
        recipe: "lower_third",
        projectMutated: true,
        exposedControls: { headline: headlineExposed, subtitle: subtitleExposed, accentColor: accentExposed },
        visualVerified: false,
        verificationScope: "After Effects accepted the authoring request. Verify the local .mogrt artifact, import it into a disposable Premiere sequence, and inspect a rendered frame before delivery."
      });
    } finally {
      app.endUndoGroup();
    }
  `);
}

export function inspectMogrtArtifact(candidate: string): MogrtArtifactStatus {
  if (!existsSync(candidate)) return { exists: false, size_bytes: null, zip_header_valid: false };
  try {
    const descriptor = openSync(candidate, "r");
    try {
      const header = Buffer.alloc(2);
      const bytes = readSync(descriptor, header, 0, header.length, 0);
      return {
        exists: true,
        size_bytes: statSync(candidate).size,
        zip_header_valid: bytes === 2 && header[0] === 0x50 && header[1] === 0x4b,
      };
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return { exists: true, size_bytes: null, zip_header_valid: false };
  }
}

function expectedArtifact(value: unknown): { workspace: string; artifact: string } {
  const input = asObject(value, "arguments");
  assertOnlyKeys(input, ["approved_workspace_path", "mogrt_path"], "arguments");
  const workspace = requiredText(input.approved_workspace_path, "approved_workspace_path", MAX_PATH);
  const artifact = requiredText(input.mogrt_path, "mogrt_path", MAX_PATH);
  if (!/\.mogrt$/i.test(artifact)) throw new Error("mogrt_path must end in .mogrt");
  const artifactPath = resolvePathFamily(artifact);
  const plan = workspaceOutput(
    workspace,
    artifactPath.api.dirname(artifactPath.resolved),
    artifactPath.api.basename(artifactPath.resolved, artifactPath.api.extname(artifactPath.resolved)),
  );
  if (plan.output !== artifactPath.resolved) throw new Error("mogrt_path must be a direct .mogrt file inside approved_workspace_path");
  return { workspace: plan.root, artifact: plan.output };
}

export function getMogrtAuthoringTools(
  bridgeOptions: BridgeOptions,
  dependencies: MogrtAuthoringDependencies = {},
) {
  const capabilities = dependencies.capabilities ?? resolveCapabilities();
  const send = dependencies.send ?? sendAfterEffectsCommand;
  const directoryExists = dependencies.directoryExists ?? ((candidate) => {
    try { return statSync(candidate).isDirectory(); } catch { return false; }
  });
  const artifactStatus = dependencies.artifactStatus ?? inspectMogrtArtifact;
  const now = dependencies.now ?? Date.now;
  const tokenFactory = dependencies.tokenFactory ?? randomUUID;
  const nextOperationId = dependencies.operationIdFactory ?? createOperationId;
  const plans = new Map<string, IssuedPlan>();

  const takePlan = (token: unknown): MogrtPlan => {
    const key = requiredText(token, "preview_token", 128);
    const issued = plans.get(key);
    if (!issued || issued.expiresAt <= now()) {
      plans.delete(key);
      throw new Error("preview_token is missing, expired, or already used; preview the MOGRT recipe again");
    }
    plans.delete(key);
    return issued.plan;
  };

  return {
    verify_after_effects_connection: {
      description: "Read-only check that the dedicated After Effects CEP connector is running. It never reads project names, media, or paths.",
      parameters: { type: "object" as const, additionalProperties: false, properties: {} },
      handler: async () => {
        const operationId = nextOperationId();
        requireCapability(capabilities, "inspect", operationId);
        const result = await send(buildAfterEffectsScript(`
          var project = app.project;
          return __aeResult({
            connected: true,
            application: app.name,
            version: app.version,
            hasSavedProject: !!(project && project.file),
            projectItemCount: project && project.items ? project.items.length : 0,
            readOnly: true
          });
        `), { ...bridgeOptions, timeoutMs: Math.min(bridgeOptions.timeoutMs ?? 5000, 5000), failFastOnUnreadyHeartbeat: true });
        return result.success
          ? { ...result, data: { ...(result.data as object), operationId } }
          : { ...result, error: `${result.error ?? "After Effects connection check failed"} (operation ${operationId})` };
      },
    },
    preview_mogrt_recipe: {
      description: "Preview a bounded After Effects lower-third MOGRT recipe. It validates one existing workspace output directory but does not contact Adobe or write any files.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          recipe: { type: "string", enum: ["lower_third"], description: "The only currently supported authored template recipe." },
          template_name: { type: "string", description: "Safe template file stem; the generated artifact is template_name.mogrt." },
          headline: { type: "string", description: "Primary lower-third text, at most 160 characters." },
          subtitle: { type: "string", description: "Optional secondary lower-third text, at most 160 characters." },
          accent_color: { type: "string", description: "Optional accent fill color as #RRGGBB; defaults to #2563EB." },
          text_color: { type: "string", description: "Optional text color as #RRGGBB; defaults to #FFFFFF." },
          duration_seconds: { type: "number", description: "Composition duration between 2 and 30 seconds; defaults to 5." },
          width: { type: "integer", description: "Composition width from 320 to 7680 pixels; defaults to 1920." },
          height: { type: "integer", description: "Composition height from 240 to 4320 pixels; defaults to 1080." },
          frame_rate: { type: "number", enum: [23.976, 24, 25, 29.97, 30, 50, 59.94, 60], description: "Composition frame rate; defaults to 30." },
          approved_workspace_path: { type: "string", description: "Absolute operator-approved workspace root containing the saved AE project and output directory." },
          output_directory: { type: "string", description: "Existing absolute output directory inside approved_workspace_path; this workflow never creates directories." },
        },
        required: ["template_name", "headline", "approved_workspace_path", "output_directory"],
      },
      handler: async (args: unknown) => {
        const operationId = nextOperationId();
        requireCapability(capabilities, "inspect", operationId);
        requireCapability(capabilities, "filesystem", operationId);
        const plan = buildPlan(args, directoryExists);
        const token = tokenFactory();
        plans.set(token, { plan, expiresAt: now() + PLAN_TTL_MS });
        return {
          success: true,
          data: {
            operationId,
            applied: false,
            plan,
            previewToken: token,
            expiresInSeconds: PLAN_TTL_MS / 1000,
            changes: [
              "Create one lower-third composition in the open saved After Effects project.",
              "Expose the bounded headline, optional subtitle, and accent-color controls.",
              "Save the open project and request a .mogrt export at the planned output path.",
            ],
            verificationScope: "This is a local preview only. It does not connect to After Effects, inspect the active project, or create a composition or file.",
          },
        };
      },
    },
    create_mogrt_recipe: {
      description: "Create exactly one previewed lower-third MOGRT in a saved After Effects project inside the approved workspace. Requires explicit export confirmation; it never creates projects or output folders.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          preview_token: { type: "string", description: "One-time token returned by preview_mogrt_recipe; it expires after 10 minutes." },
          confirm_export: { type: "boolean", description: "Must be true to save the open AE project and request the planned .mogrt export." },
        },
        required: ["preview_token", "confirm_export"],
      },
      handler: async (args: unknown) => {
        const operationId = nextOperationId();
        requireCapability(capabilities, "edit", operationId);
        requireCapability(capabilities, "export", operationId);
        requireCapability(capabilities, "filesystem", operationId);
        const input = asObject(args, "arguments");
        assertOnlyKeys(input, ["preview_token", "confirm_export"], "arguments");
        if (input.confirm_export !== true) throw new Error("confirm_export must be true to create the MOGRT");
        const plan = takePlan(input.preview_token);
        const result = await send(scriptForPlan(plan), bridgeOptions);
        if (!result.success) {
          return { ...result, error: `${result.error ?? "MOGRT authoring failed"} (operation ${operationId})` };
        }
        return {
          ...result,
          data: {
            ...(result.data as object),
            operationId,
            artifact: artifactStatus(plan.output_path),
            artifactPath: plan.output_path,
          },
        };
      },
    },
    verify_mogrt_artifact: {
      description: "Verify that a workspace-contained .mogrt artifact exists locally and has a ZIP header. This does not prove controls, import compatibility, playback, or visual correctness.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          approved_workspace_path: { type: "string", description: "Absolute operator-approved workspace root containing mogrt_path." },
          mogrt_path: { type: "string", description: "Absolute .mogrt artifact path inside approved_workspace_path." },
        },
        required: ["approved_workspace_path", "mogrt_path"],
      },
      handler: async (args: unknown) => {
        const operationId = nextOperationId();
        requireCapability(capabilities, "inspect", operationId);
        requireCapability(capabilities, "filesystem", operationId);
        const expected = expectedArtifact(args);
        const artifact = artifactStatus(expected.artifact);
        return {
          success: artifact.exists && artifact.zip_header_valid,
          ...(artifact.exists && artifact.zip_header_valid
            ? { data: { operationId, mogrtPath: expected.artifact, artifact, visualVerified: false, importVerified: false, verificationScope: "Local file existence and ZIP header only. Import this artifact into a disposable Premiere sequence and inspect a rendered frame before delivery." } }
            : { error: artifact.exists ? "The artifact is not a recognizable ZIP-based .mogrt file" : "The MOGRT artifact does not exist" }),
        };
      },
    },
  };
}
