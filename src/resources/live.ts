import { BridgeOptions } from "../bridge/file-bridge.js";
import { getAllTools, ToolDef } from "../tools/registry.js";

/**
 * Live resources — read-only views of the current Premiere state, backed by tools we
 * already have.
 *
 * The point is context without a tool call. An agent about to edit needs to know what
 * sequences exist, what's on the timeline, and which effect names are actually spelled
 * correctly on this machine. Making it burn a tool round-trip for each of those (and
 * decide to, and remember to) is how you get agents that edit blind.
 *
 * Every one of these is read-only. Nothing here can change the project.
 */

export interface LiveResource {
  name: string;
  uri: string;
  description: string;
  /** Tool to call, and the args to call it with. */
  tool: string;
  args?: Record<string, unknown>;
}

export const LIVE_RESOURCES: LiveResource[] = [
  {
    name: "project-info",
    uri: "premiere://project/info",
    description: "The open project: name, path, whether it has unsaved changes.",
    tool: "get_project_info",
  },
  {
    name: "project-items",
    uri: "premiere://project/items",
    description: "Everything in the project panel — clips, bins, sequences — with the node IDs that timeline tools need.",
    tool: "list_project_items",
  },
  {
    name: "project-sequences",
    uri: "premiere://project/sequences",
    description: "Every sequence in the project, with IDs and names.",
    tool: "list_sequences",
  },
  {
    name: "active-sequence",
    uri: "premiere://sequence/active",
    description: "The sequence currently open in the timeline, with its clips and node IDs.",
    tool: "get_active_sequence",
  },
  {
    name: "sequence-settings",
    uri: "premiere://sequence/settings",
    description: "Resolution, frame rate, and timebase of the active sequence. Read this before adding media so you don't fight a mismatch.",
    tool: "get_sequence_settings",
  },
  {
    name: "timeline-tracks",
    uri: "premiere://timeline/tracks",
    description: "Video and audio tracks of the active sequence, with lock/mute/target state.",
    tool: "list_sequence_tracks",
  },
  {
    name: "timeline-markers",
    uri: "premiere://timeline/markers",
    description: "Markers on the active sequence, in seconds.",
    tool: "list_markers",
  },
  {
    name: "effects-available",
    uri: "premiere://effects/available",
    description: "Video effects installed on THIS machine, by exact name. Effect names must match exactly — read this rather than guessing.",
    tool: "list_available_effects",
  },
  {
    name: "transitions-available",
    uri: "premiere://transitions/available",
    description: "Video transitions available by exact name.",
    tool: "list_available_transitions",
  },
  {
    name: "export-presets",
    uri: "premiere://export/presets",
    description: "Media Encoder presets found on disk, each with the .epr path to pass to export_sequence.",
    tool: "get_encoder_presets",
  },
  {
    name: "premiere-state",
    uri: "premiere://state",
    description: "Everything at once: app version, project, active sequence, playhead. The cheapest way to orient before an edit.",
    tool: "get_premiere_state",
  },
  {
    name: "bridge-health",
    uri: "premiere://bridge/health",
    description: "Whether the CEP bridge is actually alive. Check this first when tools start failing.",
    tool: "ping",
  },
];

export interface ResolvedResource {
  uri: string;
  text: string;
  mimeType: string;
}

/**
 * Read a live resource by invoking its backing tool.
 *
 * A failure here is reported as JSON, not thrown. An agent reading premiere://state with
 * Premiere closed should be told "the bridge is down" — not handed an exception that
 * looks like the resource doesn't exist.
 */
export async function readLiveResource(
  resource: LiveResource,
  bridgeOptions: BridgeOptions
): Promise<ResolvedResource> {
  const tools: Record<string, ToolDef> = getAllTools(bridgeOptions);
  const tool = tools[resource.tool];

  if (!tool) {
    return {
      uri: resource.uri,
      mimeType: "application/json",
      text: JSON.stringify(
        { error: `Resource is wired to an unknown tool: ${resource.tool}` },
        null,
        2
      ),
    };
  }

  try {
    const result = await tool.handler(resource.args ?? {});
    return {
      uri: resource.uri,
      mimeType: "application/json",
      text: JSON.stringify(
        result.success
          ? result.data
          : { error: result.error, hint: "Is Premiere open with the MCP Bridge panel running?" },
        null,
        2
      ),
    };
  } catch (err) {
    return {
      uri: resource.uri,
      mimeType: "application/json",
      text: JSON.stringify(
        {
          error: err instanceof Error ? err.message : String(err),
          hint: "Is Premiere open with the MCP Bridge panel running?",
        },
        null,
        2
      ),
    };
  }
}
