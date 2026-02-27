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
import { EXTENDSCRIPT_REFERENCE } from "./resources/extendscript-reference.js";
import { z } from "zod";

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
- set_clip_speed_qe is more reliable than the ExtendScript speed method.

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
  handler: (args: any) => Promise<{ success: boolean; data?: unknown; error?: string }>;
}

/**
 * Convert a JSON Schema-style parameters object to a Zod shape for MCP SDK registration.
 */
function jsonSchemaToZodShape(params: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  const properties = (params.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = (params.required ?? []) as string[];

  for (const [key, prop] of Object.entries(properties)) {
    let zodType: z.ZodTypeAny;
    const propType = prop.type as string;

    switch (propType) {
      case "string":
        if (prop.enum) {
          const enumValues = prop.enum as [string, ...string[]];
          zodType = z.enum(enumValues);
        } else {
          zodType = z.string();
        }
        break;
      case "number":
        zodType = z.number();
        break;
      case "boolean":
        zodType = z.boolean();
        break;
      case "array":
        zodType = z.array(z.any());
        break;
      case "object":
        zodType = z.record(z.any());
        break;
      default:
        zodType = z.any();
    }

    if (prop.description) {
      zodType = zodType.describe(prop.description as string);
    }

    if (!required.includes(key)) {
      zodType = zodType.optional();
    }

    shape[key] = zodType;
  }

  return shape;
}

export function createServer(bridgeOptions: BridgeOptions): McpServer {
  const server = new McpServer({
    name: "premiere-pro-mcp",
    version: "1.0.0",
  });

  // Collect all tools from each module
  const toolModules: Record<string, ToolDef> = {
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
    ...getAdvancedTools(bridgeOptions),
    ...getKeyframeTools(bridgeOptions),
    ...getScriptingTools(bridgeOptions),
    ...getInspectionTools(bridgeOptions),
    ...getSelectionTools(bridgeOptions),
    ...getClipboardTools(bridgeOptions),
    ...getSourceMonitorTools(bridgeOptions),
    ...getTrackTargetingTools(bridgeOptions),
    ...getUtilityTools(bridgeOptions),
    ...getHealthTools(bridgeOptions),
    ...getWorkspaceTools(bridgeOptions),
    ...getCaptionTools(bridgeOptions),
    ...getPlaybackTools(bridgeOptions),
    ...getProjectManagerTools(bridgeOptions),
  };

  // Register each tool with the MCP server
  for (const [name, tool] of Object.entries(toolModules)) {
    const zodShape = jsonSchemaToZodShape(tool.parameters);

    server.tool(
      name,
      tool.description,
      zodShape,
      async (args: Record<string, unknown>) => {
        try {
          const result = await tool.handler(args);
          if (result.success) {
            // Special handling for capture_frame: return image content block
            const data = result.data as Record<string, unknown> | undefined;
            if (data && data.mimeType === "image/png" && typeof data.base64 === "string") {
              return {
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
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(result.data, null, 2),
                },
              ],
            };
          } else {
            return {
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
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  // Register LLM instructions resource
  server.resource(
    "premiere-instructions",
    "config://premiere-instructions",
    {
      description: "Instructions and best practices for using Premiere Pro via MCP tools",
      mimeType: "text/plain",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: PREMIERE_INSTRUCTIONS,
        },
      ],
    })
  );

  // Register ExtendScript API reference resource
  server.resource(
    "extendscript-reference",
    "config://extendscript-reference",
    {
      description: "Complete Premiere Pro ExtendScript API reference for writing custom scripts via execute_extendscript",
      mimeType: "text/plain",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: EXTENDSCRIPT_REFERENCE,
        },
      ],
    })
  );

  const toolCount = Object.keys(toolModules).length;
  console.error(`[premiere-pro-mcp] Registered ${toolCount} tools + 2 resources`);

  return server;
}
