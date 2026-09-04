import { createHash } from "node:crypto";
import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";

type Mode = "talking_head" | "podcast";
type DerivedSegment = {
  id: string;
  source_project_item_id: string;
  transcript_revision: string;
  source_start_seconds: number;
  source_end_seconds: number;
  speaker_label?: string;
  master_audio_start_seconds?: number;
  master_audio_end_seconds?: number;
};
export type DerivedDialoguePlan = {
  schema_version: 1;
  project_guid: string;
  mode: Mode;
  sequence_name: string;
  target_bin_id?: string;
  master_audio_project_item_id?: string;
  segments: DerivedSegment[];
  output_duration_seconds: number;
  original_sources_unchanged: true;
  render_verified: false;
};

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function seconds(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 86_400) throw new Error(`${label} must be a finite number from 0 to 86400`);
  return Number(value.toFixed(6));
}
function token(plan: DerivedDialoguePlan): string { return `sha256:${createHash("sha256").update(JSON.stringify(plan)).digest("hex")}`; }

export function validateDerivedDialoguePlan(value: unknown): DerivedDialoguePlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("plan must be an object");
  const input = value as Record<string, unknown>;
  const allowed = ["schema_version", "project_guid", "mode", "sequence_name", "target_bin_id", "master_audio_project_item_id", "segments", "output_duration_seconds", "original_sources_unchanged", "render_verified"];
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`plan has an unknown field: ${unknown}`);
  if (input.schema_version !== 1) throw new Error("plan.schema_version must be 1");
  if (input.mode !== "talking_head" && input.mode !== "podcast") throw new Error("plan.mode must be talking_head or podcast");
  if (!Array.isArray(input.segments) || input.segments.length === 0 || input.segments.length > 64) throw new Error("plan.segments must contain between 1 and 64 entries");
  const ids = new Set<string>();
  const segments = input.segments.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`plan.segments[${index}] must be an object`);
    const item = raw as Record<string, unknown>;
    const keys = ["id", "source_project_item_id", "transcript_revision", "source_start_seconds", "source_end_seconds", "speaker_label", "master_audio_start_seconds", "master_audio_end_seconds"];
    const extra = Object.keys(item).find((key) => !keys.includes(key));
    if (extra) throw new Error(`plan.segments[${index}] has an unknown field: ${extra}`);
    const id = requiredText(item.id, `plan.segments[${index}].id`, 128);
    if (ids.has(id)) throw new Error(`plan.segments contains duplicate id: ${id}`); ids.add(id);
    const start = seconds(item.source_start_seconds, `plan.segments[${index}].source_start_seconds`);
    const end = seconds(item.source_end_seconds, `plan.segments[${index}].source_end_seconds`);
    if (end <= start) throw new Error(`plan.segments[${index}] source range must have positive duration`);
    const revision = requiredText(item.transcript_revision, `plan.segments[${index}].transcript_revision`, 71);
    if (!/^sha256:[a-f0-9]{64}$/.test(revision)) throw new Error(`plan.segments[${index}].transcript_revision must be a sha256 revision`);
    const speaker = item.speaker_label === undefined ? undefined : requiredText(item.speaker_label, `plan.segments[${index}].speaker_label`, 128);
    const masterStart = item.master_audio_start_seconds === undefined ? undefined : seconds(item.master_audio_start_seconds, `plan.segments[${index}].master_audio_start_seconds`);
    const masterEnd = item.master_audio_end_seconds === undefined ? undefined : seconds(item.master_audio_end_seconds, `plan.segments[${index}].master_audio_end_seconds`);
    if (input.mode === "podcast" && (masterStart === undefined || masterEnd === undefined || masterEnd <= masterStart || Math.abs((masterEnd - masterStart) - (end - start)) > 0.001)) throw new Error(`plan.segments[${index}] requires a positive master-audio range matching the video duration in podcast mode`);
    if (input.mode === "talking_head" && (masterStart !== undefined || masterEnd !== undefined)) throw new Error(`plan.segments[${index}] must omit master-audio ranges in talking_head mode`);
    return { id, source_project_item_id: requiredText(item.source_project_item_id, `plan.segments[${index}].source_project_item_id`, 512), transcript_revision: revision, source_start_seconds: start, source_end_seconds: end, ...(speaker ? { speaker_label: speaker } : {}), ...(masterStart === undefined ? {} : { master_audio_start_seconds: masterStart, master_audio_end_seconds: masterEnd }) };
  });
  if (input.mode === "talking_head" && new Set(segments.map((item) => item.source_project_item_id)).size !== 1) throw new Error("talking_head mode requires every segment to use the same source project item");
  const masterAudio = input.master_audio_project_item_id === undefined ? undefined : requiredText(input.master_audio_project_item_id, "plan.master_audio_project_item_id", 512);
  if (input.mode === "podcast" && !masterAudio) throw new Error("podcast mode requires master_audio_project_item_id");
  if (input.mode === "talking_head" && masterAudio) throw new Error("talking_head mode must omit master_audio_project_item_id");
  const duration = Number(segments.reduce((sum, item) => sum + item.source_end_seconds - item.source_start_seconds, 0).toFixed(6));
  if (typeof input.output_duration_seconds !== "number" || Math.abs(input.output_duration_seconds - duration) > 0.001) throw new Error("plan.output_duration_seconds does not match its segments");
  if (input.original_sources_unchanged !== true || input.render_verified !== false) throw new Error("plan must retain original_sources_unchanged true and render_verified false");
  return { schema_version: 1, project_guid: requiredText(input.project_guid, "plan.project_guid", 512), mode: input.mode, sequence_name: requiredText(input.sequence_name, "plan.sequence_name", 255), ...(input.target_bin_id === undefined ? {} : { target_bin_id: requiredText(input.target_bin_id, "plan.target_bin_id", 512) }), ...(masterAudio ? { master_audio_project_item_id: masterAudio } : {}), segments, output_duration_seconds: duration, original_sources_unchanged: true, render_verified: false };
}

async function currentRevisions(bridge: UxpWebSocketBridge, plan: DerivedDialoguePlan) {
  const expected = new Map<string, string>();
  for (const segment of plan.segments) {
    const prior = expected.get(segment.source_project_item_id);
    if (prior && prior !== segment.transcript_revision) throw new Error(`source ${segment.source_project_item_id} has conflicting transcript revisions`);
    expected.set(segment.source_project_item_id, segment.transcript_revision);
  }
  for (const [projectItemId, revision] of expected) {
    const result = await bridge.request("transcript.export", { projectItemId }) as { json?: unknown; projectGuid?: unknown };
    if (result.projectGuid !== plan.project_guid) throw new Error("active project changed while validating the dialogue plan");
    if (typeof result.json !== "string") throw new Error(`Premiere returned no transcript for source ${projectItemId}`);
    const actual = `sha256:${createHash("sha256").update(result.json).digest("hex")}`;
    if (actual !== revision) throw new Error(`transcript changed for source ${projectItemId}; preview again`);
  }
}

const segmentSchema = { type: "object" as const, additionalProperties: false, properties: {
  id: { type: "string", minLength: 1, maxLength: 128, description: "Stable approved-segment ID." },
  source_project_item_id: { type: "string", minLength: 1, maxLength: 512, description: "Exact video or linked A/V source project-item ID." },
  transcript_revision: { type: "string", pattern: "^sha256:[a-f0-9]{64}$", description: "Exact current source transcript revision." },
  source_start_seconds: { type: "number", minimum: 0, maximum: 86400, description: "Approved source-video start." },
  source_end_seconds: { type: "number", exclusiveMinimum: 0, maximum: 86400, description: "Approved source-video end." },
  speaker_label: { type: "string", minLength: 1, maxLength: 128, description: "Optional reviewed speaker label." },
  master_audio_start_seconds: { type: "number", minimum: 0, maximum: 86400, description: "Podcast master-audio source start matching this video segment." },
  master_audio_end_seconds: { type: "number", exclusiveMinimum: 0, maximum: 86400, description: "Podcast master-audio source end matching this video segment." },
}, required: ["id", "source_project_item_id", "transcript_revision", "source_start_seconds", "source_end_seconds"] };

const planSchema = { type: "object" as const, additionalProperties: false, description: "Canonical plan returned by preview_derived_dialogue_sequence_uxp.", properties: {
  schema_version: { type: "integer", enum: [1], description: "Plan schema version." },
  project_guid: { type: "string", minLength: 1, maxLength: 512, description: "Active project GUID." },
  mode: { type: "string", enum: ["talking_head", "podcast"], description: "Derivative assembly mode." },
  sequence_name: { type: "string", minLength: 1, maxLength: 255, description: "Unique name for the new ordinary sequence." },
  target_bin_id: { type: "string", minLength: 1, maxLength: 512, description: "Optional destination-bin ID for the derivative sequence." },
  master_audio_project_item_id: { type: "string", minLength: 1, maxLength: 512, description: "Required podcast master-audio project-item ID." },
  segments: { type: "array", minItems: 1, maxItems: 64, items: segmentSchema, description: "Approved output segments in final sequence order." },
  output_duration_seconds: { type: "number", exclusiveMinimum: 0, maximum: 86400, description: "Sum of approved segment durations." },
  original_sources_unchanged: { type: "boolean", description: "Must remain true." },
  render_verified: { type: "boolean", description: "Must remain false until rendered output is reviewed." },
}, required: ["schema_version", "project_guid", "mode", "sequence_name", "segments", "output_duration_seconds", "original_sources_unchanged", "render_verified"] };

export function getUxpDialogueWorkflowTools(bridge: UxpWebSocketBridge) {
  return {
    preview_derived_dialogue_sequence_uxp: {
      description: "Validate transcript revisions and preview a talking-head or speaker-reviewed podcast derivative. It creates nothing and returns an exact confirmation token.",
      parameters: { type: "object" as const, additionalProperties: false, properties: {
        project_guid: { type: "string", minLength: 1, maxLength: 512, description: "Active project GUID from UXP inspection." },
        mode: { type: "string", enum: ["talking_head", "podcast"], description: "Talking-head linked A/V assembly or podcast video plus reviewed master-audio assembly." },
        sequence_name: { type: "string", minLength: 1, maxLength: 255, description: "Unique name for the new derivative sequence." },
        target_bin_id: { type: "string", minLength: 1, maxLength: 512, description: "Optional destination-bin ID." },
        master_audio_project_item_id: { type: "string", minLength: 1, maxLength: 512, description: "Required in podcast mode; source for audio-only subclips." },
        segments: { type: "array", minItems: 1, maxItems: 64, items: segmentSchema, description: "Reviewed segments in desired output order." },
      }, required: ["project_guid", "mode", "sequence_name", "segments"] },
      operationalCapability: { backend: "UXP" as const, backends: ["uxp" as const], minimumPremiereVersion: "26.3", verificationBoundary: "transcript_revision_readback" as const, hostVerificationRequired: true, notes: ["Requires an authenticated UXP bridge and current native transcripts.", "Does not prove editorial correctness, rendered pixels, or playback."] },
      handler: async (args: Record<string, unknown>) => {
        try {
          const rawSegments = Array.isArray(args.segments) ? args.segments as Array<Record<string, unknown>> : [];
          const duration = Number(rawSegments.reduce((sum, item) => sum + (Number(item.source_end_seconds) - Number(item.source_start_seconds)), 0).toFixed(6));
          const plan = validateDerivedDialoguePlan({ schema_version: 1, ...args, output_duration_seconds: duration, original_sources_unchanged: true, render_verified: false });
          await currentRevisions(bridge, plan);
          return { success: true, data: { backend: "uxp", plan, confirmation_token: token(plan), applied: false, limitations: ["The derivative is an ordinary sequence, not a native multicam angle edit.", "Speaker and synchronization assignments are caller-reviewed.", "Rendered pixels, playback, persistence, and Undo remain unverified."] } };
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
      },
    },
    apply_derived_dialogue_sequence_uxp: {
      description: "Create a new ordinary dialogue derivative from an exact reviewed plan. It revalidates every transcript and never edits or deletes an original source or sequence.",
      parameters: { type: "object" as const, additionalProperties: false, properties: {
        plan: planSchema,
        confirmation_token: { type: "string", pattern: "^sha256:[a-f0-9]{64}$", description: "Exact token returned by preview_derived_dialogue_sequence_uxp." },
        operation_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$", description: "Required idempotency key for the host mutation." },
      }, required: ["plan", "confirmation_token", "operation_id"] },
      operationalCapability: { backend: "UXP" as const, backends: ["uxp" as const], minimumPremiereVersion: "26.3", verificationBoundary: "structural_uxp_readback" as const, hostVerificationRequired: true, notes: ["Creates an ordinary derivative sequence from a reviewed plan; native multicam mutation is unsupported.", "The receipt does not prove rendered pixels, playback, persistence after reopen, or Undo behavior."] },
      handler: async (args: Record<string, unknown>) => {
        try {
          const plan = validateDerivedDialoguePlan(args.plan);
          if (args.confirmation_token !== token(plan)) throw new Error("confirmation_token does not match this dialogue plan; preview again");
          const operationId = requiredText(args.operation_id, "operation_id", 128);
          if (!/^[A-Za-z0-9._:-]+$/.test(operationId)) throw new Error("operation_id contains unsupported characters");
          await currentRevisions(bridge, plan);
          const result = await bridge.request("dialogue.deriveSequence", { plan, operationId });
          return { success: true, data: { backend: "uxp", result } };
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
      },
    },
  };
}
