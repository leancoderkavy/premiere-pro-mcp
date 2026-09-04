import { describe, expect, it, vi } from "vitest";
import { getUxpDialogueWorkflowTools, validateDerivedDialoguePlan } from "../../src/tools/uxp-dialogue-workflows.js";

const json = "{\"segments\":[]}", revision = "sha256:cf84482b9efdd9291a36643471c6e09c79a69623f87a7b61265b660e54e69eaf";
describe("UXP dialogue workflow tools", () => {
  it("previews then applies the exact revision-bound plan", async () => {
    const request = vi.fn(async (command: string) => command === "transcript.export" ? { json, projectGuid: "project" } : { outcome: "committed_unverified" });
    const tools = getUxpDialogueWorkflowTools({ request } as any);
    const preview = await tools.preview_derived_dialogue_sequence_uxp.handler({ project_guid: "project", mode: "talking_head", sequence_name: "Reviewed", segments: [{ id: "s1", source_project_item_id: "clip", transcript_revision: revision, source_start_seconds: 0, source_end_seconds: 1 }] });
    expect(preview.success).toBe(true);
    const data = preview.data as any;
    const applied = await tools.apply_derived_dialogue_sequence_uxp.handler({ plan: data.plan, confirmation_token: data.confirmation_token, operation_id: "op-1" });
    expect(applied.success).toBe(true);
    expect(request).toHaveBeenLastCalledWith("dialogue.deriveSequence", { plan: data.plan, operationId: "op-1" });
  });
  it("validates podcast plans and rejects unsafe variants", () => {
    const segment = { id: "s", source_project_item_id: "camera", transcript_revision: revision, source_start_seconds: 1, source_end_seconds: 2, master_audio_start_seconds: 3, master_audio_end_seconds: 4 };
    const plan = { schema_version: 1, project_guid: "project", mode: "podcast", sequence_name: "Podcast", master_audio_project_item_id: "audio", segments: [segment], output_duration_seconds: 1, original_sources_unchanged: true, render_verified: false };
    expect(validateDerivedDialoguePlan(plan).mode).toBe("podcast");
    const invalid = [
      null, { ...plan, extra: true }, { ...plan, schema_version: 2 }, { ...plan, mode: "other" }, { ...plan, segments: [] },
      { ...plan, segments: [null] }, { ...plan, segments: [{ ...segment, extra: true }] }, { ...plan, segments: [segment, segment] },
      { ...plan, segments: [{ ...segment, source_end_seconds: 1 }] }, { ...plan, segments: [{ ...segment, transcript_revision: "bad" }] },
      { ...plan, segments: [{ ...segment, master_audio_end_seconds: 5 }] }, { ...plan, master_audio_project_item_id: undefined },
      { ...plan, output_duration_seconds: 2 }, { ...plan, original_sources_unchanged: false },
      { ...plan, target_bin_id: "" }, { ...plan, segments: [{ ...segment, speaker_label: "" }] },
      { ...plan, mode: "talking_head", segments: [{ ...segment, master_audio_start_seconds: undefined, master_audio_end_seconds: undefined }] },
    ];
    for (const value of invalid) expect(() => validateDerivedDialoguePlan(value)).toThrow();
    expect(() => validateDerivedDialoguePlan({ ...plan, mode: "talking_head", master_audio_project_item_id: undefined, segments: [{ ...segment, master_audio_start_seconds: undefined, master_audio_end_seconds: undefined }, { ...segment, id: "two", source_project_item_id: "other", master_audio_start_seconds: undefined, master_audio_end_seconds: undefined }] })).toThrow(/same source/);
  });
  it("fails closed for stale or unavailable transcripts and bad confirmations", async () => {
    const base = { project_guid: "project", mode: "talking_head", sequence_name: "Reviewed", segments: [{ id: "s1", source_project_item_id: "clip", transcript_revision: revision, source_start_seconds: 0, source_end_seconds: 1 }] };
    for (const response of [{ json, projectGuid: "other" }, { projectGuid: "project" }, { json: "changed", projectGuid: "project" }]) {
      const tools = getUxpDialogueWorkflowTools({ request: vi.fn().mockResolvedValue(response) } as any);
      expect((await tools.preview_derived_dialogue_sequence_uxp.handler(base)).success).toBe(false);
    }
    const tools = getUxpDialogueWorkflowTools({ request: vi.fn().mockResolvedValue({ json, projectGuid: "project" }) } as any);
    const preview = await tools.preview_derived_dialogue_sequence_uxp.handler(base) as any;
    expect((await tools.apply_derived_dialogue_sequence_uxp.handler({ plan: preview.data.plan, confirmation_token: `sha256:${"0".repeat(64)}`, operation_id: "op" })).success).toBe(false);
    expect((await tools.apply_derived_dialogue_sequence_uxp.handler({ plan: preview.data.plan, confirmation_token: preview.data.confirmation_token, operation_id: "bad space" })).success).toBe(false);
  });
  it("normalizes non-Error bridge failures", async () => {
    const tools = getUxpDialogueWorkflowTools({ request: vi.fn().mockRejectedValue("offline") } as any);
    const result = await tools.preview_derived_dialogue_sequence_uxp.handler({ project_guid: "project", mode: "talking_head", sequence_name: "Reviewed", segments: [{ id: "s1", source_project_item_id: "clip", transcript_revision: revision, source_start_seconds: 0, source_end_seconds: 1 }] });
    expect(result).toEqual({ success: false, error: "offline" });
  });
});
