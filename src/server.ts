import {
  fromJsonSchema,
  McpServer,
  type JsonSchemaType,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import { BridgeOptions } from "./bridge/file-bridge.js";
import { runWithUndoTracking } from "./bridge/undo-tracking.js";
import { getDiscoveryTools } from "./tools/discovery.js";
import { getProjectTools } from "./tools/project.js";
import { getMediaTools } from "./tools/media.js";
import { getSequenceTools } from "./tools/sequence.js";
import { getTimelineTools } from "./tools/timeline.js";
import { getEffectsTools } from "./tools/effects.js";
import { getTransitionsTools } from "./tools/transitions.js";
import { getAudioTools } from "./tools/audio.js";
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
import { getUxpTools } from "./tools/uxp.js";
import { getMogrtAuthoringTools } from "./tools/mogrt-authoring.js";
import { getMogrtStudioTools } from "./tools/mogrt-studio.js";
import { getRenderHandoffTools } from "./tools/render-handoff.js";
import type { UxpWebSocketBridge } from "./bridge/uxp-websocket-bridge.js";
import {
  guardToolHandler,
  isToolPermitted,
  resolveCapabilities,
} from "./security/index.js";
import { capabilitiesForToolInvocation } from "./security/capabilities.js";
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
  const sourceSchema = withDraft.properties !== undefined && withDraft.additionalProperties === undefined
    && withDraft.patternProperties === undefined
    ? { ...withDraft, additionalProperties: false }
    : withDraft;
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
    ...getEffectsTools(bridgeOptions),
    ...getTransitionsTools(bridgeOptions),
    ...getAudioTools(bridgeOptions),
    ...getTextTools(bridgeOptions),
    ...getStockTitleTools(bridgeOptions),
    ...getMogrtAuthoringTools(bridgeOptions),
    ...getMogrtStudioTools(bridgeOptions),
    ...getRenderHandoffTools(bridgeOptions),
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
    ...(uxpBridge ? getUxpTools(uxpBridge) : {}),
  };
  Object.assign(
    tools,
    getHealthTools(bridgeOptions, capabilities, () => tools, {
      telemetry,
      uxpBridge,
      toolPacks,
    }),
  );
  return tools;
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

    const inputSchema = jsonSchemaToInputSchema(tool.parameters);
    const guardedHandler = guardToolHandler(name, withFrameRateDefaultWarning(tool), capabilities);

    const annotations = annotationsForTool(name);
    server.registerTool(
      name,
      {
        title: annotations.title,
        description: tool.description,
        inputSchema,
        outputSchema: toolResultOutputSchema,
        annotations,
      },
      async (args: unknown) => {
        const startedAt = Date.now();
        try {
          // Every call that may change the project records the undo position:
          // anything that needs more than inspect (edit, and also filesystem or
          // export tools such as import_*, relink_*, consolidate_* that add
          // project items). Only inspect-only calls skip it.
          const tracksUndo = capabilitiesForToolInvocation(name, args).some((capability) => capability !== "inspect");
          const result = await runWithUndoTracking(tracksUndo, () => guardedHandler(args as Record<string, unknown>));
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
                structuredContent: structuredToolResult(name, true, {
                  mimeType: data.mimeType,
                }),
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
              structuredContent: structuredToolResult(name, true, result.data),
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
              structuredContent: structuredToolResult(
                name,
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
            structuredContent: structuredToolResult(
              name,
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
        }
      },
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
