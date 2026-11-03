import { runWithExpectedHostTarget, runWithExpectedProject, type ExpectedHostTarget } from "../bridge/project-guard.js";
import { EXPECTED_CEP_TARGET_SCHEMA, EXPECTED_PROJECT_PATH_SCHEMA } from "../workflows/guard-schemas.js";
import { SESSION_GUARD_TOOL_NAME } from "../workflows/schema-profile.js";

export interface SessionGuard {
  expected_project_path?: string;
  expected_cep_target?: ExpectedHostTarget;
}

/**
 * One guard per MCP session (stdio process or HTTP session). It is held in
 * memory only and never persisted, so a restart starts unguarded, exactly as a
 * client that never passed the per-call guards.
 */
export class SessionGuardStore {
  private guard: SessionGuard = {};

  get(): Readonly<SessionGuard> { return this.guard; }

  set(update: SessionGuard): Readonly<SessionGuard> {
    this.guard = {
      ...(update.expected_project_path !== undefined ? { expected_project_path: update.expected_project_path } : {}),
      ...(update.expected_cep_target !== undefined ? { expected_cep_target: update.expected_cep_target } : {}),
    };
    return this.guard;
  }

  clear(): Readonly<SessionGuard> { this.guard = {}; return this.guard; }
}

function describe(guard: Readonly<SessionGuard>) {
  return {
    expected_project_path: guard.expected_project_path ?? null,
    expected_cep_target: guard.expected_cep_target ?? null,
    active: guard.expected_project_path !== undefined || guard.expected_cep_target !== undefined,
  };
}

/**
 * Registered only under PREMIERE_MCP_SCHEMA_PROFILE=compact, where tools/list
 * no longer carries expected_project_path and expected_cep_target on every
 * tool. The stored values are applied to every later call exactly as if the
 * client had passed them; a per-call value still overrides the stored one.
 */
export function getSessionGuardTools(store: SessionGuardStore) {
  return {
    [SESSION_GUARD_TOOL_NAME]: {
      description: "Store the host guards for this MCP session: expected_project_path (the saved project every CEP command must find active) and expected_cep_target (the reviewed sequence or source identity). Under the compact schema profile tools no longer list these per call; this tool sets them once and every later call applies them, while a per-call value still overrides. Call with clear:true to remove them. Omitting both replaces the stored guard with nothing. Local-only: it sends no command to Premiere and does not itself prove the project is open.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          expected_project_path: EXPECTED_PROJECT_PATH_SCHEMA,
          expected_cep_target: EXPECTED_CEP_TARGET_SCHEMA,
          clear: { type: "boolean", description: "When true, remove the stored guards; any other argument is then refused." },
        },
      },
      handler: async (args: { expected_project_path?: string; expected_cep_target?: unknown; clear?: boolean } = {}) => {
        if (args.clear === true) {
          if (args.expected_project_path !== undefined || args.expected_cep_target !== undefined) {
            return { success: false, error: "clear:true cannot be combined with a guard value", data: { code: "INVALID_ARGUMENT", mutationOutcome: "not_applied", timelineChanged: false } };
          }
          return { success: true, data: { session_guard: describe(store.clear()), scope: "this_mcp_session_memory", boundary: "Stored guards are applied to later calls; they do not inspect or change Premiere." } };
        }
        try {
          // Reuse the request-scoped validators so a stored guard can never be
          // laxer than one passed per call.
          runWithExpectedProject(args.expected_project_path, () => undefined);
          runWithExpectedHostTarget(args.expected_cep_target, () => undefined);
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error), data: { code: "INVALID_ARGUMENT", mutationOutcome: "not_applied", timelineChanged: false } };
        }
        const stored = store.set({
          expected_project_path: args.expected_project_path,
          expected_cep_target: args.expected_cep_target as ExpectedHostTarget | undefined,
        });
        return { success: true, data: { session_guard: describe(stored), scope: "this_mcp_session_memory", boundary: "Stored guards are applied to later calls; they do not inspect or change Premiere." } };
      },
    },
  };
}
