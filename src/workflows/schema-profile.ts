/**
 * Schema profiles decide how much guard boilerplate every tool's inputSchema
 * carries in tools/list. They never change enforcement: the per-call guards
 * stay accepted and honored under every profile, and the session guard set
 * through set_session_guard is applied by the same request-scoped code path.
 *
 * - full (default): every tool advertises expected_project_path and
 *   expected_cep_target, exactly as before.
 * - compact: those two properties are omitted from every listed inputSchema
 *   (about 3,100 characters per tool) and one extra tool, set_session_guard,
 *   stores them once for the session. Per-call values still win when present.
 */
export const SCHEMA_PROFILE_NAMES = ["full", "compact"] as const;
export type SchemaProfileName = (typeof SCHEMA_PROFILE_NAMES)[number];
export type SchemaProfileSource = "default" | "environment" | "explicit";

export interface SchemaProfileSelection {
  source: SchemaProfileSource;
  profile: SchemaProfileName;
  /** Whether listed inputSchemas omit the per-call host guards. */
  compactGuards: boolean;
}

export const SESSION_GUARD_TOOL_NAME = "set_session_guard";

export function resolveSchemaProfile(
  value: string | undefined = process.env.PREMIERE_MCP_SCHEMA_PROFILE,
  source: SchemaProfileSource = value === undefined || value.trim() === "" ? "default" : "environment",
): SchemaProfileSelection {
  if (value === undefined || value.trim() === "") {
    return { source, profile: "full", compactGuards: false };
  }
  const normalized = value.trim().toLowerCase();
  if (!(SCHEMA_PROFILE_NAMES as readonly string[]).includes(normalized)) {
    throw new Error(
      `Unknown Premiere MCP schema profile "${value.trim()}". PREMIERE_MCP_SCHEMA_PROFILE must be one of: ${SCHEMA_PROFILE_NAMES.join(", ")}.`,
    );
  }
  const profile = normalized as SchemaProfileName;
  return { source, profile, compactGuards: profile === "compact" };
}
