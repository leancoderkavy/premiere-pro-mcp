import { describe, expect, it, vi } from "vitest";
import { getUxpDialogueWorkflowTools } from "../../src/tools/uxp-dialogue-workflows.js";

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
});
