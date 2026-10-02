import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../src/bridge/script-builder.js";
vi.mock("../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../src/bridge/file-bridge.js";
import { getEditPlanTools } from "../src/tools/edit-plans.js";

beforeEach(() => vi.clearAllMocks());
describe("edit-plan preview target inspection", () => {
  const issue = vi.fn(() => "token");
  const tools = getEditPlanTools({}, { capabilities: { capabilities: new Set(["inspect"]), source: "explicit" }, tokenStore: { issue, consume: vi.fn() } });
  function host() {
    const target = { sequenceID: "target", name: "Target", videoTracks: { numTracks: 1, 0: { clips: { numItems: 1, 0: { nodeId: "clip", projectItem: { nodeId: "media" }, start: { ticks: "0" }, end: { ticks: "1" } } } } }, audioTracks: { numTracks: 1, 0: { clips: { numItems: 0 } } } };
    const active = { ...target, sequenceID: "active" };
    const project = { documentID: "test-project", activeSequence: active, sequences: { numSequences: 2, 0: active, 1: target }, rootItem: { children: { numItems: 1, 0: { nodeId: "media", name: "Media", type: 1 } } } };
    vi.mocked(sendCommand).mockImplementation(async (script) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app: { project } }))));
    return { project, active };
  }
  it("refuses missing sequences, media and clips without issuing a token", async () => {
    host();
    const plans = [
      { sequence_id: "missing", operations: [{ type: "remove_clip", node_id: "clip" }] },
      { operations: [{ type: "remove_clip", node_id: "missing" }] },
      { operations: [{ type: "insert_clip", item_id: "missing", start_seconds: 0 }] },
      { operations: [{ type: "insert_clip", item_id: "media", start_seconds: 0, video_track_index: 2 }] },
    ];
    for (const plan of plans) await expect(tools.preview_edit_plan.handler({ plan })).resolves.toMatchObject({ success: false });
    expect(issue).not.toHaveBeenCalled();
  });
  it("inspects the named sequence without activating or editing it", async () => {
    const { project, active } = host();
    await expect(tools.preview_edit_plan.handler({ plan: { sequence_id: "target", operations: [{ type: "remove_clip", node_id: "clip" }, { type: "insert_clip", item_id: "media", start_seconds: 0 }] } })).resolves.toMatchObject({ success: true, data: { applied: false, targetsValidated: true, confirmationToken: "token" } });
    expect(project.activeSequence).toBe(active);
    expect(issue).toHaveBeenCalledOnce();
  });
  it("checks omitted track indices against the effective defaults", async () => {
    const { project } = host();
    project.activeSequence.audioTracks.numTracks = 0;
    await expect(tools.preview_edit_plan.handler({ plan: { operations: [{ type: "insert_clip", item_id: "media", start_seconds: 0 }] } })).resolves.toMatchObject({ success: false, error: expect.stringContaining("audio track") });
    expect(issue).not.toHaveBeenCalled();
  });
  it("refuses an incomplete inspection receipt", async () => {
    vi.mocked(sendCommand).mockResolvedValue({ success: true, data: {} });
    await expect(tools.preview_edit_plan.handler({ plan: { operations: [{ type: "remove_clip", node_id: "clip" }] } })).resolves.toMatchObject({ success: false });
    expect(issue).not.toHaveBeenCalled();
  });
});
