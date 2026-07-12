import { BridgeOptions } from "../bridge/file-bridge.js";
import { getDiscoveryTools } from "./discovery.js";
import { getProjectTools } from "./project.js";
import { getMediaTools } from "./media.js";
import { getSequenceTools } from "./sequence.js";
import { getTimelineTools } from "./timeline.js";
import { getEffectsTools } from "./effects.js";
import { getTransitionsTools } from "./transitions.js";
import { getAudioTools } from "./audio.js";
import { getTextTools } from "./text.js";
import { getMarkerTools } from "./markers.js";
import { getTrackTools } from "./tracks.js";
import { getPlayheadTools } from "./playhead.js";
import { getMetadataTools } from "./metadata.js";
import { getExportTools } from "./export.js";
import { getAdvancedTools } from "./advanced.js";
import { getKeyframeTools } from "./keyframes.js";
import { getScriptingTools } from "./scripting.js";
import { getInspectionTools } from "./inspection.js";
import { getSelectionTools } from "./selection.js";
import { getClipboardTools } from "./clipboard.js";
import { getSourceMonitorTools } from "./source-monitor.js";
import { getTrackTargetingTools } from "./track-targeting.js";
import { getUtilityTools } from "./utility.js";
import { getHealthTools } from "./health.js";
import { getWorkspaceTools } from "./workspace.js";
import { getCaptionTools } from "./captions.js";
import { getPlaybackTools } from "./playback.js";
import { getProjectManagerTools } from "./project-manager.js";

export interface ToolDef {
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: any) => Promise<{ success: boolean; data?: unknown; error?: string }>;
}

/**
 * Every tool, keyed by name. The MCP server, the live-sweep harness, and the resource
 * layer all read from here — three separate lists would drift, and a tool missing from
 * the sweep is a tool nobody is checking.
 */
export function getAllTools(bridgeOptions: BridgeOptions): Record<string, ToolDef> {
  return {
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
}
