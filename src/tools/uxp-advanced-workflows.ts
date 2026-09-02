import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";
import { planDerivedSilenceRemoval } from "./silence-removal.js";

const WAIT_RESPONSE_BUFFER_MS = 5_000;

type AdvancedArgs = Record<string, unknown> & {
  action?: string;
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

function compact(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function operation(args: AdvancedArgs): Record<string, unknown> {
  return args.operation_id ? { operationId: args.operation_id } : {};
}

function invalidAction(value: unknown) {
  return { success: false, error: `Unsupported workflow action: ${String(value)}` };
}

type ReviewedMarkerSnapshot = {
  markerGuid: string;
  expectedName: string;
  expectedStartSeconds: number;
  expectedDurationSeconds: number;
};

function reviewedMarkerSnapshots(value: unknown): ReviewedMarkerSnapshot[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) {
    throw new Error("marker_snapshots must contain between 1 and 128 reviewed marker snapshots");
  }
  const seen = new Set<string>();
  return value.map((rawSnapshot, index) => {
    if (!rawSnapshot || typeof rawSnapshot !== "object" || Array.isArray(rawSnapshot)) {
      throw new Error(`marker_snapshots[${index}] must be an object`);
    }
    const snapshot = rawSnapshot as Record<string, unknown>;
    const allowed = ["marker_guid", "expected_name", "expected_start_seconds", "expected_duration_seconds"];
    const unknown = Object.keys(snapshot).find((key) => !allowed.includes(key));
    if (unknown) throw new Error(`marker_snapshots[${index}] has an unknown field: ${unknown}`);
    if (typeof snapshot.marker_guid !== "string" || !snapshot.marker_guid.trim() || snapshot.marker_guid.length > 128) {
      throw new Error(`marker_snapshots[${index}].marker_guid must be a non-empty string of at most 128 characters`);
    }
    if (seen.has(snapshot.marker_guid)) throw new Error("marker_snapshots must not contain duplicate marker_guid values");
    seen.add(snapshot.marker_guid);
    if (typeof snapshot.expected_name !== "string" || snapshot.expected_name.length > 255) {
      throw new Error(`marker_snapshots[${index}].expected_name must be a string of at most 255 characters`);
    }
    for (const [key, item] of Object.entries({
      expected_start_seconds: snapshot.expected_start_seconds,
      expected_duration_seconds: snapshot.expected_duration_seconds,
    })) {
      if (typeof item !== "number" || !Number.isFinite(item) || item < 0 || item > 86400) {
        throw new Error(`marker_snapshots[${index}].${key} must be a number from 0 to 86400`);
      }
    }
    return {
      markerGuid: snapshot.marker_guid,
      expectedName: snapshot.expected_name,
      expectedStartSeconds: snapshot.expected_start_seconds as number,
      expectedDurationSeconds: snapshot.expected_duration_seconds as number,
    };
  });
}

const operationId = {
  type: "string",
  pattern: "^[A-Za-z0-9._:-]{1,128}$",
  description: "Optional idempotency key for a mutating operation.",
};

const MAX_DISPLAY_FORMAT_CODE = 2_147_483_647;

type DisplayFormatSnapshot = {
  audioDisplayFormat: number;
  videoDisplayFormat: number;
};

function boundedDisplayFormatCode(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_DISPLAY_FORMAT_CODE) {
    throw new Error(`${name} must be a non-negative integer no greater than ${MAX_DISPLAY_FORMAT_CODE}`);
  }
  return value;
}

function reviewedDisplayFormats(value: unknown): DisplayFormatSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expected_display_formats must be an object returned by inspect");
  }
  const formats = value as Record<string, unknown>;
  const allowed = ["audio_display_format", "video_display_format"];
  const unknown = Object.keys(formats).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`expected_display_formats has an unknown field: ${unknown}`);
  if (!("audio_display_format" in formats) || !("video_display_format" in formats)) {
    throw new Error("expected_display_formats must include audio_display_format and video_display_format");
  }
  return {
    audioDisplayFormat: boundedDisplayFormatCode(formats.audio_display_format, "expected_display_formats.audio_display_format"),
    videoDisplayFormat: boundedDisplayFormatCode(formats.video_display_format, "expected_display_formats.video_display_format"),
  };
}

function requestedDisplayFormats(value: unknown): Partial<DisplayFormatSnapshot> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("updates must be an object");
  }
  const formats = value as Record<string, unknown>;
  const allowed = ["audio_display_format", "video_display_format"];
  const unknown = Object.keys(formats).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`updates has an unknown field: ${unknown}`);
  const result: Partial<DisplayFormatSnapshot> = {};
  if ("audio_display_format" in formats) {
    result.audioDisplayFormat = boundedDisplayFormatCode(formats.audio_display_format, "updates.audio_display_format");
  }
  if ("video_display_format" in formats) {
    result.videoDisplayFormat = boundedDisplayFormatCode(formats.video_display_format, "updates.video_display_format");
  }
  if (!Object.keys(result).length) throw new Error("updates must include audio_display_format or video_display_format");
  return result;
}

const sequenceId = {
  type: "string",
  minLength: 1,
  maxLength: 128,
  description: "Stable sequence GUID. Omit where documented to use the active sequence.",
};

const projectItemId = {
  type: "string",
  minLength: 1,
  maxLength: 512,
  description: "Stable project-item ID. Some actions allow omission when exactly one Project item is selected.",
};

const timelineTargetProperties = {
  media_type: { type: "string", enum: ["video", "audio"] },
  track_index: { type: "integer", minimum: 0 },
  clip_index: { type: "integer", minimum: 0 },
};

const timelinePositionProperties = {
  time_seconds: { type: "number", minimum: 0, maximum: 86400 },
  video_track_index: { type: "integer", minimum: 0 },
  audio_track_index: { type: "integer", minimum: 0 },
};

export function getUxpAdvancedWorkflowTools(bridge: UxpWebSocketBridge) {
  return {
    inspect_project_selection_uxp: {
      description: "List Premiere Project-panel views or inspect up to 256 selected project items without traversing the complete project tree.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["views", "selection"] },
          view_id: { type: "string", minLength: 1, maxLength: 128 },
        },
        required: ["action"],
      },
      handler: async (args: AdvancedArgs) => {
        if (args.action === "views") return invoke(bridge, "projectSelection.views");
        if (args.action === "selection") return invoke(bridge, "projectSelection.inspect", compact({ viewId: args.view_id }));
        return invalidAction(args.action);
      },
    },

    inspect_project_tree_uxp: {
      description: "Read a bounded, depth-limited native Project-panel tree rooted at the active project. Returns stable IDs, names, types, parent IDs, bin state, and optional color-label indexes only; it never returns media paths, metadata, or rendered media.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          max_items: { type: "integer", minimum: 1, maximum: 512, description: "Maximum non-root project items to snapshot; defaults to 256." },
          max_depth: { type: "integer", minimum: 0, maximum: 16, description: "Maximum depth below the Project root to inspect; defaults to 6." },
        },
      },
      operationalCapability: {
        backend: "UXP" as const,
        backends: ["uxp" as const],
        minimumPremiereVersion: "26.3",
        verificationBoundary: "structured_uxp_readback" as const,
        hostVerificationRequired: true,
        notes: ["Available only through an authenticated UXP bridge whose runtime capability handshake advertises projectTree.inspect."],
      },
      handler: async (args: AdvancedArgs) => invoke(bridge, "projectTree.inspect", compact({ maxItems: args.max_items, maxDepth: args.max_depth })),
    },

    manage_markers_uxp: {
      description: "Inspect, add, update/move, remove, or explicitly review-then-remove a bounded marker batch by stable GUID using documented, undoable Premiere actions; mutations for one marker owner are serialized through preflight and readback.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["inspect", "add", "update", "remove", "remove_many"] },
          owner_type: { type: "string", enum: ["sequence", "project_item"] },
          sequence_id: sequenceId,
          project_item_id: projectItemId,
          marker_guid: { type: "string", minLength: 1, maxLength: 128 },
          expected_name: { type: "string", maxLength: 255, description: "Optional stale-marker guard for update/remove." },
          name: { type: "string", minLength: 1, maxLength: 255 },
          marker_type: { type: "string", minLength: 1, maxLength: 128 },
          start_seconds: { type: "number", minimum: 0, maximum: 86400 },
          duration_seconds: { type: "number", minimum: 0, maximum: 86400 },
          comments: { type: "string", maxLength: 4000 },
          color_index: { type: "integer", minimum: 0, maximum: 6 },
          marker_snapshots: {
            type: "array",
            minItems: 1,
            maxItems: 128,
            description: "Required for remove_many. Explicit read snapshots from inspect: every target GUID, name, start, and duration must still match before action creation.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                marker_guid: { type: "string", minLength: 1, maxLength: 128 },
                expected_name: { type: "string", maxLength: 255 },
                expected_start_seconds: { type: "number", minimum: 0, maximum: 86400 },
                expected_duration_seconds: { type: "number", minimum: 0, maximum: 86400 },
              },
              required: ["marker_guid", "expected_name", "expected_start_seconds", "expected_duration_seconds"],
            },
          },
          confirm_destructive: { type: "boolean", description: "Required true for remove_many after reviewing every explicit marker snapshot." },
          operation_id: operationId,
        },
        required: ["action"],
      },
      handler: async (args: AdvancedArgs) => {
        const markerOwner = compact({
          ownerType: args.owner_type === "project_item" ? "projectItem" : args.owner_type,
          sequenceId: args.sequence_id,
          projectItemId: args.project_item_id,
        });
        const common = {
          ...markerOwner,
          ...compact({
            markerGuid: args.marker_guid,
            expectedName: args.expected_name,
          }),
        };
        if (args.action === "inspect") return invoke(bridge, "markers.inspect", common);
        if (args.action === "add") return invoke(bridge, "markers.add", { ...common, ...compact({
          name: args.name, markerType: args.marker_type, startSeconds: args.start_seconds,
          durationSeconds: args.duration_seconds, comments: args.comments,
        }), ...operation(args) });
        if (args.action === "update") return invoke(bridge, "markers.update", { ...common, ...compact({
          name: args.name, markerType: args.marker_type, startSeconds: args.start_seconds,
          durationSeconds: args.duration_seconds, comments: args.comments, colorIndex: args.color_index,
        }), ...operation(args) });
        if (args.action === "remove") return invoke(bridge, "markers.remove", { ...common, ...operation(args) });
        if (args.action === "remove_many") {
          try {
            if (args.confirm_destructive !== true) {
              return { success: false, error: "remove_many is destructive; pass confirm_destructive=true after reviewing every marker snapshot" };
            }
            return invoke(bridge, "markers.removeMany", {
              ...markerOwner,
              markerSnapshots: reviewedMarkerSnapshots(args.marker_snapshots),
              confirmDestructive: true,
              ...operation(args),
            });
          } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
          }
        }
        return invalidAction(args.action);
      },
    },

    apply_beat_markers_uxp: {
      description: "Apply a reviewed beat grid as native sequence markers in one undoable Premiere 26.3+ UXP transaction, with bounded inputs and GUID/time readback for every marker.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          beat_times_seconds: { type: "array", minItems: 1, maxItems: 512, items: { type: "number", minimum: 0, maximum: 86400 }, description: "Strictly increasing unique beat times, such as beatTimesSeconds returned by detect_beats." },
          sequence_id: sequenceId,
          offset_seconds: { type: "number", minimum: -86400, maximum: 86400, description: "Timeline offset added to every beat time; every result must remain between 0 and 86400 seconds." },
          name_prefix: { type: "string", minLength: 1, maxLength: 64, description: "Marker label prefix; defaults to Beat." },
          comments: { type: "string", maxLength: 1000 },
          marker_type: { type: "string", minLength: 1, maxLength: 128 },
          operation_id: operationId,
        },
        required: ["beat_times_seconds"],
      },
      handler: async (args: AdvancedArgs) => invoke(bridge, "markers.addBeatGrid", {
        beatTimesSeconds: args.beat_times_seconds,
        ...compact({ sequenceId: args.sequence_id, offsetSeconds: args.offset_seconds, namePrefix: args.name_prefix, comments: args.comments, markerType: args.marker_type }),
        ...operation(args),
      }),
    },

    create_silence_cut_source_stringout_uxp: {
      description: "Create a new single-source rough-cut stringout from reviewed silence ranges using documented Premiere 26.3+ hard-bounded linked A/V subclips. It does not preserve or modify an existing edited timeline.",
      parameters: {
        type: "object" as const, additionalProperties: false,
        properties: {
          source_project_item_id: projectItemId,
          sequence_name: { type: "string", minLength: 1, maxLength: 255 },
          duration_seconds: { type: "number", exclusiveMinimum: 0, maximum: 86400 },
          frame_rate: { type: "number", exclusiveMinimum: 0, maximum: 240 },
          silence_ranges: { type: "array", minItems: 1, maxItems: 512, items: { type: "object", additionalProperties: false, properties: {
            start_seconds: { type: "number", minimum: 0, maximum: 86400 }, end_seconds: { type: "number", minimum: 0, maximum: 86400 },
          }, required: ["start_seconds", "end_seconds"] } },
          keep_handle_frames: { type: "integer", minimum: 0, maximum: 2400 },
          maximum_removals: { type: "integer", minimum: 1, maximum: 512 },
          target_bin_id: projectItemId,
          confirm_non_undoable: { type: "boolean", description: "Required true. Derived sequence creation is a direct host call and partial generated artifacts can remain." },
          operation_id: operationId,
        },
        required: ["source_project_item_id", "sequence_name", "duration_seconds", "frame_rate", "silence_ranges", "confirm_non_undoable"],
      },
      handler: async (args: AdvancedArgs) => {
        try {
          const plan = planDerivedSilenceRemoval({
            durationSeconds: Number(args.duration_seconds), frameRate: Number(args.frame_rate),
            silenceRanges: (args.silence_ranges as Array<{ start_seconds: number; end_seconds: number }>).map((range) => ({ startSeconds: range.start_seconds, endSeconds: range.end_seconds })),
            keepHandleFrames: args.keep_handle_frames as number | undefined,
            maximumRemovals: args.maximum_removals as number | undefined,
          });
          if (plan.keepRanges.length > 64) return { success: false, error: "Source stringout requires more than 64 keep segments; narrow the reviewed plan." };
          const keepRanges = plan.keepRanges.map((range) => ({ ...range, startSeconds: range.startFrame / plan.frameRate, endSeconds: range.endFrame / plan.frameRate }));
          const result = await invoke(bridge, "silence.deriveSequence", {
            sourceProjectItemId: args.source_project_item_id, name: args.sequence_name, keepRanges,
            ...compact({ targetBinId: args.target_bin_id, confirmNonUndoable: args.confirm_non_undoable }), ...operation(args),
          });
          return "data" in result ? { ...result, data: { ...result.data, plan } } : result;
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
      },
    },

    organize_project_items_uxp: {
      description: "Inspect a bin or transactionally create, rename, move, color-label, and remove project items with stable-ID guards.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["inspect_bin", "create_bin", "create_smart_bin", "rename", "move", "set_color", "remove"] },
          bin_id: projectItemId,
          parent_bin_id: projectItemId,
          destination_bin_id: projectItemId,
          project_item_id: projectItemId,
          expected_name: { type: "string", maxLength: 255 },
          expected_parent_id: { type: "string", maxLength: 512 },
          name: { type: "string", minLength: 1, maxLength: 255 },
          make_unique: { type: "boolean" },
          search_query: { type: "string", minLength: 1, maxLength: 4000 },
          color_index: { type: "integer", minimum: 0, maximum: 14 },
          operation_id: operationId,
        },
        required: ["action"],
      },
      handler: async (args: AdvancedArgs) => {
        if (args.action === "inspect_bin") return invoke(bridge, "bins.inspect", compact({ binId: args.bin_id }));
        if (args.action === "create_bin") return invoke(bridge, "bins.create", { ...compact({ parentBinId: args.parent_bin_id, name: args.name, makeUnique: args.make_unique }), ...operation(args) });
        if (args.action === "create_smart_bin") return invoke(bridge, "bins.createSmart", { ...compact({ parentBinId: args.parent_bin_id, name: args.name, searchQuery: args.search_query }), ...operation(args) });
        if (args.action === "rename") return invoke(bridge, "bins.rename", { ...compact({ projectItemId: args.project_item_id, expectedName: args.expected_name, name: args.name }), ...operation(args) });
        if (args.action === "move") return invoke(bridge, "bins.move", { ...compact({ projectItemId: args.project_item_id, destinationBinId: args.destination_bin_id, expectedParentId: args.expected_parent_id }), ...operation(args) });
        if (args.action === "set_color") return invoke(bridge, "bins.color", { ...compact({ projectItemId: args.project_item_id, colorIndex: args.color_index }), ...operation(args) });
        if (args.action === "remove") return invoke(bridge, "bins.remove", { ...compact({ projectItemId: args.project_item_id, expectedName: args.expected_name }), ...operation(args) });
        return invalidAction(args.action);
      },
    },

    manage_sequence_settings_uxp: {
      description: "Inspect sequence settings or apply a bounded settings profile in one documented, undoable UXP transaction with readback.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["get", "update"] },
          sequence_id: sequenceId,
          updates: {
            type: "object",
            additionalProperties: false,
            properties: {
              maximum_bit_depth: { type: "boolean" },
              maximum_render_quality: { type: "boolean" },
              composite_in_linear_color: { type: "boolean" },
              audio_sample_rate: { type: "number", minimum: 1, maximum: 384000 },
              video_frame_rate: { type: "number", minimum: 1, maximum: 240 },
              video_field_type: { type: "integer", minimum: 0, maximum: 2 },
              video_pixel_aspect_ratio: { type: "string", minLength: 1, maxLength: 64 },
              editing_mode: { type: "string", minLength: 1, maxLength: 255 },
              preview_file_format: { type: "string", minLength: 1, maxLength: 255 },
              preview_codec: { type: "string", minLength: 1, maxLength: 255 },
              video_width: { type: "integer", minimum: 16, maximum: 32768 },
              video_height: { type: "integer", minimum: 16, maximum: 32768 },
            },
          },
          operation_id: operationId,
        },
        required: ["action"],
      },
      handler: async (args: AdvancedArgs) => {
        if (args.action === "get") return invoke(bridge, "sequenceSettings.get", compact({ sequenceId: args.sequence_id }));
        if (args.action !== "update") return invalidAction(args.action);
        const source = (args.updates && typeof args.updates === "object" ? args.updates : {}) as Record<string, unknown>;
        const updates = compact({
          maximumBitDepth: source.maximum_bit_depth,
          maxRenderQuality: source.maximum_render_quality,
          compositeInLinearColor: source.composite_in_linear_color,
          audioSampleRate: source.audio_sample_rate,
          videoFrameRate: source.video_frame_rate,
          videoFieldType: source.video_field_type,
          videoPixelAspectRatio: source.video_pixel_aspect_ratio,
          editingMode: source.editing_mode,
          previewFileFormat: source.preview_file_format,
          previewCodec: source.preview_codec,
          videoWidth: source.video_width,
          videoHeight: source.video_height,
        });
        return invoke(bridge, "sequenceSettings.update", { ...compact({ sequenceId: args.sequence_id }), updates, ...operation(args) });
      },
    },

    manage_sequence_display_format_uxp: {
      description: "Inspect or update a sequence's native audio/video time-display formats. Updates require the exact inspected sequence GUID and complete display-format snapshot, serialize competing updates per sequence, commit one undoable UXP transaction, and verify native readback. Cancellation is not supported after dispatch.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["inspect", "update"] },
          sequence_id: sequenceId,
          expected_sequence_guid: {
            type: "string", minLength: 1, maxLength: 128,
            description: "Required for update; copy sequence.guid from inspect. The update targets this GUID even if the active sequence changes.",
          },
          expected_display_formats: {
            type: "object", additionalProperties: false,
            properties: {
              audio_display_format: { type: "integer", minimum: 0, maximum: MAX_DISPLAY_FORMAT_CODE },
              video_display_format: { type: "integer", minimum: 0, maximum: MAX_DISPLAY_FORMAT_CODE },
            },
            required: ["audio_display_format", "video_display_format"],
            description: "Required for update; copy both display-format codes returned by inspect without changes.",
          },
          updates: {
            type: "object", additionalProperties: false,
            properties: {
              audio_display_format: { type: "integer", minimum: 0, maximum: MAX_DISPLAY_FORMAT_CODE },
              video_display_format: { type: "integer", minimum: 0, maximum: MAX_DISPLAY_FORMAT_CODE },
            },
            description: "One or both documented display-format codes returned in supportedDisplayFormats by inspect.",
          },
          operation_id: operationId,
        },
        required: ["action"],
      },
      handler: async (args: AdvancedArgs) => {
        if (args.action === "inspect") return invoke(bridge, "sequence.displayFormat.inspect", compact({ sequenceId: args.sequence_id }));
        if (args.action !== "update") return invalidAction(args.action);
        if (typeof args.expected_sequence_guid !== "string" || !args.expected_sequence_guid.trim() || args.expected_sequence_guid.length > 128) {
          return { success: false, error: "update requires expected_sequence_guid from inspect" };
        }
        try {
          const expectedDisplayFormats = reviewedDisplayFormats(args.expected_display_formats);
          const updates = requestedDisplayFormats(args.updates);
          return invoke(bridge, "sequence.displayFormat.update", {
            ...compact({ sequenceId: args.sequence_id }),
            expectedSequenceGuid: args.expected_sequence_guid,
            expectedDisplayFormats,
            updates,
            ...operation(args),
          });
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },

    import_project_media_uxp: {
      description: "Import workspace-contained media files, sequences, or After Effects compositions through documented Project APIs with post-state evidence.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["files", "sequences", "ae_comps", "all_ae_comps"] },
          paths: { type: "array", minItems: 1, maxItems: 100, items: { type: "string", minLength: 1, maxLength: 4096 } },
          project_path: { type: "string", minLength: 1, maxLength: 4096 },
          sequence_ids: { type: "array", minItems: 1, maxItems: 64, items: { type: "string", minLength: 1, maxLength: 128 } },
          aep_path: { type: "string", minLength: 1, maxLength: 4096 },
          comp_names: { type: "array", minItems: 1, maxItems: 64, items: { type: "string", minLength: 1, maxLength: 255 } },
          target_bin_id: projectItemId,
          suppress_ui: { type: "boolean" },
          as_numbered_stills: { type: "boolean" },
          confirm_non_undoable: { type: "boolean" },
          operation_id: operationId,
        },
        required: ["action", "confirm_non_undoable"],
      },
      handler: async (args: AdvancedArgs) => {
        const modes: Record<string, string> = { files: "files", sequences: "sequences", ae_comps: "aeComps", all_ae_comps: "allAEComps" };
        if (!args.action || !modes[args.action]) return invalidAction(args.action);
        return invoke(bridge, "project.import", { ...compact({
          mode: modes[args.action], paths: args.paths, projectPath: args.project_path,
          sequenceIds: args.sequence_ids, aepPath: args.aep_path, compNames: args.comp_names,
          targetBinId: args.target_bin_id, suppressUI: args.suppress_ui,
          asNumberedStills: args.as_numbered_stills,
          confirmNonUndoable: args.confirm_non_undoable,
        }), ...operation(args) });
      },
    },

    automate_effect_parameters_uxp: {
      description: "Inspect or transactionally set scalar effect parameters and add, remove, range-remove, or interpolate keyframes through documented UXP actions.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["inspect", "set_value", "add_keyframe", "remove_keyframe", "remove_keyframe_range", "set_interpolation"] },
          ...timelineTargetProperties,
          component_index: { type: "integer", minimum: 0 },
          param_index: { type: "integer", minimum: 0 },
          expected_component_id: { type: "string", minLength: 1, maxLength: 256 },
          expected_param_name: { type: "string", maxLength: 255 },
          value: { type: ["number", "string", "boolean"] },
          time_seconds: { type: "number", minimum: 0, maximum: 86400 },
          end_seconds: { type: "number", minimum: 0, maximum: 86400 },
          interpolation: { type: "string", enum: ["linear", "hold", "bezier", "time"] },
          operation_id: operationId,
        },
        required: ["action", "media_type", "track_index", "clip_index", "component_index", "param_index"],
      },
      handler: async (args: AdvancedArgs) => {
        const common = compact({
          mediaType: args.media_type, trackIndex: args.track_index, clipIndex: args.clip_index,
          componentIndex: args.component_index, paramIndex: args.param_index,
          expectedComponentId: args.expected_component_id, expectedParamName: args.expected_param_name,
          timeSeconds: args.time_seconds,
        });
        const commands: Record<string, string> = {
          inspect: "parameters.inspect", set_value: "parameters.set", add_keyframe: "parameters.keyframeAdd",
          remove_keyframe: "parameters.keyframeRemove", remove_keyframe_range: "parameters.keyframeRemoveRange",
          set_interpolation: "parameters.keyframeInterpolation",
        };
        if (!args.action || !commands[args.action]) return invalidAction(args.action);
        return invoke(bridge, commands[args.action], { ...common, ...compact({ value: args.value, endSeconds: args.end_seconds, interpolation: args.interpolation }), ...operation(args) });
      },
    },

    transform_track_item_uxp: {
      description: "Inspect or atomically move, trim, rename, and enable/disable one audio or video track item with stale-position guards and readback.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["inspect", "update"] },
          ...timelineTargetProperties,
          expected_start_seconds: { type: "number", minimum: 0, maximum: 86400 },
          expected_end_seconds: { type: "number", minimum: 0, maximum: 86400 },
          move_by_seconds: { type: "number", minimum: -86400, maximum: 86400 },
          start_seconds: { type: "number", minimum: 0, maximum: 86400 },
          end_seconds: { type: "number", minimum: 0, maximum: 86400 },
          in_seconds: { type: "number", minimum: 0, maximum: 86400 },
          out_seconds: { type: "number", minimum: 0, maximum: 86400 },
          disabled: { type: "boolean" },
          name: { type: "string", minLength: 1, maxLength: 255 },
          operation_id: operationId,
        },
        required: ["action", "media_type", "track_index", "clip_index"],
      },
      handler: async (args: AdvancedArgs) => {
        const values = compact({
          mediaType: args.media_type, trackIndex: args.track_index, clipIndex: args.clip_index,
          expectedStartSeconds: args.expected_start_seconds, expectedEndSeconds: args.expected_end_seconds,
          moveBySeconds: args.move_by_seconds, startSeconds: args.start_seconds, endSeconds: args.end_seconds,
          inSeconds: args.in_seconds, outSeconds: args.out_seconds, disabled: args.disabled, name: args.name,
        });
        if (args.action === "inspect") return invoke(bridge, "trackItem.inspect", values);
        if (args.action === "update") return invoke(bridge, "trackItem.update", { ...values, ...operation(args) });
        return invalidAction(args.action);
      },
    },

    inspect_sequence_structure_uxp: {
      description: "Read a bounded native UXP timeline structure for one sequence: selected video and/or audio tracks with clip timing and state. Opt in to source Project-item IDs only when needed; no Project-panel metadata or media paths are read. track_counts contains only the requested media types, never a zero placeholder for an unqueried type. The response is capped at 64 tracks and 512 items, omits components, rendered pixels, audio analysis, and caption cues, and is not a locked cross-object snapshot or proof of playback or editorial correctness.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          sequence_id: { type: "string", minLength: 1, maxLength: 128 },
          expected_sequence_id: { type: "string", minLength: 1, maxLength: 128, description: "Optional stable sequence ID from a prior UXP snapshot. Rejects an active-sequence request if it changed." },
          media_type: { type: "string", enum: ["all", "video", "audio"] },
          track_indices: {
            type: "array", minItems: 1, maxItems: 64, uniqueItems: true,
            items: { type: "integer", minimum: 0, maximum: 1023 },
          },
          include_empty_tracks: { type: "boolean", description: "Return selected empty tracks instead of omitting them." },
          include_source_project_items: { type: "boolean", description: "Opt in to each returned timeline clip's stable source Project-item ID. The default omits it; this never reads Project-panel metadata, names, types, or media paths." },
          max_items: { type: "integer", minimum: 1, maximum: 512, description: "Hard limit for all returned clip snapshots; the request fails rather than returning a partial timeline." },
        },
      },
      handler: async (args: AdvancedArgs) => invoke(bridge, "timeline.structure.inspect", compact({
        sequenceId: args.sequence_id, expectedSequenceId: args.expected_sequence_id,
        mediaType: args.media_type, trackIndices: args.track_indices,
        includeEmptyTracks: args.include_empty_tracks, includeSourceProjectItems: args.include_source_project_items, maxItems: args.max_items,
      })),
    },

    make_split_edit_uxp: {
      description: "Create an undoable J-cut or L-cut by extending one aligned 1x audio item while preserving source sync, with atomic UXP actions and edge/source readback.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["j_cut", "l_cut"] },
          audio_track_index: { type: "integer", minimum: 0 }, audio_clip_index: { type: "integer", minimum: 0 },
          video_track_index: { type: "integer", minimum: 0 }, video_clip_index: { type: "integer", minimum: 0 },
          extension_seconds: { type: "number", minimum: 0.001, maximum: 60 },
          operation_id: operationId,
        },
        required: ["kind", "audio_track_index", "audio_clip_index", "video_track_index", "video_clip_index", "extension_seconds"],
      },
      handler: async (args: AdvancedArgs) => invoke(bridge, "trackItem.splitEdit", {
        kind: args.kind, audioTrackIndex: args.audio_track_index, audioClipIndex: args.audio_clip_index,
        videoTrackIndex: args.video_track_index, videoClipIndex: args.video_clip_index,
        extensionSeconds: args.extension_seconds, ...operation(args),
      }),
    },

    edit_timeline_uxp: {
      description: "Use the documented SequenceEditor to insert, overwrite, clone, remove, or insert MOGRT content without undocumented QE calls.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["insert", "overwrite", "clone_selection", "remove_selection", "insert_mogrt_path", "insert_mogrt_library"] },
          project_item_id: projectItemId,
          ...timelinePositionProperties,
          limit_shift: { type: "boolean" },
          time_offset_seconds: { type: "number", minimum: -86400, maximum: 86400 },
          video_track_offset: { type: "integer", minimum: -128, maximum: 128 },
          audio_track_offset: { type: "integer", minimum: -128, maximum: 128 },
          align_to_video: { type: "boolean" },
          insert: { type: "boolean" },
          ripple: { type: "boolean" },
          media_type: { type: "string", enum: ["any", "video", "audio"] },
          shift_overlapping: { type: "boolean" },
          file_path: { type: "string", minLength: 1, maxLength: 4096 },
          library_name: { type: "string", minLength: 1, maxLength: 255 },
          element_name: { type: "string", minLength: 1, maxLength: 255 },
          confirm_non_undoable: { type: "boolean" },
          operation_id: operationId,
        },
        required: ["action"],
      },
      handler: async (args: AdvancedArgs) => {
        const common = compact({
          projectItemId: args.project_item_id, timeSeconds: args.time_seconds,
          videoTrackIndex: args.video_track_index, audioTrackIndex: args.audio_track_index,
          limitShift: args.limit_shift, timeOffsetSeconds: args.time_offset_seconds,
          videoTrackOffset: args.video_track_offset, audioTrackOffset: args.audio_track_offset,
          alignToVideo: args.align_to_video, insert: args.insert, ripple: args.ripple,
          mediaType: args.media_type, shiftOverlapping: args.shift_overlapping,
          filePath: args.file_path, libraryName: args.library_name, elementName: args.element_name,
          confirmNonUndoable: args.confirm_non_undoable,
        });
        const commands: Record<string, string> = {
          insert: "timeline.insert", overwrite: "timeline.overwrite", clone_selection: "timeline.cloneSelection",
          remove_selection: "timeline.removeSelection", insert_mogrt_path: "timeline.mogrtPath",
          insert_mogrt_library: "timeline.mogrtLibrary",
        };
        if (!args.action || !commands[args.action]) return invalidAction(args.action);
        return invoke(bridge, commands[args.action], { ...common, ...operation(args) });
      },
    },

    manage_sequences_uxp: {
      description: "Inspect, create-from-media, clone, derive, activate, open, close, or explicitly delete sequences through documented stable UXP APIs.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["inspect", "create_from_media", "clone", "subsequence", "activate", "open", "close", "delete"] },
          sequence_id: sequenceId,
          expected_name: { type: "string", maxLength: 255 },
          name: { type: "string", minLength: 1, maxLength: 255 },
          project_item_ids: { type: "array", minItems: 1, maxItems: 64, items: projectItemId },
          target_bin_id: projectItemId,
          ignore_track_targeting: { type: "boolean" },
          confirm_non_undoable: { type: "boolean" },
          operation_id: operationId,
        },
        required: ["action"],
      },
      handler: async (args: AdvancedArgs) => {
        const common = compact({
          sequenceId: args.sequence_id, expectedName: args.expected_name, name: args.name,
          projectItemIds: args.project_item_ids, targetBinId: args.target_bin_id,
          ignoreTrackTargeting: args.ignore_track_targeting, confirmNonUndoable: args.confirm_non_undoable,
        });
        const commands: Record<string, string> = {
          inspect: "sequences.inspect", create_from_media: "sequences.createFromMedia", clone: "sequences.clone",
          subsequence: "sequences.subsequence", activate: "sequences.activate", open: "sequences.open",
          close: "sequences.close", delete: "sequences.delete",
        };
        if (!args.action || !commands[args.action]) return invalidAction(args.action);
        return invoke(bridge, commands[args.action], { ...common, ...operation(args) });
      },
    },

    encode_media_uxp: {
      description: "Preflight, queue, or inspect and wait for conservatively correlated AME receipts inside the approved workspace. A terminal event is not output-file verification.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["preflight", "jobs", "wait", "sequence", "project_item", "file"] },
          job_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
          timeout_ms: { type: "integer", minimum: 0, maximum: 60000 },
          limit: { type: "integer", minimum: 1, maximum: 64 },
          sequence_id: sequenceId,
          project_item_id: projectItemId,
          export_type: { type: "string", enum: ["queue_to_ame", "queue_to_app", "immediately"] },
          file_path: { type: "string", minLength: 1, maxLength: 4096 },
          output_file: { type: "string", minLength: 1, maxLength: 4096 },
          preset_file: { type: "string", minLength: 1, maxLength: 4096 },
          export_full: { type: "boolean" },
          in_seconds: { type: "number", minimum: 0, maximum: 86400 },
          out_seconds: { type: "number", minimum: 0, maximum: 86400 },
          work_area: { type: "integer", minimum: 0, maximum: 16 },
          remove_upon_completion: { type: "boolean" },
          start_queue_immediately: { type: "boolean" },
          confirm_external_write: { type: "boolean" },
          operation_id: operationId,
        },
        required: ["action"],
      },
      handler: async (args: AdvancedArgs) => {
        const exportTypes: Record<string, string> = { queue_to_ame: "queueToAme", queue_to_app: "queueToApp", immediately: "immediately" };
        const common = compact({
          sequenceId: args.sequence_id, projectItemId: args.project_item_id,
          exportType: typeof args.export_type === "string" ? exportTypes[args.export_type] : undefined,
          filePath: args.file_path, outputFile: args.output_file, presetFile: args.preset_file,
          exportFull: args.export_full, inSeconds: args.in_seconds, outSeconds: args.out_seconds,
          workArea: args.work_area, removeUponCompletion: args.remove_upon_completion,
          startQueueImmediately: args.start_queue_immediately, confirmExternalWrite: args.confirm_external_write,
        });
        const commands: Record<string, string> = {
          preflight: "encoder.preflight", jobs: "encoder.jobs", wait: "encoder.wait", sequence: "encoder.sequence",
          project_item: "encoder.projectItem", file: "encoder.file",
        };
        if (!args.action || !commands[args.action]) return invalidAction(args.action);
        const jobQuery = compact({ jobId: args.job_id, timeoutMs: args.timeout_ms, limit: args.limit });
        if (args.action === "wait") {
          const hostWaitMs = typeof args.timeout_ms === "number" ? args.timeout_ms : 0;
          return invoke(bridge, commands[args.action], jobQuery, hostWaitMs);
        }
        return invoke(bridge, commands[args.action], args.action === "jobs"
          ? jobQuery
          : { ...common, ...operation(args) });
      },
    },
  };
}
