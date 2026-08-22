import { createHash } from "node:crypto";
import {
  buildEditorialPlan,
  editorialPlanConfirmationToken,
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

function verifiedHostResult(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return result.verified === true || result.outcome === "verified";
}

function createdBinId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result = value as Record<string, unknown>;
  const item = result.item;
  if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
  const itemRecord = item as Record<string, unknown>;
  const id = itemRecord.id ?? itemRecord.projectItemId;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

function childOperationId(operationId: string, action: string, stableId: string): string {
  const digest = createHash("sha256").update(`${operationId}:${action}:${stableId}`).digest("hex").slice(0, 16);
  return `${operationId}:${action}:${digest}`;
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
    const seenEvidence = new Set<string>();
    const sourceGuards = raw.source_guards.map((guard, guardIndex) => {
      if (!guard || typeof guard !== "object" || Array.isArray(guard)) {
        throw new Error(`organization_operations[${index}].source_guards[${guardIndex}] must be an object`);
      }
      const rawGuard = guard as Record<string, unknown>;
      const evidenceId = requiredText(rawGuard.evidence_id, `organization_operations[${index}].source_guards[${guardIndex}].evidence_id`, 128);
      if (seenEvidence.has(evidenceId)) throw new Error(`organization_operations[${index}] contains duplicate evidence_id: ${evidenceId}`);
      seenEvidence.add(evidenceId);
      const candidate = candidates.get(evidenceId);
      if (!recommendation.candidateEvidenceIds.includes(evidenceId) || candidate?.kind !== "source") {
        throw new Error(`organization_operations[${index}].source_guards[${guardIndex}] must reference a source selected by its recommendation`);
      }
      const projectItemId = requiredText(rawGuard.project_item_id, `organization_operations[${index}].source_guards[${guardIndex}].project_item_id`);
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
          return { success: true, data: buildEditorialPlan(document, {
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
          }) };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
    preview_editorial_plan: {
      description: "Revalidate an editorial plan against the saved project-context revisions and return a confirmation token. This tool is read-only and cannot apply the plan.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          plan: { type: "object", description: "Exact plan returned by create_editorial_plan." },
        },
        required: ["plan"],
      },
      handler: async (args: { plan: unknown }) => {
        try {
          const plan = validateEditorialPlan(args.plan);
          const error = await revalidatePlan(repository, plan);
          if (error) return { success: false, error };
          return {
            success: true,
            data: {
              applied: false,
              confirmationToken: editorialPlanConfirmationToken(plan),
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
      description: "Apply selected organization recommendations through documented UXP bin transactions only. Requires the exact preview confirmation token and stable source/parent guards; individual host transactions may be partially committed and are never silently retried or rolled back.",
      operationalCapability: {
        backend: "orchestrator" as const,
        backends: ["orchestrator" as const],
        status: "limited" as const,
        minimumPremiereVersion: "25.6",
        authority: "edit" as const,
        verificationBoundary: "bridge_response" as const,
        hostVerificationRequired: true,
        notes: [
          "Available only when the authenticated UXP bridge is registered; it never falls back to CEP or QE.",
          "Coordinates independently committed UXP bin transactions. A failure after an earlier transaction is reported as partial and is not automatically rolled back.",
        ],
      },
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          plan: { type: "object", description: "Exact organize plan returned by create_editorial_plan." },
          confirmation_token: { type: "string", minLength: 1, maxLength: 256, description: "Exact confirmationToken returned by preview_editorial_plan for this unchanged plan." },
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
          const confirmationToken = requiredText(args.confirmation_token, "confirmation_token", 256);
          if (confirmationToken !== editorialPlanConfirmationToken(plan)) throw new Error("confirmation_token does not match this exact editorial plan");
          const operationId = requiredText(args.operation_id, "operation_id", 64);
          const revalidationError = await revalidatePlan(repository, plan);
          if (revalidationError) return { success: false, error: revalidationError };
          const operations = resolveOrganizationOperations(plan, args.organization_operations);
          const committed: Array<{ recommendationId: string; action: "create_bin" | "move" | "set_color"; projectItemId?: string; verified: boolean }> = [];

          try {
            for (const operation of operations) {
              let destinationBinId = operation.destinationBinId;
              if (!destinationBinId) {
                const result = await bridge.request("bins.create", {
                  ...(operation.parentBinId ? { parentBinId: operation.parentBinId } : {}),
                  name: operation.proposedBinName,
                  makeUnique: true,
                  operationId: childOperationId(operationId, "create", operation.recommendationId),
                });
                committed.push({ recommendationId: operation.recommendationId, action: "create_bin", verified: verifiedHostResult(result) });
                destinationBinId = createdBinId(result);
                if (!destinationBinId) throw new Error("UXP bins.create did not return a stable destination bin ID");
              }
              for (const guard of operation.sourceGuards) {
                const moveResult = await bridge.request("bins.move", {
                  projectItemId: guard.projectItemId,
                  destinationBinId,
                  expectedParentId: guard.expectedParentId,
                  operationId: childOperationId(operationId, "move", guard.evidenceId),
                });
                committed.push({ recommendationId: operation.recommendationId, action: "move", projectItemId: guard.projectItemId, verified: verifiedHostResult(moveResult) });
                if (operation.proposedColorIndex !== undefined) {
                  const colorResult = await bridge.request("bins.color", {
                    projectItemId: guard.projectItemId,
                    colorIndex: operation.proposedColorIndex,
                    operationId: childOperationId(operationId, "color", guard.evidenceId),
                  });
                  committed.push({ recommendationId: operation.recommendationId, action: "set_color", projectItemId: guard.projectItemId, verified: verifiedHostResult(colorResult) });
                }
              }
            }
          } catch (error) {
            if (!committed.length) return { success: false, error: errorMessage(error) };
            return {
              success: true,
              data: {
                applied: true,
                outcome: "partial",
                verified: false,
                committedActions: committed,
                error: errorMessage(error),
                nextSteps: ["Inspect project items and decide whether to undo the completed host transactions.", "Capture project context again before retrying with a new reviewed plan."],
              },
            };
          }

          const verified = committed.length > 0 && committed.every((entry) => entry.verified);
          return {
            success: true,
            data: {
              applied: true,
              outcome: verified ? "verified" : "applied_unverified",
              verified,
              committedActions: committed,
              nextSteps: verified
                ? ["Inspect the project organization in Premiere before continuing editorial work."]
                : ["Inspect the project organization in Premiere; one or more host responses lacked a verified postcondition."],
            },
          };
        } catch (error) {
          return { success: false, error: errorMessage(error) };
        }
      },
    },
  };
}
