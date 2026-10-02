import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/bridge/file-bridge.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/bridge/file-bridge.js")>(),
  ensurePrivateBridgeDirectory: vi.fn(),
  sendCommand: vi.fn(),
}));
import { sendCommand } from "../src/bridge/file-bridge.js";
import { getHelpersSource } from "../src/bridge/script-builder.js";
import { getEditPlanTools } from "../src/tools/edit-plans.js";
const directories: string[] = [];
beforeEach(() => { vi.mocked(sendCommand).mockReset(); });
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  const tempDir = mkdtempSync(join(tmpdir(), "premiere-plan-host-binding-"));
  directories.push(tempDir);
  const media = { nodeId: "source-A", name: "Source", type: 1 };
  const list: Array<Record<string, unknown>> = [];
  const remove = vi.fn(() => { list.splice(0, 1); return 0; });
  const clip = { nodeId: "clip-A", name: "Clip", projectItem: media, start: { ticks: "0" }, end: { ticks: "254016000000" }, getLinkedItems: () => null, remove };
  list.push(clip);
  const clips = new Proxy({}, { get: (_target, key) => key === "numItems" ? list.length : list[Number(key)] });
  const sequence = { sequenceID: "sequence-A", name: "Target", videoTracks: { numTracks: 1, 0: { clips, isLocked: () => false } }, audioTracks: { numTracks: 1, 0: { clips: { numItems: 0 } } } };
  const other = { ...sequence, sequenceID: "sequence-B", name: "Other" };
  let active = sequence;
  const activation = vi.fn((value: typeof sequence) => { active = value; });
  const project = {
    documentID: "document-A",
    get activeSequence() { return active; },
    set activeSequence(value) { activation(value); },
    sequences: { numSequences: 2, 0: sequence, 1: other },
    rootItem: { children: { numItems: 1, 0: media } },
  };
  vi.mocked(sendCommand).mockImplementation(async (script) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
    app: { project }, Time: function () { this.ticks = "0"; },
  }))));
  const dependencies = { capabilities: { capabilities: new Set(["inspect", "edit"]), source: "explicit" as const }, auditSink: vi.fn() };
  return { tools: getEditPlanTools({ tempDir }, dependencies), restart: () => getEditPlanTools({ tempDir }, dependencies), project, sequence, other, media, clip, remove, activation };
}
const insert = { operations: [{ type: "insert_clip" as const, item_id: "Source", start_seconds: 0 }] };
const removal = { operations: [{ type: "remove_clip" as const, node_id: "clip-A" }] };
async function preview(tools: ReturnType<typeof getEditPlanTools>, plan = insert as unknown) {
  const result = await tools.preview_edit_plan.handler({ plan });
  expect(result).toMatchObject({ success: true });
  return String(result.data!.confirmationToken);
}
describe("persisted preview host-target binding", () => {
  it("rejects an active sequence switch before mutation", async () => {
    const f = fixture(); const token = await preview(f.tools);
    f.project.activeSequence = f.other; f.activation.mockClear();
    const result = await f.restart().apply_edit_plan.handler({ plan: insert, confirmation_token: token });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("host targets changed") });
    expect(f.remove).not.toHaveBeenCalled(); expect(f.activation).not.toHaveBeenCalled();
    await expect(f.tools.apply_edit_plan.handler({ plan: insert, confirmation_token: token })).rejects.toThrow("already consumed");
  });
  it("rejects a different project even if sequence IDs are reused", async () => {
    const f = fixture(); const token = await preview(f.tools);
    f.project.documentID = "document-B";
    expect(await f.tools.apply_edit_plan.handler({ plan: insert, confirmation_token: token })).toMatchObject({ success: false, error: expect.stringContaining("host targets changed") });
    expect(f.activation).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled();
  });
  it("rejects a project item name that now resolves to a different node", async () => {
    const f = fixture(); const token = await preview(f.tools);
    f.project.rootItem.children[0] = { ...f.media, nodeId: "replacement-source" };
    expect(await f.tools.apply_edit_plan.handler({ plan: insert, confirmation_token: token })).toMatchObject({ success: false, error: expect.stringContaining("host targets changed") });
    expect(f.activation).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled();
  });
  it("rejects a named sequence replacement before activating it", async () => {
    const f = fixture(); const plan = { ...insert, sequence_id: "Target" }; const token = await preview(f.tools, plan);
    f.project.activeSequence = f.other; f.activation.mockClear();
    f.project.sequences[0] = { ...f.sequence, sequenceID: "replacement-sequence" };
    expect(await f.tools.apply_edit_plan.handler({ plan, confirmation_token: token })).toMatchObject({ success: false, error: expect.stringContaining("No sequence activation or mutation") });
    expect(f.activation).not.toHaveBeenCalled(); expect(f.project.activeSequence).toBe(f.other); expect(f.remove).not.toHaveBeenCalled();
  });
  it.each(["source", "range"])("rejects changed removal clip %s identity before mutation", async (change) => {
    const f = fixture(); const token = await preview(f.tools, removal);
    if (change === "source") f.clip.projectItem = { ...f.media, nodeId: "replacement-source" };
    else f.clip.start.ticks = "10";
    expect(await f.tools.apply_edit_plan.handler({ plan: removal, confirmation_token: token })).toMatchObject({ success: false, error: expect.stringContaining("host targets changed") });
    expect(f.remove).not.toHaveBeenCalled(); expect(f.activation).not.toHaveBeenCalled();
  });
  it("rejects a clip moved into a different track family", async () => {
    const f = fixture(); const token = await preview(f.tools, removal);
    const sequence = f.sequence as unknown as { videoTracks: unknown; audioTracks: unknown };
    const video = sequence.videoTracks; sequence.videoTracks = sequence.audioTracks; sequence.audioTracks = video;
    expect(await f.tools.apply_edit_plan.handler({ plan: removal, confirmation_token: token })).toMatchObject({ success: false, error: expect.stringContaining("host targets changed") });
    expect(f.remove).not.toHaveBeenCalled(); expect(f.activation).not.toHaveBeenCalled();
  });
  it("activates a still-bound named sequence only after all target checks", async () => {
    const f = fixture(); const plan = { ...removal, sequence_id: "Target" }; const token = await preview(f.tools, plan);
    f.project.activeSequence = f.other; f.activation.mockClear();
    expect(await f.tools.apply_edit_plan.handler({ plan, confirmation_token: token })).toMatchObject({ success: true, data: { applied: true } });
    expect(f.activation).toHaveBeenCalledExactlyOnceWith(f.sequence); expect(f.remove).toHaveBeenCalledOnce();
  });
  it("persists the exact binding across restart and applies in one host command", async () => {
    const f = fixture(); const token = await preview(f.tools, removal);
    vi.mocked(sendCommand).mockClear();
    expect(await f.restart().apply_edit_plan.handler({ plan: removal, confirmation_token: token })).toMatchObject({ success: true, data: { applied: true } });
    expect(sendCommand).toHaveBeenCalledOnce(); expect(f.remove).toHaveBeenCalledOnce();
  });
  it("refuses preview without stable project identity", async () => {
    const f = fixture(); f.project.documentID = "";
    expect(await f.tools.preview_edit_plan.handler({ plan: insert })).toMatchObject({ success: false, error: expect.stringContaining("stable target identities") });
    expect(f.remove).not.toHaveBeenCalled(); expect(f.activation).not.toHaveBeenCalled();
  });
});
