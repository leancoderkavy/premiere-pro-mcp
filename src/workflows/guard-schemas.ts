/**
 * JSON Schema for the two request-scoped host guards every registered tool
 * accepts. They live here so the server registration loop and the session
 * guard tool advertise exactly the same shape.
 */
export const EXPECTED_PROJECT_PATH_SCHEMA = {
  type: "string", minLength: 1, maxLength: 4096,
  description: "Optional absolute saved-project path. Every generated CEP command refuses before its body when the active project differs or is unsaved. UXP commands refuse this CEP-only guard; local-only tools do not inspect Premiere. Omit to keep existing behavior.",
} as const;

export const EXPECTED_CEP_TARGET_SCHEMA = {
  type: "object", additionalProperties: false,
  description: "Optional reviewed CEP sequence/clip identity and exact tick ranges. Checked before every generated command; UXP refuses this CEP-only guard.",
  properties: {
    backend: { type: "string", const: "cep", description: "Backend namespace for these IDs." },
    sequence_id: { type: "string", minLength: 1, maxLength: 512, description: "Stable expected active sequence ID." },
    project_document_id: { type: "string", minLength: 1, maxLength: 512, description: "Exact Premiere project document ID observed during review." },
    source_item: { type: "object", additionalProperties: false, description: "Reviewed source identity for a source-only operation.", properties: {
      node_id: { type: "string", minLength: 1, maxLength: 512, description: "Exact project-item node ID." },
      media_path: { type: "string", minLength: 1, maxLength: 4096, description: "Optional exact source-media path." },
    }, required: ["node_id"] },
    clip: { type: "object", additionalProperties: false, description: "Optional exact reviewed timeline clip.", properties: {
      node_id: { type: "string", minLength: 1, maxLength: 512, description: "Stable CEP node ID." },
      track_type: { type: "string", enum: ["video", "audio"], description: "Expected media track group." },
      track_index: { type: "integer", minimum: 0, maximum: 255, description: "Expected zero-based track index; identity still checked." },
      project_item_id: { type: "string", minLength: 1, maxLength: 512, description: "Expected source project-item node ID." },
      start_ticks: { type: "string", pattern: "^-?\\d{1,30}$", description: "Exact expected timeline start ticks." },
      end_ticks: { type: "string", pattern: "^-?\\d{1,30}$", description: "Exact expected exclusive timeline end ticks." },
      in_ticks: { type: "string", pattern: "^-?\\d{1,30}$", description: "Exact expected source In ticks." },
      out_ticks: { type: "string", pattern: "^-?\\d{1,30}$", description: "Exact expected exclusive source Out ticks." },
      effect: { type: "object", additionalProperties: false, description: "Reviewed effect and parameter identity checked before mutation.", properties: {
        match_name: { type: "string", minLength: 1, maxLength: 512, description: "Effect match name from host inspection." },
        display_name: { type: "string", minLength: 1, maxLength: 512, description: "Optional exact host display name." },
        parameter_index: { type: "integer", minimum: 0, maximum: 255, description: "Inspected zero-based parameter index." },
        parameter_name: { type: "string", minLength: 1, maxLength: 512, description: "Exact inspected parameter name." },
      }, required: ["match_name", "parameter_index", "parameter_name"] },
    }, required: ["node_id", "track_type", "track_index"] },
  }, required: ["backend"], anyOf: [{ required: ["sequence_id"] }, { required: ["source_item"] }],
} as const;

/** The guard argument names every tool accepts, whichever schema profile is listed. */
export const GUARD_ARGUMENT_NAMES = ["expected_project_path", "expected_cep_target"] as const;
export type GuardArgumentName = (typeof GUARD_ARGUMENT_NAMES)[number];

/** Both guards as one object schema, used to validate per-call guards that the compact listing omits. */
export const GUARD_ARGUMENTS_SCHEMA = {
  type: "object",
  properties: {
    expected_project_path: EXPECTED_PROJECT_PATH_SCHEMA,
    expected_cep_target: EXPECTED_CEP_TARGET_SCHEMA,
  },
} as const;
