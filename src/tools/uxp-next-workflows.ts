import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";

const WAIT_RESPONSE_BUFFER_MS = 5_000;

type EventArgs = {
  action?: string;
  after_revision?: number;
  categories?: string[];
  event_names?: string[];
  limit?: number;
  timeout_ms?: number;
};

type ReadinessArgs = {
  action?: string;
  sequence_id?: string;
  expected_sequence_id?: string;
  operation_type?: string;
  after_revision?: number;
  timeout_ms?: number;
  poll_min_ms?: number;
  poll_max_ms?: number;
};

type ProjectSessionArgs = {
  action?: string;
  project_id?: string;
  expected_path?: string;
  path?: string;
  paths?: string[];
  include_paths?: boolean;
  show_dialogs?: boolean;
  add_to_mru?: boolean;
  save_before_close?: boolean;
  confirm_external_write?: boolean;
  confirm_overwrite?: boolean;
  confirm_close?: boolean;
  confirm_discard_unsaved?: boolean;
  operation_id?: string;
};

type GrowingMediaArgs = {
  action?: string;
  project_id?: string;
  expected_path?: string;
  lease_ms?: number;
  confirm_pause?: boolean;
  operation_id?: string;
};

type CheckpointArgs = {
  action?: string;
  owner?: string;
  sequence_id?: string;
  expected_owner_id?: string;
  name?: string;
  value_type?: string;
  value?: string | number | boolean;
  persistence?: string;
  operation_id?: string;
};

function invoke(
  bridge: UxpWebSocketBridge,
  command: string,
  args: Record<string, unknown> = {},
  hostWaitMs?: number,
) {
  const request = hostWaitMs === undefined
    ? bridge.request(command, args)
    : bridge.request(command, args, { minimumTimeoutMs: hostWaitMs + WAIT_RESPONSE_BUFFER_MS });
  return request
    .then((result) => ({ success: true, data: { backend: "uxp", result } }))
    .catch((error: unknown) => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }));
}

function eventQuery(args: EventArgs, includeTimeout: boolean) {
  return {
    ...(args.after_revision !== undefined ? { afterRevision: args.after_revision } : {}),
    ...(args.categories !== undefined ? { categories: args.categories } : {}),
    ...(args.event_names !== undefined ? { eventNames: args.event_names } : {}),
    ...(args.limit !== undefined ? { limit: args.limit } : {}),
    ...(includeTimeout && args.timeout_ms !== undefined ? { timeoutMs: args.timeout_ms } : {}),
  };
}

export function getUxpNextWorkflowTools(bridge: UxpWebSocketBridge) {
  return {
    inspect_premiere_events_uxp: {
      description: "List or briefly wait for bounded, redacted Premiere host-event receipts without polling the complete project state.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["list", "wait"] },
          after_revision: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          categories: {
            type: "array", maxItems: 32, uniqueItems: true,
            items: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
          },
          event_names: {
            type: "array", maxItems: 32, uniqueItems: true,
            items: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
          },
          limit: { type: "integer", minimum: 1, maximum: 256 },
          timeout_ms: {
            type: "integer", minimum: 0, maximum: 60000,
            description: "Used only by wait; zero performs a non-blocking check.",
          },
        },
        required: ["action"],
      },
      handler: async (args: EventArgs) => {
        if (args.action === "list") return invoke(bridge, "events.list", eventQuery(args, false));
        if (args.action === "wait") {
          return invoke(bridge, "events.wait", eventQuery(args, true), args.timeout_ms ?? 0);
        }
        return { success: false, error: `Unsupported event action: ${String(args.action)}` };
      },
    },
    wait_for_host_readiness_uxp: {
      description: "Capture a pre-dispatch readiness revision or wait, without retrying, for video-effect analysis or one documented operation-completion receipt.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["snapshot", "analysis", "operation"] },
          sequence_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
          expected_sequence_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
          operation_type: { type: "string", enum: ["import", "export", "effect_drop", "generative_extend"] },
          after_revision: {
            type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER,
            description: "Required for operation waits; capture it with snapshot before dispatching the operation.",
          },
          timeout_ms: { type: "integer", minimum: 0, maximum: 60000 },
          poll_min_ms: { type: "integer", minimum: 100, maximum: 2000 },
          poll_max_ms: { type: "integer", minimum: 100, maximum: 5000 },
        },
        required: ["action"],
      },
      handler: async (args: ReadinessArgs) => {
        if (args.action === "snapshot") {
          return invoke(bridge, "readiness.snapshot", {
            ...(args.sequence_id !== undefined ? { sequenceId: args.sequence_id } : {}),
          });
        }
        if (args.action === "analysis") {
          return invoke(bridge, "readiness.analysis.wait", {
            ...(args.sequence_id !== undefined ? { sequenceId: args.sequence_id } : {}),
            ...(args.expected_sequence_id !== undefined ? { expectedSequenceId: args.expected_sequence_id } : {}),
            ...(args.timeout_ms !== undefined ? { timeoutMs: args.timeout_ms } : {}),
            ...(args.poll_min_ms !== undefined ? { pollMinMs: args.poll_min_ms } : {}),
            ...(args.poll_max_ms !== undefined ? { pollMaxMs: args.poll_max_ms } : {}),
          }, args.timeout_ms ?? 30_000);
        }
        if (args.action === "operation") {
          const operations: Record<string, string> = {
            import: "import", export: "export", effect_drop: "effectDrop", generative_extend: "generativeExtend",
          };
          return invoke(bridge, "readiness.operation.wait", {
            ...(args.operation_type !== undefined ? { operationType: operations[args.operation_type] } : {}),
            ...(args.after_revision !== undefined ? { afterRevision: args.after_revision } : {}),
            ...(args.timeout_ms !== undefined ? { timeoutMs: args.timeout_ms } : {}),
          }, args.timeout_ms ?? 30_000);
        }
        return { success: false, error: `Unsupported readiness action: ${String(args.action)}` };
      },
    },
    manage_project_sessions_uxp: {
      description: "List or explicitly create, open, save, branch, and close Premiere project sessions. Path writes stay inside the approved UXP workspace; Save As handle changes are read back and branch copies reopen the source after every copy.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: {
            type: "string",
            enum: ["list", "validate", "create", "open", "save", "save_as", "branch_copies", "close"],
          },
          project_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
          expected_path: { type: "string", minLength: 1, maxLength: 4096 },
          path: { type: "string", minLength: 1, maxLength: 4096 },
          paths: {
            type: "array", minItems: 1, maxItems: 16, uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 4096 },
          },
          include_paths: { type: "boolean", description: "List project paths only when explicitly requested; defaults to redacted." },
          show_dialogs: { type: "boolean", description: "For open only; defaults to false." },
          add_to_mru: { type: "boolean", description: "For open only; defaults to false." },
          save_before_close: { type: "boolean", description: "For close only; defaults to true." },
          confirm_external_write: { type: "boolean" },
          confirm_overwrite: { type: "boolean" },
          confirm_close: { type: "boolean" },
          confirm_discard_unsaved: { type: "boolean" },
          operation_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
        },
        required: ["action"],
      },
      handler: async (args: ProjectSessionArgs) => {
        const common = {
          ...(args.project_id !== undefined ? { projectId: args.project_id } : {}),
          ...(args.expected_path !== undefined ? { expectedPath: args.expected_path } : {}),
          ...(args.operation_id !== undefined ? { operationId: args.operation_id } : {}),
        };
        if (args.action === "list") return invoke(bridge, "project.sessions.list", {
          ...(args.include_paths !== undefined ? { includePaths: args.include_paths } : {}),
        });
        if (args.action === "validate") return invoke(bridge, "project.sessions.validate", { path: args.path });
        if (args.action === "create") return invoke(bridge, "project.sessions.create", {
          path: args.path,
          ...(args.confirm_external_write !== undefined ? { confirmExternalWrite: args.confirm_external_write } : {}),
          ...(args.confirm_overwrite !== undefined ? { confirmOverwrite: args.confirm_overwrite } : {}),
          ...(args.operation_id !== undefined ? { operationId: args.operation_id } : {}),
        });
        if (args.action === "open") return invoke(bridge, "project.sessions.open", {
          path: args.path,
          ...(args.show_dialogs !== undefined ? { showDialogs: args.show_dialogs } : {}),
          ...(args.add_to_mru !== undefined ? { addToMru: args.add_to_mru } : {}),
          ...(args.operation_id !== undefined ? { operationId: args.operation_id } : {}),
        });
        if (args.action === "save") return invoke(bridge, "project.sessions.save", common);
        if (args.action === "save_as") return invoke(bridge, "project.sessions.saveAs", {
          ...common, path: args.path,
          ...(args.confirm_external_write !== undefined ? { confirmExternalWrite: args.confirm_external_write } : {}),
          ...(args.confirm_overwrite !== undefined ? { confirmOverwrite: args.confirm_overwrite } : {}),
        });
        if (args.action === "branch_copies") return invoke(bridge, "project.sessions.branchCopies", {
          ...common, paths: args.paths,
          ...(args.confirm_external_write !== undefined ? { confirmExternalWrite: args.confirm_external_write } : {}),
          ...(args.confirm_overwrite !== undefined ? { confirmOverwrite: args.confirm_overwrite } : {}),
        });
        if (args.action === "close") return invoke(bridge, "project.sessions.close", {
          ...common,
          ...(args.save_before_close !== undefined ? { saveBeforeClose: args.save_before_close } : {}),
          ...(args.confirm_close !== undefined ? { confirmClose: args.confirm_close } : {}),
          ...(args.confirm_discard_unsaved !== undefined ? { confirmDiscardUnsaved: args.confirm_discard_unsaved } : {}),
        });
        return { success: false, error: `Unsupported project-session action: ${String(args.action)}` };
      },
    },
    manage_growing_media_uxp: {
      description: "Inspect, pause under a bounded lease, or resume Premiere growing-media swaps. Pause expires within ten minutes and is resumed on ordinary panel or bridge shutdown; status is panel-local and never claims a host readback.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["status", "pause", "resume"] },
          project_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
          expected_path: { type: "string", minLength: 1, maxLength: 4096 },
          lease_ms: { type: "integer", minimum: 1000, maximum: 600000 },
          confirm_pause: { type: "boolean", description: "Must be true for pause." },
          operation_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
        },
        required: ["action"],
      },
      handler: async (args: GrowingMediaArgs) => {
        if (args.action === "status") return invoke(bridge, "growing.status");
        if (args.action === "pause") return invoke(bridge, "growing.pause", {
          ...(args.project_id !== undefined ? { projectId: args.project_id } : {}),
          ...(args.expected_path !== undefined ? { expectedPath: args.expected_path } : {}),
          ...(args.lease_ms !== undefined ? { leaseMs: args.lease_ms } : {}),
          ...(args.confirm_pause !== undefined ? { confirmPause: args.confirm_pause } : {}),
          ...(args.operation_id !== undefined ? { operationId: args.operation_id } : {}),
        });
        if (args.action === "resume") return invoke(bridge, "growing.resume", {
          ...(args.project_id !== undefined ? { projectId: args.project_id } : {}),
          ...(args.operation_id !== undefined ? { operationId: args.operation_id } : {}),
        });
        return { success: false, error: `Unsupported growing-media action: ${String(args.action)}` };
      },
    },
    manage_workflow_checkpoints_uxp: {
      description: "Read or transactionally write small, namespaced workflow checkpoints on the active project or a targeted sequence. Persistent values may sync with cloud projects; never store secrets, native paths, transcripts, or media names.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["has", "get", "set", "clear"] },
          owner: { type: "string", enum: ["project", "sequence"] },
          sequence_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
          expected_owner_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
          name: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$" },
          value_type: { type: "string", enum: ["string", "int", "float", "bool"] },
          value: { type: ["string", "number", "boolean"], maxLength: 8192 },
          persistence: { type: "string", enum: ["session", "persistent"] },
          operation_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
        },
        required: ["action", "name"],
      },
      handler: async (args: CheckpointArgs) => {
        const common = {
          ...(args.owner !== undefined ? { owner: args.owner } : {}),
          ...(args.sequence_id !== undefined ? { sequenceId: args.sequence_id } : {}),
          ...(args.expected_owner_id !== undefined ? { expectedOwnerId: args.expected_owner_id } : {}),
          name: args.name,
        };
        if (args.action === "has") return invoke(bridge, "checkpoint.has", common);
        if (args.action === "get") return invoke(bridge, "checkpoint.get", {
          ...common, ...(args.value_type !== undefined ? { valueType: args.value_type } : {}),
        });
        if (args.action === "set") return invoke(bridge, "checkpoint.set", {
          ...common,
          ...(args.value_type !== undefined ? { valueType: args.value_type } : {}),
          ...(args.value !== undefined ? { value: args.value } : {}),
          ...(args.persistence !== undefined ? { persistence: args.persistence } : {}),
          ...(args.operation_id !== undefined ? { operationId: args.operation_id } : {}),
        });
        if (args.action === "clear") return invoke(bridge, "checkpoint.clear", {
          ...common, ...(args.operation_id !== undefined ? { operationId: args.operation_id } : {}),
        });
        return { success: false, error: `Unsupported checkpoint action: ${String(args.action)}` };
      },
    },
  };
}
