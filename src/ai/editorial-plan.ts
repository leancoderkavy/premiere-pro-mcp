import {
  normalizeContextKeywords,
  normalizeContextText,
  searchProjectContext,
  type ProjectContextDocument,
  type ProjectContextKind,
  type ProjectContextRecord,
} from "../context/project-context-store.js";

export const EDITORIAL_PLAN_SCHEMA_VERSION = 1;
export const MAX_EDITORIAL_CANDIDATES = 32;
export const MAX_ORGANIZATION_RULES = 16;
export const MAX_PLATFORM_CUTDOWN_TARGETS = 8;

export type EditorialWorkflow = "organize" | "stringout" | "rough_cut" | "caption_review" | "platform_cutdown";

export interface OrganizationRule {
  name: string;
  keywords: string[];
  colorIndex?: number;
}

export interface PlatformCutdownTarget {
  name: string;
  width: number;
  height: number;
  sequenceName?: string;
  includeCaptions?: boolean;
}

export interface EditorialCandidate {
  evidenceId: string;
  kind: ProjectContextKind;
  name: string;
  score: number;
  matchedTerms: string[];
  sourceId?: string;
  timelineItemId?: string;
  startSeconds?: number;
  endSeconds?: number;
  sourceRevision?: string;
  timelineRevision?: string;
}

export interface EditorialRecommendation {
  id: string;
  kind: "organize_source" | "create_stringout" | "transcript_rough_cut" | "caption_artifact_review" | "create_platform_cutdown";
  title: string;
  route: string;
  mutatesProject: false;
  requiresReview: true;
  candidateEvidenceIds: string[];
  details: Record<string, unknown>;
}

export interface EditorialPlan {
  schemaVersion: typeof EDITORIAL_PLAN_SCHEMA_VERSION;
  projectId: string;
  workflow: EditorialWorkflow;
  intent: string;
  expectedContextRevision: string;
  expectedTimelineRevision: string;
  candidates: EditorialCandidate[];
  recommendations: EditorialRecommendation[];
  limitations: string[];
  applied: false;
}

export interface BuildEditorialPlanOptions {
  workflow: EditorialWorkflow;
  intent: string;
  sequenceId?: string;
  maxCandidates?: number;
  organizationRules?: OrganizationRule[];
  platformTargets?: PlatformCutdownTarget[];
}

function finiteSeconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function boundedWorkflow(value: unknown): EditorialWorkflow {
  if (value === "organize" || value === "stringout" || value === "rough_cut" || value === "caption_review" || value === "platform_cutdown") return value;
  throw new Error("workflow must be organize, stringout, rough_cut, caption_review, or platform_cutdown");
}

function boundedOrganizationRules(value: unknown): OrganizationRule[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ORGANIZATION_RULES) {
    throw new Error(`organization_rules must contain at most ${MAX_ORGANIZATION_RULES} rules`);
  }
  const names = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`organization_rules[${index}] must be an object`);
    }
    const raw = entry as Record<string, unknown>;
    const name = normalizeContextText(raw.name).slice(0, 255);
    const keywords = normalizeContextKeywords(raw.keywords).map((keyword) => keyword.toLocaleLowerCase());
    const rawColorIndex = raw.colorIndex ?? raw.color_index;
    if (!name) throw new Error(`organization_rules[${index}].name must not be empty`);
    if (!keywords.length) throw new Error(`organization_rules[${index}].keywords must contain at least one keyword`);
    if (names.has(name.toLocaleLowerCase())) throw new Error(`organization_rules contains duplicate name: ${name}`);
    names.add(name.toLocaleLowerCase());
    if (rawColorIndex !== undefined && (!Number.isInteger(rawColorIndex) || typeof rawColorIndex !== "number" || rawColorIndex < 0 || rawColorIndex > 14)) {
      throw new Error(`organization_rules[${index}].color_index must be an integer from 0 through 14`);
    }
    const colorIndex = rawColorIndex as number | undefined;
    return { name, keywords, ...(colorIndex === undefined ? {} : { colorIndex }) };
  });
}

function boundedPlatformCutdownTargets(value: unknown): PlatformCutdownTarget[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.length || value.length > MAX_PLATFORM_CUTDOWN_TARGETS) {
    throw new Error(`platform_targets must contain between 1 and ${MAX_PLATFORM_CUTDOWN_TARGETS} targets`);
  }
  const names = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`platform_targets[${index}] must be an object`);
    }
    const raw = entry as Record<string, unknown>;
    const name = normalizeContextText(raw.name).slice(0, 64);
    const width = raw.width;
    const height = raw.height;
    const sequenceName = normalizeContextText(raw.sequenceName ?? raw.sequence_name).slice(0, 255);
    const includeCaptions = raw.includeCaptions ?? raw.include_captions;
    if (!name) throw new Error(`platform_targets[${index}].name must not be empty`);
    if (names.has(name.toLocaleLowerCase())) throw new Error(`platform_targets contains duplicate name: ${name}`);
    names.add(name.toLocaleLowerCase());
    if (typeof width !== "number" || !Number.isInteger(width) || width < 16 || width > 8192) {
      throw new Error(`platform_targets[${index}].width must be an integer from 16 through 8192`);
    }
    if (typeof height !== "number" || !Number.isInteger(height) || height < 16 || height > 8192) {
      throw new Error(`platform_targets[${index}].height must be an integer from 16 through 8192`);
    }
    if (includeCaptions !== undefined && typeof includeCaptions !== "boolean") {
      throw new Error(`platform_targets[${index}].include_captions must be a boolean`);
    }
    return {
      name,
      width,
      height,
      ...(sequenceName ? { sequenceName } : {}),
      ...(includeCaptions === undefined ? {} : { includeCaptions }),
    };
  });
}

function candidateFromRecord(record: ProjectContextRecord, score: number, matchedTerms: string[]): EditorialCandidate {
  return {
    evidenceId: record.id,
    kind: record.kind,
    name: record.name,
    score: Number(score.toFixed(3)),
    matchedTerms,
    ...(record.sourceId ? { sourceId: record.sourceId } : {}),
    ...(record.timelineItemId ? { timelineItemId: record.timelineItemId } : {}),
    ...(finiteSeconds(record.startSeconds) === undefined ? {} : { startSeconds: record.startSeconds }),
    ...(finiteSeconds(record.endSeconds) === undefined ? {} : { endSeconds: record.endSeconds }),
    ...(record.sourceRevision ? { sourceRevision: record.sourceRevision } : {}),
    ...(record.timelineRevision ? { timelineRevision: record.timelineRevision } : {}),
  };
}

function organizationRecommendations(
  document: ProjectContextDocument,
  rules: OrganizationRule[],
  candidateEvidenceIds: ReadonlySet<string>,
): EditorialRecommendation[] {
  if (!rules.length) return [];
  const sources = document.records.filter((record) => record.kind === "source" && record.sourceId);
  return rules.map((rule, index) => {
    const keywords = new Set(rule.keywords);
    const matchingIds = sources
      .filter((record) => {
        const haystack = `${record.name} ${record.text} ${record.keywords.join(" ")}`.toLocaleLowerCase();
        return [...keywords].some((keyword) => haystack.includes(keyword));
      })
      .map((record) => record.id)
      .filter((id) => candidateEvidenceIds.has(id));
    return {
      id: `organization-${index + 1}`,
      kind: "organize_source",
      title: `Review sources for ${rule.name}`,
      route: "apply_editorial_organization_plan",
      mutatesProject: false,
      requiresReview: true,
      candidateEvidenceIds: matchingIds,
      details: {
        proposedBinName: rule.name,
        matchingKeywords: rule.keywords,
        ...(rule.colorIndex === undefined ? {} : { proposedColorIndex: rule.colorIndex }),
        matchingSourceCount: matchingIds.length,
        note: "After review, use the guarded organization-plan apply tool with stable project-item IDs and expected-parent guards. This plan never moves media itself.",
      },
    };
  });
}

function selectedSequence(document: ProjectContextDocument, sequenceId?: string): ProjectContextRecord {
  const sequence = document.records.find((record) => record.kind === "sequence" && record.sequenceId && (!sequenceId || record.sequenceId === sequenceId));
  if (!sequence?.sequenceId) {
    throw new Error(sequenceId
      ? "platform_cutdown requires a captured sequence matching sequence_id"
      : "platform_cutdown requires at least one captured sequence");
  }
  return sequence;
}

function platformCutdownRecommendations(
  sourceSequence: ProjectContextRecord,
  targets: PlatformCutdownTarget[],
  candidateEvidenceIds: string[],
): EditorialRecommendation[] {
  const sourceSequenceId = sourceSequence.sequenceId as string;
  return targets.map((target, index) => ({
    id: `platform-cutdown-${index + 1}`,
    kind: "create_platform_cutdown",
    title: `Review ${target.name} cutdown`,
    route: "manage_sequences_uxp",
    mutatesProject: false,
    requiresReview: true,
    candidateEvidenceIds,
    details: {
      sourceSequenceId,
      sourceSequenceName: sourceSequence.name,
      proposedSequenceName: target.sequenceName ?? `${sourceSequence.name} - ${target.name}`.slice(0, 255),
      target: { width: target.width, height: target.height },
      includeCaptions: target.includeCaptions === true,
      nextRoutes: [
        { tool: "manage_sequences_uxp", action: "clone" },
        { tool: "auto_reframe_sequence", targetWidth: target.width, targetHeight: target.height },
        ...(target.includeCaptions ? [{ tool: "create_caption_track" }] : []),
        { tool: "get_sequence_structure" },
        { tool: "export_sequence" },
      ],
      note: "First clone the source sequence, re-query the stable derivative ID, then review Auto Reframe and captions before any export. This plan does not create, reframe, or render a sequence.",
    },
  }));
}

export function buildEditorialPlan(
  document: ProjectContextDocument,
  options: BuildEditorialPlanOptions,
): EditorialPlan {
  const workflow = boundedWorkflow(options.workflow);
  const intent = normalizeContextText(options.intent).slice(0, 1_000);
  if (!intent) throw new Error("intent must not be empty");
  const requestedCandidates = options.maxCandidates ?? 8;
  if (!Number.isFinite(requestedCandidates)) throw new Error("max_candidates must be a finite number");
  const maxCandidates = Math.max(1, Math.min(MAX_EDITORIAL_CANDIDATES, Math.trunc(requestedCandidates)));
  const organizationRules = boundedOrganizationRules(options.organizationRules);
  const platformTargets = boundedPlatformCutdownTargets(options.platformTargets);
  if (workflow === "organize" && !organizationRules.length) {
    throw new Error("organization_rules are required for an organize workflow; the server does not infer editorial categories from filenames alone");
  }
  if (workflow === "platform_cutdown" && !platformTargets.length) {
    throw new Error("platform_targets are required for a platform_cutdown workflow");
  }

  const candidates = searchProjectContext(document, {
    query: intent,
    ...(options.sequenceId ? { sequenceId: options.sequenceId } : {}),
    kinds: ["transcript", "shot", "audio", "note", "timeline", "source"],
    limit: maxCandidates,
  }).map((result) => candidateFromRecord(result.record, result.score, result.matchedTerms));

  const evidenceIds = candidates.map((candidate) => candidate.evidenceId);
  const recommendations: EditorialRecommendation[] = [];
  const limitations: string[] = [
    "This is a non-mutating plan. It does not call an LLM, upload media, create bins, move clips, or change a sequence.",
    "Capture project context again immediately before any mutation; a stored context revision does not by itself prove the live Premiere project is unchanged.",
  ];

  if (workflow === "organize") {
    recommendations.push(...organizationRecommendations(document, organizationRules, new Set(evidenceIds)));
    limitations.push("Review every source match before calling apply_editorial_organization_plan. Newly created bin IDs must be resolved before any move operation.");
  } else if (workflow === "stringout") {
    recommendations.push({
      id: "stringout-1",
      kind: "create_stringout",
      title: "Review candidate sources for a stringout",
      route: "manage_sequences_uxp",
      mutatesProject: false,
      requiresReview: true,
      candidateEvidenceIds: evidenceIds,
      details: {
        candidateCount: candidates.length,
        note: "Resolve the selected project-item IDs, create a new sequence, and verify source order before adding clips. This plan does not infer pacing or publish a timeline mutation.",
      },
    });
    limitations.push("A stringout must be created in a new sequence and verified after the host returns stable sequence/item identities.");
  } else if (workflow === "rough_cut") {
    recommendations.push({
      id: "rough-cut-1",
      kind: "transcript_rough_cut",
      title: "Review transcript evidence for a rough-cut preview",
      route: "preview_transcript_edit_uxp",
      mutatesProject: false,
      requiresReview: true,
      candidateEvidenceIds: evidenceIds.filter((id) => document.records.some((record) => record.id === id && record.kind === "transcript")),
      details: {
        candidateCount: candidates.length,
        note: "Use the native transcript preview and duplicate-sequence planning workflow. Do not treat text matches as automatic timeline-cut authority.",
      },
    });
    limitations.push("Transcript-to-timeline application remains restricted to mappings validated in a licensed Premiere host.");
  } else if (workflow === "caption_review") {
    recommendations.push({
      id: "caption-review-1",
      kind: "caption_artifact_review",
      title: "Review caption evidence and an imported artifact",
      route: "create_caption_track",
      mutatesProject: false,
      requiresReview: true,
      candidateEvidenceIds: evidenceIds.filter((id) => document.records.some((record) => record.id === id && record.kind === "transcript")),
      details: {
        note: "Premiere scripting can create a caption track from an imported SRT/VTT artifact, but cannot safely translate captions or create raw caption clips through a documented API.",
      },
    });
    limitations.push("Translation, transcription, and dubbing are user-assisted or separate-provider workflows; no media-transfer or paid-provider request is made by this plan.");
  } else {
    const sourceSequence = selectedSequence(document, options.sequenceId);
    recommendations.push(...platformCutdownRecommendations(sourceSequence, platformTargets, evidenceIds));
    limitations.push("Cutdown planning does not create a sequence, invoke Auto Reframe, relabel clips, translate captions, or render/export media.");
    limitations.push("Any later UXP mutation must use the newly returned stable sequence ID and independently report its host verification boundary.");
  }

  return {
    schemaVersion: EDITORIAL_PLAN_SCHEMA_VERSION,
    projectId: document.projectId,
    workflow,
    intent,
    expectedContextRevision: document.revision,
    expectedTimelineRevision: document.timelineRevision,
    candidates,
    recommendations,
    limitations,
    applied: false,
  };
}

export function validateEditorialPlan(value: unknown): EditorialPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("plan must be an object");
  const plan = value as Partial<EditorialPlan>;
  if (plan.schemaVersion !== EDITORIAL_PLAN_SCHEMA_VERSION) {
    throw new Error(`plan.schemaVersion must be ${EDITORIAL_PLAN_SCHEMA_VERSION}`);
  }
  const workflow = boundedWorkflow(plan.workflow);
  const projectId = normalizeContextText(plan.projectId).slice(0, 512);
  const intent = normalizeContextText(plan.intent).slice(0, 1_000);
  const expectedContextRevision = normalizeContextText(plan.expectedContextRevision).slice(0, 128);
  const expectedTimelineRevision = normalizeContextText(plan.expectedTimelineRevision).slice(0, 128);
  if (!projectId || !intent || !expectedContextRevision || !expectedTimelineRevision) {
    throw new Error("plan requires projectId, intent, expectedContextRevision, and expectedTimelineRevision");
  }
  if (!Array.isArray(plan.candidates) || plan.candidates.length > MAX_EDITORIAL_CANDIDATES) {
    throw new Error(`plan.candidates must contain at most ${MAX_EDITORIAL_CANDIDATES} entries`);
  }
  if (!Array.isArray(plan.recommendations) || !plan.recommendations.length || plan.recommendations.length > MAX_ORGANIZATION_RULES) {
    throw new Error(`plan.recommendations must contain between 1 and ${MAX_ORGANIZATION_RULES} entries`);
  }
  if (plan.applied !== false) throw new Error("editorial plans are preview-only and must have applied: false");

  const candidates = plan.candidates.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || !normalizeContextText(candidate.evidenceId)) {
      throw new Error(`plan.candidates[${index}] requires evidenceId`);
    }
    return {
      ...candidate,
      evidenceId: normalizeContextText(candidate.evidenceId).slice(0, 128),
      name: normalizeContextText(candidate.name).slice(0, 512),
      kind: candidate.kind as ProjectContextKind,
      score: Number.isFinite(candidate.score) ? Number(candidate.score) : 0,
      matchedTerms: normalizeContextKeywords(candidate.matchedTerms),
    };
  });
  const evidenceIds = new Set(candidates.map((candidate) => candidate.evidenceId));
  const recommendations = plan.recommendations.map((recommendation, index) => {
    if (!recommendation || typeof recommendation !== "object") throw new Error(`plan.recommendations[${index}] must be an object`);
    if (!normalizeContextText(recommendation.id) || !normalizeContextText(recommendation.route)) {
      throw new Error(`plan.recommendations[${index}] requires id and route`);
    }
    if (recommendation.mutatesProject !== false || recommendation.requiresReview !== true) {
      throw new Error(`plan.recommendations[${index}] must remain review-only`);
    }
    for (const evidenceId of recommendation.candidateEvidenceIds ?? []) {
      if (!evidenceIds.has(evidenceId)) throw new Error(`plan.recommendations[${index}] references unknown evidenceId: ${evidenceId}`);
    }
    return recommendation;
  });
  if (!Array.isArray(plan.limitations) || !plan.limitations.length) throw new Error("plan.limitations must not be empty");

  return {
    schemaVersion: EDITORIAL_PLAN_SCHEMA_VERSION,
    projectId,
    workflow,
    intent,
    expectedContextRevision,
    expectedTimelineRevision,
    candidates,
    recommendations,
    limitations: plan.limitations.map((value) => normalizeContextText(value).slice(0, 2_000)).filter(Boolean),
    applied: false,
  } as EditorialPlan;
}
