import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BridgeOptions } from "./bridge/file-bridge.js";
import { getDiscoveryTools } from "./tools/discovery.js";
import { getProjectTools } from "./tools/project.js";
import { getMediaTools } from "./tools/media.js";
import { getSequenceTools } from "./tools/sequence.js";
import { getTimelineTools } from "./tools/timeline.js";
import { getEffectsTools } from "./tools/effects.js";
import { getTransitionsTools } from "./tools/transitions.js";
import { getAudioTools } from "./tools/audio.js";
import { getTextTools } from "./tools/text.js";
import { getMarkerTools } from "./tools/markers.js";
import { getTrackTools } from "./tools/tracks.js";
import { getPlayheadTools } from "./tools/playhead.js";
import { getMetadataTools } from "./tools/metadata.js";
import { getExportTools } from "./tools/export.js";
import { getMediaAnalysisTools } from "./tools/media-analysis.js";
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
import { getProjectIntakeTools } from "./tools/project-intake.js";
import { getCompetitorGapTools } from "./tools/competitor-gaps.js";
import { getUxpTools } from "./tools/uxp.js";
import type { UxpWebSocketBridge } from "./bridge/uxp-websocket-bridge.js";
import {
  guardToolHandler,
  isToolPermitted,
  resolveCapabilities,
} from "./security/index.js";
import { EXTENDSCRIPT_REFERENCE } from "./resources/extendscript-reference.js";
import { getLiveContextResources } from "./resources/live-context-resources.js";
import { PROJECT_CONTEXT_RESOURCE } from "./context/project-context-resource.js";
import { WORKFLOW_PROMPTS, WORKFLOW_RESOURCE } from "./workflows/catalog.js";
import {
  annotationsForTool,
  structuredToolResult,
} from "./workflows/tool-metadata.js";
import { getTelemetry, type Telemetry } from "./telemetry.js";
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

const PREMIERE_INSTRUCTIONS = `You are controlling Adobe Premiere Pro through MCP tools. Follow these best practices:

WORKFLOW ORDER:
1. Always call get_project_info first to understand the current state.
2. Import media before adding to timeline.
3. Create/select a sequence before timeline operations.
4. Add clips first, then effects, then transitions.
5. Save the project after making significant changes.

TIMELINE RULES:
- Clips are identified by node_id. Use get_active_sequence or list_sequence_tracks to discover node IDs.
- Video clips on higher track indices appear on top of lower ones (compositing order).
- Images default to ~5 seconds duration when added to timeline.
- The first clip added to a new sequence determines its resolution and frame rate.
- Time values are in seconds (the tools handle tick conversion internally).

EFFECTS & TRANSITIONS:
- Apply effects by name using apply_effect (e.g., "Gaussian Blur", "Lumetri Color").
- Use list_available_effects to find exact effect names.
- Transitions require clips to be adjacent (no gap between them).
- Keep transitions short (0.5-2 seconds typically).
- Use color_correct for Lumetri Color adjustments rather than manual property setting.

KEYFRAMES:
- Use get_effect_properties to discover property names before setting values.
- Enable keyframes with add_keyframe; the property auto-enables time-varying.
- Interpolation types: "linear" (smooth), "hold" (instant jump), "bezier" (custom easing).

QE DOM TOOLS:
- Tools marked "Uses QE DOM" use an undocumented API. They are powerful but may behave unexpectedly.
- ripple_delete, roll_edit, slide_edit, slip_edit are QE-based advanced trim tools.
- Premiere does not expose a supported scripting API for changing timeline-clip speed; speed tools fail before mutation.

CLIPS & SELECTION:
- Use set_clip_selection to select clips before operations that work on selection (link, unlink, scene_edit_detection).
- Use overwrite_clip for 3-point editing (overwrites existing content).
- Use add_to_timeline for insert editing (ripples content forward).

BINS & ORGANIZATION:
- Bins are folders in the project panel. Use create_bin, delete_bin, rename_bin.
- Use move_item_to_bin to organize imported media.
- create_smart_bin creates auto-populating search bins.

EXPORT:
- Use export_sequence for AME-based encoding with presets.
- Use export_frame to capture a single frame as an image.
- Use start_batch_encode to begin rendering all queued items.

ERROR HANDLING:
- If a tool returns "No active sequence", call set_active_sequence first.
- If a tool returns "Clip not found", the node_id may have changed after timeline edits. Re-query the sequence.
- If "QE clip not found", the clip index may differ between DOM and QE. Try re-querying.

CUSTOM SCRIPTING:
- Use execute_extendscript to write and run any ExtendScript code for tasks not covered by existing tools.
- Use evaluate_expression for quick one-line queries.
- Use inspect_dom_object to explore unfamiliar objects.
- Use get_premiere_state as your first call to understand the full current context.
- Use get_sequence_structure for detailed timeline layout before edits.
- Read the "extendscript-reference" resource for the complete API cheat sheet.
`;

interface ToolDef {
  description: string;
  parameters: Record<string, unknown>;
  handler: (
    args: any,
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;
}

const toolCatalogCache = new Map<string, Record<string, ToolDef>>();
const schemaCache = new WeakMap<
  Record<string, unknown>,
  Record<string, z.ZodTypeAny>
>();
const debugEnabled = /^(1|true|yes|on|debug)$/i.test(
  process.env.PREMIERE_MCP_DEBUG ?? "",
);

function debugLog(message: string): void {
  if (debugEnabled) {
    console.error(`[premiere-pro-mcp] ${message}`);
  }
}

function jsonSchemaPropToZod(prop: Record<string, unknown>): z.ZodTypeAny {
  const propType = prop.type as string | undefined;

  if (propType === "string") {
    if (prop.enum && Array.isArray(prop.enum) && prop.enum.length > 0) {
      const enumValues = prop.enum as [string, ...string[]];
      return z.enum(enumValues);
    }
    return z.string();
  }

  if (propType === "number") {
    return z.number();
  }

  if (propType === "boolean") {
    return z.boolean();
  }

  if (propType === "array") {
    const itemSchema = (prop.items ?? {}) as Record<string, unknown>;
    // Use unknown as a safe fallback while still emitting a concrete items schema.
    const itemZod =
      Object.keys(itemSchema).length > 0
        ? jsonSchemaPropToZod(itemSchema)
        : z.unknown();
    return z.array(itemZod);
  }

  if (propType === "object") {
    const nestedProperties = (prop.properties ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const nestedRequired = new Set((prop.required ?? []) as string[]);

    if (Object.keys(nestedProperties).length === 0) {
      return z.record(z.string(), z.unknown());
    }

    const nestedShape: Record<string, z.ZodTypeAny> = {};
    for (const [nestedKey, nestedProp] of Object.entries(nestedProperties)) {
      let nestedZod = jsonSchemaPropToZod(nestedProp);
      if (nestedProp.description) {
        nestedZod = nestedZod.describe(nestedProp.description as string);
      }
      if (!nestedRequired.has(nestedKey)) {
        nestedZod = nestedZod.optional();
      }
      nestedShape[nestedKey] = nestedZod;
    }

    return z.object(nestedShape).passthrough();
  }

  return z.unknown();
}

/**
 * Convert a JSON Schema-style parameters object to a Zod shape for MCP SDK registration.
 */
function jsonSchemaToZodShape(
  params: Record<string, unknown>,
): Record<string, z.ZodTypeAny> {
  const cached = schemaCache.get(params);
  if (cached) return cached;
  const shape: Record<string, z.ZodTypeAny> = {};
  const properties = (params.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const required = (params.required ?? []) as string[];

  for (const [key, prop] of Object.entries(properties)) {
    let zodType = jsonSchemaPropToZod(prop);

    if (prop.description) {
      zodType = zodType.describe(prop.description as string);
    }

    if (!required.includes(key)) {
      zodType = zodType.optional();
    }

    shape[key] = zodType;
  }

  schemaCache.set(params, shape);
  return shape;
}

function collectTools(
  bridgeOptions: BridgeOptions,
  capabilities: ReturnType<typeof resolveCapabilities>,
  uxpBridge?: UxpWebSocketBridge,
  telemetry?: Telemetry,
  cacheable = false,
): Record<string, ToolDef> {
  const cacheKey = JSON.stringify({
    tempDir: bridgeOptions.tempDir ?? process.env.PREMIERE_TEMP_DIR ?? null,
    timeoutMs:
      bridgeOptions.timeoutMs ?? process.env.PREMIERE_TIMEOUT_MS ?? null,
    capabilities: [...capabilities.capabilities].sort(),
  });
  // Health tools close over the telemetry sink and UXP adapter. The default
  // sink is a singleton and may be cached; a caller-supplied sink or UXP bridge
  // must remain instance-specific.
  const cached = !uxpBridge && cacheable ? toolCatalogCache.get(cacheKey) : undefined;
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
    ...getMarkerTools(bridgeOptions),
    ...getTrackTools(bridgeOptions),
    ...getPlayheadTools(bridgeOptions),
    ...getMetadataTools(bridgeOptions),
    ...getExportTools(bridgeOptions),
    ...getMediaAnalysisTools(bridgeOptions),
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
    ...getProjectContextTools(bridgeOptions),
    ...getEditorialPlanTools({ uxpBridge }),
    ...getProjectIntakeTools(bridgeOptions),
    ...getCompetitorGapTools(bridgeOptions, uxpBridge),
    ...(uxpBridge ? getUxpTools(uxpBridge) : {}),
  };
  Object.assign(
    tools,
    getHealthTools(bridgeOptions, capabilities, () => tools, {
      telemetry,
      uxpBridge,
    }),
  );
  if (!uxpBridge && cacheable) toolCatalogCache.set(cacheKey, tools);
  return tools;
}

export interface ServerOptions {
  uxpBridge?: UxpWebSocketBridge;
  telemetry?: Telemetry;
}

export function createServer(
  bridgeOptions: BridgeOptions,
  serverOptions: ServerOptions = {},
): McpServer {
  const server = new McpServer({
    name: "premiere-pro-mcp",
    version: SERVER_VERSION,
  });

  const capabilities = resolveCapabilities();
  const telemetry = serverOptions.telemetry ?? getTelemetry();

  // Collect all tools from each module
  const toolModules = collectTools(
    bridgeOptions,
    capabilities,
    serverOptions.uxpBridge,
    telemetry,
    !serverOptions.telemetry,
  );

  // Register each tool with the MCP server
  let withheld = 0;
  for (const [name, tool] of Object.entries(toolModules)) {
    // Don't advertise tools the active authority profile will always refuse.
    // guardToolHandler still rejects them at call time, but listing an
    // unusable tool spends client context and invites the model to attempt a
    // call that cannot succeed.
    if (!isToolPermitted(name, capabilities)) {
      withheld++;
      continue;
    }

    const zodShape = jsonSchemaToZodShape(tool.parameters);
    const guardedHandler = guardToolHandler(name, tool.handler, capabilities);

    server.tool(
      name,
      tool.description,
      zodShape,
      annotationsForTool(name),
      async (args: Record<string, unknown>) => {
        const startedAt = Date.now();
        try {
          const result = await guardedHandler(args);
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
            return {
              structuredContent: structuredToolResult(
                name,
                false,
                undefined,
                result.error,
              ),
              content: [
                {
                  type: "text" as const,
                  text: `Error: ${result.error}`,
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
            error_type: err instanceof Error ? err.name : "UnknownError",
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

  if (withheld > 0) {
    debugLog(
      `Withheld ${withheld} tool(s) from tools/list — not permitted by the ` +
        `active capability profile (${[...capabilities.capabilities].sort().join(", ")}). ` +
        `Call get_capabilities to see the enabled authority.`,
    );
  }

  // Register LLM instructions resource
  server.resource(
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
          text: PREMIERE_INSTRUCTIONS,
        },
      ],
    }),
  );

  for (const resource of getLiveContextResources(bridgeOptions)) {
    server.resource(
      resource.name,
      resource.uri,
      {
        description: resource.description,
        mimeType: "application/json",
      },
      resource.read,
    );
  }

  server.resource(
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

  server.resource(
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
        argsSchema: prompt.argsSchema,
      },
      prompt.render,
    );
  }

  // Register ExtendScript API reference resource
  server.resource(
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
    `Registered ${toolCount} tools + 9 resources + ${WORKFLOW_PROMPTS.length} prompts`,
  );

  return server;
}
