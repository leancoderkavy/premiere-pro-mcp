import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

const READ_PREFIXES = ["get_", "list_", "inspect_", "find_", "check_"];
const DESTRUCTIVE_PREFIXES = ["delete_", "remove_", "ripple_delete", "close_"];
const OPEN_WORLD_TOOLS = new Set(["execute_extendscript", "send_raw_script"]);

/** Conservative MCP hints. They describe expected behavior, never authorization. */
export function annotationsForTool(name: string): ToolAnnotations {
  const readOnly = READ_PREFIXES.some((prefix) => name.startsWith(prefix));
  return {
    title: name.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "),
    readOnlyHint: readOnly,
    destructiveHint: !readOnly && DESTRUCTIVE_PREFIXES.some((prefix) => name.startsWith(prefix)),
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
