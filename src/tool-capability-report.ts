import {
  capabilityForTool,
  type Capability,
  type CapabilityConfig,
} from "./security/capabilities.js";

export type ToolBackend = "local" | "cep" | "extendscript" | "qe" | "orchestrator";
export type ToolSupportStatus = "supported" | "limited" | "experimental" | "unsupported";
export type VerificationBoundary =
  | "static_metadata_only"
  | "local_filesystem"
  | "local_and_host_response"
  | "host_response"
  | "bridge_response"
  | "structured_uxp_readback"
  | "output_and_host_response"
  | "plan_revalidation";

export interface CatalogToolDefinition {
  description: string;
  operationalCapability?: ToolOperationalOverride;
}

export type ToolBackendLabel =
  | "local"
  | "CEP/ExtendScript"
  | "CEP/ExtendScript + QE"
  | "local + CEP/ExtendScript"
  | "orchestrator";

export interface ToolOperationalOverride {
  backend?: ToolBackendLabel;
  backends?: ToolBackend[];
  status?: ToolSupportStatus;
  minimumPremiereVersion?: string | null;
  authority?: Capability;
  verificationBoundary?: VerificationBoundary;
  hostVerificationRequired?: boolean;
  notes?: string[];
}

export interface ToolOperationalCapability {
  name: string;
  backend: ToolBackendLabel;
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

const LOCAL_TOOLS = new Set([
  "get_capabilities",
  "preview_edit_plan",
  "create_editorial_plan",
  "preview_editorial_plan",
]);
const ORCHESTRATOR_TOOLS = new Set(["apply_edit_plan"]);

/**
 * Forward-compatible exceptions for tools whose implementation crosses a
 * boundary that cannot be inferred from its name or description. Tool
 * definitions may carry the same `operationalCapability` metadata directly;
 * registration metadata wins over these catalog defaults.
 */
export const TOOL_OPERATIONAL_OVERRIDES: Readonly<
  Record<string, ToolOperationalOverride>
> = {
  verify_delivery_file: {
    backend: "local",
    backends: ["local"],
    status: "supported",
    minimumPremiereVersion: null,
    authority: "filesystem",
    verificationBoundary: "local_filesystem",
    hostVerificationRequired: false,
    notes: [
      "Reads and hashes a local delivery file; it does not contact Premiere Pro.",
    ],
  },
  get_advanced_feature_support: {
    backend: "local",
    backends: ["local"],
    status: "supported",
    minimumPremiereVersion: null,
    authority: "inspect",
    verificationBoundary: "static_metadata_only",
    hostVerificationRequired: false,
    notes: [
      "Evaluates documented feature prerequisites locally; it does not prove host availability or entitlement.",
    ],
  },
  create_editorial_plan: {
    backend: "local",
    backends: ["local"],
    status: "supported",
    minimumPremiereVersion: null,
    authority: "inspect",
    verificationBoundary: "static_metadata_only",
    hostVerificationRequired: false,
    notes: [
      "Builds a review-only plan from saved project context; it does not contact Premiere, call an AI provider, or change the project.",
    ],
  },
  preview_editorial_plan: {
    backend: "local",
    backends: ["local"],
    status: "supported",
    minimumPremiereVersion: null,
    authority: "inspect",
    verificationBoundary: "plan_revalidation",
    hostVerificationRequired: false,
    notes: [
      "Revalidates the plan against saved project-context revisions; a current local revision is not live Premiere host verification.",
    ],
  },
  validate_export_preset: {
    backend: "local + CEP/ExtendScript",
    backends: ["local", "cep", "extendscript"],
    status: "supported",
    minimumPremiereVersion: "2020",
    authority: "export",
    verificationBoundary: "local_and_host_response",
    hostVerificationRequired: true,
    notes: [
      "Checks the preset file locally, then asks the active Premiere sequence to resolve its output extension.",
    ],
  },
};

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
  const override = {
    ...(TOOL_OPERATIONAL_OVERRIDES[name] ?? {}),
    ...(definition.operationalCapability ?? {}),
  };
  const authority = override.authority ?? capabilityForTool(name);
  const local = override.backends?.length === 1 && override.backends[0] === "local"
    ? true
    : LOCAL_TOOLS.has(name);
  const orchestrator = ORCHESTRATOR_TOOLS.has(name);
  const usesQe = /\bQE(?:\s+DOM)?\b/i.test(definition.description);
  const backends: ToolBackend[] = override.backends ?? (local
    ? ["local"]
    : orchestrator
      ? ["orchestrator", "cep", "extendscript"]
      : usesQe
        ? ["cep", "extendscript", "qe"]
        : ["cep", "extendscript"]);

  const notes: string[] = [...(override.notes ?? [])];
  if (override.notes === undefined && local) {
    notes.push("Computed locally; does not prove that Premiere Pro is connected.");
  } else if (override.notes === undefined && orchestrator) {
    notes.push("Coordinates registered tools and revalidates the preview before applying edits.");
  } else if (override.notes === undefined && usesQe) {
    notes.push("Uses Adobe's undocumented QE DOM; behavior can vary between Premiere Pro builds.");
  } else if (override.notes === undefined) {
    notes.push("Runs through the production CEP file bridge using ExtendScript.");
  }
  if (!capabilities.capabilities.has(authority)) {
    notes.push(`Disabled by the current '${capabilities.source}' authority profile.`);
  }

  return {
    name,
    backend: override.backend ?? (local
      ? "local"
      : orchestrator
        ? "orchestrator"
        : usesQe
          ? "CEP/ExtendScript + QE"
          : "CEP/ExtendScript"),
    backends,
    status: override.status ?? (
      usesQe ? "experimental" : orchestrator ? "limited" : "supported"
    ),
    minimumPremiereVersion: override.minimumPremiereVersion !== undefined
      ? override.minimumPremiereVersion
      : local ? null : minimumVersion(definition.description, usesQe),
    authority: {
      required: authority,
      enabled: capabilities.capabilities.has(authority),
    },
    verificationBoundary: override.verificationBoundary
      ?? verificationBoundaryFor(name, authority, local),
    hostVerificationRequired: override.hostVerificationRequired ?? !local,
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
