import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { runWithUndoTracking } from "../../src/bridge/undo-tracking.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { confirmationToken, getEditPlanTools } from "../../src/tools/edit-plans.js";
import { staticEditPlanTokenStore } from "../helpers/static-edit-plan-token-store.js";

const mockedSendCommand = vi.mocked(sendCommand);
const TICKS = 254016000000;
type Result = { success: boolean; error?: string; data?: Record<string, unknown> };

beforeEach(() => vi.clearAllMocks());

/** Two clips on V1. `failing` throws on remove(); `recordsUndo` also moves the undo stack before throwing. */
function host(options: { failing: string; recordsUndo?: boolean }) {
  const stack = { index: 7 };
  const list: Array<Record<string, unknown>> = [];
  for (const [id, start] of [["v0", 0], ["v1", 10]] as const) {
    const clip: Record<string, unknown> = {
      nodeId: id,
      projectItem: { nodeId: "test-source" },
      name: `shot ${id}`,
      start: { ticks: String(start * TICKS) },
      end: { ticks: String((start + 10) * TICKS) },
      inPoint: { ticks: "0" }, outPoint: { ticks: String(10 * TICKS) },
      getLinkedItems: () => null,
      remove: () => {
        if (id === options.failing) {
          if (options.recordsUndo) stack.index += 1;
          throw new Error("locked by another operation");
        }
        list.splice(list.indexOf(clip), 1);
        return 0;
      },
    };
    list.push(clip);
  }
  const clips = new Proxy({}, { get: (_t, key) => (key === "numItems" ? list.length : list[Number(key)]) });
  const seq = { sequenceID: "seq", name: "Cut", videoTracks: { numTracks: 1, 0: { clips, isLocked: () => false } }, audioTracks: { numTracks: 0 } };
  mockedSendCommand.mockImplementation(async (script: string) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
    app: { enableQE: () => {}, project: { documentID: "test-project", activeSequence: seq, sequences: { numSequences: 1, 0: seq } } },
    qe: { project: { undoStackIndex: () => stack.index } },
  }))));
  return list;
}

const tools = getEditPlanTools({}, { capabilities: { capabilities: new Set(["inspect", "edit"]), source: "explicit" }, auditSink: vi.fn(), operationIdFactory: () => "op", tokenStore: staticEditPlanTokenStore });
const apply = async (plan: { operations: Array<{ type: "remove_clip"; node_id: string }> }) =>
  { await tools.preview_edit_plan.handler({ plan }); mockedSendCommand.mockClear(); return runWithUndoTracking(true, () => tools.apply_edit_plan.handler({ plan, confirmation_token: confirmationToken(plan) })) as Promise<Result>; };

describe("apply_edit_plan failure reporting", () => {
  it("returns undoSteps as data only, noting that DOM removals are not covered", async () => {
    const list = host({ failing: "v1" });
    const result = await apply({ operations: [{ type: "remove_clip", node_id: "v0" }, { type: "remove_clip", node_id: "v1" }] });
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("The timeline changed: the 1 operation(s) before it were applied"),
      data: { timelineChanged: true, undoSteps: 0, undoStepsNote: expect.stringContaining("DOM-only operations") },
    });
    expect(result.error).not.toMatch(/undo count/);
    expect(list.map((clip) => clip.nodeId)).toEqual(["v1"]);
    // The pattern must survive the TS template literal as \s and \. in ExtendScript.
    expect(String(mockedSendCommand.mock.calls[0][0])).toContain("replace(/\\s*Nothing was changed\\.?/g");
  });

  it("does not say nothing changed when the failed operation recorded undo entries", async () => {
    host({ failing: "v0", recordsUndo: true });
    const result = await apply({ operations: [{ type: "remove_clip", node_id: "v0" }] });
    expect(result).toMatchObject({ success: false, data: { timelineChanged: true, undoSteps: 1 } });
    expect(result.error).toContain("may have changed");
    expect(result.error).not.toContain("Nothing was changed");
  });
});
