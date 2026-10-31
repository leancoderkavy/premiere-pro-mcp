import { describe, expect, it } from "vitest";
import { mutationReceipt } from "../../src/workflows/mutation-receipt.js";

const tools = ["overwrite_clip", "set_clip_properties_batch", "setup_ducking", "copy_effects_between_clips", "create_sequence", "set_sequence_frame_rate", "set_sequence_settings", "add_tracks", "import_media", "add_keyframe", "remove_from_timeline", "delete_multiple_project_items", "import_ae_comps"];
describe("audited handler receipt evidence", () => {
  it.each(tools)("honors successful %s readback", name => {
    expect(mutationReceipt(true, { verified: true }, { dispatched: true }, name)).toMatchObject({ outcome: "verified", verification: { boundary: "handler_declared_readback; see tool evidence", renderVerified: false } });
  });
  it.each(tools)("keeps failed or absent %s evidence conservative", name => {
    expect(mutationReceipt(true, { verified: false }, { dispatched: true }, name).outcome).toBe("committed_unverified");
    expect(mutationReceipt(true, {}, { dispatched: true }, name).outcome).toBe("committed_unverified");
    expect(mutationReceipt(false, { verified: true }, { dispatched: true }, name).outcome).toBe("unknown");
    for (const outcome of ["committed_unverified", "unknown", "not_applied", "committed"]) {
      expect(mutationReceipt(true, { verified: true, outcome }, { dispatched: true }, name).outcome).toBe(outcome);
    }
    expect(mutationReceipt(true, { verified: true, outcome: "verified", mutationOutcome: "unknown" }, { dispatched: true }, name).outcome).toBe("unknown");
    expect(mutationReceipt(true, { verified: true, recoveryRequired: true }, { dispatched: true }, name).outcome).toBe("unknown");
  });
  it("does not trust an unaudited handler flag or erase a declared boundary", () => {
    expect(mutationReceipt(true, { verified: true }, { dispatched: true }, "unreviewed_write").outcome).toBe("committed_unverified");
    expect(mutationReceipt(true, { verified: true, verificationScope: "bin item-count increase only" }, { dispatched: true }, "import_ae_comps").verification.boundary).toBe("bin item-count increase only");
  });
});
