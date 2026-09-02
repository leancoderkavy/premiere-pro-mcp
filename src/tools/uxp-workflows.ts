import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";

type WorkflowArgs = {
  action?: string;
  media_type?: string;
  track_index?: number;
  clip_index?: number;
  effect_id?: string;
  insertion_index?: number;
  component_index?: number;
  expected_effect_id?: string;
  mode?: string;
  project_item_id?: string;
  project_item_name?: string;
  media_path?: string;
  is_high_resolution?: boolean;
  make_alternate_link_in_team_projects?: boolean;
  replace_existing_proxy?: boolean;
  enabled?: boolean;
  confirm_non_undoable?: boolean;
  new_path?: string;
  expected_current_path?: string;
  override_compatibility_check?: boolean;
  require_offline?: boolean;
  project_metadata?: string;
  xmp_metadata?: string;
  updated_fields?: string[];
  frame_rate?: number;
  pixel_aspect_ratio?: number;
  field_type?: number;
  remove_pulldown?: boolean;
  alpha_usage?: number;
  ignore_alpha?: boolean;
  invert_alpha?: boolean;
  vr_conform?: number;
  vr_layout?: number;
  vr_horizontal_view?: number;
  vr_vertical_view?: number;
  input_lut_id?: string;
  file_path?: string;
  seconds?: number;
  speed?: number;
  folder_types?: string[];
  destination?: string;
  operation_id?: string;
  expected_sequence_guid?: string;
  selection_items?: TimelineSelectionItemArgs[];
  selection_targets?: TimelineSelectionTargetArgs[];
};

type TimelineSelectionTargetArgs = {
  media_type?: string;
  track_index?: number;
  clip_index?: number;
};

type TimelineSelectionItemArgs = {
  media_type?: string;
  track_index?: number;
  clip_index?: number;
  expected_project_item_id?: string;
  expected_start_seconds?: number;
  expected_end_seconds?: number;
};

function invoke(
  bridge: UxpWebSocketBridge,
  command: string,
  args: Record<string, unknown> = {},
) {
  return bridge.request(command, args)
    .then((result) => ({ success: true, data: { backend: "uxp", result } }))
    .catch((error: unknown) => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }));
}

function target(args: WorkflowArgs): Record<string, unknown> {
  return {
    ...(args.project_item_id !== undefined ? { projectItemId: args.project_item_id } : {}),
    ...(args.project_item_name !== undefined ? { projectItemName: args.project_item_name } : {}),
  };
}

function operation(args: WorkflowArgs): Record<string, unknown> {
  return args.operation_id ? { operationId: args.operation_id } : {};
}

function invalidAction(value: unknown) {
  return { success: false, error: `Unsupported workflow action: ${String(value)}` };
}

const projectItemProperties = {
  project_item_id: { type: "string", minLength: 1, maxLength: 512, description: "Stable project-item ID. Omit with project_item_name to use exactly one Project panel selection." },
  project_item_name: { type: "string", minLength: 1, maxLength: 255, description: "Unique media-clip name. Not allowed together with project_item_id." },
};

const operationId = {
  type: "string",
  pattern: "^[A-Za-z0-9._:-]{1,128}$",
  description: "Optional idempotency key for mutating operations.",
};

export function getUxpWorkflowTools(bridge: UxpWebSocketBridge) {
  return {
    manage_clip_effects_uxp: {
      description: "List native audio/video effects, inspect one clip's component chain, or add/remove one effect in a locked Premiere UXP transaction.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["catalog", "inspect", "add", "remove"] },
          media_type: { type: "string", enum: ["video", "audio", "all"] },
          track_index: { type: "integer", minimum: 0 },
          clip_index: { type: "integer", minimum: 0 },
          effect_id: { type: "string", minLength: 1, maxLength: 256, description: "Video match name or audio display name returned by catalog." },
          insertion_index: { type: "integer", minimum: 0 },
          component_index: { type: "integer", minimum: 0 },
          expected_effect_id: { type: "string", minLength: 1, maxLength: 256, description: "Required stale-chain guard for removal; must match the inspected match or display name." },
          operation_id: operationId,
        },
        required: ["action"],
      },
      handler: async (args: WorkflowArgs) => {
        if (args.action === "catalog") return invoke(bridge, "effects.catalog", args.media_type ? { mediaType: args.media_type } : {});
        const coordinates = {
          mediaType: args.media_type, trackIndex: args.track_index, clipIndex: args.clip_index,
        };
        if (args.action === "inspect") return invoke(bridge, "effects.chain.get", coordinates);
        if (args.action === "add") return invoke(bridge, "effects.chain.add", {
          ...coordinates, effectId: args.effect_id,
          ...(args.insertion_index === undefined ? {} : { insertionIndex: args.insertion_index }),
          ...operation(args),
        });
        if (args.action === "remove") return invoke(bridge, "effects.chain.remove", {
          ...coordinates, componentIndex: args.component_index, expectedEffectId: args.expected_effect_id, ...operation(args),
        });
        return invalidAction(args.action);
      },
    },

    batch_selected_clips_uxp: {
      description: "Inspect the current timeline selection or apply one native effect add/remove across up to 64 same-type selected clips as a single compound transaction.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["inspect", "add_effect", "remove_effect"] },
          media_type: { type: "string", enum: ["video", "audio"] },
          effect_id: { type: "string", minLength: 1, maxLength: 256 },
          insertion_index: { type: "integer", minimum: 0 },
          component_index: { type: "integer", minimum: 0 },
          expected_effect_id: { type: "string", minLength: 1, maxLength: 256 },
          operation_id: operationId,
        },
        required: ["action"],
      },
      handler: async (args: WorkflowArgs) => {
        if (args.action === "inspect") return invoke(bridge, "selection.inspect");
        if (args.action === "add_effect") return invoke(bridge, "effects.selection.add", {
          mediaType: args.media_type, effectId: args.effect_id,
          ...(args.insertion_index === undefined ? {} : { insertionIndex: args.insertion_index }),
          ...operation(args),
        });
        if (args.action === "remove_effect") return invoke(bridge, "effects.selection.remove", {
          mediaType: args.media_type, componentIndex: args.component_index, expectedEffectId: args.expected_effect_id, ...operation(args),
        });
        return invalidAction(args.action);
      },
    },

    manage_timeline_selection_uxp: {
      description: "Inspect, replace, add to, remove from, or clear the active sequence's native UXP clip selection with sequence and clip fingerprint stale-state guards.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["inspect", "inspect_targets", "replace", "add", "remove", "clear"] },
          selection_targets: {
            type: "array", minItems: 1, maxItems: 64,
            description: "Required for inspect_targets; returns the project-item and timeline-time fingerprints needed by mutation actions.",
            items: {
              type: "object", additionalProperties: false,
              properties: {
                media_type: { type: "string", enum: ["video", "audio"] },
                track_index: { type: "integer", minimum: 0 },
                clip_index: { type: "integer", minimum: 0 },
              },
              required: ["media_type", "track_index", "clip_index"],
            },
          },
          expected_sequence_guid: {
            type: "string", minLength: 1, maxLength: 512,
            description: "Required for mutations; copy sequenceGuid from a recent inspect result.",
          },
          selection_items: {
            type: "array", minItems: 1, maxItems: 64,
            description: "Required for replace/add/remove. Every coordinate must include the project-item and timeline-time fingerprint returned by inspect.",
            items: {
              type: "object", additionalProperties: false,
              properties: {
                media_type: { type: "string", enum: ["video", "audio"] },
                track_index: { type: "integer", minimum: 0 },
                clip_index: { type: "integer", minimum: 0 },
                expected_project_item_id: { type: "string", minLength: 1, maxLength: 512 },
                expected_start_seconds: { type: "number", minimum: 0 },
                expected_end_seconds: { type: "number", minimum: 0 },
              },
              required: [
                "media_type", "track_index", "clip_index", "expected_project_item_id",
                "expected_start_seconds", "expected_end_seconds",
              ],
            },
          },
          operation_id: operationId,
        },
        required: ["action"],
      },
      handler: async (args: WorkflowArgs) => {
        if (args.action === "inspect") return invoke(bridge, "selection.fingerprints.inspect");
        if (args.action === "inspect_targets") {
          if (!args.selection_targets?.length) {
            return { success: false, error: "inspect_targets requires one or more selection_targets" };
          }
          return invoke(bridge, "selection.targets.inspect", {
            items: args.selection_targets.map((item) => ({
              mediaType: item.media_type, trackIndex: item.track_index, clipIndex: item.clip_index,
            })),
          });
        }
        if (["replace", "add", "remove", "clear"].includes(args.action ?? "")) {
          if (!args.expected_sequence_guid) {
            return { success: false, error: `${args.action} requires expected_sequence_guid from a recent inspection` };
          }
          if (args.action === "clear" && args.selection_items !== undefined) {
            return { success: false, error: "clear requires selection_items to be omitted" };
          }
          if (args.action !== "clear" && !args.selection_items?.length) {
            return { success: false, error: `${args.action} requires one or more selection_items` };
          }
          return invoke(bridge, "selection.update", {
            mode: args.action,
            expectedSequenceGuid: args.expected_sequence_guid,
            ...(args.selection_items === undefined ? {} : {
              items: args.selection_items.map((item) => ({
                mediaType: item.media_type,
                trackIndex: item.track_index,
                clipIndex: item.clip_index,
                expectedProjectItemId: item.expected_project_item_id,
                expectedStartSeconds: item.expected_start_seconds,
                expectedEndSeconds: item.expected_end_seconds,
              })),
            }),
            ...operation(args),
          });
        }
        return invalidAction(args.action);
      },
    },

    detect_scene_edits_uxp: {
      description: "Run Premiere's documented scene-edit detection on the current timeline selection using cuts, markers, or subclips. This direct host mutation is not claimed undoable.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          mode: { type: "string", enum: ["apply_cuts", "create_markers", "create_subclips"] },
          operation_id: operationId,
        },
        required: ["mode"],
      },
      handler: async (args: WorkflowArgs) => {
        const modes: Record<string, string> = { apply_cuts: "applyCuts", create_markers: "createMarkers", create_subclips: "createSubclips" };
        if (!args.mode || !modes[args.mode]) return invalidAction(args.mode);
        return invoke(bridge, "sceneEdit.detect", { mode: modes[args.mode], ...operation(args) });
      },
    },

    manage_proxy_ingest_uxp: {
      description: "Inspect or attach proxy/high-resolution media for one clip, or read/update project ingest state. Attach operations are non-undoable and workspace-contained.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["inspect_proxy", "attach_proxy", "get_ingest", "set_ingest"] },
          ...projectItemProperties,
          media_path: { type: "string", minLength: 1, maxLength: 4096 },
          is_high_resolution: { type: "boolean", description: "False attaches proxy media; true attaches high-resolution media." },
          make_alternate_link_in_team_projects: { type: "boolean" },
          replace_existing_proxy: { type: "boolean", description: "Required to replace a different attached proxy." },
          enabled: { type: "boolean" },
          confirm_non_undoable: { type: "boolean" },
          operation_id: operationId,
        },
        required: ["action"],
      },
      handler: async (args: WorkflowArgs) => {
        if (args.action === "inspect_proxy") return invoke(bridge, "proxy.inspect", target(args));
        if (args.action === "get_ingest") return invoke(bridge, "ingest.get");
        if (args.action === "set_ingest") return invoke(bridge, "ingest.configure", { enabled: args.enabled, ...operation(args) });
        if (args.action === "attach_proxy") return invoke(bridge, "proxy.attach", {
          ...target(args), mediaPath: args.media_path,
          ...(args.is_high_resolution === undefined ? {} : { isHiRes: args.is_high_resolution }),
          ...(args.make_alternate_link_in_team_projects === undefined ? {} : { makeAlternateLinkInTeamProjects: args.make_alternate_link_in_team_projects }),
          ...(args.replace_existing_proxy === undefined ? {} : { replaceExistingProxy: args.replace_existing_proxy }),
          confirmNonUndoable: args.confirm_non_undoable, ...operation(args),
        });
        return invalidAction(args.action);
      },
    },

    relink_offline_media_uxp: {
      description: "Relink one offline clip to a workspace-contained media path after stale-path and capability checks. This Premiere API is non-undoable and requires explicit confirmation.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          ...projectItemProperties,
          new_path: { type: "string", minLength: 1, maxLength: 4096 },
          expected_current_path: { type: "string", minLength: 1, maxLength: 4096 },
          override_compatibility_check: { type: "boolean" },
          require_offline: { type: "boolean", description: "Defaults to true." },
          confirm_non_undoable: { type: "boolean" },
          operation_id: operationId,
        },
        required: ["new_path", "confirm_non_undoable"],
      },
      handler: async (args: WorkflowArgs) => invoke(bridge, "media.relink", {
        ...target(args), newPath: args.new_path,
        ...(args.expected_current_path ? { expectedCurrentPath: args.expected_current_path } : {}),
        ...(args.override_compatibility_check === undefined ? {} : { overrideCompatibilityCheck: args.override_compatibility_check }),
        ...(args.require_offline === undefined ? {} : { requireOffline: args.require_offline }),
        confirmNonUndoable: args.confirm_non_undoable, ...operation(args),
      }),
    },

    manage_metadata_uxp: {
      description: "Read bounded project/XMP metadata or update either form together in one locked, undoable Premiere transaction with readback evidence.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["get", "update"] },
          ...projectItemProperties,
          project_metadata: { type: "string", maxLength: 350000, description: "Project metadata; combined readback is limited to a 900,000-byte serialized UTF-8 result." },
          xmp_metadata: { type: "string", maxLength: 350000, description: "XMP metadata; combined readback is limited to a 900,000-byte serialized UTF-8 result." },
          updated_fields: { type: "array", minItems: 1, maxItems: 128, items: { type: "string", minLength: 1, maxLength: 512 } },
          operation_id: operationId,
        },
        required: ["action"],
      },
      handler: async (args: WorkflowArgs) => {
        if (args.action === "get") return invoke(bridge, "metadata.get", target(args));
        if (args.action === "update") return invoke(bridge, "metadata.update", {
            ...target(args),
            ...(args.project_metadata === undefined ? {} : { projectMetadata: args.project_metadata }),
            ...(args.xmp_metadata === undefined ? {} : { xmpMetadata: args.xmp_metadata }),
            ...(args.updated_fields === undefined ? {} : { updatedFields: args.updated_fields }),
            ...operation(args),
          });
        return invalidAction(args.action);
      },
    },

    inspect_project_panel_metadata_uxp: {
      description: "Read bounded native Project-panel metadata: either the active project's panel schema or one media item's column metadata. This is read-only; it neither creates metadata schema fields nor writes Project-panel state.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["panel", "item_columns"] },
          ...projectItemProperties,
        },
        required: ["action"],
      },
      operationalCapability: {
        backend: "UXP" as const,
        backends: ["uxp" as const],
        minimumPremiereVersion: "25.6",
        verificationBoundary: "structured_uxp_readback" as const,
        hostVerificationRequired: true,
        notes: ["Available only through an authenticated UXP bridge whose runtime capability handshake advertises the requested metadata Project-panel command."],
      },
      handler: async (args: WorkflowArgs) => {
        if (args.action === "panel") return invoke(bridge, "metadata.projectPanel.get");
        if (args.action === "item_columns") return invoke(bridge, "metadata.columns.get", target(args));
        return invalidAction(args.action);
      },
    },

    manage_color_conformance_uxp: {
      description: "Preflight project graphics-white/LUT/footage interpretation state, or update bounded footage-conformance fields in one undoable UXP transaction.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["preflight", "update"] },
          ...projectItemProperties,
          frame_rate: { type: "number", minimum: 1, maximum: 240 },
          pixel_aspect_ratio: { type: "number", minimum: 0.01, maximum: 100 },
          field_type: { type: "integer", minimum: 0, maximum: 64 },
          remove_pulldown: { type: "boolean" },
          alpha_usage: { type: "integer", minimum: 0, maximum: 64 },
          ignore_alpha: { type: "boolean" },
          invert_alpha: { type: "boolean" },
          vr_conform: { type: "integer", minimum: 0, maximum: 64 },
          vr_layout: { type: "integer", minimum: 0, maximum: 64 },
          vr_horizontal_view: { type: "number", minimum: 1, maximum: 360 },
          vr_vertical_view: { type: "number", minimum: 1, maximum: 180 },
          input_lut_id: { type: "string", maxLength: 512 },
          operation_id: operationId,
        },
        required: ["action"],
      },
      handler: async (args: WorkflowArgs) => {
        if (args.action === "preflight") return invoke(bridge, "color.preflight", target(args));
        if (args.action === "update") return invoke(bridge, "footage.conform", {
          ...target(args),
          ...(args.frame_rate === undefined ? {} : { frameRate: args.frame_rate }),
          ...(args.pixel_aspect_ratio === undefined ? {} : { pixelAspectRatio: args.pixel_aspect_ratio }),
          ...(args.field_type === undefined ? {} : { fieldType: args.field_type }),
          ...(args.remove_pulldown === undefined ? {} : { removePullDown: args.remove_pulldown }),
          ...(args.alpha_usage === undefined ? {} : { alphaUsage: args.alpha_usage }),
          ...(args.ignore_alpha === undefined ? {} : { ignoreAlpha: args.ignore_alpha }),
          ...(args.invert_alpha === undefined ? {} : { invertAlpha: args.invert_alpha }),
          ...(args.vr_conform === undefined ? {} : { vrConform: args.vr_conform }),
          ...(args.vr_layout === undefined ? {} : { vrLayout: args.vr_layout }),
          ...(args.vr_horizontal_view === undefined ? {} : { vrHorzView: args.vr_horizontal_view }),
          ...(args.vr_vertical_view === undefined ? {} : { vrVertView: args.vr_vertical_view }),
          ...(args.input_lut_id === undefined ? {} : { inputLutId: args.input_lut_id }),
          ...operation(args),
        });
        return invalidAction(args.action);
      },
    },

    audition_source_monitor_uxp: {
      description: "Open a selected project item or approved file, inspect/set position, play at bounded speed, or close Source Monitor media through documented UXP APIs.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["state", "open_project_item", "open_file", "set_position", "play", "close", "close_all"] },
          ...projectItemProperties,
          file_path: { type: "string", minLength: 1, maxLength: 4096 },
          seconds: { type: "number", minimum: 0 },
          speed: { type: "number", minimum: -16, maximum: 16 },
          operation_id: operationId,
        },
        required: ["action"],
      },
      handler: async (args: WorkflowArgs) => {
        if (args.action === "state") return invoke(bridge, "sourceMonitor.state");
        if (args.action === "open_project_item") return invoke(bridge, "sourceMonitor.open", { ...target(args), ...operation(args) });
        if (args.action === "open_file") return invoke(bridge, "sourceMonitor.open", { filePath: args.file_path, ...operation(args) });
        if (args.action === "set_position") return invoke(bridge, "sourceMonitor.position.set", { seconds: args.seconds, ...operation(args) });
        if (args.action === "play") return invoke(bridge, "sourceMonitor.play", { ...(args.speed === undefined ? {} : { speed: args.speed }), ...operation(args) });
        if (args.action === "close" || args.action === "close_all") return invoke(bridge, "sourceMonitor.close", { all: args.action === "close_all", ...operation(args) });
        return invalidAction(args.action);
      },
    },

    preflight_production_storage_uxp: {
      description: "Inspect project/Production scratch disks and ingest state, or set supported project scratch categories to Premiere's symbolic destinations in one undoable transaction.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["preflight", "configure_project"] },
          folder_types: {
            type: "array", minItems: 1, maxItems: 6, uniqueItems: true,
            items: { type: "string", enum: ["capture", "audio_preview", "video_preview", "auto_save", "cc_libraries", "capsule_media"] },
          },
          destination: { type: "string", enum: ["same_as_project", "my_documents"] },
          operation_id: operationId,
        },
        required: ["action"],
      },
      handler: async (args: WorkflowArgs) => {
        if (args.action === "preflight") return invoke(bridge, "storage.preflight");
        if (args.action !== "configure_project") return invalidAction(args.action);
        if (!args.folder_types?.length ||
          (args.destination !== "same_as_project" && args.destination !== "my_documents")) {
          return { success: false, error: "configure_project requires folder_types and destination" };
        }
        const typeMap: Record<string, string> = {
          capture: "capture", audio_preview: "audioPreview", video_preview: "videoPreview",
          auto_save: "autoSave", cc_libraries: "ccLibraries", capsule_media: "capsuleMedia",
        };
        return invoke(bridge, "scratch.configure", {
          folderTypes: args.folder_types.map((value) => typeMap[value]),
          destination: args.destination === "same_as_project" ? "sameAsProject" : "myDocuments",
          ...operation(args),
        });
      },
    },

    inspect_premiere_environment_uxp: {
      description: "Inspect After Effects interoperability and the active Premiere project's current and supported graphics-white luminance values through documented read-only UXP APIs.",
      parameters: {},
      handler: async () => invoke(bridge, "environment.inspect"),
    },

    get_uxp_workspace_access: {
      description: "Report whether the Premiere panel has an operator-approved persistent workspace folder. The native path and persistent token are never returned.",
      parameters: {},
      handler: async () => invoke(bridge, "workspace.status"),
    },
  };
}
