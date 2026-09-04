import {
  capabilityForTool,
  type Capability,
  type CapabilityConfig,
} from "./security/capabilities.js";

export type ToolBackend = "local" | "cep" | "extendscript" | "qe" | "orchestrator" | "uxp";
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
  | "UXP"
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
  "create_editorial_context_pack",
  "create_editorial_plan",
  "preview_editorial_plan",
  "preview_motion_graphics_demo",
  "preview_product_spot",
  "preview_brand_spot",
]);
const ORCHESTRATOR_TOOLS = new Set(["apply_edit_plan", "apply_spot_workflow_plan"]);

/**
 * Forward-compatible exceptions for tools whose implementation crosses a
 * boundary that cannot be inferred from its name or description. Tool
 * definitions may carry the same `operationalCapability` metadata directly;
 * registration metadata wins over these catalog defaults.
 */
export const TOOL_OPERATIONAL_OVERRIDES: Readonly<
  Record<string, ToolOperationalOverride>
> = {
  verify_after_effects_connection: {
    backend: "CEP/ExtendScript",
    backends: ["cep", "extendscript"],
    status: "supported",
    minimumPremiereVersion: null,
    authority: "inspect",
    verificationBoundary: "host_response",
    hostVerificationRequired: true,
    notes: [
      "Uses the separate local After Effects CEP bridge and returns no project names, paths, or media details.",
    ],
  },
  preview_mogrt_recipe: {
    backend: "local",
    backends: ["local"],
    status: "supported",
    minimumPremiereVersion: null,
    authority: "inspect",
    verificationBoundary: "static_metadata_only",
    hostVerificationRequired: false,
    notes: [
      "Also requires filesystem authority to validate an existing approved output directory; it does not contact Adobe or write files.",
    ],
  },
  create_mogrt_recipe: {
    backend: "local + CEP/ExtendScript",
    backends: ["local", "cep", "extendscript"],
    status: "supported",
    minimumPremiereVersion: null,
    authority: "export",
    verificationBoundary: "output_and_host_response",
    hostVerificationRequired: true,
    notes: [
      "Also requires edit and filesystem authority. The isolated AE bridge creates only a previewed recipe in an already saved, workspace-contained project; host acceptance is not visual verification.",
    ],
  },
  verify_mogrt_artifact: {
    backend: "local",
    backends: ["local"],
    status: "supported",
    minimumPremiereVersion: null,
    authority: "filesystem",
    verificationBoundary: "local_filesystem",
    hostVerificationRequired: false,
    notes: [
      "Checks local file presence and a ZIP header only; it does not establish After Effects controls or Premiere import/render behavior.",
    ],
  },
  validate_mogrt_brand_kit: {
    backend: "local", backends: ["local"], status: "supported", minimumPremiereVersion: null,
    authority: "inspect", verificationBoundary: "local_filesystem", hostVerificationRequired: false,
    notes: ["Also requires filesystem authority. Validates a declared brand-kit schema and contained logo path; it does not inspect installed fonts or image pixels."],
  },
  preview_mogrt_batch: {
    backend: "local", backends: ["local"], status: "supported", minimumPremiereVersion: null,
    authority: "inspect", verificationBoundary: "static_metadata_only", hostVerificationRequired: false,
    notes: ["Also requires filesystem authority. Parses a bounded workspace-contained CSV or JSON file without contacting Adobe or creating files."],
  },
  create_mogrt_batch: {
    backend: "local + CEP/ExtendScript", backends: ["local", "cep", "extendscript"], status: "supported", minimumPremiereVersion: null,
    authority: "export", verificationBoundary: "output_and_host_response", hostVerificationRequired: true,
    notes: ["Also requires edit and filesystem authority. Serial exports can leave prior artifacts and AE compositions in place if a later item fails; host acceptance is not visual verification."],
  },
  inspect_after_effects_template_source: {
    backend: "CEP/ExtendScript", backends: ["cep", "extendscript"], status: "supported", minimumPremiereVersion: null,
    authority: "inspect", verificationBoundary: "host_response", hostVerificationRequired: true,
    notes: ["Reads a named or active After Effects composition without paths or layer text. On hosts exposing the AE 16.1+ API, it reads controller names; older hosts report that this readback is unavailable."],
  },
  preview_mogrt_library_publish: {
    backend: "local", backends: ["local"], status: "supported", minimumPremiereVersion: null,
    authority: "inspect", verificationBoundary: "local_filesystem", hostVerificationRequired: false,
    notes: ["Also requires filesystem authority. Plans an immutable local library version but does not create a directory or copy a MOGRT."],
  },
  publish_mogrt_to_library: {
    backend: "local", backends: ["local"], status: "supported", minimumPremiereVersion: null,
    authority: "filesystem", verificationBoundary: "local_filesystem", hostVerificationRequired: false,
    notes: ["Copies one ZIP-checked MOGRT into a newly created version directory and fails instead of overwriting a prior version."],
  },
  inspect_mogrt_library: {
    backend: "local", backends: ["local"], status: "supported", minimumPremiereVersion: null,
    authority: "inspect", verificationBoundary: "local_filesystem", hostVerificationRequired: false,
    notes: ["Also requires filesystem authority. Lists bounded template and version names only; it does not read MOGRT contents."],
  },
  inspect_after_effects_render_templates: {
    backend: "CEP/ExtendScript", backends: ["cep", "extendscript"], status: "supported", minimumPremiereVersion: null,
    authority: "inspect", verificationBoundary: "host_response", hostVerificationRequired: true,
    notes: ["Reads template names from an existing render-queue item. It never adds an item, changes a template, or starts rendering."],
  },
  preview_after_effects_render: {
    backend: "local", backends: ["local"], status: "supported", minimumPremiereVersion: null,
    authority: "inspect", verificationBoundary: "static_metadata_only", hostVerificationRequired: false,
    notes: ["Also requires filesystem authority. Validates a bounded no-overwrite render queue request but cannot prove the named composition or templates exist."],
  },
  enqueue_after_effects_render: {
    backend: "local + CEP/ExtendScript", backends: ["local", "cep", "extendscript"], status: "supported", minimumPremiereVersion: null,
    authority: "export", verificationBoundary: "host_response", hostVerificationRequired: true,
    notes: ["Also requires edit and filesystem authority. Queues one render and saves the project; it does not start the queue or verify an output file."],
  },
  preview_mogrt_premiere_handoff: {
    backend: "local", backends: ["local"], status: "supported", minimumPremiereVersion: null,
    authority: "inspect", verificationBoundary: "local_filesystem", hostVerificationRequired: false,
    notes: ["Also requires filesystem authority. Validates the artifact and explicit disposable-sequence target locally; it does not contact Premiere."],
  },
  apply_mogrt_premiere_handoff: {
    backend: "CEP/ExtendScript", backends: ["cep", "extendscript"], status: "supported", minimumPremiereVersion: "2020",
    authority: "edit", verificationBoundary: "local_and_host_response", hostVerificationRequired: true,
    notes: ["Also requires filesystem authority. Rechecks an explicit disposable sequence name and empty track, then verifies insertion and MOGRT control descriptors; rendered-frame correctness remains separate."],
  },
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

function minimumVersion(description: string, usesQe: boolean, usesUxp: boolean): string {
  const explicit = description.match(
    /Premiere(?: Pro)?(?: version)?\s*(\d{2}(?:\.\d+)?)\s*\+/i,
  );
  if (explicit) return explicit[1];
  // The production CEP bridge supports the repository's documented 2020–2026
  // range. QE does not improve that guarantee because it is undocumented.
  if (usesUxp) return "25.6";
  return usesQe ? "2020 (QE availability varies by build)" : "2020";
}

function verificationBoundaryFor(
  name: string,
  authority: Capability,
  local: boolean,
): VerificationBoundary {
  if (local) return "static_metadata_only";
  if (name === "apply_edit_plan" || name === "apply_spot_workflow_plan") return "plan_revalidation";
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
  const usesUxp = override.backends?.includes("uxp")
    || name.endsWith("_uxp")
    || name.startsWith("get_uxp_");
  const usesQe = !usesUxp && /\bQE(?:\s+DOM)?\b/i.test(definition.description);
  const backends: ToolBackend[] = override.backends ?? (local
    ? ["local"]
    : orchestrator
      ? ["orchestrator", "cep", "extendscript"]
      : usesUxp
        ? ["uxp"]
        : usesQe
        ? ["cep", "extendscript", "qe"]
        : ["cep", "extendscript"]);

  const notes: string[] = [...(override.notes ?? [])];
  if (override.notes === undefined && local) {
    notes.push("Computed locally; does not prove that Premiere Pro is connected.");
  } else if (override.notes === undefined && orchestrator) {
    notes.push("Coordinates registered tools and revalidates the preview before applying edits.");
  } else if (override.notes === undefined && usesUxp) {
    notes.push("Runs through the authenticated local UXP bridge using Premiere UXP APIs.");
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
        : usesUxp
          ? "UXP"
          : usesQe
          ? "CEP/ExtendScript + QE"
          : "CEP/ExtendScript"),
    backends,
    status: override.status ?? (
      usesQe ? "experimental" : orchestrator ? "limited" : "supported"
    ),
    minimumPremiereVersion: override.minimumPremiereVersion !== undefined
      ? override.minimumPremiereVersion
      : local ? null : minimumVersion(definition.description, usesQe, usesUxp),
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
