import {
  buildEditorialPlan,
  editorialPlanConfirmationToken,
  validateEditorialPlan,
  type EditorialWorkflow,
  type OrganizationRule,
} from "../ai/editorial-plan.js";
import { ProjectContextRepository } from "../context/project-context-store.js";

export interface EditorialPlanToolDependencies {
  repository?: ProjectContextRepository;
}

function projectId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("project_id is required");
  return value.trim();
}

export function getEditorialPlanTools(dependencies: EditorialPlanToolDependencies = {}) {
  const repository = dependencies.repository ?? new ProjectContextRepository();
  return {
    create_editorial_plan: {
      description: "Create a local, evidence-backed editorial workflow plan from captured project context. It never calls an LLM, uploads media, or changes Premiere.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          project_id: { type: "string", minLength: 1, maxLength: 512, description: "Project context ID returned by manage_project_context capture." },
          workflow: { type: "string", enum: ["organize", "stringout", "rough_cut", "caption_review"], description: "The workflow to plan. Every workflow remains review-only." },
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
          const document = await repository.get(plan.projectId);
          if (!document) return { success: false, error: "Project context not found; capture it before previewing an editorial plan" };
          if (document.revision !== plan.expectedContextRevision || document.timelineRevision !== plan.expectedTimelineRevision) {
            return {
              success: false,
              error: "Editorial plan is stale; capture project context and create a new plan before reviewing or mutating Premiere",
            };
          }
          const activeEvidence = new Set(document.records.map((record) => record.id));
          const missingEvidence = plan.candidates.map((candidate) => candidate.evidenceId).filter((id) => !activeEvidence.has(id));
          if (missingEvidence.length) {
            return { success: false, error: `Editorial plan references unavailable evidence: ${missingEvidence.join(", ")}` };
          }
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
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },
  };
}
