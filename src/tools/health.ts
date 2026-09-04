import { buildToolScript } from "../bridge/script-builder.js";
import { getTempDir, sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import { resolveCapabilities, type CapabilityConfig } from "../security/capabilities.js";
import { isToolPermitted } from "../security/index.js";
import { buildPlatformCapabilityReport } from "../platform-capabilities.js";
import { buildAdvancedFeatureSupport, type AdvancedFeatureBackend } from "../advanced-feature-support.js";
import type { CatalogToolDefinition } from "../tool-capability-report.js";
import { buildFirstRunReport, type FirstRunReport } from "../diagnostics.js";
import { captureActivationEvent, type Telemetry } from "../telemetry.js";
import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";
import {
  buildToolPackReport,
  isToolInSelectedPacks,
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
      description: "Discover Premiere operations and report backend coverage, authority, and verification requirements. Use tool_query with task keywords (for example transcript, captions, or review frames) for ranked, bounded matches available in this session. Use tool_names for exact lookups or tool_offset/tool_limit for paging. Discovery never grants authority or proves a live host is ready.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          tool_query: {
            type: "string",
            minLength: 1,
            maxLength: 256,
            pattern: "\\S",
            description: "Optional case-insensitive keywords matched against tool names and descriptions. Exact names rank first. Search defaults to 20 results with descriptions and session availability; page with tool_offset/tool_limit.",
          },
          available_only: {
            type: "boolean",
            description: "Filter to tools registered under this session's authority and tool packs. Defaults to true for tool_query, false otherwise. Set false to diagnose unavailable matches; this does not enable them.",
          },
          tool_names: {
            type: "array",
            items: { type: "string", minLength: 1, maxLength: 256 },
            minItems: 1,
            maxItems: 128,
            uniqueItems: true,
            description: "Optional exact tool-name allowlist. Returns only those catalog entries while retaining the overall capability summary.",
          },
          tool_offset: {
            type: "integer",
            minimum: 0,
            description: "Zero-based offset into the filtered tool catalog. Pair with tool_limit for an explicitly sized page.",
          },
          tool_limit: {
            type: "integer",
            minimum: 1,
            maximum: 128,
            description: "Maximum tool catalog entries to return. Omit with tool_offset to preserve the complete legacy response.",
          },
        },
      },
      handler: async (args: { tool_query?: string; available_only?: boolean; tool_names?: string[]; tool_offset?: number; tool_limit?: number } = {}) => {
        if (args.tool_query !== undefined && (
          typeof args.tool_query !== "string" || !args.tool_query.trim() || args.tool_query.length > 256
        )) {
          return { success: false, error: "tool_query must contain 1 through 256 characters and at least one non-whitespace character" };
        }
        const catalog = getToolCatalog();
        const selection = options.toolPacks ?? resolveToolPacks();
        const report = buildPlatformCapabilityReport(
          capabilities,
          process.platform,
          getTempDir(bridgeOptions),
          catalog,
          buildToolPackReport(selection),
        );
        const query = args.tool_query?.trim().toLowerCase();
        const terms = query?.split(/[\s_\-]+/u).filter(Boolean) ?? [];
        const availableOnly = args.available_only ?? (query !== undefined);
        const names = Array.isArray(args.tool_names) ? new Set(args.tool_names) : undefined;
        const matchingTools = report.tools.tools.flatMap((tool) => {
          if (names && !names.has(tool.name)) return [];
          const registered = isToolPermitted(tool.name, capabilities) && isToolInSelectedPacks(tool.name, selection);
          if (availableOnly && !registered) return [];
          const description = catalog[tool.name]?.description ?? "";
          const name = tool.name.toLowerCase();
          const searchableDescription = description.toLowerCase();
          const score = query === name ? 1000 : terms.reduce((sum, term) =>
            sum + (name.includes(term) ? 3 : searchableDescription.includes(term) ? 1 : 0), 0);
          if (query !== undefined && score === 0) return [];
          return [{ tool, description, registered, score }];
        });
        if (query !== undefined) {
          // Deterministic tie ordering keeps offset pagination stable.
          matchingTools.sort((a, b) => b.score - a.score ||
            (a.tool.name < b.tool.name ? -1 : a.tool.name > b.tool.name ? 1 : 0));
        }
        const offset = Number.isInteger(args.tool_offset) && (args.tool_offset as number) >= 0 ? args.tool_offset as number : 0;
        const hasExplicitPage = query !== undefined || args.tool_limit !== undefined || args.tool_offset !== undefined;
        const limit = Number.isInteger(args.tool_limit) && (args.tool_limit as number) > 0
          ? Math.min(args.tool_limit as number, 128)
          : query !== undefined ? 20 : matchingTools.length;
        const page = (hasExplicitPage ? matchingTools.slice(offset, offset + limit) : matchingTools)
          .map(({ tool, description, registered }) => query !== undefined || args.available_only !== undefined
            ? { ...tool, description, registered }
            : tool);

        return {
          success: true,
          data: {
            ...report,
            ...(query !== undefined ? {
              // The full Adobe inventories dominate the legacy response. A
              // task search needs backend prerequisites, not every API symbol.
              backends: {
                cep: {
                  status: report.backends.cep.status,
                  platforms: report.backends.cep.platforms,
                  premiereVersions: report.backends.cep.premiereVersions,
                  hostVerificationRequired: report.premiere.hostVerificationRequired,
                },
                uxp: {
                  status: report.backends.uxp.status,
                  platforms: report.backends.uxp.platforms,
                  premiereVersions: report.backends.uxp.premiereVersions,
                  hostVerificationRequired: report.backends.uxp.hostVerificationRequired,
                },
              },
              discovery: {
                mode: "keyword_search",
                detail: "summary",
                note: "Detailed backend inventories are omitted from search. Omit tool_query to request the full report. Registered tools still require live prerequisites and action-level authority.",
              },
            } : {}),
            tools: {
              ...report.tools,
              tools: page,
              ...(names || hasExplicitPage || args.available_only !== undefined
                ? {
                    pagination: {
                      offset,
                      limit,
                      returned: page.length,
                      totalMatching: matchingTools.length,
                      hasMore: offset + page.length < matchingTools.length,
                      nextOffset: offset + page.length < matchingTools.length ? offset + page.length : null,
                    },
                  }
                : {}),
            },
          },
        };
      },
    },
    ping: {
      description: "Health check — verify the CEP plugin is running and connected to Premiere Pro. Call this before other tools to confirm connectivity.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var version = app.version;
          var projectName = app.project && app.project.name ? app.project.name : "No project open";
          var activeSequence = app.project ? __getCurrentActiveSequence() : null;
          var activeSeq = activeSequence ? activeSequence.name : "None";
          return __result({
            connected: true,
            premiereVersion: version,
            projectName: projectName,
            activeSequence: activeSeq
          });
        `);
        return sendCommand(script, {
          ...bridgeOptions,
          timeoutMs: 5000,
          failFastOnUnreadyHeartbeat: true,
        });
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
              var sequenceOpen = !!(projectOpen && __getCurrentActiveSequence());
              return __result({ projectOpen: projectOpen, sequenceOpen: sequenceOpen });
            `);
            const response = await sendCommand(script, {
              ...bridgeOptions,
              timeoutMs: 5000,
              failFastOnUnreadyHeartbeat: true,
            });
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
