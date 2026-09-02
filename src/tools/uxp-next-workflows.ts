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

type MediaHealthArgs = {
  action?: string;
  project_item_ids?: string[];
  project_item_id?: string;
  expected_offline?: boolean;
  confirm_set_offline?: boolean;
  match_path?: string;
  ignore_subclips?: boolean;
  include_paths?: boolean;
  include_media_timing?: boolean;
  operation_id?: string;
};

type SourceMediaTimingArgs = {
  action?: string;
  project_item_id?: string;
  expected_timing?: {
    start_seconds?: number;
    duration_seconds?: number;
  };
  start_seconds?: number;
  confirm_set_start?: boolean;
  operation_id?: string;
};

type TrackStateArgs = {
  action?: string;
  sequence_id?: string;
  expected_sequence_id?: string;
  media_type?: string;
  track_indices?: number[];
  muted?: boolean;
  expected_muted?: boolean;
  operation_id?: string;
};

type SourceClipItem = {
  project_item_id?: string;
  media_type?: string;
  expected_in_seconds?: number;
  expected_out_seconds?: number;
  in_seconds?: number;
  out_seconds?: number;
  clear_in_out?: boolean;
  scale_to_frame?: boolean;
};

type SourceClipArgs = {
  action?: string;
  items?: SourceClipItem[];
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
    maintain_media_health_uxp: {
      description: "Inspect up to 64 source media items, refresh them serially, transactionally set them offline, or find project items matching an approved media path. Native paths are redacted unless explicitly requested; opt-in media timing is read-only, bounded, and runtime-compatible.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["inspect", "refresh", "set_offline", "find_by_media_path"] },
          project_item_ids: {
            type: "array", minItems: 1, maxItems: 64, uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 512 },
          },
          project_item_id: { type: "string", minLength: 1, maxLength: 512 },
          expected_offline: { type: "boolean" },
          confirm_set_offline: { type: "boolean" },
          match_path: { type: "string", minLength: 1, maxLength: 4096 },
          ignore_subclips: { type: "boolean" },
          include_paths: { type: "boolean", description: "Explicitly include media/proxy/origin paths; defaults to redacted." },
          include_media_timing: { type: "boolean", description: "For inspect only, include bounded source start/duration readback; defaults to false." },
          operation_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
        },
        required: ["action"],
      },
      handler: async (args: MediaHealthArgs) => {
        if (args.action === "inspect") return invoke(bridge, "media.health.inspect", {
          ...(args.project_item_ids !== undefined ? { projectItemIds: args.project_item_ids } : {}),
          ...(args.include_paths !== undefined ? { includePaths: args.include_paths } : {}),
          ...(args.include_media_timing !== undefined ? { includeMediaTiming: args.include_media_timing } : {}),
        });
        if (args.action === "refresh") return invoke(bridge, "media.health.refresh", {
          ...(args.project_item_ids !== undefined ? { projectItemIds: args.project_item_ids } : {}),
          ...(args.expected_offline !== undefined ? { expectedOffline: args.expected_offline } : {}),
          ...(args.operation_id !== undefined ? { operationId: args.operation_id } : {}),
        });
        if (args.action === "set_offline") return invoke(bridge, "media.health.setOffline", {
          ...(args.project_item_ids !== undefined ? { projectItemIds: args.project_item_ids } : {}),
          ...(args.expected_offline !== undefined ? { expectedOffline: args.expected_offline } : {}),
          ...(args.confirm_set_offline !== undefined ? { confirmSetOffline: args.confirm_set_offline } : {}),
          ...(args.operation_id !== undefined ? { operationId: args.operation_id } : {}),
        });
        if (args.action === "find_by_media_path") return invoke(bridge, "media.health.findByPath", {
          ...(args.project_item_id !== undefined ? { projectItemId: args.project_item_id } : {}),
          ...(args.match_path !== undefined ? { matchPath: args.match_path } : {}),
          ...(args.ignore_subclips !== undefined ? { ignoreSubclips: args.ignore_subclips } : {}),
          ...(args.include_paths !== undefined ? { includePaths: args.include_paths } : {}),
        });
        return { success: false, error: `Unsupported media-health action: ${String(args.action)}` };
      },
    },
    manage_source_media_timing_uxp: {
      description: "Inspect or transactionally set one source media item's timecode start through stable Premiere 26.3 UXP APIs. Setting requires the exact bounded timing snapshot, explicit confirmation, one undoable transaction, per-item serialization, and native readback.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["inspect", "set_start"] },
          project_item_id: { type: "string", minLength: 1, maxLength: 512 },
          expected_timing: {
            type: "object", additionalProperties: false,
            properties: {
              start_seconds: { type: "number", minimum: 0, maximum: 86400000 },
              duration_seconds: { type: "number", minimum: 0, maximum: 86400000 },
            },
            required: ["start_seconds", "duration_seconds"],
            description: "Required for set_start. Copy the complete snapshot returned by inspect; a changed start or duration rejects the request before action creation.",
          },
          start_seconds: { type: "number", minimum: 0, maximum: 86400000 },
          confirm_set_start: { type: "boolean", description: "Required true for set_start because source timecode changes can affect editorial synchronization." },
          operation_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
        },
        required: ["action", "project_item_id"],
      },
      handler: async (args: SourceMediaTimingArgs) => {
        const common = {
          ...(args.project_item_id === undefined ? {} : { projectItemId: args.project_item_id }),
        };
        if (args.action === "inspect") return invoke(bridge, "source.mediaTiming.inspect", common);
        if (args.action === "set_start") return invoke(bridge, "source.mediaTiming.setStart", {
          ...common,
          ...(args.expected_timing === undefined ? {} : { expectedTiming: {
            ...(args.expected_timing.start_seconds === undefined ? {} : { startSeconds: args.expected_timing.start_seconds }),
            ...(args.expected_timing.duration_seconds === undefined ? {} : { durationSeconds: args.expected_timing.duration_seconds }),
          } }),
          ...(args.start_seconds === undefined ? {} : { startSeconds: args.start_seconds }),
          ...(args.confirm_set_start === undefined ? {} : { confirmSetStart: args.confirm_set_start }),
          ...(args.operation_id === undefined ? {} : { operationId: args.operation_id }),
        });
        return { success: false, error: `Unsupported source-media timing action: ${String(args.action)}` };
      },
    },
    manage_track_state_uxp: {
      description: "Inspect audio, video, and caption track mute state or set one media type serially with stale-state preflight and per-track readback. Adobe exposes this as direct promises, so no undo transaction is claimed.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["inspect", "set_mute"] },
          sequence_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
          expected_sequence_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
          media_type: { type: "string", enum: ["all", "video", "audio", "caption"] },
          track_indices: {
            type: "array", minItems: 1, maxItems: 64, uniqueItems: true,
            items: { type: "integer", minimum: 0, maximum: 1023 },
          },
          muted: { type: "boolean" },
          expected_muted: { type: "boolean" },
          operation_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
        },
        required: ["action"],
      },
      handler: async (args: TrackStateArgs) => {
        const common = {
          ...(args.sequence_id !== undefined ? { sequenceId: args.sequence_id } : {}),
          ...(args.expected_sequence_id !== undefined ? { expectedSequenceId: args.expected_sequence_id } : {}),
          ...(args.media_type !== undefined ? { mediaType: args.media_type } : {}),
          ...(args.track_indices !== undefined ? { trackIndices: args.track_indices } : {}),
        };
        if (args.action === "inspect") return invoke(bridge, "track.state.inspect", common);
        if (args.action === "set_mute") return invoke(bridge, "track.state.set", {
          ...common,
          ...(args.muted !== undefined ? { muted: args.muted } : {}),
          ...(args.expected_muted !== undefined ? { expectedMuted: args.expected_muted } : {}),
          ...(args.operation_id !== undefined ? { operationId: args.operation_id } : {}),
        });
        return { success: false, error: `Unsupported track-state action: ${String(args.action)}` };
      },
    },
    manage_source_clip_uxp: {
      description: "Inspect or transactionally update source-clip in/out points and request scale-to-frame for up to 64 media items. In/out values are read back; Adobe exposes no getter for clear or scale state, so those requests remain committed-unverified.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["inspect", "update"] },
          items: {
            type: "array", minItems: 1, maxItems: 64,
            items: {
              type: "object", additionalProperties: false,
              properties: {
                project_item_id: { type: "string", minLength: 1, maxLength: 512 },
                media_type: { type: "string", enum: ["video", "audio"] },
                expected_in_seconds: { type: "number", minimum: 0, maximum: 86400000 },
                expected_out_seconds: { type: "number", minimum: 0, maximum: 86400000 },
                in_seconds: { type: "number", minimum: 0, maximum: 86400000 },
                out_seconds: { type: "number", minimum: 0, maximum: 86400000 },
                clear_in_out: { type: "boolean" },
                scale_to_frame: { type: "boolean", enum: [true] },
              },
              required: ["project_item_id"],
            },
          },
          operation_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
        },
        required: ["action", "items"],
      },
      handler: async (args: SourceClipArgs) => {
        const items = args.items?.map((item) => ({
          ...(item.project_item_id !== undefined ? { projectItemId: item.project_item_id } : {}),
          ...(item.media_type !== undefined ? { mediaType: item.media_type } : {}),
          ...(item.expected_in_seconds !== undefined ? { expectedInSeconds: item.expected_in_seconds } : {}),
          ...(item.expected_out_seconds !== undefined ? { expectedOutSeconds: item.expected_out_seconds } : {}),
          ...(item.in_seconds !== undefined ? { inSeconds: item.in_seconds } : {}),
          ...(item.out_seconds !== undefined ? { outSeconds: item.out_seconds } : {}),
          ...(item.clear_in_out !== undefined ? { clearInOut: item.clear_in_out } : {}),
          ...(item.scale_to_frame !== undefined ? { scaleToFrame: item.scale_to_frame } : {}),
        }));
        if (args.action === "inspect") return invoke(bridge, "source.clip.inspect", { items });
        if (args.action === "update") return invoke(bridge, "source.clip.update", {
          items,
          ...(args.operation_id !== undefined ? { operationId: args.operation_id } : {}),
        });
        return { success: false, error: `Unsupported source-clip action: ${String(args.action)}` };
      },
    },
  };
}
