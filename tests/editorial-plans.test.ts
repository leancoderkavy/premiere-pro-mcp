import { describe, expect, it, vi } from "vitest";
import {
  buildEditorialPlan,
  validateEditorialPlan,
} from "../src/ai/editorial-plan.js";
import { ProjectContextRepository } from "../src/context/project-context-store.js";
import { buildContextDocumentFromSnapshot, enrichContextDocument, type PremiereContextSnapshot } from "../src/tools/project-context.js";
import { getEditorialPlanTools } from "../src/tools/editorial-plans.js";
import type { UxpWebSocketBridge } from "../src/bridge/uxp-websocket-bridge.js";

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

function verifiedUxpReadback(boundary: string, result: Record<string, unknown>) {
  return {
    ...result,
    outcome: "verified",
    verified: true,
    verificationBoundary: boundary,
    operation: {
      verification: {
        status: "verified",
        boundary,
        evidence: [{ type: boundary, verified: true }],
      },
    },
  };
}

async function createAndPreviewOrganizationPlan(
  tools: any,
  document: Awaited<ReturnType<typeof context>>,
  organizationRules: Array<{ name: string; keywords: string[]; colorIndex?: number }>,
) {
  const created = await tools.create_editorial_plan.handler({
    project_id: document.projectId,
    workflow: "organize",
    intent: "interview budget",
    organization_rules: organizationRules.map((rule) => ({
      name: rule.name,
      keywords: rule.keywords,
      ...(rule.colorIndex === undefined ? {} : { color_index: rule.colorIndex }),
    })),
  });
  expect(created).toMatchObject({ success: true, data: { workflow: "organize", applied: false } });
  const plan = created.data;
  const preview = await tools.preview_editorial_plan.handler({ plan });
  expect(preview).toMatchObject({ success: true, data: { applied: false, workflow: "organize" } });
  return { plan, confirmationToken: preview.data.confirmationToken as string };
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
        route: "apply_editorial_organization_plan",
        mutatesProject: false,
        requiresReview: true,
      })],
    });
    expect(plan.limitations.join(" ")).toContain("does not call an LLM");
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

  it("plans bounded platform cutdowns without creating, reframing, or exporting a sequence", async () => {
    const document = await context();
    const plan = buildEditorialPlan(document, {
      workflow: "platform_cutdown",
      intent: "interview budget",
      platformTargets: [{ name: "Vertical short", width: 1080, height: 1920, includeCaptions: true }],
    });

    expect(plan).toMatchObject({ workflow: "platform_cutdown", applied: false });
    expect(plan.recommendations[0]).toMatchObject({
      kind: "create_platform_cutdown",
      route: "manage_sequences_uxp",
      details: expect.objectContaining({
        sourceSequenceId: "sequence-1",
        target: { width: 1080, height: 1920 },
        includeCaptions: true,
      }),
    });
    expect((plan.recommendations[0].details.nextRoutes as Array<{ tool: string }>).map((route) => route.tool))
      .toEqual(["manage_sequences_uxp", "auto_reframe_sequence", "create_caption_track", "get_sequence_structure", "export_sequence"]);
    expect(plan.limitations.join(" ")).toContain("does not create a sequence");

    expect(() => buildEditorialPlan(document, { workflow: "platform_cutdown", intent: "cutdown" }))
      .toThrow("platform_targets are required");
    expect(() => buildEditorialPlan(document, {
      workflow: "platform_cutdown",
      intent: "cutdown",
      sequenceId: "missing-sequence",
      platformTargets: [{ name: "Square", width: 1080, height: 1080 }],
    })).toThrow("matching sequence_id");
    expect(() => buildEditorialPlan(document, {
      workflow: "platform_cutdown",
      intent: "cutdown",
      platformTargets: [{ name: "Bad dimensions", width: 0, height: 1080 }],
    })).toThrow("width must be an integer");
  });

  it("requires explicit categories and rejects plans that claim they were applied", async () => {
    const document = await context();
    expect(() => buildEditorialPlan(document, { workflow: "organize", intent: "interviews" }))
      .toThrow("organization_rules are required");

    const plan = buildEditorialPlan(document, { workflow: "stringout", intent: "interview" });
    expect(() => validateEditorialPlan({ ...plan, applied: true })).toThrow("preview-only");
    expect(() => validateEditorialPlan({ ...plan, recommendations: [] })).toThrow("recommendations must contain");
    expect(() => buildEditorialPlan(document, { workflow: "stringout", intent: "interview", maxCandidates: Number.POSITIVE_INFINITY }))
      .toThrow("max_candidates must be a finite number");
  });

  it("bounds malformed organization, cutdown, and serialized-plan inputs", async () => {
    const document = await context();
    for (const rules of [
      {} as any,
      Array.from({ length: 17 }, () => ({ name: "Bin", keywords: ["interview"] })),
      [null],
      [{ name: "", keywords: ["interview"] }],
      [{ name: "Bin", keywords: [] }],
      [{ name: "Bin", keywords: ["interview"] }, { name: "bin", keywords: ["budget"] }],
      [{ name: "Bin", keywords: ["interview"], color_index: 15 }],
    ]) {
      expect(() => buildEditorialPlan(document, { workflow: "organize", intent: "interview", organizationRules: rules }))
        .toThrow();
    }
    for (const targets of [
      [],
      [null],
      [{ name: "", width: 1080, height: 1920 }],
      [{ name: "Square", width: 1080, height: 1080 }, { name: "square", width: 1080, height: 1080 }],
      [{ name: "Missing width", height: 1080 }],
      [{ name: "Bad height", width: 1080, height: 0 }],
      [{ name: "Bad captions", width: 1080, height: 1920, include_captions: "yes" }],
    ]) {
      expect(() => buildEditorialPlan(document, { workflow: "platform_cutdown", intent: "cutdown", platformTargets: targets as any }))
        .toThrow();
    }

    const plan = buildEditorialPlan(document, { workflow: "stringout", intent: "interview" });
    for (const malformed of [
      null,
      { ...plan, schemaVersion: 2 },
      { ...plan, workflow: "unknown" },
      { ...plan, projectId: "" },
      { ...plan, candidates: null },
      { ...plan, candidates: [{}] },
      { ...plan, recommendations: [] },
      { ...plan, recommendations: [null] },
      { ...plan, recommendations: [{ ...plan.recommendations[0], route: "" }] },
      { ...plan, recommendations: [{ ...plan.recommendations[0], mutatesProject: true }] },
      { ...plan, recommendations: [{ ...plan.recommendations[0], candidateEvidenceIds: ["unknown-evidence"] }] },
      { ...plan, limitations: [] },
    ]) {
      expect(() => validateEditorialPlan(malformed)).toThrow();
    }
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
    expect((preview as any).data.confirmationToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);

    await repository.put({
      ...document,
      revision: "changed-context-revision",
      timelineRevision: "changed-timeline-revision",
    });
    await expect(tools.preview_editorial_plan.handler({ plan }))
      .resolves.toEqual(expect.objectContaining({ success: false, error: expect.stringContaining("stale") }));
  });

  it("rejects client-modified server-issued plans during preview and apply", async () => {
    const document = await context();
    const repository = new ProjectContextRepository({ backend: "memory" });
    await repository.put(document);
    const request = vi.fn();
    const tools = getEditorialPlanTools({ repository, uxpBridge: { request } as unknown as UxpWebSocketBridge }) as any;
    const { plan, confirmationToken } = await createAndPreviewOrganizationPlan(
      tools,
      document,
      [{ name: "Interviews", keywords: ["interview"] }],
    );
    const sourceIndex = plan.candidates.findIndex((candidate: any) => candidate.kind === "source");
    const source = plan.candidates[sourceIndex];
    const recommendation = plan.recommendations[0];
    const sourceGuards = [{ evidence_id: source.evidenceId, project_item_id: source.sourceId, expected_parent_id: "root-bin" }];
    const forgedPlans = [
      {
        ...plan,
        candidates: plan.candidates.map((candidate: any, index: number) => index === sourceIndex
          ? { ...candidate, sourceId: "attacker-source" }
          : candidate),
      },
      {
        ...plan,
        recommendations: [{ ...recommendation, details: { ...recommendation.details, proposedBinName: "Attacker Bin" } }],
      },
      {
        ...plan,
        recommendations: [{ ...recommendation, route: "organize_project_items_uxp" }],
      },
      {
        ...plan,
        recommendations: [{ ...recommendation, candidateEvidenceIds: [] }],
      },
    ];

    for (const forgedPlan of forgedPlans) {
      await expect(tools.preview_editorial_plan.handler({ plan: forgedPlan }))
        .resolves.toMatchObject({ success: false, error: expect.stringContaining("was not issued") });
      await expect(tools.apply_editorial_organization_plan.handler({
        plan: forgedPlan,
        confirmation_token: confirmationToken,
        operation_id: "forged-plan",
        organization_operations: [{ recommendation_id: recommendation.id, source_guards: sourceGuards }],
      })).resolves.toMatchObject({ success: false, error: expect.stringContaining("was not issued") });
    }
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects duplicate source guards across the complete organization batch before UXP mutation", async () => {
    const document = await context();
    const repository = new ProjectContextRepository({ backend: "memory" });
    await repository.put(document);
    const request = vi.fn();
    const tools = getEditorialPlanTools({ repository, uxpBridge: { request } as unknown as UxpWebSocketBridge }) as any;
    const { plan, confirmationToken } = await createAndPreviewOrganizationPlan(
      tools,
      document,
      [
        { name: "Interviews", keywords: ["interview"] },
        { name: "Interviews again", keywords: ["interview"] },
      ],
    );
    const source = plan.candidates.find((candidate: any) => candidate.kind === "source")!;
    const sourceGuard = { evidence_id: source.evidenceId, project_item_id: source.sourceId, expected_parent_id: "root-bin" };

    await expect(tools.apply_editorial_organization_plan.handler({
      plan,
      confirmation_token: confirmationToken,
      operation_id: "duplicate-evidence",
      organization_operations: plan.recommendations.map((recommendation: any) => ({
        recommendation_id: recommendation.id,
        source_guards: [sourceGuard],
      })),
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("duplicate evidence_id") });
    expect(request).not.toHaveBeenCalled();

    const duplicateSourceDocument = structuredClone(document);
    const originalSource = duplicateSourceDocument.records.find((record) => record.kind === "source")!;
    duplicateSourceDocument.records.push({
      ...originalSource,
      id: "duplicate-source-evidence",
      name: "Interview alternate record.mov",
      text: "Interview alternate record.",
      keywords: ["interview"],
    });
    await repository.put(duplicateSourceDocument);
    const duplicateSourceTools = getEditorialPlanTools({ repository, uxpBridge: { request } as unknown as UxpWebSocketBridge }) as any;
    const duplicateSourcePlan = await createAndPreviewOrganizationPlan(
      duplicateSourceTools,
      duplicateSourceDocument,
      [
        { name: "Interviews", keywords: ["interview"] },
        { name: "Interview copies", keywords: ["interview"] },
      ],
    );
    const [firstEvidence, secondEvidence] = duplicateSourcePlan.plan.candidates
      .filter((candidate: any) => candidate.kind === "source")
      .map((candidate: any) => candidate.evidenceId);

    await expect(duplicateSourceTools.apply_editorial_organization_plan.handler({
      plan: duplicateSourcePlan.plan,
      confirmation_token: duplicateSourcePlan.confirmationToken,
      operation_id: "duplicate-project-item",
      organization_operations: duplicateSourcePlan.plan.recommendations.map((recommendation: any, index: number) => ({
        recommendation_id: recommendation.id,
        source_guards: [{
          evidence_id: index === 0 ? firstEvidence : secondEvidence,
          project_item_id: "source-1",
          expected_parent_id: "root-bin",
        }],
      })),
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("duplicate project_item_id") });
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps platform-cutdown creation and preview local even when a UXP bridge is available", async () => {
    const document = await context();
    const repository = new ProjectContextRepository({ backend: "memory" });
    await repository.put(document);
    const request = vi.fn().mockRejectedValue(new Error("A plan must not call the host"));
    const tools = getEditorialPlanTools({ repository, uxpBridge: { request } as unknown as UxpWebSocketBridge });

    const created = await tools.create_editorial_plan.handler({
      project_id: document.projectId,
      workflow: "platform_cutdown",
      intent: "interview budget",
      platform_targets: [{ name: "Vertical", width: 1080, height: 1920, include_captions: true }],
    });
    expect(created).toMatchObject({
      success: true,
      data: { workflow: "platform_cutdown", applied: false },
    });
    await expect(tools.preview_editorial_plan.handler({ plan: created.data }))
      .resolves.toMatchObject({ success: true, data: { applied: false, workflow: "platform_cutdown" } });
    expect(request).not.toHaveBeenCalled();
  });

  it("returns clear errors when a project context is missing", async () => {
    const tools = getEditorialPlanTools({ repository: new ProjectContextRepository({ backend: "memory" }) });
    await expect(tools.create_editorial_plan.handler({
      project_id: "missing",
      workflow: "stringout",
      intent: "interview",
    })).resolves.toEqual({ success: false, error: "Project context not found; capture it before creating an editorial plan" });
  });

  it("registers organization application only with the UXP bridge and applies each guarded host transaction", async () => {
    const document = await context();
    const repository = new ProjectContextRepository({ backend: "memory" });
    await repository.put(document);
    const request = vi.fn()
      .mockResolvedValueOnce(verifiedUxpReadback("bin_child_id_readback", { created: true, item: { id: "bin-interviews" } }))
      .mockResolvedValueOnce(verifiedUxpReadback("project_item_parent_readback", {
        moved: true,
        destinationBinId: "bin-interviews",
        after: { parentId: "bin-interviews" },
      }))
      .mockResolvedValueOnce(verifiedUxpReadback("project_item_color_readback", {
        updated: true,
        after: { colorLabelIndex: 3 },
      }));
    const bridge = { request } as unknown as UxpWebSocketBridge;
    const withoutUxp = getEditorialPlanTools({ repository });
    expect(withoutUxp).not.toHaveProperty("apply_editorial_organization_plan");
    const tools = getEditorialPlanTools({ repository, uxpBridge: bridge }) as any;
    expect(tools.apply_editorial_organization_plan.operationalCapability).toMatchObject({
      verificationBoundary: "structured_uxp_readback",
      hostVerificationRequired: true,
    });
    const { plan, confirmationToken } = await createAndPreviewOrganizationPlan(
      tools,
      document,
      [{ name: "Interviews", keywords: ["interview"], colorIndex: 3 }],
    );
    const source = plan.candidates.find((candidate: any) => candidate.kind === "source")!;
    expect(source).toMatchObject({ sourceId: "source-1" });

    const result = await tools.apply_editorial_organization_plan.handler({
      plan,
      confirmation_token: confirmationToken,
      operation_id: "organize-2026-08-22",
      organization_operations: [{
        recommendation_id: "organization-1",
        source_guards: [{ evidence_id: source.evidenceId, project_item_id: "source-1", expected_parent_id: "root-bin" }],
      }],
    });

    expect(result).toMatchObject({
      success: true,
      data: { applied: true, outcome: "verified", verified: true, committedActions: [
        { action: "create_bin", verified: true },
        { action: "move", projectItemId: "source-1", verified: true },
        { action: "set_color", projectItemId: "source-1", verified: true },
      ] },
    });
    expect(request.mock.calls).toEqual([
      ["bins.create", expect.objectContaining({ name: "Interviews", makeUnique: true, operationId: expect.stringMatching(/^organize-2026-08-22:create:/) })],
      ["bins.move", expect.objectContaining({ projectItemId: "source-1", destinationBinId: "bin-interviews", expectedParentId: "root-bin", operationId: expect.stringMatching(/^organize-2026-08-22:move:/) })],
      ["bins.color", expect.objectContaining({ projectItemId: "source-1", colorIndex: 3, operationId: expect.stringMatching(/^organize-2026-08-22:color:/) })],
    ]);
  });

  it("accepts an unchanged editorial plan after an MCP JSON round trip", async () => {
    const document = await context();
    const repository = new ProjectContextRepository({ backend: "memory" });
    await repository.put(document);
    const request = vi.fn()
      .mockResolvedValueOnce(verifiedUxpReadback("bin_child_id_readback", { created: true, item: { id: "bin-interviews" } }))
      .mockResolvedValueOnce(verifiedUxpReadback("project_item_parent_readback", {
        moved: true,
        destinationBinId: "bin-interviews",
        after: { parentId: "bin-interviews" },
      }));
    const tools = getEditorialPlanTools({ repository, uxpBridge: { request } as unknown as UxpWebSocketBridge }) as any;
    const { plan, confirmationToken } = await createAndPreviewOrganizationPlan(
      tools,
      document,
      [{ name: "Interviews", keywords: ["interview"] }],
    );
    const roundTrippedPlan = JSON.parse(JSON.stringify(plan));
    const source = roundTrippedPlan.candidates.find((candidate: any) => candidate.kind === "source")!;

    await expect(tools.apply_editorial_organization_plan.handler({
      plan: roundTrippedPlan,
      confirmation_token: confirmationToken,
      operation_id: "organize-json-roundtrip",
      organization_operations: [{
        recommendation_id: "organization-1",
        source_guards: [{ evidence_id: source.evidenceId, project_item_id: "source-1", expected_parent_id: "root-bin" }],
      }],
    })).resolves.toMatchObject({
      success: true,
      data: { applied: true, outcome: "verified", verified: true },
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("fails closed before UXP mutation for stale, unconfirmed, or unplanned organization input", async () => {
    const document = await context();
    const repository = new ProjectContextRepository({ backend: "memory" });
    await repository.put(document);
    const request = vi.fn();
    const tools = getEditorialPlanTools({ repository, uxpBridge: { request } as unknown as UxpWebSocketBridge }) as any;
    const { plan, confirmationToken } = await createAndPreviewOrganizationPlan(
      tools,
      document,
      [{ name: "Interviews", keywords: ["interview"] }],
    );
    const source = plan.candidates.find((candidate: any) => candidate.kind === "source")!;
    const unpreviewed = await tools.create_editorial_plan.handler({
      project_id: document.projectId,
      workflow: "organize",
      intent: "interview budget",
      organization_rules: [{ name: "Unpreviewed", keywords: ["interview"] }],
    });
    const unpreviewedPlan = unpreviewed.data;
    const unpreviewedSource = unpreviewedPlan.candidates.find((candidate: any) => candidate.kind === "source")!;
    const validOperations = [{
      recommendation_id: "organization-1",
      source_guards: [{ evidence_id: source.evidenceId, project_item_id: "source-1", expected_parent_id: "root-bin" }],
    }];

    await expect(tools.apply_editorial_organization_plan.handler({
      plan: unpreviewedPlan,
      confirmation_token: "not-previewed",
      operation_id: "organize-unpreviewed",
      organization_operations: [{
        recommendation_id: "organization-1",
        source_guards: [{ evidence_id: unpreviewedSource.evidenceId, project_item_id: "source-1", expected_parent_id: "root-bin" }],
      }],
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("opaque token") });
    await expect(tools.apply_editorial_organization_plan.handler({
      plan,
      confirmation_token: "wrong-token",
      operation_id: "organize-invalid",
      organization_operations: validOperations,
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("confirmation_token") });
    await expect(tools.apply_editorial_organization_plan.handler({
      plan,
      confirmation_token: confirmationToken,
      operation_id: "organize-invalid",
      organization_operations: [{ ...validOperations[0], source_guards: [{ ...validOperations[0].source_guards[0], project_item_id: "unplanned-source" }] }],
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("must match the planned source ID") });

    await repository.put({ ...document, revision: "new-revision", timelineRevision: "new-timeline-revision" });
    await expect(tools.apply_editorial_organization_plan.handler({
      plan,
      confirmation_token: confirmationToken,
      operation_id: "organize-stale",
      organization_operations: validOperations,
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("stale") });
    expect(request).not.toHaveBeenCalled();
  });

  it("reports completed UXP transactions as partial without claiming rollback or verification", async () => {
    const document = await context();
    const repository = new ProjectContextRepository({ backend: "memory" });
    await repository.put(document);
    const request = vi.fn()
      .mockResolvedValueOnce(verifiedUxpReadback("bin_child_id_readback", { created: true, item: { id: "bin-interviews" } }))
      .mockRejectedValueOnce(new Error("expected parent no longer matches"));
    const tools = getEditorialPlanTools({ repository, uxpBridge: { request } as unknown as UxpWebSocketBridge }) as any;
    const { plan, confirmationToken } = await createAndPreviewOrganizationPlan(
      tools,
      document,
      [{ name: "Interviews", keywords: ["interview"], colorIndex: 3 }],
    );
    const source = plan.candidates.find((candidate: any) => candidate.kind === "source")!;

    await expect(tools.apply_editorial_organization_plan.handler({
      plan,
      confirmation_token: confirmationToken,
      operation_id: "organize-partial",
      organization_operations: [{
        recommendation_id: "organization-1",
        source_guards: [{ evidence_id: source.evidenceId, project_item_id: "source-1", expected_parent_id: "root-bin" }],
      }],
    })).resolves.toMatchObject({
      success: true,
      data: {
        applied: true,
        outcome: "partial",
        verified: false,
        committedActions: [{ action: "create_bin" }],
        unverifiedAttempts: [{ action: "move", verified: false }],
        nextSteps: expect.arrayContaining([expect.stringContaining("undo the verified completed host transactions")]),
      },
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("halts before a later mutation when a verified UXP reply contradicts its readback", async () => {
    const document = await context();
    const repository = new ProjectContextRepository({ backend: "memory" });
    await repository.put(document);
    const request = vi.fn()
      .mockResolvedValueOnce(verifiedUxpReadback("bin_child_id_readback", { created: true, item: { id: "bin-interviews" } }))
      .mockResolvedValueOnce(verifiedUxpReadback("project_item_parent_readback", {
        moved: true,
        destinationBinId: "bin-interviews",
        after: { parentId: "wrong-bin" },
      }))
      .mockRejectedValueOnce(new Error("Color should not be attempted after a contradictory move readback"));
    const tools = getEditorialPlanTools({ repository, uxpBridge: { request } as unknown as UxpWebSocketBridge }) as any;
    const { plan, confirmationToken } = await createAndPreviewOrganizationPlan(
      tools,
      document,
      [{ name: "Interviews", keywords: ["interview"], colorIndex: 3 }],
    );
    const source = plan.candidates.find((candidate: any) => candidate.kind === "source")!;

    await expect(tools.apply_editorial_organization_plan.handler({
      plan,
      confirmation_token: confirmationToken,
      operation_id: "organize-contradictory-readback",
      organization_operations: [{
        recommendation_id: "organization-1",
        source_guards: [{ evidence_id: source.evidenceId, project_item_id: "source-1", expected_parent_id: "root-bin" }],
      }],
    })).resolves.toMatchObject({
      success: true,
      data: {
        outcome: "partial",
        verified: false,
        committedActions: [
          { action: "create_bin", verified: true },
        ],
        unverifiedAttempts: [{ action: "move", verified: false }],
        error: expect.stringContaining("destination-parent readback"),
      },
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("reports a color response with the wrong observed label as partial", async () => {
    const document = await context();
    const repository = new ProjectContextRepository({ backend: "memory" });
    await repository.put(document);
    const request = vi.fn()
      .mockResolvedValueOnce(verifiedUxpReadback("bin_child_id_readback", { created: true, item: { id: "bin-interviews" } }))
      .mockResolvedValueOnce(verifiedUxpReadback("project_item_parent_readback", {
        moved: true,
        destinationBinId: "bin-interviews",
        after: { parentId: "bin-interviews" },
      }))
      .mockResolvedValueOnce(verifiedUxpReadback("project_item_color_readback", {
        updated: true,
        after: { colorLabelIndex: 2 },
      }));
    const tools = getEditorialPlanTools({ repository, uxpBridge: { request } as unknown as UxpWebSocketBridge }) as any;
    const { plan, confirmationToken } = await createAndPreviewOrganizationPlan(
      tools,
      document,
      [{ name: "Interviews", keywords: ["interview"], colorIndex: 3 }],
    );
    const source = plan.candidates.find((candidate: any) => candidate.kind === "source")!;

    await expect(tools.apply_editorial_organization_plan.handler({
      plan,
      confirmation_token: confirmationToken,
      operation_id: "organize-color-readback",
      organization_operations: [{
        recommendation_id: "organization-1",
        source_guards: [{ evidence_id: source.evidenceId, project_item_id: "source-1", expected_parent_id: "root-bin" }],
      }],
    })).resolves.toMatchObject({
      success: true,
      data: {
        outcome: "partial",
        verified: false,
        committedActions: [
          { action: "create_bin", verified: true },
          { action: "move", verified: true },
        ],
        unverifiedAttempts: [{ action: "set_color", verified: false }],
        error: expect.stringContaining("color-label readback"),
      },
    });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("fails a malformed first UXP response without claiming an applied plan", async () => {
    const document = await context();
    const repository = new ProjectContextRepository({ backend: "memory" });
    await repository.put(document);
    const existingBinRequest = vi.fn().mockResolvedValue({ moved: true });
    const existingBinTools = getEditorialPlanTools({ repository, uxpBridge: { request: existingBinRequest } as unknown as UxpWebSocketBridge }) as any;
    const { plan, confirmationToken } = await createAndPreviewOrganizationPlan(
      existingBinTools,
      document,
      [{ name: "Interviews", keywords: ["interview"] }],
    );
    const source = plan.candidates.find((candidate: any) => candidate.kind === "source")!;
    const malformedResult = await existingBinTools.apply_editorial_organization_plan.handler({
      plan,
      confirmation_token: confirmationToken,
      operation_id: "organize-existing-bin",
      organization_operations: [{
        recommendation_id: "organization-1",
        destination_bin_id: "existing-bin",
        source_guards: [{ evidence_id: source.evidenceId, project_item_id: "source-1", expected_parent_id: "root-bin" }],
      }],
    });
    expect(malformedResult).toMatchObject({
      success: false,
      error: expect.stringContaining("destination-parent readback"),
    });
    expect(malformedResult.error).toContain("inspect Premiere before retrying");
    expect(existingBinRequest).toHaveBeenCalledTimes(1);
    expect(existingBinRequest).toHaveBeenCalledWith("bins.move", expect.objectContaining({ destinationBinId: "existing-bin" }));

    const incompleteCreateRequest = vi.fn().mockResolvedValue({ item: {}, verified: false });
    const incompleteCreateTools = getEditorialPlanTools({ repository, uxpBridge: { request: incompleteCreateRequest } as unknown as UxpWebSocketBridge }) as any;
    const incomplete = await createAndPreviewOrganizationPlan(
      incompleteCreateTools,
      document,
      [{ name: "Interviews", keywords: ["interview"] }],
    );
    await expect(incompleteCreateTools.apply_editorial_organization_plan.handler({
      plan: incomplete.plan,
      confirmation_token: incomplete.confirmationToken,
      operation_id: "organize-incomplete-create",
      organization_operations: [{
        recommendation_id: "organization-1",
        source_guards: [{ evidence_id: source.evidenceId, project_item_id: "source-1", expected_parent_id: "root-bin" }],
      }],
    })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("stable-bin readback"),
    });
    expect(incompleteCreateRequest).toHaveBeenCalledTimes(1);
  });

  it("fails a first UXP request rejection and warns that host state is unknown", async () => {
    const document = await context();
    const repository = new ProjectContextRepository({ backend: "memory" });
    await repository.put(document);
    const request = vi.fn().mockRejectedValue(new Error("UXP bridge disconnected"));
    const tools = getEditorialPlanTools({ repository, uxpBridge: { request } as unknown as UxpWebSocketBridge }) as any;
    const { plan, confirmationToken } = await createAndPreviewOrganizationPlan(
      tools,
      document,
      [{ name: "Interviews", keywords: ["interview"] }],
    );
    const source = plan.candidates.find((candidate: any) => candidate.kind === "source")!;

    const rejectedResult = await tools.apply_editorial_organization_plan.handler({
      plan,
      confirmation_token: confirmationToken,
      operation_id: "organize-rejected-first-request",
      organization_operations: [{
        recommendation_id: "organization-1",
        destination_bin_id: "existing-bin",
        source_guards: [{ evidence_id: source.evidenceId, project_item_id: "source-1", expected_parent_id: "root-bin" }],
      }],
    });
    expect(rejectedResult).toMatchObject({
      success: false,
      error: expect.stringContaining("UXP bridge disconnected"),
    });
    expect(rejectedResult.error).toContain("may have reached the host");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("returns local validation failures without starting a UXP transaction", async () => {
    const document = await context();
    const repository = new ProjectContextRepository({ backend: "memory" });
    await repository.put(document);
    const request = vi.fn().mockRejectedValue(new Error("host unavailable"));
    const tools = getEditorialPlanTools({ repository, uxpBridge: { request } as unknown as UxpWebSocketBridge }) as any;
    const { plan, confirmationToken } = await createAndPreviewOrganizationPlan(
      tools,
      document,
      [{ name: "Interviews", keywords: ["interview"] }],
    );
    await expect(tools.create_editorial_plan.handler({
      project_id: document.projectId,
      workflow: "platform_cutdown",
      intent: "cutdown",
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("platform_targets are required") });
    await expect(tools.preview_editorial_plan.handler({ plan: null })).resolves.toMatchObject({ success: false, error: expect.stringContaining("plan must be an object") });
    await expect(tools.apply_editorial_organization_plan.handler({
      plan,
      confirmation_token: confirmationToken,
      operation_id: "organize-host-failure",
      organization_operations: [],
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("organization_operations") });
    await expect(tools.apply_editorial_organization_plan.handler({
      plan,
      confirmation_token: confirmationToken,
      operation_id: "organize-host-failure",
      organization_operations: [{ recommendation_id: "unknown", source_guards: [{ evidence_id: "missing", project_item_id: "source-1", expected_parent_id: "root" }] }],
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("organize_source recommendation") });
    await expect(tools.apply_editorial_organization_plan.handler({
      plan,
      confirmation_token: confirmationToken,
      operation_id: "organize-host-failure",
      organization_operations: [{ recommendation_id: "organization-1", source_guards: [] }],
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("source_guards") });
    await expect(tools.apply_editorial_organization_plan.handler({
      plan,
      confirmation_token: confirmationToken,
      operation_id: "organize-host-failure",
      organization_operations: [{ recommendation_id: "organization-1", source_guards: [null] }],
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("must be an object") });
    const transcript = plan.candidates.find((candidate) => candidate.kind === "transcript")!;
    await expect(tools.apply_editorial_organization_plan.handler({
      plan,
      confirmation_token: confirmationToken,
      operation_id: "organize-host-failure",
      organization_operations: [{ recommendation_id: "organization-1", source_guards: [{ evidence_id: transcript.evidenceId, project_item_id: "source-1", expected_parent_id: "root" }] }],
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("must reference a source") });
    const stringout = buildEditorialPlan(document, { workflow: "stringout", intent: "interview" });
    await expect(tools.apply_editorial_organization_plan.handler({
      plan: stringout,
      confirmation_token: confirmationToken,
      operation_id: "organize-host-failure",
      organization_operations: [],
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("only accepts an organize") });
    expect(request).not.toHaveBeenCalled();
  });
});
