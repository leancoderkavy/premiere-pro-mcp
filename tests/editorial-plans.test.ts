import { describe, expect, it } from "vitest";
import {
  buildEditorialPlan,
  editorialPlanConfirmationToken,
  validateEditorialPlan,
} from "../src/ai/editorial-plan.js";
import { ProjectContextRepository } from "../src/context/project-context-store.js";
import { buildContextDocumentFromSnapshot, enrichContextDocument, type PremiereContextSnapshot } from "../src/tools/project-context.js";
import { getEditorialPlanTools } from "../src/tools/editorial-plans.js";

async function context() {
  const snapshot: PremiereContextSnapshot = {
    projectName: "Documentary",
    projectPath: "D:/Projects/documentary.prproj",
    sequence: {
      id: "sequence-1",
      name: "Assembly",
      durationSeconds: 120,
      truncated: false,
      clips: [{
        nodeId: "timeline-1",
        name: "Interview A",
        startSeconds: 10,
        endSeconds: 20,
        inPointSeconds: 30,
        outPointSeconds: 40,
        speed: 1,
        trackType: "video",
        trackIndex: 0,
        sourceId: "source-1",
        sourceName: "Interview A.mov",
        mediaPath: "D:/Media/interview-a.mov",
        offline: false,
      }],
    },
  };
  const built = await buildContextDocumentFromSnapshot(snapshot, undefined, async () => ({ mediaPathHash: "source-hash" }));
  const source = built.document.records.find((record) => record.kind === "source")!;
  return enrichContextDocument(built.document, [{
    kind: "transcript",
    source_id: "source-1",
    source_revision: source.sourceRevision,
    start_seconds: 31,
    end_seconds: 35,
    text: "The budget needs approval by Friday.",
    keywords: ["budget", "approval", "interview"],
    metadata: { confidence: 0.97 },
  }]).document;
}

describe("editorial workflow plans", () => {
  it("creates a review-only organization plan from explicit rules", async () => {
    const document = await context();
    const plan = buildEditorialPlan(document, {
      workflow: "organize",
      intent: "interview budget approval",
      organizationRules: [{ name: "Interviews", keywords: ["interview"], colorIndex: 3 }],
    });

    expect(plan).toMatchObject({
      schemaVersion: 1,
      workflow: "organize",
      applied: false,
      expectedContextRevision: document.revision,
      expectedTimelineRevision: document.timelineRevision,
      recommendations: [expect.objectContaining({
        route: "organize_project_items_uxp",
        mutatesProject: false,
        requiresReview: true,
      })],
    });
    expect(plan.limitations.join(" ")).toContain("does not call an LLM");
    expect(editorialPlanConfirmationToken(plan)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("routes rough cuts and caption review without claiming automatic application", async () => {
    const document = await context();
    const roughCut = buildEditorialPlan(document, { workflow: "rough_cut", intent: "budget approval" });
    const caption = buildEditorialPlan(document, { workflow: "caption_review", intent: "budget approval" });

    expect(roughCut.recommendations[0]).toMatchObject({ route: "preview_transcript_edit_uxp", mutatesProject: false });
    expect(roughCut.limitations.join(" ")).toContain("licensed Premiere host");
    expect(caption.recommendations[0]).toMatchObject({ route: "create_caption_track", mutatesProject: false });
    expect(caption.limitations.join(" ")).toContain("paid-provider request");
  });

  it("requires explicit categories and rejects plans that claim they were applied", async () => {
    const document = await context();
    expect(() => buildEditorialPlan(document, { workflow: "organize", intent: "interviews" }))
      .toThrow("organization_rules are required");

    const plan = buildEditorialPlan(document, { workflow: "stringout", intent: "interview" });
    expect(() => validateEditorialPlan({ ...plan, applied: true })).toThrow("preview-only");
    expect(() => validateEditorialPlan({ ...plan, recommendations: [] })).toThrow("recommendations must contain");
  });

  it("creates and previews plans only while the captured revision remains current", async () => {
    const document = await context();
    const repository = new ProjectContextRepository({ backend: "memory" });
    await repository.put(document);
    const tools = getEditorialPlanTools({ repository });

    const created = await tools.create_editorial_plan.handler({
      project_id: document.projectId,
      workflow: "stringout",
      intent: "interview budget",
    });
    expect(created).toMatchObject({ success: true, data: { applied: false, workflow: "stringout" } });

    const plan = created.data as any;
    const preview = await tools.preview_editorial_plan.handler({ plan });
    expect(preview).toMatchObject({ success: true, data: { applied: false, workflow: "stringout" } });
    expect((preview as any).data.confirmationToken).toBe(editorialPlanConfirmationToken(plan));

    await repository.put({
      ...document,
      revision: "changed-context-revision",
      timelineRevision: "changed-timeline-revision",
    });
    await expect(tools.preview_editorial_plan.handler({ plan }))
      .resolves.toEqual(expect.objectContaining({ success: false, error: expect.stringContaining("stale") }));
  });

  it("returns clear errors when a project context is missing", async () => {
    const tools = getEditorialPlanTools({ repository: new ProjectContextRepository({ backend: "memory" }) });
    await expect(tools.create_editorial_plan.handler({
      project_id: "missing",
      workflow: "stringout",
      intent: "interview",
    })).resolves.toEqual({ success: false, error: "Project context not found; capture it before creating an editorial plan" });
  });
});
