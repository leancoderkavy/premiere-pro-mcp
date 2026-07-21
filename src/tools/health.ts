import { buildToolScript } from "../bridge/script-builder.js";
import { getTempDir, sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import { resolveCapabilities, type CapabilityConfig } from "../security/capabilities.js";
import { buildPlatformCapabilityReport } from "../platform-capabilities.js";

export function getHealthTools(
  bridgeOptions: BridgeOptions,
  capabilities: CapabilityConfig = resolveCapabilities(),
) {
  return {
    get_capabilities: {
      description: "Report Windows/macOS support, Premiere Pro backend coverage, enabled authority, and whether live host verification is still required.",
      parameters: {},
      handler: async () => ({
        success: true,
        data: buildPlatformCapabilityReport(capabilities, process.platform, getTempDir(bridgeOptions)),
      }),
    },
    ping: {
      description: "Health check — verify the CEP plugin is running and connected to Premiere Pro. Call this before other tools to confirm connectivity.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var version = app.version;
          var projectName = app.project && app.project.name ? app.project.name : "No project open";
          var activeSeq = app.project && app.project.activeSequence ? app.project.activeSequence.name : "None";
          return __result({
            connected: true,
            premiereVersion: version,
            projectName: projectName,
            activeSequence: activeSeq
          });
        `);
        return sendCommand(script, { ...bridgeOptions, timeoutMs: 5000 });
      },
    },
  };
}
