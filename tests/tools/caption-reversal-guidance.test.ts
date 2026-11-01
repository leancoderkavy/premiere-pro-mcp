import { runInNewContext } from "node:vm";
import { parse } from "acorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { runWithUndoTracking } from "../../src/bridge/undo-tracking.js";
import { getCaptionTools } from "../../src/tools/captions.js";
import { buildPremiereInstructions } from "../../src/workflows/agent-instructions.js";
import { WORKFLOW_TOOL_PACKS } from "../../src/workflows/tool-packs.js";
const tool = getCaptionTools({}).create_caption_track;
const id = 'caption"\\\n.srt';
function host(steps: number | undefined, afterCount: unknown = 1) {
  let attempted = false;
  const item = { nodeId: id, name: id };
  const create = vi.fn(() => { attempted = true; return true; });
  vi.mocked(sendCommand).mockImplementation(async script => {
    const source = getHelpersSource() + "\n" + script;
    parse(source, { ecmaVersion: 3, allowReserved: "never" });
    return JSON.parse(String(runInNewContext(source, {
      app: { enableQE() {}, project: { activeSequence: { createCaptionTrack: create, getCaptionTracks: () => ({ numTracks: attempted ? afterCount : 0 }) }, rootItem: { children: { numItems: 1, 0: item } } } },
      qe: { project: { undoStackIndex: () => steps === undefined ? undefined : 10 + (attempted ? steps : 0) } },
      Sequence: { CAPTION_FORMAT_SUBTITLE: 1 },
    })));
  });
  return create;
}
beforeEach(() => { vi.mocked(sendCommand).mockReset(); });
describe("caption import reversal evidence", () => {
  it.each([1, 3, 100])("reports the observed %s undo steps and exact stack guard", async steps => {
    const create = host(steps);
    const result: any = await runWithUndoTracking(true, () => tool.handler({ item_id: id }));
    expect(result).toMatchObject({ success: true, data: { verified: true, undoSteps: steps, undoStackIndex: 10 + steps, reversal: { cepRemovalAvailable: false, undo: { available: true, arguments: { count: steps, expected_undo_stack_index: 10 + steps } }, hide: { tool: "manage_track_state_uxp" } } } });
    expect(result.data.exportWarning).toContain("render in export_sequence by default");
    expect(result.data.reversal.undo.evidence).toContain("does not prove action identity");
    expect(create).toHaveBeenCalledTimes(1);
    expect(sendCommand).toHaveBeenCalledTimes(1);
  });
  it.each([0, undefined])("never guesses an undo count when no positive delta was captured (%s)", async steps => {
    host(steps);
    const result: any = await runWithUndoTracking(true, () => tool.handler({ item_id: id }));
    expect(result.data.undoSteps).toBeNull();
    expect(result.data.reversal.undo).toMatchObject({ available: false, arguments: null });
    expect(result.data.reversal.undo.instruction).toContain("Do not guess");
  });
  it("retains an observed count above the single-call undo limit without suggesting invalid arguments", async () => {
    host(101);
    const result: any = await runWithUndoTracking(true, () => tool.handler({ item_id: id }));
    expect(result.data.undoSteps).toBe(101);
    expect(result.data.reversal.undo).toMatchObject({ available: false, arguments: null });
  });
  it("does not upgrade an unverified attempted import when adding reversal guidance", async () => {
    host(2, null);
    const result: any = await runWithUndoTracking(true, () => tool.handler({ item_id: id }));
    expect(result).toMatchObject({ success: true, data: { verified: false, outcome: "committed_unverified", undoSteps: 2, reversal: { undo: { available: true } } } });
  });
  it("keeps failed count readback failed and describes the UXP guard requirements", async () => {
    host(2, 0);
    const result: any = await runWithUndoTracking(true, () => tool.handler({ item_id: id }));
    expect(result).toMatchObject({ success: false, data: { verified: false, outcome: "committed_unverified", undoSteps: 2 } });
    expect(result.data.reversal.hide.instruction).toContain("expected_sequence_id/expected_muted");
    expect(result.data.reversal.hide.instruction).toContain("Muting hides the track; it does not delete it");
  });
  it.each([
    { outcome: "unknown" }, { outcome: "unknown_outcome" }, { outcome: "not_applied" },
    { mutationOutcome: "unknown" }, { mutationOutcome: "not_applied" },
    { recoveryRequired: true }, { stateUnknown: true },
  ])("never suggests undo for uncertain or refused receipt metadata %j", async flag => {
    vi.mocked(sendCommand).mockResolvedValue({ success: false, data: { beforeTrackCount: 0, undoSteps: 2, undoStackIndex: 12, ...flag } });
    const result: any = await tool.handler({ item_id: id });
    expect(result.data.reversal.undo).toMatchObject({ available: false, arguments: null });
  });
  it("does not suggest a count inconsistent with a nonnegative starting stack index", async () => {
    vi.mocked(sendCommand).mockResolvedValue({ success: true, data: { beforeTrackCount: 0, undoSteps: 2, undoStackIndex: 1 } });
    const result: any = await tool.handler({ item_id: id });
    expect(result.data.reversal.undo.available).toBe(false);
  });
  it("leaves pre-mutation refusals without reversal arguments", async () => {
    host(2);
    const result: any = await tool.handler({ item_id: "missing" });
    expect(result.success).toBe(false);
    expect(result.data?.reversal).toBeUndefined();
  });
  it("keeps planning local and warns in the tool and client instructions", async () => {
    const result: any = await tool.handler({ action: "plan_lecture_workflow", artifact_format: "srt", caption_content: "1\n00:00:00,000 --> 00:00:01,000\nHello\n" });
    expect(result.success).toBe(true);
    expect(result.data.reversal).toBeUndefined();
    expect(sendCommand).not.toHaveBeenCalled();
    expect(tool.description).toContain("CEP cannot remove or hide");
    const instructions = buildPremiereInstructions(new Set(["create_caption_track"]));
    expect(instructions).toContain("Caption tracks render in export_sequence by default");
    expect(instructions).toContain("missing count is not permission to guess");
    // Reversal routes appear only when their tools are registered.
    expect(instructions).not.toContain("multiple_undo");
    expect(instructions).not.toContain("manage_track_state_uxp");
    const withUndo = buildPremiereInstructions(new Set(["create_caption_track", "multiple_undo"]));
    expect(withUndo).toContain("- create_caption_track -> multiple_undo: To reverse a caption import");
    expect(withUndo).not.toContain("manage_track_state_uxp");
    const withMute = buildPremiereInstructions(new Set(["create_caption_track", "manage_track_state_uxp"]));
    expect(withMute).toContain("- create_caption_track -> manage_track_state_uxp: A connected capable UXP panel");
  });

  it("registers the advertised reversal tools in every pack that exposes caption import", () => {
    const captionPacks = WORKFLOW_TOOL_PACKS.filter((pack) => pack.tools.includes("create_caption_track"));
    expect(captionPacks.map((pack) => pack.name)).toEqual(expect.arrayContaining(["captions", "assistant-edit"]));
    for (const pack of captionPacks) {
      expect(pack.tools, pack.name).toEqual(expect.arrayContaining(["multiple_undo", "manage_track_state_uxp"]));
    }
  });
});
