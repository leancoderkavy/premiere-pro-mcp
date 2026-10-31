import { describe, expect, it, vi } from "vitest";
import { createContext, runInContext } from "node:vm";
import { parse } from "acorn";
import { buildScript, getHelpersSource } from "../../src/bridge/script-builder.js";
import { runWithUndoTracking } from "../../src/bridge/undo-tracking.js";
import { runWithExpectedHostTarget } from "../../src/bridge/project-guard.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getTimelineTools } from "../../src/tools/timeline.js";

// One long-lived engine, as in the CEP panel: helper globals survive between commands.
function engine(undoIndex: { value: number | null }) {
  const context = createContext({
    app: { enableQE() {}, project: { activeSequence: { sequenceID: "seq-1", videoTracks: { numTracks: 0 }, audioTracks: { numTracks: 0 } } } },
    qe: { project: { undoStackIndex: () => undoIndex.value } },
  });
  runInContext(getHelpersSource(), context);
  return (script: string) => {
    parse(script, { ecmaVersion: 3, allowReserved: "never" });
    return JSON.parse(String(runInContext(script, context)));
  };
}

describe("__refuse", () => {
  it("reports a refusal before any change as not_applied", () => {
    const run = engine({ value: 4 });
    const result = run(runWithUndoTracking(true, () => buildScript(`return __refuse("Clip not found: stale");`)));
    expect(result).toEqual({ success: false, error: "Clip not found: stale", data: { mutationOutcome: "not_applied", timelineChanged: false, refusedBeforeChange: true } });
  });

  it("falls back to __error when the undo history moved during the command", () => {
    const undo = { value: 4 };
    const run = engine(undo);
    const result = run(runWithUndoTracking(true, () => buildScript(`qe.project.undoStackIndex = function () { return 5; }; return __refuse("Late refusal");`)));
    expect(result.data.mutationOutcome).toBeUndefined();
    expect(result.data.refusedBeforeChange).toBeUndefined();
    expect(result.data.timelineChanged).toBe(true);
    expect(result.error).toContain("recorded 1 undo entry");
  });

  it("falls back to __error when the undo index is unreadable", () => {
    const run = engine({ value: 4 });
    const result = run(runWithUndoTracking(true, () => buildScript(`qe.project.undoStackIndex = function () { throw new Error("QE unavailable"); }; return __refuse("Unreadable undo");`)));
    expect(result.data.mutationOutcome).toBeUndefined();
  });

  it("keeps an attempted marker write unknown", () => {
    const run = engine({ value: 4 });
    const result = run(runWithUndoTracking(true, () => buildScript(`__markerWriteAttempted = true; return __refuse("Marker refused");`)));
    expect(result.data.mutationOutcome).toBe("unknown");
    expect(result.data.refusedBeforeChange).toBeUndefined();
  });

  it("keeps an inspect-only refusal shaped like __error", () => {
    const run = engine({ value: 4 });
    const result = run(runWithUndoTracking(false, () => buildScript(`return __refuse("Bin not found: nope");`)));
    expect(result).toEqual({ success: false, error: "Bin not found: nope" });
  });

  it("does not override an explicit outcome", () => {
    const run = engine({ value: 4 });
    const result = run(runWithUndoTracking(true, () => buildScript(`return __refuse("Explicit", { mutationOutcome: "unknown", timelineChanged: null });`)));
    expect(result.data).toMatchObject({ mutationOutcome: "unknown", timelineChanged: null });
    expect(result.data.refusedBeforeChange).toBeUndefined();
  });

  it("does not let a target-guard refusal inherit the previous command's write flags", () => {
    const run = engine({ value: 4 });
    // The previous command attempted a marker write and left the flag set in the shared engine.
    run(runWithUndoTracking(true, () => buildScript(`__markerWriteAttempted = true; return __result({ ok: true });`)));
    const guarded = runWithExpectedHostTarget({ backend: "cep", sequence_id: "other-sequence" }, () => runWithUndoTracking(true, () => buildScript(`return __result({ ran: true });`)));
    const result = run(guarded);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Expected target guard refused");
    expect(result.data).toMatchObject({ mutationOutcome: "not_applied", timelineChanged: false, refusedBeforeChange: true });
  });
});

describe("refusals in tool scripts", () => {
  it("enable_disable_clip refuses a stale node ID as not_applied", async () => {
    const run = engine({ value: 7 });
    vi.mocked(sendCommand).mockImplementation(async (script) => run(script));
    const tools = getTimelineTools({});
    const result = await runWithUndoTracking(true, () => tools.enable_disable_clip.handler({ node_id: "000fffff", enabled: false }));
    expect(result).toMatchObject({ success: false, error: "Clip not found: 000fffff", data: { mutationOutcome: "not_applied", timelineChanged: false } });
  });
});
