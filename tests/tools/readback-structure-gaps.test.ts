import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { getAdvancedTools } from "../../src/tools/advanced.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";
const options = { tempDir: "/tmp/readback", timeoutMs: 1000 };
const sent = vi.mocked(sendCommand);
const advanced = getAdvancedTools(options), targeting = getTrackTargetingTools(options);
function collection<T>(items: T[], key = "numItems") { return Object.assign({ [key]: items.length }, items); }
function bridge(context: object) { sent.mockImplementation(async (script) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, context)))); }
beforeEach(() => vi.clearAllMocks());
describe("structural readback receipts", () => {
  it.each([false, true])("reads clip selection after write (ignored=%s)", async (ignored) => {
    let selected = false;
    const clip = { nodeId: 'clip"\\id', name: "Clip", setSelected: (value: number) => { if (!ignored) selected = !!value; }, isSelected: () => selected };
    const seq = { videoTracks: collection([{ clips: collection([clip]) }], "numTracks"), audioTracks: collection([], "numTracks") };
    bridge({ app: { project: { activeSequence: seq } } });
    const result = await advanced.set_clip_selection.handler({ node_id: clip.nodeId, selected: true });
    expect(result).toMatchObject({ success: !ignored, data: { selected: !ignored, requestedSelected: true, verified: !ignored, outcome: ignored ? "failed" : "verified" } });
  });
  it("rejects invalid selection before contacting the host", async () => {
    expect(await advanced.set_clip_selection.handler({ node_id: "clip", selected: 1 as unknown as boolean })).toMatchObject({ success: false });
    expect(sent).not.toHaveBeenCalled();
  });
  it("reports unreadable selection without claiming the requested value", async () => {
    const clip = { nodeId: "clip", name: "Clip", setSelected: vi.fn(), isSelected: () => { throw new Error("read blocked"); } };
    bridge({ app: { project: { activeSequence: { videoTracks: collection([{ clips: collection([clip]) }], "numTracks"), audioTracks: collection([], "numTracks") } } } });
    expect(await advanced.set_clip_selection.handler({ node_id: "clip", selected: true })).toMatchObject({ success: true, data: { selected: null, verified: false, outcome: "committed_unverified" } });
  });
  it.each([false, true])("verifies new sequence source placements (ignored=%s)", async (ignored) => {
    const item = { nodeId: 'item"\\id', name: "Source", type: 1 };
    const seq = { sequenceID: "new-seq", name: 'New"\\sequence', videoTracks: collection([{ clips: collection(ignored ? [] : [{ projectItem: item, start: { ticks: "0" } }]) }], "numTracks"), audioTracks: collection([], "numTracks") };
    const project = { rootItem: { children: collection([item]) }, sequences: collection([], "numSequences"), createNewSequenceFromClips: vi.fn(() => { project.sequences = collection([seq], "numSequences"); return seq; }) };
    bridge({ app: { project } });
    expect(await advanced.create_sequence_from_clips.handler({ name: seq.name, item_ids: [item.nodeId] })).toMatchObject({ success: !ignored, data: { requestedClipCount: 1, clipCount: ignored ? 0 : 1, verified: !ignored, outcome: ignored ? "failed" : "verified" } });
  });
  it("refuses an empty sequence request without calling the host", async () => {
    expect(await advanced.create_sequence_from_clips.handler({ name: "Empty", item_ids: [] })).toMatchObject({ success: false });
    expect(sent).not.toHaveBeenCalled();
  });
  it.each([false, true])("verifies selected-clip removal (ignored=%s)", async (ignored) => {
    const track = { clips: collection([] as object[]) };
    const clip = { nodeId: "clip", isSelected: () => true, remove: vi.fn(() => { if (!ignored) track.clips = collection([]); }) };
    track.clips = collection([clip]);
    bridge({ app: { project: { activeSequence: { videoTracks: collection([track], "numTracks"), audioTracks: collection([], "numTracks") } } } });
    expect(await targeting.remove_selected_clips.handler({})).toMatchObject({ success: !ignored, data: ignored ? { removed: 0, remainingNodeIds: ["clip"] } : { removed: 1, verified: true, ripple: false } });
  });
  it("refuses ripple requests before deleting anything", async () => {
    expect(await targeting.remove_selected_clips.handler({ ripple: true })).toMatchObject({ success: false, data: { outcome: "not_applied", removed: 0, timelineChanged: false } });
    expect(sent).not.toHaveBeenCalled();
  });
  it("rejects invalid removal input before contacting the host", async () => {
    expect(await targeting.remove_selected_clips.handler({ ripple: "yes" as unknown as boolean })).toMatchObject({ success: false });
    expect(sent).not.toHaveBeenCalled();
  });
});
