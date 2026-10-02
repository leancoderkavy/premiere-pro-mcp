import type { EditPlanTokenStore } from "../../src/tools/edit-plan-token-store.js";

/** Keeps unrelated script tests focused on their host behavior. */
export const staticEditPlanTokenStore: EditPlanTokenStore = {
  issue: (digest) => digest,
  consume: (token, digest) => {
    if (token !== digest) throw new Error("Confirmation token does not match this edit plan; preview it again");
  },
};
