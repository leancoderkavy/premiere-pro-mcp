import type { ToolAnnotations } from "@modelcontextprotocol/server";

const READ_PREFIXES = ["get_", "list_", "inspect_", "find_", "check_", "search_"];
const READ_ONLY_TOOLS = new Set([
  "create_context_edit_plan",
  "create_editorial_plan",
  "preview_editorial_plan",
  "preview_project_intake",
  "preview_motion_graphics_demo",
  "preview_product_spot",
  "preview_brand_spot",
  "validate_project_for_export",
  "verify_delivery_conformance",
  "read_sequence_captions",
  "plan_silence_review_markers",
]);
const DESTRUCTIVE_PREFIXES = ["delete_", "remove_", "ripple_delete", "close_"];
const DESTRUCTIVE_TOOLS = new Set(["manage_project_context"]);
const OPEN_WORLD_TOOLS = new Set(["execute_extendscript", "send_raw_script"]);

/** Conservative MCP hints. They describe expected behavior, never authorization. */
export function annotationsForTool(name: string): ToolAnnotations {
  const readOnly = READ_ONLY_TOOLS.has(name) || READ_PREFIXES.some((prefix) => name.startsWith(prefix));
  return {
    title: name.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "),
    readOnlyHint: readOnly,
    destructiveHint: !readOnly && (
      DESTRUCTIVE_TOOLS.has(name) || DESTRUCTIVE_PREFIXES.some((prefix) => name.startsWith(prefix))
    ),
    idempotentHint: readOnly,
    openWorldHint: OPEN_WORLD_TOOLS.has(name),
  };
}

export function structuredToolResult(tool: string, success: boolean, data?: unknown, error?: string) {
  return {
    ok: success,
    tool,
    ...(success ? { data: data ?? null } : { error: error ?? "Unknown error" }),
  };
}
