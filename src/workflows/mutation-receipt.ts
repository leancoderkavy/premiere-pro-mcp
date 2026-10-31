import type { InvocationContext } from "./invocation-context.js";

export interface MutationReceipt {
  version: 1;
  dispatch: "not_dispatched" | "dispatched" | "accepted" | "unknown";
  outcome: "not_applied" | "committed" | "verified" | "committed_unverified" | "unknown";
  verification: { boundary: string; renderVerified: boolean };
  affectedTargets: unknown[];
  partialSteps: unknown[];
  outputEvidence: unknown | null;
  nextSafeAction: string;
}
// These handlers set verified only after observing their promised host postconditions.
// Explicit outcomes and unknown-state flags always take precedence.
const handlerReadbackTools = new Set([
  "overwrite_clip", "set_clip_properties_batch", "setup_ducking", "copy_effects_between_clips",
  "create_sequence", "set_sequence_frame_rate", "set_sequence_settings", "add_tracks",
  "import_media", "add_keyframe", "remove_from_timeline", "delete_multiple_project_items", "import_ae_comps",
]);

/** Add a common envelope without promoting handler success to verified mutation. */
export function mutationReceipt(success: boolean, value: unknown, context?: Pick<InvocationContext, "dispatched">, toolName?: string): MutationReceipt {
  const outer = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const data = outer.result && typeof outer.result === "object" && !Array.isArray(outer.result) ? outer.result as Record<string, unknown> : outer;
  // A generic "failed" says nothing about host state; the more specific
  // mutationOutcome (for example not_applied on a refusal) decides then.
  const raw = data.outcome === "failed" && data.mutationOutcome !== undefined ? data.mutationOutcome : data.outcome ?? data.mutationOutcome;
  const dispatched = context?.dispatched === true;
  const unknown = data.mutationOutcome === "unknown" || data.mutationOutcome === "unknown_outcome" || raw === "unknown" || raw === "unknown_outcome" || data.recoveryRequired === true || data.stateUnknown === true;
  const outcome: MutationReceipt["outcome"] = unknown ? "unknown"
    : raw === "verified" ? "verified"
    : raw === "committed" ? "committed"
    : raw === "committed_unverified" ? "committed_unverified"
    : raw === "not_applied" || data.dispatched === false ? "not_applied"
    : success && data.verified === true && toolName !== undefined && handlerReadbackTools.has(toolName) && raw === undefined ? "verified"
    : success ? (dispatched ? "committed_unverified" : "not_applied")
    : dispatched ? "unknown" : "not_applied";
  const array = (candidate: unknown) => Array.isArray(candidate) ? candidate.slice(0, 100) : [];
  return {
    version: 1,
    dispatch: unknown || outcome === "unknown" ? "unknown" : data.accepted === true || data.queued === true ? "accepted" : dispatched ? "dispatched" : "not_dispatched",
    outcome,
    verification: { boundary: typeof data.verificationScope === "string" ? data.verificationScope.slice(0, 512) : typeof data.verificationBoundary === "string" ? data.verificationBoundary : outcome === "verified" ? "handler_declared_readback; see tool evidence" : "no_shared_postcondition_proof", renderVerified: data.renderVerified === true },
    affectedTargets: array(data.affectedTargets ?? data.targets),
    partialSteps: array(data.partialSteps ?? data.steps),
    outputEvidence: data.outputEvidence ?? data.artifact ?? data.outputVerification ?? null,
    nextSafeAction: outcome === "unknown" ? "Inspect affected targets and reconcile this operation before any dependent edit; do not replay blindly."
      : outcome === "committed_unverified" || outcome === "committed" ? "Read back postconditions and validate relevant output before relying on completion."
      : outcome === "verified" ? "Use the declared evidence boundary; rendered behavior needs separate output proof." : "Fix preflight inputs before dispatch.",
  };
}
