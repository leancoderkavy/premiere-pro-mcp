import { randomUUID } from "node:crypto";

export const CAPABILITIES = ["inspect", "edit", "export", "filesystem", "unsafe-script"] as const;

export type Capability = (typeof CAPABILITIES)[number];

export interface CapabilityConfig {
  capabilities: ReadonlySet<Capability>;
  source: "default" | "environment" | "explicit";
}

const KNOWN = new Set<string>(CAPABILITIES);

/**
 * Resolve the server's authority. Unsafe scripting is deliberately never part
 * of the default: an operator must name it explicitly.
 */
export function resolveCapabilities(
  value: string | undefined = process.env.PREMIERE_MCP_CAPABILITIES,
): CapabilityConfig {
  if (value === undefined || value.trim() === "") {
    return { capabilities: new Set<Capability>(["inspect", "edit", "export", "filesystem"]), source: "default" };
  }

  const capabilities = new Set<Capability>();
  for (const raw of value.split(",")) {
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    if (!KNOWN.has(name)) {
      throw new Error(`Unknown Premiere MCP capability: ${name}`);
    }
    capabilities.add(name as Capability);
  }
  return { capabilities, source: "environment" };
}

export class CapabilityDeniedError extends Error {
  readonly code = "CAPABILITY_DENIED";

  constructor(readonly capability: Capability, readonly operationId: string) {
    super(`Operation ${operationId} requires the '${capability}' capability`);
    this.name = "CapabilityDeniedError";
  }
}

export function requireCapability(
  config: CapabilityConfig,
  capability: Capability,
  operationId: string,
): void {
  if (!config.capabilities.has(capability)) {
    throw new CapabilityDeniedError(capability, operationId);
  }
}

export const UNSAFE_TOOL_NAMES = new Set(["execute_extendscript", "send_raw_script", "evaluate_expression"]);

const INSPECT_TOOL_NAMES = new Set([
  "ping",
  "get_capabilities",
  "preview_edit_plan",
  "preview_transcript_edit_uxp",
  "plan_transcript_rough_cut_uxp",
  "create_context_edit_plan",
  "create_editorial_context_pack",
  "create_editorial_plan",
  "preview_editorial_plan",
  "preview_project_intake",
  "preview_motion_graphics_demo",
  "preview_product_spot",
  "preview_brand_spot",
  "inspect_sequence_timing_uxp",
  "inspect_sequence_timing_by_guid_uxp",
  "validate_project_for_export",
  "read_sequence_captions",
  "plan_silence_review_markers",
]);
// detect_silence reads a media file from disk and shells out to ffmpeg. It
// changes nothing in Premiere, so classifying it as "edit" would overstate what
// it does; filesystem is the authority it actually needs.
const FILESYSTEM_TOOL_NAMES = new Set([
  "apply_lut",
  "set_scratch_disk_path",
  "verify_delivery_file",
  "verify_delivery_conformance",
  "detect_silence",
  "detect_beats",
  "create_project_backup",
  "analyze_loudness",
  "analyze_video_qc",
  "detect_source_scene_changes",
  "normalize_loudness_file",
  "inspect_media_streams",
  "generate_media_contact_sheet",
  "detect_audio_transients",
  "detect_motion_peaks",
  "read_video_scopes",
  "plan_shot_match",
  "analyze_video_interlacing",
  "detect_active_picture_bounds",
  "inspect_cmx3600_edl",
  "validate_cmx3600_edl",
  "compare_cmx3600_edls",
  "inspect_fcpxml_interchange",
  "verify_fcpxml_media_references",
]);

const ACTION_CAPABILITIES: Readonly<Record<string, Readonly<Record<string, readonly Capability[]>>>> = {
  manage_project_context: {
    capture: ["inspect", "filesystem"],
    enrich: ["inspect", "filesystem"],
    status: ["inspect"],
    clear: ["filesystem"],
  },
  manage_clip_effects_uxp: {
    catalog: ["inspect"],
    inspect: ["inspect"],
    add: ["edit"],
    remove: ["edit"],
  },
  batch_selected_clips_uxp: {
    inspect: ["inspect"],
    add_effect: ["edit"],
    remove_effect: ["edit"],
  },
  manage_timeline_selection_uxp: {
    inspect: ["inspect"],
    inspect_targets: ["inspect"],
    replace: ["edit"],
    add: ["edit"],
    remove: ["edit"],
    clear: ["edit"],
  },
  manage_proxy_ingest_uxp: {
    inspect_proxy: ["inspect"],
    attach_proxy: ["edit", "filesystem"],
    get_ingest: ["inspect"],
    set_ingest: ["edit"],
  },
  manage_metadata_uxp: {
    get: ["inspect"],
    update: ["edit"],
  },
  inspect_project_panel_metadata_uxp: {
    panel: ["inspect"],
    item_columns: ["inspect"],
  },
  manage_project_panel_metadata_uxp: {
    inspect: ["inspect"],
    update: ["edit"],
  },
  create_project_metadata_field_uxp: {
    inspect: ["inspect"],
    create: ["edit"],
  },
  manage_color_conformance_uxp: {
    preflight: ["inspect"],
    update: ["edit"],
  },
  audition_source_monitor_uxp: {
    state: ["inspect"],
    open_project_item: ["edit"],
    open_file: ["edit", "filesystem"],
    set_position: ["edit"],
    play: ["edit"],
    close: ["edit"],
    close_all: ["edit"],
  },
  preflight_production_storage_uxp: {
    preflight: ["inspect"],
    configure_project: ["edit"],
  },
  inspect_project_selection_uxp: {
    views: ["inspect"],
    selection: ["inspect"],
  },
  manage_markers_uxp: {
    inspect: ["inspect"],
    add: ["edit"],
    update: ["edit"],
    remove: ["edit"],
    remove_many: ["edit"],
  },
  organize_project_items_uxp: {
    inspect_bin: ["inspect"],
    create_bin: ["edit"],
    create_smart_bin: ["edit"],
    rename: ["edit"],
    move: ["edit"],
    set_color: ["edit"],
    remove: ["edit"],
  },
  manage_sequence_settings_uxp: {
    get: ["inspect"],
    update: ["edit"],
  },
  manage_sequence_display_format_uxp: {
    inspect: ["inspect"],
    update: ["edit"],
  },
  manage_sequence_range_uxp: {
    inspect: ["inspect"],
    update: ["edit"],
  },
  manage_sequence_playhead_uxp: {
    inspect: ["inspect"],
    set: ["edit"],
  },
  manage_app_preferences_uxp: {
    inspect: ["inspect"],
    set: ["edit"],
  },
  import_project_media_uxp: {
    files: ["edit", "filesystem"],
    sequences: ["edit", "filesystem"],
    ae_comps: ["edit", "filesystem"],
    all_ae_comps: ["edit", "filesystem"],
  },
  automate_effect_parameters_uxp: {
    inspect: ["inspect"],
    inspect_keyframe: ["inspect"],
    inspect_time_varying: ["inspect"],
    set_value: ["edit"],
    add_keyframe: ["edit"],
    remove_keyframe: ["edit"],
    remove_keyframe_range: ["edit"],
    set_interpolation: ["edit"],
    set_time_varying: ["edit"],
  },
  transform_track_item_uxp: {
    inspect: ["inspect"],
    update: ["edit"],
  },
  edit_timeline_uxp: {
    insert: ["edit"],
    overwrite: ["edit"],
    clone_selection: ["edit"],
    remove_selection: ["edit"],
    insert_mogrt_path: ["edit", "filesystem"],
    insert_mogrt_library: ["edit"],
  },
  manage_sequences_uxp: {
    inspect: ["inspect"],
    create_from_media: ["edit"],
    clone: ["edit"],
    subsequence: ["edit"],
    activate: ["edit"],
    open: ["edit"],
    close: ["edit"],
    delete: ["edit"],
  },
  encode_media_uxp: {
    preflight: ["inspect"],
    sequence: ["export", "filesystem"],
    project_item: ["export", "filesystem"],
    file: ["export", "filesystem"],
  },
};

/** A conservative classification for centralized server registration. */
export function capabilityForTool(toolName: string): Capability {
  if (UNSAFE_TOOL_NAMES.has(toolName)) return "unsafe-script";
  if (/^(export_|validate_export_|start_batch_encode|queue_|encode_|capture_frame)/.test(toolName)) return "export";
  if (/^(import_|relink_|create_project|open_project|save_|consolidate_)/.test(toolName)) return "filesystem";
  if (FILESYSTEM_TOOL_NAMES.has(toolName)) return "filesystem";
  if (INSPECT_TOOL_NAMES.has(toolName) || /^(get_|list_|inspect_|find_|check_|search_)/.test(toolName)) return "inspect";
  // Every remaining registered tool changes Premiere state. Defaulting to edit
  // keeps new tools fail-closed instead of silently bypassing the authority profile.
  return "edit";
}

/** Resolve authority at the action level for consolidated multi-action tools. */
export function capabilitiesForToolInvocation(toolName: string, args: unknown): readonly Capability[] {
  const actionMap = ACTION_CAPABILITIES[toolName];
  if (!actionMap) return [capabilityForTool(toolName)];
  const input = args && typeof args === "object" && !Array.isArray(args)
    ? args as Record<string, unknown>
    : undefined;
  const action = input?.action;
  const required = typeof action === "string" ? actionMap[action] : undefined;
  if (toolName === "encode_media_uxp" && action === "preflight" && typeof input?.preset_file === "string") {
    return ["inspect", "filesystem"];
  }
  return required
    ? required
    : [capabilityForTool(toolName)];
}

/**
 * Tools that stay advertised under every profile, because they are how an
 * operator diagnoses a profile that is too narrow: get_capabilities reports the
 * active authority, and ping proves the bridge is alive. Withholding them makes
 * a misconfigured server look broken with no supported way to ask why.
 */
export const ALWAYS_LISTED_TOOL_NAMES = new Set(["ping", "get_capabilities"]);

/**
 * Whether a tool should appear in tools/list under the given profile.
 *
 * This is an advertising decision, not an enforcement one — guardToolHandler
 * remains the authority check at call time. Keeping the two separate means a
 * listing bug can never widen what a profile is actually allowed to do.
 */
export function isToolPermitted(
  toolName: string,
  config: CapabilityConfig,
): boolean {
  if (ALWAYS_LISTED_TOOL_NAMES.has(toolName)) return true;
  const actionMap = ACTION_CAPABILITIES[toolName];
  if (actionMap) {
    return Object.values(actionMap).some((required) => required.every((capability) => config.capabilities.has(capability)));
  }
  return config.capabilities.has(capabilityForTool(toolName));
}

export function guardToolHandler<TArgs, TResult>(
  toolName: string,
  handler: (args: TArgs) => Promise<TResult>,
  config: CapabilityConfig = resolveCapabilities(),
  createOperationId: () => string = randomUUID,
): (args: TArgs) => Promise<TResult> {
  return async (args: TArgs) => {
    const operationId = createOperationId();
    for (const required of capabilitiesForToolInvocation(toolName, args)) {
      requireCapability(config, required, operationId);
    }
    return handler(args);
  };
}
