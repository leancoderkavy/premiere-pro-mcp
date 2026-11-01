import { randomUUID } from "node:crypto";
import { requiredArgumentError } from "./security/required-arguments.js";
import {
  type CallToolResult,
  fromJsonSchema,
  McpServer,
  type JsonSchemaType,
  type StandardSchemaWithJSON,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";
import { BridgeOptions, getTempDir, withBridgeWorkflow } from "./bridge/file-bridge.js";
import { markHostRecovery } from "./bridge/host-lease.js";
import { runWithExpectedProject, runWithExpectedHostTarget } from "./bridge/project-guard.js";
import { runWithUndoTracking } from "./bridge/undo-tracking.js";
import { getDiscoveryTools } from "./tools/discovery.js";
import { getProjectTools } from "./tools/project.js";
import { getMediaTools } from "./tools/media.js";
import { getSequenceTools } from "./tools/sequence.js";
import { getTimelineTools } from "./tools/timeline.js";
import { getRippleRemoveRangesTools } from "./tools/ripple-remove-ranges.js";
import { getEffectsTools } from "./tools/effects.js";
import { getTransitionsTools } from "./tools/transitions.js";
import { getAudioTools } from "./tools/audio.js";
import { getSourceToTimelineTools } from "./tools/source-to-timeline.js";
import { getTextTools } from "./tools/text.js";
import { getStockTitleTools } from "./tools/stock-titles.js";
import { getMarkerTools } from "./tools/markers.js";
import { getTrackTools } from "./tools/tracks.js";
import { getPlayheadTools } from "./tools/playhead.js";
import { getMetadataTools } from "./tools/metadata.js";
import { getExportTools } from "./tools/export.js";
import { getMediaAnalysisTools } from "./tools/media-analysis.js";
import { getInterchangeAnalysisTools } from "./tools/interchange-analysis.js";
import { getAdvancedTools } from "./tools/advanced.js";
import { getKeyframeTools } from "./tools/keyframes.js";
import { getScriptingTools } from "./tools/scripting.js";
import { getInspectionTools } from "./tools/inspection.js";
import { getSelectionTools } from "./tools/selection.js";
import { getClipboardTools } from "./tools/clipboard.js";
import { getSourceMonitorTools } from "./tools/source-monitor.js";
import { getTrackTargetingTools } from "./tools/track-targeting.js";
import { getUtilityTools } from "./tools/utility.js";
import { getHealthTools } from "./tools/health.js";
import { getWorkspaceTools } from "./tools/workspace.js";
import { getCaptionTools } from "./tools/captions.js";
import { getPlaybackTools } from "./tools/playback.js";
import { getProjectManagerTools } from "./tools/project-manager.js";
import { getEditPlanTools } from "./tools/edit-plans.js";
import { getSpotWorkflowTools } from "./tools/spot-workflows.js";
import { getAvSettingsTools } from "./tools/av-settings.js";
import { getRecoveryTools } from "./tools/recovery.js";
import { getProjectContextTools } from "./tools/project-context.js";
import { getEditorialPlanTools } from "./tools/editorial-plans.js";
import { getEditorialContextPackTools } from "./tools/editorial-context-pack.js";
import { getFilmEditorialTools } from "./tools/film-editorial.js";
import { ProjectContextRepository } from "./context/project-context-store.js";
import { getProjectIntakeTools } from "./tools/project-intake.js";
import { getCompetitorGapTools } from "./tools/competitor-gaps.js";
import { getEditorialReviewTools } from "./tools/editorial-review.js";
import { getDialogueAnalysisTools } from "./tools/dialogue-analysis.js";
import { MediaWatchRegistry, getMediaWatchTools } from "./tools/media-watch.js";
import { getWorkflowRecipeTools } from "./tools/workflow-recipes.js";
import { getTimelineQaTools } from "./tools/timeline-qa.js";
import { getCrossAppWorkflowTools } from "./tools/cross-app-workflow.js";
import { getSpeakerLayoutTools } from "./tools/speaker-layout.js";
import { getMaskFitTools } from "./tools/mask-fit.js";
import { getRhythmPlanTools } from "./tools/rhythm-plans.js";
import { getShortsIntelligenceTools } from "./tools/shorts-intelligence.js";
import { getCaptionAuthoringTools } from "./tools/caption-authoring.js";
import { getReactionShortsTools } from "./tools/reaction-shorts.js";
import { getTranscriptWordEditTools } from "./tools/transcript-word-edits.js";
import { getPlatformDeliveryTools } from "./tools/platform-delivery.js";
import { getEditorRequestTools } from "./tools/editor-requests.js";
import { getReviewPlanTools } from "./tools/review-plans.js";
import { getExecutionWorkflowTools } from "./tools/execution-workflows.js";
import { getOperationRecoveryTools } from "./tools/operation-recovery.js";
import { getTimelineEditorialTools } from "./tools/timeline-editorial.js";
import { getInterchangeWorkflowTools } from "./tools/interchange-workflows.js";
import { getTemporalRenderEvidenceTools } from "./tools/temporal-render-evidence.js";
import { deriveToolOperationalCapability } from "./tool-capability-report.js";
import { getUxpTools } from "./tools/uxp.js";
import { getMogrtAuthoringTools } from "./tools/mogrt-authoring.js";
import { getMogrtStudioTools } from "./tools/mogrt-studio.js";
import { getRenderHandoffTools } from "./tools/render-handoff.js";
import { getSendToAfterEffectsTools } from "./tools/send-to-after-effects.js";
import type { UxpWebSocketBridge } from "./bridge/uxp-websocket-bridge.js";
import {
  guardToolHandler,
  isToolPermitted,
  resolveCapabilities,
} from "./security/index.js";
import { capabilitiesForToolInvocation, toolMayChangeState } from "./security/capabilities.js";
import { EXTENDSCRIPT_REFERENCE } from "./resources/extendscript-reference.js";
import { getLiveContextResources } from "./resources/live-context-resources.js";
import { PROJECT_CONTEXT_RESOURCE } from "./context/project-context-resource.js";
import { buildPremiereInstructions } from "./workflows/agent-instructions.js";
import { WORKFLOW_PROMPTS, WORKFLOW_RESOURCE } from "./workflows/catalog.js";
import {
  annotationsForTool,
  structuredToolResult,
} from "./workflows/tool-metadata.js";
import {
  isToolInSelectedPacks,
  resolveToolPacks,
  type ToolPackSelection,
} from "./workflows/tool-packs.js";
import { getTelemetry, telemetryErrorType, type Telemetry } from "./telemetry.js";
import { currentInvocation, withInvocationContext, reportProgress } from "./workflows/invocation-context.js";
import { beginOperation, finishOperation, type OperationLogEntry } from "./workflows/operation-log.js";
import { claimIdempotencyKey, completeIdempotencyKey, idempotencyResponse, IDEMPOTENCY_KEY_SCHEMA, type IdempotencyClaim } from "./workflows/idempotency.js";
import { mutationReceipt } from "./workflows/mutation-receipt.js";
import { argumentDiagnostics, strictDeclaredObjects } from "./workflows/strict-schema.js";
import { recordPerformance } from "./workflows/performance-diagnostics.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Read the version from package.json rather than hardcoding it. A literal here
 * silently drifts from the published package every release, which makes the
 * version reported over MCP useless for triaging bug reports.
 */
export const SERVER_VERSION = ((): string => {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(path.resolve(here, "../package.json"), "utf8");
    const version: unknown = JSON.parse(raw).version;
    return typeof version === "string" && version ? version : "unknown";
  } catch {
    return "unknown";
  }
})();


interface ToolDef {
  description: string;
  parameters: Record<string, unknown>;
  annotations?: ToolAnnotations;
  handler: (
    args: any,
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;
}

const toolCatalogCache = new Map<string, Record<string, ToolDef>>();
const inputSchemaCache = new WeakMap<
  Record<string, unknown>,
  StandardSchemaWithJSON<unknown, unknown>
>();
const inputSchemaContentCache = new Map<
  string,
  StandardSchemaWithJSON<unknown, unknown>
>();
const JSON_SCHEMA_DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";
const toolResultOutputSchema = fromJsonSchema({
  $schema: JSON_SCHEMA_DRAFT_2020_12,
  type: "object",
  additionalProperties: false,
  properties: {
    ok: {
      type: "boolean",
      description: "Whether the tool completed successfully.",
    },
    tool: {
      type: "string",
      minLength: 1,
      description: "The registered MCP tool name.",
    },
    data: {
      description: "Tool-specific result data when ok is true; on failure, diagnostic detail when the tool provides it.",
    },
    error: {
      type: "string",
      description: "Failure detail when ok is false.",
    },
    receipt: {
      type: "object",
      description: "Versioned common mutation receipt; success never implies rendered verification.",
      additionalProperties: true,
    },
    idempotency: {
      type: "object",
      description: "Present when idempotency_key deduplicated this call: replayed is true when the original outcome was returned instead of running again.",
      additionalProperties: true,
    },
  },
  required: ["ok", "tool"],
} as JsonSchemaType);
const debugEnabled = /^(1|true|yes|on|debug)$/i.test(
  process.env.PREMIERE_MCP_DEBUG ?? "",
);

function debugLog(message: string): void {
  if (debugEnabled) {
    console.error(`[premiere-pro-mcp] ${message}`);
  }
}

/**
 * AJV reports an unknown argument only as "must NOT have additional
 * properties". Name the offending keys and the accepted ones so a caller can
 * fix a misspelling instead of guessing.
 */
function namingUnknownArguments(
  schema: StandardSchemaWithJSON<unknown, unknown>,
  allowed: string[] | null,
  sourceSchema: Record<string, unknown>,
): StandardSchemaWithJSON<unknown, unknown> {
  const standard = schema["~standard"];
  const allowedSet = new Set(allowed ?? []);
  return {
    "~standard": {
      ...standard,
      validate: async (value: unknown) => {
        const diagnostics = argumentDiagnostics(value, sourceSchema);
        if (diagnostics.length) return { issues: diagnostics.map(message => ({ message })) };
        const result = await standard.validate(value);
        if (!("issues" in result) || !result.issues) {
          return result;
        }
        const issues = result.issues.map((issue) => {
          const message = issue.message.replace(/data([^\s,]*) must be equal to one of the allowed values/g, (original, pointer: string) => {
            let node: unknown = sourceSchema;
            for (const segment of pointer.split("/").slice(1)) {
              if (!node || typeof node !== "object") break;
              const current = node as Record<string, unknown>;
              const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
              node = current.type === "array" ? current.items : (current.properties as Record<string, unknown> | undefined)?.[key];
            }
            const values = node && typeof node === "object" ? (node as Record<string, unknown>).enum : undefined;
            return Array.isArray(values) ? `${original}; allowed values: ${values.map((entry) => JSON.stringify(entry)).join(", ")}` : original;
          });
          return { ...issue, message };
        });
        const unknown = allowed && value && typeof value === "object" && !Array.isArray(value)
          ? Object.keys(value).filter((key) => !allowedSet.has(key)) : [];
        if (unknown.length === 0) return { issues };
        const message = `unknown argument${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")}; this tool accepts: ${(allowed ?? []).join(", ") || "no arguments"}`;
        return {
          issues: [
            { message },
            ...issues.filter((issue) => !/additional properties/.test(issue.message)),
          ],
        };
      },
    },
  } as StandardSchemaWithJSON<unknown, unknown>;
}

/**
 * Reuse the source JSON Schema directly. The MCP SDK's adapter supplies both
 * AJV validation and the exact schema needed for tools/list, avoiding a costly
 * Zod-to-JSON-Schema conversion for every stateless HTTP request.
 */
function jsonSchemaToInputSchema(
  params: Record<string, unknown>,
): StandardSchemaWithJSON<unknown, unknown> {
  const cached = inputSchemaCache.get(params);
  if (cached) return cached;

  // Context-aware tools are intentionally re-created for each server, so their
  // parameter objects have new identities even though their JSON Schema is
  // unchanged. Reuse the compiled adapter by schema content as well.
  const cacheKey = JSON.stringify(params);
  const contentCached = inputSchemaContentCache.get(cacheKey);
  if (contentCached) {
    inputSchemaCache.set(params, contentCached);
    return contentCached;
  }

  const withDraft = params.$schema === undefined
    ? { $schema: JSON_SCHEMA_DRAFT_2020_12, ...params }
    : params;
  // A misspelled argument (time_seconds for start_seconds) used to be dropped
  // silently and the tool ran with its default instead. Reject unknown
  // top-level arguments whenever a tool declares its properties.
  const sourceSchema = strictDeclaredObjects(withDraft);
  const schema = namingUnknownArguments(
    fromJsonSchema(sourceSchema as JsonSchemaType),
    sourceSchema.additionalProperties === false ? Object.keys((sourceSchema.properties ?? {}) as object) : null,
    sourceSchema,
  );
  inputSchemaCache.set(params, schema);
  inputSchemaContentCache.set(cacheKey, schema);
  return schema;
}

function collectStaticTools(
  bridgeOptions: BridgeOptions,
  capabilities: ReturnType<typeof resolveCapabilities>,
): Record<string, ToolDef> {
  const cacheKey = JSON.stringify({
    tempDir: bridgeOptions.tempDir ?? process.env.PREMIERE_TEMP_DIR ?? null,
    timeoutMs:
      bridgeOptions.timeoutMs ?? process.env.PREMIERE_TIMEOUT_MS ?? null,
    failFastOnUnreadyHeartbeat: bridgeOptions.failFastOnUnreadyHeartbeat ?? false,
    capabilities: [...capabilities.capabilities].sort(),
  });
  const cached = toolCatalogCache.get(cacheKey);
  if (cached) return cached;

  const tools: Record<string, ToolDef> = {
    ...getDiscoveryTools(bridgeOptions),
    ...getProjectTools(bridgeOptions),
    ...getMediaTools(bridgeOptions),
    ...getSequenceTools(bridgeOptions),
    ...getTimelineTools(bridgeOptions),
    ...getRippleRemoveRangesTools(bridgeOptions, { capabilities }),
    ...getEffectsTools(bridgeOptions),
    ...getTransitionsTools(bridgeOptions),
    ...getAudioTools(bridgeOptions),
    ...getSourceToTimelineTools(bridgeOptions),
    ...getTextTools(bridgeOptions),
    ...getStockTitleTools(bridgeOptions),
    ...getMogrtAuthoringTools(bridgeOptions),
    ...getMogrtStudioTools(bridgeOptions),
    ...getRenderHandoffTools(bridgeOptions),
    ...getSendToAfterEffectsTools(bridgeOptions),
    ...getMarkerTools(bridgeOptions),
    ...getTrackTools(bridgeOptions),
    ...getPlayheadTools(bridgeOptions),
    ...getMetadataTools(bridgeOptions),
    ...getExportTools(bridgeOptions),
    ...getMediaAnalysisTools(bridgeOptions),
    ...getInterchangeAnalysisTools(bridgeOptions),
    ...getAdvancedTools(bridgeOptions),
    ...getKeyframeTools(bridgeOptions),
    ...getScriptingTools(bridgeOptions),
    ...getInspectionTools(bridgeOptions),
    ...getSelectionTools(bridgeOptions),
    ...getClipboardTools(bridgeOptions),
    ...getSourceMonitorTools(bridgeOptions),
    ...getTrackTargetingTools(bridgeOptions),
    ...getUtilityTools(bridgeOptions),
    ...getWorkspaceTools(bridgeOptions),
    ...getCaptionTools(bridgeOptions),
    ...getPlaybackTools(bridgeOptions),
    ...getProjectManagerTools(bridgeOptions),
    ...getEditPlanTools(bridgeOptions, { capabilities }),
    ...getSpotWorkflowTools(bridgeOptions, { capabilities }),
    ...getAvSettingsTools(bridgeOptions),
    ...getRecoveryTools(bridgeOptions),
    ...getProjectIntakeTools(bridgeOptions),
    ...getDialogueAnalysisTools(),
    ...getEditorialReviewTools(),
    ...getWorkflowRecipeTools(),
    ...getTimelineQaTools(),
    ...getCrossAppWorkflowTools(),
    ...getSpeakerLayoutTools(),
    ...getMaskFitTools(bridgeOptions),
    ...getRhythmPlanTools(),
    ...getShortsIntelligenceTools(),
    ...getCaptionAuthoringTools(),
    ...getReactionShortsTools(),
    ...getTranscriptWordEditTools(),
    ...getPlatformDeliveryTools(),
    ...getEditorRequestTools(bridgeOptions),
    ...getReviewPlanTools(),
    ...getInterchangeWorkflowTools(bridgeOptions),
    ...getTemporalRenderEvidenceTools(bridgeOptions),
  };
  toolCatalogCache.set(cacheKey, tools);
  return tools;
}

/** Every tool definition a server would register (exported for catalog tests). */
export function collectTools(
  bridgeOptions: BridgeOptions,
  capabilities: ReturnType<typeof resolveCapabilities>,
  uxpBridge?: UxpWebSocketBridge,
  telemetry?: Telemetry,
  toolPacks?: ToolPackSelection,
  projectContextRepository = new ProjectContextRepository(),
  mediaWatchRegistry = new MediaWatchRegistry(),
): Record<string, ToolDef> {
  // Streamable HTTP creates an independent McpServer for every request. Most
  // tool definitions are immutable, while context, telemetry, and UXP tools
  // close over server-specific state. Reuse only the former so initialization
  // stays fast without ever leaking one request's project context or bridge.
  const tools: Record<string, ToolDef> = {
    ...collectStaticTools(bridgeOptions, capabilities),
    ...getProjectContextTools(bridgeOptions, { repository: projectContextRepository }),
    ...getEditorialContextPackTools({ repository: projectContextRepository }),
    ...getFilmEditorialTools({ repository: projectContextRepository }),
    ...getEditorialPlanTools({ repository: projectContextRepository, uxpBridge }),
    ...getCompetitorGapTools(bridgeOptions, uxpBridge),
    ...getMediaWatchTools(mediaWatchRegistry),
    ...getOperationRecoveryTools(uxpBridge, bridgeOptions),
    ...(uxpBridge ? getUxpTools(uxpBridge) : {}),
  };
  // Compositions use the same schema and authority boundary as external calls.
  // A plan token or a discovered tool name is never authority to bypass it.
  let compositionCatalog: Record<string, ToolDef> | undefined;
  const getCompositionCatalog = () => compositionCatalog ??= Object.fromEntries(Object.entries(tools).map(([name, tool]) => [name, {
    ...tool,
    handler: async (args: unknown) => {
      const validation = await jsonSchemaToInputSchema(tool.parameters)["~standard"].validate(args);
      if ("issues" in validation && validation.issues) return { success: false, error: `INVALID_ARGUMENT: ${validation.issues.map(issue => issue.message).join("; ")}` };
      return guardToolHandler(name, tool.handler, capabilities)(args);
    },
  }]));
  Object.assign(
    tools,
    getTimelineEditorialTools(bridgeOptions, { getToolCatalog: getCompositionCatalog, capabilities }),
    getExecutionWorkflowTools(bridgeOptions, { getToolCatalog: getCompositionCatalog, capabilities, uxpBridge }),
    getHealthTools(bridgeOptions, capabilities, () => tools, {
      telemetry,
      uxpBridge,
      toolPacks,
    }),
  );
  // Clone definitions: cached static tools must not retain another caller's authority.
  return Object.fromEntries(Object.entries(tools).map(([name, tool]) => {
    const handler = guardToolHandler(name, async (args: unknown) => {
      const refused = requiredArgumentError(tool.parameters, args);
      return refused ?? tool.handler(args);
    }, capabilities);
    // Source audits inspect handler text; execution still uses the guarded function.
    Object.defineProperty(handler, "toString", { value: () => tool.handler.toString() });
    return [name, { ...tool, handler }];
  }));
}

export interface ServerOptions {
  uxpBridge?: UxpWebSocketBridge;
  telemetry?: Telemetry;
  /** Allows embedded hosts to share an explicitly configured context backend. */
  contextRepository?: ProjectContextRepository;
  /** Shares session-scoped watched-folder state across request-scoped servers. */
  mediaWatchRegistry?: MediaWatchRegistry;
  /** Overrides PREMIERE_MCP_TOOL_PACKS for this server instance. */
  toolPacks?: string;
}

/**
 * Local planners snap times to frames and default frame_rate to 30. On 24, 25,
 * or 60 fps material that silently shifts every frame number, so surface a
 * warning whenever a caller relies on that default.
 */
function withFrameRateDefaultWarning<TArgs, TResult>(tool: { parameters?: unknown; handler: (args: TArgs) => Promise<TResult> }) {
  const frameRate = (tool.parameters as { properties?: Record<string, { description?: string }> } | undefined)?.properties?.frame_rate;
  if (!frameRate || !/defaults to 30\b/.test(frameRate.description ?? "")) return tool.handler;
  return async (args: TArgs): Promise<TResult> => {
    const result = await tool.handler(args);
    const input = args as Record<string, unknown> | undefined;
    const outcome = result as { success?: boolean; data?: unknown };
    if (input?.frame_rate !== undefined || !outcome?.success || !outcome.data || typeof outcome.data !== "object" || Array.isArray(outcome.data)) {
      return result;
    }
    const data = outcome.data as Record<string, unknown>;
    const warning = "frame_rate was not given, so frame numbers assume 30 fps. Pass the sequence frame rate (get_sequence_settings) for 24, 25, or 60 fps material.";
    const warnings = Array.isArray(data.warnings) ? [...data.warnings, warning] : [warning];
    return { ...(result as object), data: { ...data, warnings } } as TResult;
  };
}

export function createServer(
  bridgeOptions: BridgeOptions,
  serverOptions: ServerOptions = {},
): McpServer {
  // Idempotency keys are scoped to this server instance: one per stdio process,
  // one per HTTP session.
  const idempotencyNamespace = randomUUID();

  const capabilities = resolveCapabilities();
  const toolPacks = serverOptions.toolPacks === undefined
    ? resolveToolPacks()
    : resolveToolPacks(serverOptions.toolPacks, "explicit");
  const telemetry = serverOptions.telemetry ?? getTelemetry();
  // Context consumers must share a single in-memory backend as well as the
  // durable backends; independent repository instances would otherwise make
  // a just-captured memory context invisible to plans and reading packs.
  const projectContextRepository = serverOptions.contextRepository ?? new ProjectContextRepository();
  const mediaWatchRegistry = serverOptions.mediaWatchRegistry ?? new MediaWatchRegistry();

  // Collect all tools from each module
  const toolModules = collectTools(
    bridgeOptions,
    capabilities,
    serverOptions.uxpBridge,
    telemetry,
    toolPacks,
    projectContextRepository,
    mediaWatchRegistry,
  );

  const premiereInstructions = buildPremiereInstructions(new Set(
    Object.keys(toolModules).filter((name) =>
      isToolPermitted(name, capabilities) && isToolInSelectedPacks(name, toolPacks)),
  ));
  const server = new McpServer(
    {
      name: "premiere-pro-mcp",
      version: SERVER_VERSION,
    },
    {
      instructions: premiereInstructions,
      cacheHints: {
        "tools/list": { ttlMs: 30_000, cacheScope: "private" },
        "prompts/list": { ttlMs: 300_000, cacheScope: "public" },
        "resources/list": { ttlMs: 60_000, cacheScope: "private" },
        "resources/read": { ttlMs: 0, cacheScope: "private" },
      },
      capabilities: {
        extensions: {
          "io.github.leancoderkavy/premiere-pro": {
            protocolRevision: "2026-07-28",
            dualEra: true,
            transports: ["stdio", "streamable-http"],
            bridgeBackends: ["cep", "uxp"],
          },
        },
      },
    },
  );

  // Register each tool with the MCP server
  let authorityWithheld = 0;
  let packWithheld = 0;
  for (const [name, tool] of Object.entries(toolModules)) {
    // Don't advertise tools the active authority profile will always refuse.
    // guardToolHandler still rejects them at call time, but listing an
    // unusable tool spends client context and invites the model to attempt a
    // call that cannot succeed.
    if (!isToolPermitted(name, capabilities)) {
      authorityWithheld++;
      continue;
    }
    // Tool packs are a discovery/context optimization. They only decide which
    // permitted tools this server registers; they never change the capability
    // guard that protects every registered handler.
    if (!isToolInSelectedPacks(name, toolPacks)) {
      packWithheld++;
      continue;
    }

    // Only tools that can change state advertise idempotency_key. A key sent
    // with a read-only action of a multi-action tool is accepted and ignored.
    const acceptsIdempotencyKey = toolMayChangeState(name);
    const inputSchema = jsonSchemaToInputSchema({
      ...tool.parameters,
      properties: {
        ...(tool.parameters as { properties?: Record<string, unknown> }).properties,
        ...(acceptsIdempotencyKey ? { idempotency_key: IDEMPOTENCY_KEY_SCHEMA } : {}),
        expected_project_path: {
          type: "string", minLength: 1, maxLength: 4096,
          description: "Optional absolute saved-project path. Every generated CEP command refuses before its body when the active project differs or is unsaved. UXP commands refuse this CEP-only guard; local-only tools do not inspect Premiere. Omit to keep existing behavior.",
        },
        expected_cep_target: {
          type: "object", additionalProperties: false,
          description: "Optional reviewed CEP sequence/clip identity and exact tick ranges. Checked before every generated command; UXP refuses this CEP-only guard.",
          properties: {
            backend: { type: "string", const: "cep", description: "Backend namespace for these IDs." },
            sequence_id: { type: "string", minLength: 1, maxLength: 512, description: "Stable expected active sequence ID." },
            project_document_id: { type: "string", minLength: 1, maxLength: 512, description: "Exact Premiere project document ID observed during review." },
            source_item: { type: "object", additionalProperties: false, description: "Reviewed source identity for a source-only operation.", properties: {
              node_id: { type: "string", minLength: 1, maxLength: 512, description: "Exact project-item node ID." },
              media_path: { type: "string", minLength: 1, maxLength: 4096, description: "Optional exact source-media path." },
            }, required: ["node_id"] },
            clip: { type: "object", additionalProperties: false, description: "Optional exact reviewed timeline clip.", properties: {
              node_id: { type: "string", minLength: 1, maxLength: 512, description: "Stable CEP node ID." },
              track_type: { type: "string", enum: ["video", "audio"], description: "Expected media track group." },
              track_index: { type: "integer", minimum: 0, maximum: 255, description: "Expected zero-based track index; identity still checked." },
              project_item_id: { type: "string", minLength: 1, maxLength: 512, description: "Expected source project-item node ID." },
              start_ticks: { type: "string", pattern: "^-?\\d{1,30}$", description: "Exact expected timeline start ticks." },
              end_ticks: { type: "string", pattern: "^-?\\d{1,30}$", description: "Exact expected exclusive timeline end ticks." },
              in_ticks: { type: "string", pattern: "^-?\\d{1,30}$", description: "Exact expected source In ticks." },
              out_ticks: { type: "string", pattern: "^-?\\d{1,30}$", description: "Exact expected exclusive source Out ticks." },
              effect: { type: "object", additionalProperties: false, description: "Reviewed effect and parameter identity checked before mutation.", properties: {
                match_name: { type: "string", minLength: 1, maxLength: 512, description: "Effect match name from host inspection." },
                display_name: { type: "string", minLength: 1, maxLength: 512, description: "Optional exact host display name." },
                parameter_index: { type: "integer", minimum: 0, maximum: 255, description: "Inspected zero-based parameter index." },
                parameter_name: { type: "string", minLength: 1, maxLength: 512, description: "Exact inspected parameter name." },
              }, required: ["match_name", "parameter_index", "parameter_name"] },
            }, required: ["node_id", "track_type", "track_index"] },
          }, required: ["backend"], anyOf: [{ required: ["sequence_id"] }, { required: ["source_item"] }],
        },
      },
    });
    const guardedHandler = guardToolHandler(name, withFrameRateDefaultWarning(tool), capabilities);

    const annotations = annotationsForTool(name, tool.annotations);
    server.registerTool(
      name,
      {
        title: annotations.title,
        description: tool.description,
        inputSchema,
        outputSchema: toolResultOutputSchema,
        annotations,
      },
      async (args: unknown, ctx) => withInvocationContext({
        signal: ctx.mcpReq.signal,
        progressToken: ctx.mcpReq._meta?.progressToken as string | number | undefined,
        notify: ctx.mcpReq.notify,
      }, async () => {
        const startedAt = Date.now();
        const { idempotency_key: idempotencyKey, ...callArgs } = (args ?? {}) as Record<string, unknown>;
        const mutating = capabilitiesForToolInvocation(name, callArgs).some(capability => capability !== "inspect");
        // Claim synchronously, before any await, so two concurrent retries
        // cannot both start. Read-only invocations are never deduplicated.
        const operation: { entry: OperationLogEntry | null } = { entry: null };
        const claim: IdempotencyClaim | null = mutating && typeof idempotencyKey === "string"
          ? claimIdempotencyKey(name, idempotencyKey, callArgs, () => (operation.entry = beginOperation(name, startedAt)).sequence, startedAt, idempotencyNamespace)
          : null;
        if (claim && claim.kind !== "new") return idempotencyResponse(name, claim) as CallToolResult;
        if (claim && operation.entry) operation.entry.idempotencyKeyHash = claim.record.keyHashPrefix;
        else if (mutating) operation.entry = beginOperation(name, startedAt);
        const logEntry = operation.entry;
        const run = async () => {
          const structured = (success: boolean, data?: unknown, error?: string) => {
            const receipt = mutating ? mutationReceipt(success, data, currentInvocation(), name) : undefined;
            if (logEntry && receipt) finishOperation(logEntry, success, receipt.outcome);
            return {
              ...structuredToolResult(name, success, data, error),
              ...(receipt ? { receipt } : {}),
            };
          };
          try {
            await reportProgress(0, 1, "Tool started; host completion remains unverified.");
            // Every call that may change the project records the undo position:
            // anything that needs more than inspect (edit, and also filesystem or
            // export tools such as import_*, relink_*, consolidate_* that add
            // project items). Only inspect-only calls skip it.
            const tracksUndo = capabilitiesForToolInvocation(name, callArgs).some((capability) => capability !== "inspect");
            const { expected_project_path, expected_cep_target, ...toolArgs } = callArgs;
            const work = () => runWithExpectedHostTarget(expected_cep_target,
              () => runWithUndoTracking(tracksUndo, () => guardedHandler(toolArgs)));
            const usesHost = deriveToolOperationalCapability(name, tool, capabilities).backends.some(backend => ["cep", "extendscript", "qe", "uxp"].includes(backend));
            const protectedHostWork = async () => {
              try {
                const result = await work();
                if (currentInvocation()?.dispatched && mutationReceipt(result.success, result.data, currentInvocation(), name).outcome === "unknown") {
                  markHostRecovery(getTempDir(bridgeOptions), "unknown_command_outcome");
                }
                return result;
              } catch (error) {
                // An earlier command may have written before a later readback or
                // cancellation failed. Persist uncertainty before releasing the
                // workflow lease so another backend cannot race the next edit.
                if (currentInvocation()?.dispatched) markHostRecovery(getTempDir(bridgeOptions), "unknown_command_outcome");
                throw error;
              }
            };
            const result = await runWithExpectedProject(expected_project_path,
              () => mutating && usesHost && name !== "acknowledge_operation_recovery" ? withBridgeWorkflow(bridgeOptions, protectedHostWork) : work());
            let payloadBytes: number | null = null;
            try { payloadBytes = Buffer.byteLength(JSON.stringify(result.data ?? null)); } catch { /* non-JSON diagnostic */ }
            recordPerformance({ durationMs: Date.now() - startedAt, payloadBytes, stages: currentInvocation()?.stages ?? {}, cacheHit: (result.data as { analysisCache?: { hit?: boolean } } | undefined)?.analysisCache?.hit ?? null });
            telemetry.capture("mcp_tool_call", {
              tool: name,
              outcome: result.success ? "succeeded" : "failed",
              duration_ms: Date.now() - startedAt,
            });
            if (result.success) {
              // Special handling for capture_frame: return image content block
              const data = result.data as Record<string, unknown> | undefined;
              if (
                data &&
                data.mimeType === "image/png" &&
                typeof data.base64 === "string"
              ) {
                return {
                  structuredContent: structured(true, Object.fromEntries(Object.entries(data).filter(([key]) => key !== "base64"))),
                  content: [
                    {
                      type: "image" as const,
                      data: data.base64 as string,
                      mimeType: "image/png" as const,
                    },
                    {
                      type: "text" as const,
                      text: "Frame captured successfully.",
                    },
                  ],
                };
              }
              return {
                structuredContent: structured(true, result.data),
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(result.data, null, 2),
                  },
                ],
              };
            } else {
              const failureData = (result as { data?: unknown }).data;
              return {
                structuredContent: structured(
                  false,
                  failureData,
                  result.error,
                ),
                content: [
                  {
                    type: "text" as const,
                    text: failureData === undefined || failureData === null
                      ? `Error: ${result.error}`
                      : `Error: ${result.error}\nDetails: ${JSON.stringify(failureData, null, 2)}`,
                  },
                ],
                isError: true,
              };
            }
          } catch (err) {
            telemetry.capture("mcp_tool_call", {
              tool: name,
              outcome: "failed",
              duration_ms: Date.now() - startedAt,
              error_type: telemetryErrorType(err),
            });
            return {
              structuredContent: structured(
                false,
                undefined,
                err instanceof Error ? err.message : String(err),
              ),
              content: [
                {
                  type: "text" as const,
                  text: `Error: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              isError: true,
            };
          } finally {
            await reportProgress(1, 1, "Tool returned; inspect its receipt for evidence and partial outcomes.");
          }
        };
        if (!claim) return run();
        let response: Awaited<ReturnType<typeof run>> | undefined;
        try {
          response = await run();
          return response;
        } finally {
          // A call that ended without a recorded receipt keeps an unknown outcome
          // and is never retried blindly under the same key.
          completeIdempotencyKey(claim.record, logEntry?.status === "succeeded", logEntry && logEntry.status !== "running" ? logEntry.outcome : null, response);
        }
      }),
    );
  }

  if (authorityWithheld > 0) {
    debugLog(
      `Withheld ${authorityWithheld} tool(s) from tools/list — not permitted by the ` +
        `active capability profile (${[...capabilities.capabilities].sort().join(", ")}). ` +
        `Call get_capabilities to see the enabled authority.`,
    );
  }
  if (packWithheld > 0) {
    debugLog(
      `Withheld ${packWithheld} permitted tool(s) from tools/list by the ` +
        `${toolPacks.fullCatalog ? "full" : toolPacks.selected.join(", ")} workflow tool pack selection.`,
    );
  }

  // Register LLM instructions resource
  server.registerResource(
    "premiere-instructions",
    "config://premiere-instructions",
    {
      description:
        "Instructions and best practices for using Premiere Pro via MCP tools",
      mimeType: "text/plain",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: premiereInstructions,
        },
      ],
    }),
  );

  for (const resource of getLiveContextResources(bridgeOptions)) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        description: resource.description,
        mimeType: "application/json",
      },
      resource.read,
    );
  }

  server.registerResource(
    "premiere-workflows",
    "config://premiere-workflows",
    {
      description: "High-level, safety-oriented Premiere Pro workflow catalog",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: WORKFLOW_RESOURCE,
        },
      ],
    }),
  );

  server.registerResource(
    "premiere-project-context",
    "config://premiere-project-context",
    {
      description: "Revisioned local project-context indexing and retrieval workflow",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: PROJECT_CONTEXT_RESOURCE,
        },
      ],
    }),
  );

  for (const prompt of WORKFLOW_PROMPTS) {
    server.registerPrompt(
      prompt.name,
      {
        title: prompt.title,
        description: prompt.description,
        argsSchema: z.object(prompt.argsSchema),
      },
      prompt.render,
    );
  }

  // Register ExtendScript API reference resource
  server.registerResource(
    "extendscript-reference",
    "config://extendscript-reference",
    {
      description:
        "Complete Premiere Pro ExtendScript API reference for writing custom scripts via execute_extendscript",
      mimeType: "text/plain",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: EXTENDSCRIPT_REFERENCE,
        },
      ],
    }),
  );

  const toolCount = Object.keys(toolModules).length;
  debugLog(
    `Registered ${toolCount} tools + 14 resources + ${WORKFLOW_PROMPTS.length} prompts`,
  );

  return server;
}
