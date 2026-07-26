import { buildToolScript } from "../bridge/script-builder.js";
import { getTempDir, sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import { resolveCapabilities, type CapabilityConfig } from "../security/capabilities.js";
import { buildPlatformCapabilityReport } from "../platform-capabilities.js";
import { buildAdvancedFeatureSupport, type AdvancedFeatureBackend } from "../advanced-feature-support.js";

export function getHealthTools(
  bridgeOptions: BridgeOptions,
  capabilities: CapabilityConfig = resolveCapabilities(),
) {
  return {
    get_advanced_feature_support: {
      description:
        "Report public-API support, prerequisites, entitlements, and user-assisted boundaries for Premiere collaboration and AI features",
      parameters: {
        type: "object" as const,
        properties: {
          backend: {
            type: "string",
            enum: ["cep", "uxp"],
            description: "Backend being evaluated (default: cep, the current production MCP transport)",
          },
          premiere_version: {
            type: "string",
            description: "Optional Premiere version such as 26.3.0 for version-specific eligibility",
          },
          frameio_entitled: {
            type: "boolean",
            description: "Whether the operator has confirmed Frame.io account/project access",
          },
          generative_ai_entitled: {
            type: "boolean",
            description: "Whether the operator has confirmed Adobe generative AI entitlement",
          },
          network_available: {
            type: "boolean",
            description: "Whether required Adobe/cloud services are reachable",
          },
        },
      },
      handler: async (args: {
        backend?: AdvancedFeatureBackend;
        premiere_version?: string;
        frameio_entitled?: boolean;
        generative_ai_entitled?: boolean;
        network_available?: boolean;
      }) => {
        try {
          return {
            success: true,
            data: buildAdvancedFeatureSupport({
              backend: args.backend,
              premiereVersion: args.premiere_version,
              frameIoEntitled: args.frameio_entitled,
              generativeAiEntitled: args.generative_ai_entitled,
              networkAvailable: args.network_available,
            }),
          };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
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
