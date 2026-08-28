/**
 * Workflow packs narrow `tools/list` for clients with limited tool context.
 * They intentionally do not change capability enforcement: every registered
 * handler still passes through the central authority guard at invocation time.
 */
export const WORKFLOW_TOOL_PACK_NAMES = [
  "essential",
  "inspection",
  "delivery",
  "captions",
] as const;

export type WorkflowToolPackName = (typeof WORKFLOW_TOOL_PACK_NAMES)[number];
export type ToolPackSource = "default" | "environment" | "explicit";

export interface ToolPackSelection {
  source: ToolPackSource;
  selected: readonly WorkflowToolPackName[];
  fullCatalog: boolean;
}

export interface WorkflowToolPack {
  name: WorkflowToolPackName;
  title: string;
  description: string;
  tools: readonly string[];
}

export interface ToolPackReport {
  source: ToolPackSource;
  selected: readonly (WorkflowToolPackName | "full")[];
  fullCatalog: boolean;
  available: ReadonlyArray<Pick<WorkflowToolPack, "name" | "title" | "description">>;
  note: string;
}

// Match the capability layer's diagnostic guarantee. A narrowed list must
// still let an operator discover the selected packs and diagnose authority.
const ALWAYS_ADVERTISED_DIAGNOSTIC_TOOLS = new Set(["ping", "get_capabilities"]);

/**
 * Each pack is deliberately a short, reviewable set of named tools. Keeping
 * membership explicit avoids a new broad prefix accidentally widening a pack
 * when another tool is added later.
 */
export const WORKFLOW_TOOL_PACKS: readonly WorkflowToolPack[] = [
  {
    name: "essential",
    title: "Essential editing and delivery",
    description:
      "Connection, project and sequence inspection, safe edit-plan preview, save, delivery validation, export, and local delivery verification.",
    tools: [
      "verify_premiere_connection",
      "get_project_info",
      "get_active_sequence",
      "get_sequence_structure",
      "inspect_edit_readiness",
      "inspect_sequence_review_report",
      "preview_edit_plan",
      "save_project",
      "validate_project_for_export",
      "export_sequence",
      "verify_delivery_file",
    ],
  },
  {
    name: "inspection",
    title: "Project and review inspection",
    description:
      "Read-only project, sequence, timeline, review, and render-queue inspection before an editorial or delivery handoff.",
    tools: [
      "verify_premiere_connection",
      "get_premiere_state",
      "get_full_project_overview",
      "get_project_info",
      "list_sequences",
      "get_active_sequence",
      "get_sequence_structure",
      "get_full_sequence_info",
      "get_timeline_gaps",
      "get_timeline_summary",
      "inspect_edit_readiness",
      "inspect_sequence_review_report",
      "detect_silence",
      "plan_silence_review_markers",
      "get_offline_media",
      "get_used_media_report",
      "get_render_queue_status",
    ],
  },
  {
    name: "delivery",
    title: "Export and delivery",
    description:
      "Export preflight, rendering, interchange export, review-frame export, queue state, and post-export local verification.",
    tools: [
      "validate_project_for_export",
      "validate_export_preset",
      "export_sequence",
      "export_frame",
      "export_sequence_review_frames",
      "export_sequence_clip_review_frames",
      "export_as_fcp_xml",
      "export_aaf",
      "export_omf",
      "add_to_render_queue",
      "start_batch_encode",
      "get_render_queue_status",
      "encode_project_item",
      "encode_file",
      "verify_delivery_file",
      "analyze_video_qc",
    ],
  },
  {
    name: "captions",
    title: "Caption review",
    description:
      "Caption-track creation, supported caption readback, sequence structure, and review-frame evidence.",
    tools: [
      "create_caption_track",
      "read_sequence_captions",
      "get_active_sequence",
      "get_sequence_structure",
      "inspect_sequence_review_report",
      "export_sequence_review_frames",
      "export_sequence_clip_review_frames",
    ],
  },
];

const PACK_BY_NAME = new Map(
  WORKFLOW_TOOL_PACKS.map((pack) => [pack.name, pack]),
);

function parseToolPackNames(value: string): WorkflowToolPackName[] {
  const selected = new Set<WorkflowToolPackName>();
  for (const rawName of value.split(",")) {
    const name = rawName.trim().toLowerCase();
    if (!name) continue;
    if (name === "full") {
      if (value.split(",").filter((part) => part.trim()).length > 1) {
        throw new Error("PREMIERE_MCP_TOOL_PACKS cannot combine 'full' with another pack");
      }
      return [];
    }
    if (!PACK_BY_NAME.has(name as WorkflowToolPackName)) {
      throw new Error(
        `Unknown Premiere MCP tool pack: ${name}. Available packs: full, ${WORKFLOW_TOOL_PACK_NAMES.join(", ")}`,
      );
    }
    selected.add(name as WorkflowToolPackName);
  }
  if (selected.size === 0) {
    throw new Error(
      `PREMIERE_MCP_TOOL_PACKS must select full or at least one pack: ${WORKFLOW_TOOL_PACK_NAMES.join(", ")}`,
    );
  }
  return [...selected];
}

export function resolveToolPacks(
  value: string | undefined = process.env.PREMIERE_MCP_TOOL_PACKS,
  source: ToolPackSource = value === undefined || value.trim() === ""
    ? "default"
    : "environment",
): ToolPackSelection {
  if (value === undefined || value.trim() === "" || value.trim().toLowerCase() === "full") {
    return { source, selected: [], fullCatalog: true };
  }
  return { source, selected: parseToolPackNames(value), fullCatalog: false };
}

export function isToolInSelectedPacks(
  toolName: string,
  selection: ToolPackSelection,
): boolean {
  if (selection.fullCatalog) return true;
  if (ALWAYS_ADVERTISED_DIAGNOSTIC_TOOLS.has(toolName)) return true;
  return selection.selected.some((name) => PACK_BY_NAME.get(name)?.tools.includes(toolName));
}

export function buildToolPackReport(selection: ToolPackSelection): ToolPackReport {
  return {
    source: selection.source,
    selected: selection.fullCatalog ? ["full"] : [...selection.selected],
    fullCatalog: selection.fullCatalog,
    available: WORKFLOW_TOOL_PACKS.map(({ name, title, description }) => ({
      name,
      title,
      description,
    })),
    note:
      "Tool packs narrow tool discovery and registration for this session. They do not grant capabilities; every registered call remains subject to the configured authority profile.",
  };
}
