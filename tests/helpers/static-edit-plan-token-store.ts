import type { EditPlanHostBinding, EditPlanTokenStore } from "../../src/tools/edit-plan-token-store.js";
import type { EditPlan } from "../../src/tools/edit-plans.js";

/** Explicit identities for bridge-mocked script tests, never used in production. */
export function fixtureEditPlanBinding(plan: EditPlan, sequenceId = "seq"): EditPlanHostBinding {
  return { version: 1, projectDocumentId: "test-project", sequenceId, targets: plan.operations.map((operation) => operation.type === "insert_clip"
    ? { type: "insert_clip", targetId: operation.item_id, videoTrackIndex: operation.video_track_index ?? 0, audioTrackIndex: operation.audio_track_index ?? 0 }
    : { type: "remove_clip", targetId: operation.node_id, sourceProjectItemId: "test-source", trackType: "video", trackIndex: 0, startTicks: "0", endTicks: "1" }) };
}
const bindings = new Map<string, EditPlanHostBinding>();
/** Keeps unrelated script tests focused on their host behavior, with explicit binding issuance. */
export const staticEditPlanTokenStore: EditPlanTokenStore = {
  issue: (digest, binding) => { bindings.set(digest, binding); return digest; },
  consume: (token, digest) => {
    if (token !== digest) throw new Error("Confirmation token does not match this edit plan; preview it again");
    const binding = bindings.get(digest);
    if (!binding) throw new Error("Test must issue an explicit fixture host binding before apply");
    return binding;
  },
};
