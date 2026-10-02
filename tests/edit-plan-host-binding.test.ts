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
  const clip = { nodeId: "clip-A", name: "Clip", projectItem: media, start: { ticks: "0" }, end: { ticks: "254016000000" }, inPoint: { ticks: "0" }, outPoint: { ticks: "254016000000" }, getLinkedItems: () => null, remove };
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
    app: { project, enableQE: () => {} }, Time: function () { this.ticks = "0"; },
    qe: { project: { getActiveSequence: () => ({ getVideoTrackAt: () => ({ isSyncLocked: () => false }), getAudioTrackAt: () => ({ isSyncLocked: () => false }) }) } },
  }))));
  const dependencies = { capabilities: { capabilities: new Set(["inspect", "edit"]), source: "explicit" as const }, auditSink: vi.fn() };
  return { tools: getEditPlanTools({ tempDir }, dependencies), restart: () => getEditPlanTools({ tempDir }, dependencies), project, sequence, other, media, clip, remove, activation };
}
function linkedFixture() {
  const f = fixture();
  const partnerRemove = vi.fn();
  const partner = { ...f.clip, nodeId: "linked-B", projectItem: { ...f.media, nodeId: "source-B" }, remove: partnerRemove };
  const additionalRemove = vi.fn();
  const additional = { ...partner, nodeId: "linked-C", projectItem: { ...f.media, nodeId: "source-C" }, remove: additionalRemove };
  const audio = [partner, additional];
  partnerRemove.mockImplementation(() => { audio.splice(audio.indexOf(partner), 1); return 0; });
  additionalRemove.mockImplementation(() => { audio.splice(audio.indexOf(additional), 1); return 0; });
  f.sequence.audioTracks[0].clips = new Proxy({ numItems: 2 }, { get: (_target, key) => key === "numItems" ? audio.length : audio[Number(key)] });
  (f.sequence.audioTracks[0] as typeof f.sequence.audioTracks[0] & { isLocked: () => boolean }).isLocked = () => false;
  const linkage = [partner];
  (f.clip as unknown as { getLinkedItems: () => unknown }).getLinkedItems = () => new Proxy({ numItems: 0 }, { get: (_target, key) => key === "numItems" ? linkage.length : linkage[Number(key)] });
  return { ...f, partner, additional, partnerRemove, additionalRemove, audio, linkage };
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
  it.each([false, true])("rejects newly linked removal partners before mutation (ripple:%s)", async (ripple) => {
    const f = linkedFixture();
    const plan = { operations: [{ ...removal.operations[0], ripple, ...(ripple ? { include_linked: false } : {}) }] };
    const token = await preview(f.tools, plan);
    f.linkage.push(f.additional);
    const result = await f.restart().apply_edit_plan.handler({ plan, confirmation_token: token });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("host targets changed") });
    expect(f.remove).not.toHaveBeenCalled(); expect(f.partnerRemove).not.toHaveBeenCalled(); expect(f.additionalRemove).not.toHaveBeenCalled(); expect(f.activation).not.toHaveBeenCalled();
  });
  it("applies unchanged linked targets after restart despite linkage enumeration order", async () => {
    const f = linkedFixture(); f.linkage.push(f.additional);
    const token = await preview(f.tools, removal); f.linkage.reverse();
    vi.mocked(sendCommand).mockClear();
    const applied = await f.restart().apply_edit_plan.handler({ plan: removal, confirmation_token: token });
    expect(applied.error).toBeUndefined();
    expect(applied).toMatchObject({ success: true, data: { applied: true } });
    expect(sendCommand).toHaveBeenCalledOnce(); expect(f.remove).toHaveBeenCalledOnce();
    expect(f.partnerRemove).toHaveBeenCalledOnce(); expect(f.additionalRemove).toHaveBeenCalledOnce(); expect(f.audio).toHaveLength(0);
  });
  it.each([false, true])("reuses validated partners when a second linkage read would fail (ripple:%s)", async (ripple) => {
    const f = linkedFixture(); f.audio.splice(1, 1);
    const plan = { operations: [{ ...removal.operations[0], ripple }] };
    const token = await preview(f.tools, plan);
    const readLinkage = vi.fn(() => {
      if (readLinkage.mock.calls.length > 1) throw new Error("second linkage read unavailable");
      return { numItems: 1, 0: f.partner };
    });
    (f.clip as unknown as { getLinkedItems: () => unknown }).getLinkedItems = readLinkage;
    expect(await f.restart().apply_edit_plan.handler({ plan, confirmation_token: token })).toMatchObject({ success: true, data: { applied: true } });
    expect(readLinkage).toHaveBeenCalledOnce();
    expect(f.remove).toHaveBeenCalledOnce(); expect(f.partnerRemove).toHaveBeenCalledOnce(); expect(f.audio).toHaveLength(0);
  });
  it.each([false, true])("reports first removal that deletes then throws as changed (ripple:%s)", async (ripple) => {
    const f = linkedFixture(); f.audio.splice(1, 1);
    const plan = { operations: [{ ...removal.operations[0], ripple }] };
    const token = await preview(f.tools, plan);
    const remove = f.remove.getMockImplementation()!;
    f.remove.mockImplementationOnce(() => { remove(); throw new Error("native removal threw after deletion"); });
    const result = await f.restart().apply_edit_plan.handler({ plan, confirmation_token: token });
    expect(result).toMatchObject({ success: false, data: { timelineChanged: true, mutationAttempted: true, mutationOutcome: "changed", readbackComplete: true, removedClipIds: ["clip-A"] } });
    expect(result.error).not.toMatch(/nothing was changed/i); expect(f.partnerRemove).not.toHaveBeenCalled();
  });
  it.each([false, true])("reports unreadable readback after throwing removal as unknown (ripple:%s)", async (ripple) => {
    const f = fixture(); const plan = { operations: [{ ...removal.operations[0], ripple }] };
    const token = await preview(f.tools, plan);
    const clips = f.sequence.videoTracks[0].clips; let unreadable = false;
    f.sequence.videoTracks[0].clips = new Proxy(clips, { get: (target, key) => { if (unreadable) throw new Error("readback unavailable"); return Reflect.get(target, key); } });
    const remove = f.remove.getMockImplementation()!;
    f.remove.mockImplementationOnce(() => { remove(); unreadable = true; throw new Error("native removal threw"); });
    const result = await f.restart().apply_edit_plan.handler({ plan, confirmation_token: token });
    expect(result).toMatchObject({ success: false, data: { timelineChanged: null, mutationAttempted: true, mutationOutcome: "unknown", readbackComplete: false } });
    expect(result.error).not.toMatch(/nothing was changed/i);
  });
  it.each([false, true])("accepts a fresh active sequence wrapper for post-throw readback (ripple:%s)", async (ripple) => {
    const f = fixture(); const plan = { operations: [{ ...removal.operations[0], ripple }] };
    const token = await preview(f.tools, plan); const remove = f.remove.getMockImplementation()!;
    f.remove.mockImplementationOnce(() => {
      remove(); Object.defineProperty(f.project, "activeSequence", { get: () => ({ ...f.sequence }) });
      throw new Error("removed then threw with fresh wrappers");
    });
    expect(await f.restart().apply_edit_plan.handler({ plan, confirmation_token: token })).toMatchObject({ success: false, data: { timelineChanged: true, mutationOutcome: "changed", readbackComplete: true, removedClipIds: ["clip-A"] } });
  });
  it.each([false, true])("refuses post-throw readback from another project reusing sequence IDs (ripple:%s)", async (ripple) => {
    const f = fixture(); const plan = { operations: [{ ...removal.operations[0], ripple }] };
    const token = await preview(f.tools, plan); const remove = f.remove.getMockImplementation()!;
    f.remove.mockImplementationOnce(() => { remove(); f.project.documentID = "document-B"; throw new Error("native removal switched projects"); });
    const result = await f.restart().apply_edit_plan.handler({ plan, confirmation_token: token });
    expect(result).toMatchObject({ success: false, data: { timelineChanged: null, mutationOutcome: "unknown", readbackComplete: false, removedClipIds: [] } });
    expect(result.error).not.toMatch(/nothing was changed/i);
  });
  it.each(["tracks", "clips", "node"])("does not infer removal from malformed %s readback", async (malformed) => {
    const f = fixture(); const token = await preview(f.tools, removal); const remove = f.remove.getMockImplementation()!;
    f.remove.mockImplementationOnce(() => {
      remove();
      if (malformed === "tracks") f.sequence.audioTracks.numTracks = NaN;
      else if (malformed === "clips") f.sequence.audioTracks[0].clips.numItems = -1;
      else Object.assign(f.sequence.audioTracks[0], { clips: { numItems: 1, 0: { nodeId: undefined } } });
      throw new Error("native removal threw with malformed readback");
    });
    const result = await f.restart().apply_edit_plan.handler({ plan: removal, confirmation_token: token });
    expect(result).toMatchObject({ success: false, data: { timelineChanged: null, mutationOutcome: "unknown", readbackComplete: false, removedClipIds: [] } });
    expect(result.error).not.toMatch(/nothing was changed/i);
  });
  it.each(["source", "range", "track"])("rejects linked partner %s changes after preview", async (change) => {
    const f = linkedFixture(); const token = await preview(f.tools, removal);
    if (change === "source") f.partner.projectItem = { ...f.media, nodeId: "replacement-linked-source" };
    else if (change === "range") f.partner.inPoint = { ticks: "100" };
    else {
      const tracks = f.sequence.audioTracks as typeof f.sequence.audioTracks & Record<number, typeof f.sequence.audioTracks[0]>;
      tracks[1] = tracks[0]; tracks[0] = { clips: { numItems: 0 } }; tracks.numTracks = 2;
    }
    expect(await f.tools.apply_edit_plan.handler({ plan: removal, confirmation_token: token })).toMatchObject({ success: false, error: expect.stringContaining("host targets changed") });
    expect(f.remove).not.toHaveBeenCalled(); expect(f.partnerRemove).not.toHaveBeenCalled(); expect(f.activation).not.toHaveBeenCalled();
  });
  it("refuses linked removal when linkage becomes unreadable", async () => {
    const f = linkedFixture(); const token = await preview(f.tools, removal);
    f.clip.getLinkedItems = () => { throw new Error("linkage accessor unavailable"); };
    expect(await f.tools.apply_edit_plan.handler({ plan: removal, confirmation_token: token })).toMatchObject({ success: false, error: expect.stringContaining("could not be read") });
    expect(f.remove).not.toHaveBeenCalled(); expect(f.partnerRemove).not.toHaveBeenCalled();
  });
  it("refuses a preview whose linkage result is undefined", async () => {
    const f = fixture(); (f.clip as unknown as { getLinkedItems: () => unknown }).getLinkedItems = () => undefined;
    expect(await f.tools.preview_edit_plan.handler({ plan: removal })).toMatchObject({ success: false, error: expect.stringContaining("cannot be enumerated safely") });
    expect(f.remove).not.toHaveBeenCalled();
  });
  it("keeps explicit unlinked removal usable without reading or deleting partners", async () => {
    const f = linkedFixture(); f.clip.getLinkedItems = () => { throw new Error("unreadable but not requested"); };
    const plan = { operations: [{ ...removal.operations[0], include_linked: false }] };
    const token = await preview(f.tools, plan);
    expect(await f.tools.apply_edit_plan.handler({ plan, confirmation_token: token })).toMatchObject({ success: true, data: { applied: true } });
    expect(f.remove).toHaveBeenCalledOnce(); expect(f.partnerRemove).not.toHaveBeenCalled(); expect(f.additionalRemove).not.toHaveBeenCalled();
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
