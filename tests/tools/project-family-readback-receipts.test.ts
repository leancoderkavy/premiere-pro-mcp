import { runInNewContext } from "node:vm";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { getSequenceTools } from "../../src/tools/sequence.js";
import { getUtilityTools } from "../../src/tools/utility.js";
import { getAdvancedTools } from "../../src/tools/advanced.js";
import { getTimelineTools } from "../../src/tools/timeline.js";
import { mutationReceipt } from "../../src/workflows/mutation-receipt.js";

const sent = vi.mocked(sendCommand);
const options = { tempDir: "/tmp/readback", timeoutMs: 1000 };
const sequence = getSequenceTools(options), utility = getUtilityTools(options), advanced = getAdvancedTools(options), timeline = getTimelineTools(options);
function collection(items: any[], key = "numItems") { return Object.assign({ [key]: items.length }, items); }
function bridge(context: object) { sent.mockImplementation(async script => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, context)))); }
function receipt(result: { success: boolean; data?: unknown }, tool: string) { return mutationReceipt(result.success, result.data, { dispatched: true }, tool); }
beforeEach(() => vi.clearAllMocks());

describe("project and sequence readback receipts", () => {
  it.each([false, true])("uses collection readback for sequence creation (ignored=%s)", async ignored => {
    const created = { name: 'New"\\sequence', sequenceID: "new" };
    const project: any = { sequences: collection([], "numSequences"), activeSequence: null };
    bridge({ app: { enableQE() {}, project }, qe: { project: { newSequence(name: string) {
      expect(name).toBe(created.name);
      if (!ignored) { project.activeSequence = created; project.sequences = collection([created], "numSequences"); }
    } } } });
    const result = await sequence.create_sequence.handler({ name: created.name, preset_path: resolve("package.json") });
    expect(result.success).toBe(!ignored);
    expect(receipt(result, "create_sequence").outcome === "verified").toBe(!ignored);
  });
  it.each([false, true])("uses setting readback for frame dimensions (ignored=%s)", async ignored => {
    let settings = { videoFrameWidth: 1920, videoFrameHeight: 1080 };
    const seq = { name: "Edit", getSettings: () => ({ ...settings }), setSettings(next: typeof settings) { if (!ignored) settings = { ...next }; } };
    bridge({ app: { project: { activeSequence: seq } } });
    const result = await sequence.set_sequence_settings.handler({ width: 1280, height: 720 });
    expect(result.success).toBe(!ignored);
    expect(receipt(result, "set_sequence_settings").outcome === "verified").toBe(!ignored);
  });
  it.each([false, true])("uses frame-duration readback for rate changes (ignored=%s)", async ignored => {
    let rate = { ticks: String(254016000000 / 25) };
    const seq = { name: "Edit", videoTracks: collection([], "numTracks"), audioTracks: collection([], "numTracks"), getSettings: () => ({ videoFrameRate: rate }), setSettings(next: { videoFrameRate: typeof rate }) { if (!ignored) rate = next.videoFrameRate; } };
    function Time(this: { ticks: string }) { this.ticks = "0"; }
    bridge({ app: { project: { activeSequence: seq } }, Time });
    const result = await utility.set_sequence_frame_rate.handler({ frame_rate: 30 });
    expect(result.success).toBe(!ignored);
    expect(receipt(result, "set_sequence_frame_rate").outcome === "verified").toBe(!ignored);
  });
  it.each([false, true])("uses exact track counts for track creation (ignored=%s)", async ignored => {
    const seq = { name: "Edit", videoTracks: collection([], "numTracks"), audioTracks: collection([], "numTracks") };
    const qeSeq = { addTracks(video: number, _vIndex: number, audio: number) {
      if (!ignored) { seq.videoTracks = collection(Array.from({ length: video }, (_, i) => ({ id: i, name: `V${i}`, clips: collection([]) })), "numTracks"); seq.audioTracks = collection(Array.from({ length: audio }, (_, i) => ({ id: i, name: `A${i}`, clips: collection([]) })), "numTracks"); }
    } };
    bridge({ app: { enableQE() {}, project: { activeSequence: seq } }, qe: { project: { getActiveSequence: () => qeSeq } } });
    const result = await advanced.add_tracks.handler({ video_tracks: 1, audio_tracks: 1 });
    expect(result.success).toBe(!ignored);
    expect(receipt(result, "add_tracks").outcome === "verified").toBe(!ignored);
  });
  it.each([false, true])("uses node absence for batch deletion (ignored=%s)", async ignored => {
    const root: any = { type: 2, nodeId: "root", name: "Root", children: collection([]) };
    const bin = { type: 2, nodeId: "bin", name: 'Bin"\\name', children: collection([]), deleteBin() { if (!ignored) root.children = collection([]); } };
    root.children = collection([bin]);
    bridge({ app: { project: { rootItem: root, sequences: collection([], "numSequences") } } });
    const result = await utility.delete_multiple_project_items.handler({ item_ids: ["bin"] });
    expect(result.success).toBe(!ignored);
    expect(receipt(result, "delete_multiple_project_items").outcome === "verified").toBe(!ignored);
  });
  it.each([false, true])("uses clip absence for timeline removal (ignored=%s)", async ignored => {
    const track = { isLocked: () => false, clips: collection([]) };
    const clip = { nodeId: 'clip"\\id', name: "Clip", remove() { if (!ignored) track.clips = collection([]); } };
    track.clips = collection([clip]);
    const seq = { sequenceID: "seq", videoTracks: collection([track], "numTracks"), audioTracks: collection([], "numTracks") };
    bridge({ app: { project: { activeSequence: seq } } });
    const result = await timeline.remove_from_timeline.handler({ node_id: clip.nodeId, include_linked: false });
    expect(result.success).toBe(!ignored);
    expect(receipt(result, "remove_from_timeline").outcome === "verified").toBe(!ignored);
  });
});
