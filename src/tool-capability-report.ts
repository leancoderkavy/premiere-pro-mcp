import {
  capabilityForTool,
  type Capability,
  type CapabilityConfig,
} from "./security/capabilities.js";

export type ToolBackend = "local" | "cep" | "extendscript" | "qe" | "orchestrator";
export type ToolSupportStatus = "supported" | "limited" | "experimental" | "unsupported";
export type VerificationBoundary =
  | "static_metadata_only"
  | "host_response"
  | "bridge_response"
  | "output_and_host_response"
  | "plan_revalidation";

export interface CatalogToolDefinition {
  description: string;
}

export interface ToolOperationalCapability {
  name: string;
  backend: "local" | "CEP/ExtendScript" | "CEP/ExtendScript + QE" | "orchestrator";
  backends: ToolBackend[];
  status: ToolSupportStatus;
  minimumPremiereVersion: string | null;
  authority: {
    required: Capability;
    enabled: boolean;
  };
  verificationBoundary: VerificationBoundary;
  hostVerificationRequired: boolean;
  notes: string[];
}

const LOCAL_TOOLS = new Set(["get_capabilities", "preview_edit_plan"]);
const ORCHESTRATOR_TOOLS = new Set(["apply_edit_plan"]);

function minimumVersion(description: string, usesQe: boolean): string {
  const explicit = description.match(
    /Premiere(?: Pro)?(?: version)?\s*(\d{2}(?:\.\d+)?)\s*\+/i,
  );
  if (explicit) return explicit[1];
  // The production CEP bridge supports the repository's documented 2020–2026
  // range. QE does not improve that guarantee because it is undocumented.
  return usesQe ? "2020 (QE availability varies by build)" : "2020";
}

function verificationBoundaryFor(
  name: string,
  authority: Capability,
  local: boolean,
): VerificationBoundary {
  if (local) return "static_metadata_only";
  if (name === "apply_edit_plan") return "plan_revalidation";
  if (authority === "inspect") return "host_response";
  if (authority === "export" || authority === "filesystem") {
    return "output_and_host_response";
  }
  return "bridge_response";
}

/**
 * Derive operational metadata from the same registered catalog and authority
 * classifier used by the MCP server. A tool can add an explicit Premiere
 * version to its description; otherwise the documented backend baseline is
 * used.
 */
export function deriveToolOperationalCapability(
  name: string,
  definition: CatalogToolDefinition,
  capabilities: CapabilityConfig,
): ToolOperationalCapability {
  const authority = capabilityForTool(name);
  const local = LOCAL_TOOLS.has(name);
  const orchestrator = ORCHESTRATOR_TOOLS.has(name);
  const usesQe = /\bQE(?:\s+DOM)?\b/i.test(definition.description);
  const backends: ToolBackend[] = local
    ? ["local"]
    : orchestrator
      ? ["orchestrator", "cep", "extendscript"]
      : usesQe
        ? ["cep", "extendscript", "qe"]
        : ["cep", "extendscript"];

  const notes: string[] = [];
  if (local) {
    notes.push("Computed locally; does not prove that Premiere Pro is connected.");
  } else if (orchestrator) {
    notes.push("Coordinates registered tools and revalidates the preview before applying edits.");
  } else if (usesQe) {
    notes.push("Uses Adobe's undocumented QE DOM; behavior can vary between Premiere Pro builds.");
  } else {
    notes.push("Runs through the production CEP file bridge using ExtendScript.");
  }
  if (!capabilities.capabilities.has(authority)) {
    notes.push(`Disabled by the current '${capabilities.source}' authority profile.`);
  }

  return {
    name,
    backend: local
      ? "local"
      : orchestrator
        ? "orchestrator"
        : usesQe
          ? "CEP/ExtendScript + QE"
          : "CEP/ExtendScript",
    backends,
    status: usesQe ? "experimental" : orchestrator ? "limited" : "supported",
    minimumPremiereVersion: local ? null : minimumVersion(definition.description, usesQe),
    authority: {
      required: authority,
      enabled: capabilities.capabilities.has(authority),
    },
    verificationBoundary: verificationBoundaryFor(name, authority, local),
    hostVerificationRequired: !local,
    notes,
  };
}

export function buildToolCapabilityReport(
  catalog: Record<string, CatalogToolDefinition>,
  capabilities: CapabilityConfig,
) {
  const tools = Object.entries(catalog)
    .map(([name, definition]) =>
      deriveToolOperationalCapability(name, definition, capabilities),
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  const byStatus = tools.reduce<Record<ToolSupportStatus, number>>(
    (counts, tool) => {
      counts[tool.status] += 1;
      return counts;
    },
    { supported: 0, limited: 0, experimental: 0, unsupported: 0 },
  );

  return {
    schemaVersion: 1,
    generatedFrom: "registered-tool-catalog",
    total: tools.length,
    byStatus,
    tools,
  };
}
