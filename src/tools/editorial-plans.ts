import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  buildEditorialPlan,
  validateEditorialPlan,
  type EditorialPlan,
  type EditorialWorkflow,
  type OrganizationRule,
  type PlatformCutdownTarget,
} from "../ai/editorial-plan.js";
import type { UxpWebSocketBridge } from "../bridge/uxp-websocket-bridge.js";
import { ProjectContextRepository } from "../context/project-context-store.js";

export interface EditorialPlanToolDependencies {
  repository?: ProjectContextRepository;
  uxpBridge?: UxpWebSocketBridge;
}

interface OrganizationSourceGuard {
  evidenceId: string;
  projectItemId: string;
  expectedParentId: string;
}

interface ResolvedOrganizationOperation {
  recommendationId: string;
  destinationBinId?: string;
  parentBinId?: string;
  proposedBinName: string;
  proposedColorIndex?: number;
  sourceGuards: OrganizationSourceGuard[];
}

const MAX_ORGANIZATION_APPLICATIONS = 16;
const MAX_ORGANIZATION_SOURCE_GUARDS = 64;
const MAX_ISSUED_EDITORIAL_PLANS = 128;

interface IssuedEditorialPlan {
  plan: EditorialPlan;
  confirmationToken?: string;
}

type OrganizationAction = "create_bin" | "move" | "set_color";

interface VerifiedOrganizationAction {
  recommendationId: string;
  action: OrganizationAction;
  projectItemId?: string;
  verified: true;
}

interface UnverifiedOrganizationAttempt {
  recommendationId: string;
  action: OrganizationAction;
  projectItemId?: string;
  verified: false;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function projectId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("project_id is required");
  return value.trim();
}

function requiredText(value: unknown, field: string, maxLength = 512): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${field} must be at most ${maxLength} characters`);
  return normalized;
}

function optionalText(value: unknown, field: string, maxLength = 512): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, field, maxLength);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * A UXP mutation may claim success only when the panel returned the documented
 * readback contract for that exact command. A bare `verified: true` is not
 * enough: it would turn a malformed or stale panel response into a false
 * successful editorial workflow.
 *
 * This validates a panel response, not a licensed Premiere host. The latter
 * remains a separate release gate.
 */
function verifiedReadback(value: unknown, boundary: string): Record<string, unknown> | undefined {
  const result = objectValue(value);
  const operation = objectValue(result?.operation);
  const verification = objectValue(operation?.verification);
  const evidence = verification?.evidence;
  const hasMatchingEvidence = Array.isArray(evidence) && evidence.some((entry) => {
    const item = objectValue(entry);
    return item?.type === boundary && item.verified === true;
  });
  if (
    result?.verified !== true
    || result.outcome !== "verified"
    || result.verificationBoundary !== boundary
    || verification?.status !== "verified"
    || verification.boundary !== boundary
    || !hasMatchingEvidence
  ) {
    return undefined;
  }
  return result;
}

function createdBinId(value: unknown): string | undefined {
  const result = objectValue(value);
  const itemRecord = objectValue(result?.item);
  if (!itemRecord) return undefined;
  const id = itemRecord.id ?? itemRecord.projectItemId;
  return textValue(id);
}

function verifiedCreatedBin(value: unknown): string | undefined {
  const result = verifiedReadback(value, "bin_child_id_readback");
  if (!result || result.created !== true) return undefined;
  return createdBinId(result);
}

function verifiedMove(value: unknown, destinationBinId: string): boolean {
  const result = verifiedReadback(value, "project_item_parent_readback");
  const after = objectValue(result?.after);
  return result?.moved === true
    && textValue(result.destinationBinId) === destinationBinId
    && textValue(after?.parentId) === destinationBinId;
}

function verifiedColor(value: unknown, colorIndex: number): boolean {
  const result = verifiedReadback(value, "project_item_color_readback");
  const after = objectValue(result?.after);
  return result?.updated === true && after?.colorLabelIndex === colorIndex;
}

function childOperationId(operationId: string, action: string, stableId: string): string {
  const digest = createHash("sha256").update(`${operationId}:${action}:${stableId}`).digest("hex").slice(0, 16);
  return `${operationId}:${action}:${digest}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "\"__undefined__\"";
}

function planFingerprint(plan: EditorialPlan): string {
  return createHash("sha256").update(stableJson(plan)).digest("hex");
}

function issuePlan(issuedPlans: Map<string, IssuedEditorialPlan>, plan: EditorialPlan): void {
  const serverPlan = structuredClone(plan);
  const fingerprint = planFingerprint(serverPlan);
  const existing = issuedPlans.get(fingerprint);
  if (existing && isDeepStrictEqual(existing.plan, serverPlan)) return;
  if (issuedPlans.size >= MAX_ISSUED_EDITORIAL_PLANS) {
    const oldestFingerprint = issuedPlans.keys().next().value;
    if (oldestFingerprint) issuedPlans.delete(oldestFingerprint);
  }
  issuedPlans.set(fingerprint, { plan: serverPlan });
}

/**
 * Plans are returned to clients for review, but only an exact, server-issued
 * plan can be previewed or applied. The hash is an internal map index only;
 * deep equality against the stored server plan is the authority check.
 */
function requireIssuedPlan(issuedPlans: ReadonlyMap<string, IssuedEditorialPlan>, plan: EditorialPlan): IssuedEditorialPlan {
  const issued = issuedPlans.get(planFingerprint(plan));
  if (!issued || !isDeepStrictEqual(issued.plan, plan)) {
    throw new Error("Editorial plan was not issued by this server instance or its contents changed; create and preview a new plan");
  }
  return issued;
}

function confirmationTokenMatches(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function resolveOrganizationOperations(plan: EditorialPlan, value: unknown): ResolvedOrganizationOperation[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_ORGANIZATION_APPLICATIONS) {
    throw new Error(`organization_operations must contain between 1 and ${MAX_ORGANIZATION_APPLICATIONS} entries`);
  }
  const recommendations = new Map(plan.recommendations
    .filter((recommendation) => recommendation.kind === "organize_source")
    .map((recommendation) => [recommendation.id, recommendation]));
  const candidates = new Map(plan.candidates.map((candidate) => [candidate.evidenceId, candidate]));
  const seenRecommendations = new Set<string>();
  const seenEvidence = new Set<string>();
  const seenProjectItemIds = new Set<string>();
  let sourceGuardCount = 0;

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`organization_operations[${index}] must be an object`);
    }
    const raw = entry as Record<string, unknown>;
    const recommendationId = requiredText(raw.recommendation_id, `organization_operations[${index}].recommendation_id`, 128);
    if (seenRecommendations.has(recommendationId)) throw new Error(`organization_operations contains duplicate recommendation_id: ${recommendationId}`);
    seenRecommendations.add(recommendationId);
    const recommendation = recommendations.get(recommendationId);
    if (!recommendation) throw new Error(`organization_operations[${index}] must reference an organize_source recommendation`);
    const proposedBinName = requiredText(recommendation.details.proposedBinName, `plan recommendation ${recommendationId}.details.proposedBinName`, 255);
    const proposedColorIndex = recommendation.details.proposedColorIndex;
    if (proposedColorIndex !== undefined && (!Number.isInteger(proposedColorIndex) || typeof proposedColorIndex !== "number" || proposedColorIndex < 0 || proposedColorIndex > 14)) {
      throw new Error(`plan recommendation ${recommendationId} has an invalid proposedColorIndex`);
    }
    const destinationBinId = optionalText(raw.destination_bin_id, `organization_operations[${index}].destination_bin_id`);
    const parentBinId = optionalText(raw.parent_bin_id, `organization_operations[${index}].parent_bin_id`);
    if (!Array.isArray(raw.source_guards) || !raw.source_guards.length) {
      throw new Error(`organization_operations[${index}].source_guards must contain at least one source guard`);
    }
    sourceGuardCount += raw.source_guards.length;
    if (sourceGuardCount > MAX_ORGANIZATION_SOURCE_GUARDS) {
      throw new Error(`organization_operations may contain at most ${MAX_ORGANIZATION_SOURCE_GUARDS} source guards`);
    }
    const sourceGuards = raw.source_guards.map((guard, guardIndex) => {
      if (!guard || typeof guard !== "object" || Array.isArray(guard)) {
        throw new Error(`organization_operations[${index}].source_guards[${guardIndex}] must be an object`);
      }
      const rawGuard = guard as Record<string, unknown>;
      const evidenceId = requiredText(rawGuard.evidence_id, `organization_operations[${index}].source_guards[${guardIndex}].evidence_id`, 128);
      if (seenEvidence.has(evidenceId)) throw new Error(`organization_operations contains duplicate evidence_id: ${evidenceId}`);
      seenEvidence.add(evidenceId);
      const candidate = candidates.get(evidenceId);
      if (!recommendation.candidateEvidenceIds.includes(evidenceId) || candidate?.kind !== "source") {
        throw new Error(`organization_operations[${index}].source_guards[${guardIndex}] must reference a source selected by its recommendation`);
      }
      const projectItemId = requiredText(rawGuard.project_item_id, `organization_operations[${index}].source_guards[${guardIndex}].project_item_id`);
      if (seenProjectItemIds.has(projectItemId)) {
        throw new Error(`organization_operations contains duplicate project_item_id: ${projectItemId}`);
      }
      seenProjectItemIds.add(projectItemId);
      if (candidate.sourceId !== projectItemId) {
        throw new Error(`organization_operations[${index}].source_guards[${guardIndex}].project_item_id must match the planned source ID`);
      }
      return {
        evidenceId,
        projectItemId,
        expectedParentId: requiredText(rawGuard.expected_parent_id, `organization_operations[${index}].source_guards[${guardIndex}].expected_parent_id`),
      };
    });
    return {
      recommendationId,
      ...(destinationBinId ? { destinationBinId } : {}),
      ...(parentBinId ? { parentBinId } : {}),
      proposedBinName,
      ...(proposedColorIndex === undefined ? {} : { proposedColorIndex }),
      sourceGuards,
    };
  });
}

async function revalidatePlan(
  repository: ProjectContextRepository,
  plan: EditorialPlan,
): Promise<string | undefined> {
  const document = await repository.get(plan.projectId);
  if (!document) return "Project context not found; capture it before previewing an editorial plan";
  if (document.revision !== plan.expectedContextRevision || document.timelineRevision !== plan.expectedTimelineRevision) {
    return "Editorial plan is stale; capture project context and create a new plan before reviewing or mutating Premiere";
  }
  const activeEvidence = new Set(document.records.map((record) => record.id));
  const missingEvidence = plan.candidates.map((candidate) => candidate.evidenceId).filter((id) => !activeEvidence.has(id));
  return missingEvidence.length ? `Editorial plan references unavailable evidence: ${missingEvidence.join(", ")}` : undefined;
}

export function getEditorialPlanTools(dependencies: EditorialPlanToolDependencies = {}) {
  const repository = dependencies.repository ?? new ProjectContextRepository();
  const issuedPlans = new Map<string, IssuedEditorialPlan>();
  const tools = {
    create_editorial_plan: {
      description: "Create a local, evidence-backed editorial workflow plan from captured project context. It never calls an LLM, uploads media, or changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          project_id: { type: "string", minLength: 1, maxLength: 512, description: "Project context ID returned by manage_project_context capture." },
          workflow: { type: "string", enum: ["organize", "stringout", "rough_cut", "caption_review", "platform_cutdown"], description: "The workflow to plan. Every workflow remains review-only." },
          intent: { type: "string", minLength: 1, maxLength: 1000, description: "The editorial goal used to retrieve relevant local evidence." },
          sequence_id: { type: "string", minLength: 1, maxLength: 128, description: "Optional exact sequence ID filter for evidence retrieval." },
          max_candidates: { type: "integer", minimum: 1, maximum: 32, description: "Maximum evidence candidates to include; defaults to 8." },
          organization_rules: {
            type: "array",
            maxItems: 16,
            description: "Required only for organize. Rules are supplied by the editor or MCP client; the server does not infer categories from filenames alone.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string", minLength: 1, maxLength: 255 },
                keywords: { type: "array", minItems: 1, maxItems: 64, items: { type: "string", minLength: 1, maxLength: 512 } },
                color_index: { type: "integer", minimum: 0, maximum: 14 },
              },
              required: ["name", "keywords"],
            },
          },
          platform_targets: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            description: "Required only for platform_cutdown. These are proposed derivative sequence dimensions; this tool does not create or reframe a sequence.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string", minLength: 1, maxLength: 64 },
                width: { type: "integer", minimum: 16, maximum: 8192 },
                height: { type: "integer", minimum: 16, maximum: 8192 },
                sequence_name: { type: "string", minLength: 1, maxLength: 255 },
                include_captions: { type: "boolean" },
              },
              required: ["name", "width", "height"],
            },
          },
        },
        required: ["project_id", "workflow", "intent"],
      },
      handler: async (args: {
        project_id: string;
        workflow: EditorialWorkflow;
        intent: string;
        sequence_id?: string;
        max_candidates?: number;
        organization_rules?: OrganizationRule[];
        platform_targets?: Array<{
          name: string;
          width: number;
          height: number;
          sequence_name?: string;
          include_captions?: boolean;
        }>;
      }) => {
        const document = await repository.get(projectId(args.project_id));
        if (!document) return { success: false, error: "Project context not found; capture it before creating an editorial plan" };
        try {
          const plan = buildEditorialPlan(document, {
            workflow: args.workflow,
            intent: args.intent,
            ...(args.sequence_id ? { sequenceId: args.sequence_id } : {}),
            ...(args.max_candidates === undefined ? {} : { maxCandidates: args.max_candidates }),
            ...(args.organization_rules === undefined ? {} : { organizationRules: args.organization_rules }),
            ...(args.platform_targets === undefined ? {} : {
              platformTargets: args.platform_targets.map((target): PlatformCutdownTarget => ({
                name: target.name,
                width: target.width,
                height: target.height,
                ...(target.sequence_name === undefined ? {} : { sequenceName: target.sequence_name }),
                ...(target.include_captions === undefined ? {} : { includeCaptions: target.include_captions }),
              })),
            }),
          });
          issuePlan(issuedPlans, plan);
          return { success: true, data: plan };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
    preview_editorial_plan: {
      description: "Revalidate an exact server-issued editorial plan against the saved project-context revisions and return an opaque confirmation token. This tool is read-only and cannot apply the plan.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          plan: { type: "object", description: "Unchanged plan returned by create_editorial_plan from this running server instance." },
        },
        required: ["plan"],
      },
      handler: async (args: { plan: unknown }) => {
        try {
          const plan = validateEditorialPlan(args.plan);
          const issuedPlan = requireIssuedPlan(issuedPlans, plan);
          const error = await revalidatePlan(repository, plan);
          if (error) return { success: false, error };
          issuedPlan.confirmationToken ??= randomBytes(32).toString("base64url");
          return {
            success: true,
            data: {
              applied: false,
              confirmationToken: issuedPlan.confirmationToken,
              workflow: plan.workflow,
              expectedContextRevision: plan.expectedContextRevision,
              expectedTimelineRevision: plan.expectedTimelineRevision,
              recommendationCount: plan.recommendations.length,
              nextSteps: [
                "Review each recommendation and resolve stable Premiere IDs.",
                "Capture project context again immediately before a mutation.",
                "Use the route named in the recommendation; each mutation has its own authority and host verification boundary.",
              ],
            },
          };
        } catch (error) {
          return { success: false, error: errorMessage(error) };
        }
      },
    },
  };

  if (!dependencies.uxpBridge) return tools;
  const bridge = dependencies.uxpBridge;
  return {
    ...tools,
    apply_editorial_organization_plan: {
      description: "Apply selected organization recommendations through documented UXP bin transactions only. Requires the unchanged server-issued plan, its opaque preview confirmation token, and stable source/parent guards; individual host transactions may be partially committed and are never silently retried or rolled back.",
      operationalCapability: {
        backend: "orchestrator" as const,
        backends: ["orchestrator" as const],
        status: "limited" as const,
        minimumPremiereVersion: "25.6",
        authority: "edit" as const,
        verificationBoundary: "structured_uxp_readback" as const,
        hostVerificationRequired: true,
        notes: [
          "Available only when the authenticated UXP bridge is registered; it never falls back to CEP or QE.",
          "Coordinates independently committed UXP bin transactions. A failure after an earlier transaction is reported as partial and is not automatically rolled back.",
          "Stops after any mutation that lacks the command-specific UXP readback contract; automated contract coverage is not licensed-host evidence.",
        ],
      },
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          plan: { type: "object", description: "Unchanged organize plan returned by create_editorial_plan from this running server instance." },
          confirmation_token: { type: "string", minLength: 1, maxLength: 256, description: "Opaque confirmationToken returned by preview_editorial_plan for this unchanged server-issued plan." },
          operation_id: { type: "string", minLength: 1, maxLength: 64, description: "Caller-supplied idempotency/audit identifier used to derive individual UXP transaction IDs." },
          organization_operations: {
            type: "array",
            minItems: 1,
            maxItems: 16,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                recommendation_id: { type: "string", minLength: 1, maxLength: 128 },
                destination_bin_id: { type: "string", minLength: 1, maxLength: 512, description: "An existing destination bin. Omit to create the plan's proposed bin name." },
                parent_bin_id: { type: "string", minLength: 1, maxLength: 512, description: "Optional parent for a newly created destination bin; omit for the project root." },
                source_guards: {
                  type: "array",
                  minItems: 1,
                  maxItems: 64,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      evidence_id: { type: "string", minLength: 1, maxLength: 128 },
                      project_item_id: { type: "string", minLength: 1, maxLength: 512 },
                      expected_parent_id: { type: "string", minLength: 1, maxLength: 512 },
                    },
                    required: ["evidence_id", "project_item_id", "expected_parent_id"],
                  },
                },
              },
              required: ["recommendation_id", "source_guards"],
            },
          },
        },
        required: ["plan", "confirmation_token", "operation_id", "organization_operations"],
      },
      handler: async (args: {
        plan: unknown;
        confirmation_token: unknown;
        operation_id: unknown;
        organization_operations: unknown;
      }) => {
        try {
          const plan = validateEditorialPlan(args.plan);
          if (plan.workflow !== "organize") throw new Error("apply_editorial_organization_plan only accepts an organize workflow plan");
          const issuedPlan = requireIssuedPlan(issuedPlans, plan);
          const confirmationToken = requiredText(args.confirmation_token, "confirmation_token", 256);
          if (!issuedPlan.confirmationToken || !confirmationTokenMatches(confirmationToken, issuedPlan.confirmationToken)) {
            throw new Error("confirmation_token must be the exact opaque token returned by preview_editorial_plan for this server-issued plan");
          }
          const operationId = requiredText(args.operation_id, "operation_id", 64);
          const revalidationError = await revalidatePlan(repository, plan);
          if (revalidationError) return { success: false, error: revalidationError };
          const operations = resolveOrganizationOperations(plan, args.organization_operations);
          const committed: VerifiedOrganizationAction[] = [];
          const unverifiedAttempts: UnverifiedOrganizationAttempt[] = [];

          try {
            for (const operation of operations) {
              let destinationBinId = operation.destinationBinId;
              if (!destinationBinId) {
                let result: unknown;
                try {
                  result = await bridge.request("bins.create", {
                    ...(operation.parentBinId ? { parentBinId: operation.parentBinId } : {}),
                    name: operation.proposedBinName,
                    makeUnique: true,
                    operationId: childOperationId(operationId, "create", operation.recommendationId),
                  });
                } catch (error) {
                  unverifiedAttempts.push({ recommendationId: operation.recommendationId, action: "create_bin", verified: false });
                  throw error;
                }
                destinationBinId = verifiedCreatedBin(result);
                if (!destinationBinId) {
                  unverifiedAttempts.push({ recommendationId: operation.recommendationId, action: "create_bin", verified: false });
                  throw new Error("UXP bins.create did not return the required verified stable-bin readback");
                }
                committed.push({ recommendationId: operation.recommendationId, action: "create_bin", verified: true });
              }
              for (const guard of operation.sourceGuards) {
                let moveResult: unknown;
                try {
                  moveResult = await bridge.request("bins.move", {
                    projectItemId: guard.projectItemId,
                    destinationBinId,
                    expectedParentId: guard.expectedParentId,
                    operationId: childOperationId(operationId, "move", guard.evidenceId),
                  });
                } catch (error) {
                  unverifiedAttempts.push({ recommendationId: operation.recommendationId, action: "move", projectItemId: guard.projectItemId, verified: false });
                  throw error;
                }
                const moveVerified = verifiedMove(moveResult, destinationBinId);
                if (!moveVerified) {
                  unverifiedAttempts.push({ recommendationId: operation.recommendationId, action: "move", projectItemId: guard.projectItemId, verified: false });
                  throw new Error("UXP bins.move did not return the required verified destination-parent readback");
                }
                committed.push({ recommendationId: operation.recommendationId, action: "move", projectItemId: guard.projectItemId, verified: true });
                if (operation.proposedColorIndex !== undefined) {
                  let colorResult: unknown;
                  try {
                    colorResult = await bridge.request("bins.color", {
                      projectItemId: guard.projectItemId,
                      colorIndex: operation.proposedColorIndex,
                      operationId: childOperationId(operationId, "color", guard.evidenceId),
                    });
                  } catch (error) {
                    unverifiedAttempts.push({ recommendationId: operation.recommendationId, action: "set_color", projectItemId: guard.projectItemId, verified: false });
                    throw error;
                  }
                  const colorVerified = verifiedColor(colorResult, operation.proposedColorIndex);
                  if (!colorVerified) {
                    unverifiedAttempts.push({ recommendationId: operation.recommendationId, action: "set_color", projectItemId: guard.projectItemId, verified: false });
                    throw new Error("UXP bins.color did not return the required verified color-label readback");
                  }
                  committed.push({ recommendationId: operation.recommendationId, action: "set_color", projectItemId: guard.projectItemId, verified: true });
                }
              }
            }
          } catch (error) {
            const hasVerifiedCommit = committed.length > 0;
            if (!hasVerifiedCommit) {
              const attemptedActions = unverifiedAttempts.map((attempt) => attempt.action).join(", ");
              return {
                success: false,
                error: `${errorMessage(error)} No project change was verified; inspect Premiere before retrying because the attempted UXP action${unverifiedAttempts.length === 1 ? "" : "s"} (${attemptedActions}) may have reached the host.`,
              };
            }
            return {
              success: true,
              data: {
                applied: true,
                outcome: "partial",
                verified: false,
                committedActions: committed,
                unverifiedAttempts,
                error: errorMessage(error),
                nextSteps: ["Inspect project items and decide whether to undo the verified completed host transactions.", "Capture project context again before retrying with a new reviewed plan."],
              },
            };
          }

          return {
            success: true,
            data: {
              applied: true,
              outcome: "verified",
              verified: true,
              committedActions: committed,
              nextSteps: ["Inspect the project organization in Premiere before continuing editorial work."],
            },
          };
        } catch (error) {
          return { success: false, error: errorMessage(error) };
        }
      },
    },
  };
}
