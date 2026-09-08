import { createHash } from "node:crypto";

const WORKFLOWS = ["ae_mogrt_to_premiere", "ae_render_to_premiere"] as const;
type Workflow = typeof WORKFLOWS[number];
type Step = {
  id: string;
  app: "after_effects" | "premiere" | "local";
  tool: string | null;
  instruction: string;
  approval: string | null;
  evidence_required: string;
};

const connection: Step = {
  id: "connect_ae", app: "after_effects", tool: "verify_after_effects_connection",
  instruction: "Verify the dedicated After Effects connector with a saved workspace-contained project open.",
  approval: null, evidence_required: "Successful connector response for the intended host; not proof that subsequent actions will succeed.",
};
const premiere: Step = {
  id: "connect_premiere", app: "premiere", tool: "verify_premiere_connection",
  instruction: "Verify the Premiere connector and inspect the intended target project before import.",
  approval: null, evidence_required: "Successful response from the intended Premiere host.",
};

function stepsFor(workflow: Workflow): Step[] {
  if (workflow === "ae_mogrt_to_premiere") return [
    connection,
    { id: "preview_creation", app: "local", tool: "preview_mogrt_recipe", instruction: "Choose a supported recipe and an existing approved workspace/output directory. Review the exact recipe and output path.", approval: null, evidence_required: "Fresh recipe preview and one-time previewToken." },
    { id: "create", app: "after_effects", tool: "create_mogrt_recipe", instruction: "Submit the recipe token only after approval of the exact preview.", approval: "confirm_export", evidence_required: "Successful creation response; retain its operation ID and actual artifact path." },
    { id: "verify_artifact", app: "local", tool: "verify_mogrt_artifact", instruction: "Check the actual created artifact before asking Premiere to import it.", approval: null, evidence_required: "Artifact exists and has a valid ZIP header. This does not establish MOGRT controls or visual correctness." },
    premiere,
    { id: "preview_import", app: "local", tool: "preview_mogrt_premiere_handoff", instruction: "Select the exact sequence ID, an empty track, and a disposable sequence named 'MOGRT Verify - …'. Review this separate handoff preview.", approval: null, evidence_required: "Fresh handoff preview for the verified artifact and exact target." },
    { id: "import", app: "premiere", tool: "apply_mogrt_premiere_handoff", instruction: "Submit the handoff token only after separate import approval. The host rechecks the disposable sequence and empty track.", approval: "confirm_import", evidence_required: "Successful insertion readback and returned control descriptors; retain operation ID." },
    { id: "visual_review", app: "premiere", tool: "capture_frame", instruction: "Capture a review frame from the imported template in the intended sequence and inspect it with the user.", approval: "Review the capture target and any required export authority.", evidence_required: "Rendered frame inspected for placement, text, and controls. Automated success alone is insufficient." },
  ];
  return [
    connection,
    { id: "templates", app: "after_effects", tool: "inspect_after_effects_render_templates", instruction: "Read template names from an existing render-queue item; if none exists, prepare one manually and inspect again.", approval: null, evidence_required: "Actual render-settings and output-module template names from this host." },
    { id: "preview_queue", app: "local", tool: "preview_after_effects_render", instruction: "Preview one named composition, the host template names, and a new output path inside the approved workspace.", approval: null, evidence_required: "Fresh queue preview; this does not verify the composition or create a render." },
    { id: "enqueue", app: "after_effects", tool: "enqueue_after_effects_render", instruction: "Approve the exact queue request, including saving the open After Effects project.", approval: "confirm_enqueue", evidence_required: "Successful enqueue receipt; queued is not rendered." },
    { id: "render", app: "after_effects", tool: null, instruction: "Stop for the operator to render the approved queue item in After Effects. This server does not start or monitor that render.", approval: "Operator approval and manual rendering required.", evidence_required: "Operator confirms the exact item finished successfully; do not infer completion from enqueue success." },
    { id: "verify_output", app: "local", tool: "verify_delivery_file", instruction: "Verify the actual output path after rendering, retaining its checksum and size.", approval: null, evidence_required: "Successful non-empty file verification; file presence does not prove render provenance or audiovisual quality." },
    premiere,
    { id: "import", app: "premiere", tool: "import_media", instruction: "Obtain explicit approval of the exact verified file and target bin, then import. This tool has no preview token and does not place a timeline clip.", approval: "Explicit user approval of file and target bin before invocation.", evidence_required: "Successful import response followed by independent project readback." },
    { id: "readback", app: "premiere", tool: "list_project_items", instruction: "List the approved target bin and match the imported item's mediaPath to the verified output; stop if its identity cannot be established. Review the media manually before a separately approved timeline edit.", approval: null, evidence_required: "Imported item identified in the intended project and media reviewed. No timeline placement or final-delivery claim." },
  ];
}

export function planCrossAppWorkflow(args: unknown) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  const input = args as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== "workflow")) throw new Error("Only workflow is accepted; plans cannot accept scripts, approvals, or completion claims");
  if (!WORKFLOWS.includes(input.workflow as Workflow)) throw new Error(`workflow must be one of: ${WORKFLOWS.join(", ")}`);
  const workflow = input.workflow as Workflow;
  const steps = stepsFor(workflow).map((step, index, all) => ({
    ...step, depends_on: index === 0 ? [] : [all[index - 1].id],
    status: "not_executed" as const,
    on_failure: "Stop this workflow. Inspect actual host and artifact state; do not replay completed mutations or claim rollback. Obtain a new preview and approval before retrying a mutation.",
  }));
  return {
    workflow, applied: false, execution_supported: false,
    plan_revision: `sha256:${createHash("sha256").update(JSON.stringify({ workflow, steps })).digest("hex")}`,
    next_step: steps[0].id,
    steps,
    required_tools: [...new Set(steps.flatMap(step => step.tool ? [step.tool] : []))],
    manual_steps: steps.filter(step => step.tool === null).map(step => step.id),
    boundaries: [
      "Planning only: no host, filesystem, process, or network calls; no tokens or approval are issued.",
      "Discover each required tool in this session and check its schema and authority before use. A route in this plan is not capability attestation.",
      "Execute serially. Each step requires its predecessor's actual evidence, not a caller-supplied success flag. This plan does not track or verify execution.",
      "Existing tools keep their own preview, authority, expiry, and receipt checks. Approval of one app's mutation never approves another app's mutation.",
      "No Photoshop, Illustrator, Audition, aerender, arbitrary script, automatic render, or cross-app rollback support is added.",
    ],
  };
}

export function getCrossAppWorkflowTools() {
  return {
    plan_cross_app_workflow: {
      description: "Plan an After Effects MOGRT or rendered-file handoff to Premiere using existing tools. Returns ordered dependencies, separate approvals, required evidence, and manual render stops. Local-only planning; never executes steps, issues approval tokens, or claims host readiness.",
      parameters: {
        type: "object" as const, additionalProperties: false,
        properties: { workflow: { type: "string", enum: [...WORKFLOWS], description: "Supported After Effects to Premiere handoff to plan." } },
        required: ["workflow"],
      },
      handler: async (args: unknown) => {
        try { return { success: true as const, data: planCrossAppWorkflow(args) }; }
        catch (error) { return { success: false as const, error: error instanceof Error ? error.message : String(error) }; }
      },
    },
  };
}
