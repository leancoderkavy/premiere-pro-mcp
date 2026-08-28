import { buildToolScript } from "../bridge/script-builder.js";
import { getTempDir, sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import { resolveCapabilities, type CapabilityConfig } from "../security/capabilities.js";
import { buildPlatformCapabilityReport } from "../platform-capabilities.js";
import { buildAdvancedFeatureSupport, type AdvancedFeatureBackend } from "../advanced-feature-support.js";
import type { CatalogToolDefinition } from "../tool-capability-report.js";
import { buildFirstRunReport, type FirstRunReport } from "../diagnostics.js";
import { captureActivationEvent, type Telemetry } from "../telemetry.js";
import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";
import {
  buildToolPackReport,
  resolveToolPacks,
  type ToolPackSelection,
} from "../workflows/tool-packs.js";

export interface HealthToolOptions {
  telemetry?: Telemetry;
  uxpBridge?: UxpWebSocketBridge;
  toolPacks?: ToolPackSelection;
}

const disabledTelemetry: Telemetry = {
  enabled: false,
  capture: () => {},
  shutdown: async () => {},
};

export function getHealthTools(
  bridgeOptions: BridgeOptions,
  capabilities: CapabilityConfig = resolveCapabilities(),
  getToolCatalog: () => Record<string, CatalogToolDefinition> = () => ({}),
  options: HealthToolOptions = {},
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
        data: buildPlatformCapabilityReport(
          capabilities,
          process.platform,
          getTempDir(bridgeOptions),
          getToolCatalog(),
          buildToolPackReport(options.toolPacks ?? resolveToolPacks()),
        ),
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
    verify_premiere_connection: {
      description:
        "Run a safe, read-only first-run check. It proves that this MCP server, the selected Premiere bridge, an active project, and an active sequence are connected without returning project names, paths, or media details.",
      parameters: {
        type: "object" as const,
        properties: {
          backend: {
            type: "string",
            enum: ["cep", "uxp"],
            description: "Bridge to check. Defaults to CEP. This check never falls back to a different bridge.",
          },
        },
      },
      handler: async (args: { backend?: "cep" | "uxp" }) => {
        const backend = args.backend ?? "cep";
        const telemetry = options.telemetry ?? disabledTelemetry;

        let report: FirstRunReport;
        if (backend === "uxp") {
          if (!options.uxpBridge) {
            report = buildFirstRunReport("uxp", { reachable: false });
          } else {
            try {
              // This is an explicit read-only UXP request. Do not try CEP if it
              // fails: even diagnostics should accurately name their backend.
              const result = await options.uxpBridge.request("state.get");
              const state = result && typeof result === "object"
                ? result as Record<string, unknown>
                : {};
              report = buildFirstRunReport("uxp", {
                reachable: true,
                projectOpen: state.projectOpen === true,
                sequenceOpen: state.sequenceOpen === true,
              });
            } catch {
              report = buildFirstRunReport("uxp", { reachable: false });
            }
          }
        } else {
          try {
            const script = buildToolScript(`
              var projectOpen = !!(app && app.project && typeof app.project.name !== "undefined");
              var sequenceOpen = !!(projectOpen && app.project.activeSequence);
              return __result({ projectOpen: projectOpen, sequenceOpen: sequenceOpen });
            `);
            const response = await sendCommand(script, { ...bridgeOptions, timeoutMs: 5000 });
            const data = response.success && response.data && typeof response.data === "object"
              ? response.data as Record<string, unknown>
              : {};
            report = buildFirstRunReport("cep", {
              reachable: response.success === true,
              projectOpen: data.projectOpen === true,
              sequenceOpen: data.sequenceOpen === true,
            });
          } catch {
            report = buildFirstRunReport("cep", { reachable: false });
          }
        }

        // This is the only repository-owned activation signal. A tool call
        // that finds an unavailable bridge, project, or sequence remains a
        // useful diagnostic, but is not activation.
        if (report.overall === "ready") {
          captureActivationEvent(telemetry, { backend });
        }
        // A completed diagnostic remains a successful tool call even if it
        // identifies a problem. The structured report tells the user what to fix.
        return { success: true, data: report };
      },
    },
  };
}
