import { mutationReceipt } from "../../src/workflows/mutation-receipt.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";
import { withInvocationContext } from "../../src/workflows/invocation-context.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { DELETE_BATCH_CHUNK_SIZE, DELETE_BATCH_MAX_ITEMS, DELETE_BATCH_PROGRESS_INTERVAL_MS, getUtilityTools } from "../../src/tools/utility.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/delete-batch", timeoutMs: 5000 };
type Result = { success: boolean; error?: string; data?: Record<string, unknown> };
beforeEach(() => vi.clearAllMocks());

type Node = { nodeId: string; name: string; type: number; children?: { numItems: number; [i: number]: Node }; parent?: Node; isOffline?: () => boolean; deleteBin?: () => void; moveBin?: (bin: Node) => void };

/**
 * A fake project with `clipCount` unused clips in a Footage bin, one clip on a
 * timeline, one sequence, and counters for how often the timelines were walked.
 */
function project(options: { clipCount?: number; deleteBinNoop?: boolean; rejectSequence?: boolean; sequenceInBin?: boolean } = {}) {
  const clipCount = options.clipCount ?? 3;
  const makeBin = (nodeId: string, name: string): Node => ({ nodeId, name, type: 2, children: { numItems: 0 } });
  const root = makeBin("root", "Project");
  const add = (bin: Node, child: Node) => { const kids = bin.children!; kids[kids.numItems] = child; kids.numItems++; child.parent = bin; };
  const remove = (bin: Node, child: Node) => {
    const kids = bin.children!; const list: Node[] = [];
    for (let i = 0; i < kids.numItems; i++) if (kids[i] !== child) list.push(kids[i]);
    for (let i = 0; i < kids.numItems; i++) delete kids[i];
    list.forEach((n, i) => { kids[i] = n; }); kids.numItems = list.length;
  };
  const footage = makeBin("footage", "Footage");
  footage.deleteBin = () => remove(root, footage);
  add(root, footage);
  const clips: Node[] = [];
  for (let i = 0; i < clipCount; i++) {
    const clip: Node = { nodeId: `clip-${i}`, name: `Clip ${i}.mov`, type: 1 };
    clip.moveBin = (bin: Node) => { remove(clip.parent!, clip); add(bin, clip); };
    add(footage, clip);
    clips.push(clip);
  }
  const used: Node = { nodeId: "used", name: "Interview A.mp4", type: 1 };
  used.moveBin = (bin: Node) => { remove(used.parent!, used); add(bin, used); };
  add(root, used);
  const seqItem: Node = { nodeId: "seqitem", name: "Edit", type: 1 };
  const seqParent = options.sequenceInBin ? makeBin("seqbin", "Sequences") : root;
  if (seqParent !== root) add(root, seqParent);
  add(seqParent, seqItem);
  let bins = 0;
  (root as Record<string, unknown>).createBin = (name: string) => {
    const bin = makeBin(`tmp-${bins++}`, name);
    bin.deleteBin = () => { if (!options.deleteBinNoop) remove(root, bin); };
    add(root, bin);
    return bin;
  };
  const walks = { video: 0 };
  const timelineClip = { projectItem: used, name: used.name };
  const seq = {
    name: "Edit", sequenceID: "edit-seq", projectItem: seqItem,
    get videoTracks() { walks.video++; return { numTracks: 1, 0: { clips: { numItems: 1, 0: timelineClip } } }; },
    audioTracks: { numTracks: 0 },
  };
  const sequences: { numSequences: number; [i: number]: typeof seq } = { numSequences: 1, 0: seq };
  const deleteSequence = (target: typeof seq) => {
    if (options.rejectSequence) return false;
    const remaining: Array<typeof seq> = [];
    for (let i = 0; i < sequences.numSequences; i++) if (sequences[i] !== target) remaining.push(sequences[i]);
    for (let i = 0; i < sequences.numSequences; i++) delete sequences[i];
    remaining.forEach((entry, index) => { sequences[index] = entry; });
    sequences.numSequences = remaining.length;
    remove(seqParent, seqItem);
    return true;
  };
  mockedSendCommand.mockImplementation(async (script: string) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
    app: { project: { documentID: "document-a", rootItem: root, sequences, activeSequence: seq, deleteSequence } },
    Date: function FixedDate(this: { getTime: () => number }) { this.getTime = () => 1000 + bins; },
  }))));
  const footageNames = () => { const out: string[] = []; for (let i = 0; i < footage.children!.numItems; i++) out.push(footage.children![i].name); return out; };
  const rootNames = () => { const out: string[] = []; for (let i = 0; i < root.children!.numItems; i++) out.push(root.children![i].name); return out; };
  return { clips, walks, footageNames, rootNames, timelineClip };
}

describe("delete_multiple_project_items used-item index and chunks", () => {
  it("walks timelines once for planning and once per chunk", async () => {
    const { clips, walks, footageNames } = project({ clipCount: 5 });
    const result = await getUtilityTools(bridgeOptions).delete_multiple_project_items.handler({ item_ids: clips.map((clip) => clip.nodeId) }) as Result;
    expect(result).toMatchObject({ success: true, data: { deleted: 5, total: 5, planned: 5, verified: true, chunksCompleted: 1, chunkSize: DELETE_BATCH_CHUNK_SIZE, sequencesScanned: 1 } });
    // Revalidate once per chunk before mutation.
    expect(walks.video).toBe(2);
    expect(mockedSendCommand).toHaveBeenCalledTimes(2);
    expect(footageNames()).toEqual([]);
  });

  it("refuses a used item from the index before any deletion, with the same usage details", async () => {
    const { clips, footageNames, rootNames } = project({ clipCount: 2 });
    const result = await getUtilityTools(bridgeOptions).delete_multiple_project_items.handler({ item_ids: [clips[0].nodeId, "used"] }) as Result;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Interview A.mp4 is used by 1 timeline clip\(s\) in Edit/);
    expect(result.error).toContain("No project items were deleted");
    expect(result.data).toMatchObject({ code: "ITEM_IN_USE", usages: [{ sequence: "Edit", sequenceId: "edit-seq", clips: 1, tracks: [{ type: "video", index: 0, clips: 1 }] }] });
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
    expect(footageNames()).toEqual(["Clip 0.mov", "Clip 1.mov"]);
    expect(rootNames()).toContain("Interview A.mp4");
  });

  it("deletes a used item and a sequence only when confirmed", async () => {
    const { rootNames } = project({ clipCount: 1 });
    const result = await getUtilityTools(bridgeOptions).delete_multiple_project_items.handler({ item_ids: ["used", "Edit"], confirm_remove_from_sequences: true }) as Result;
    expect(result).toMatchObject({ success: true, data: { deleted: 2, items: [{ nodeId: "used" }, { nodeId: "seqitem", name: "Edit" }] } });
    expect(rootNames()).not.toContain("Interview A.mp4");
    expect(rootNames()).not.toContain("Edit");
  });

  it("deletes in chunks with per-chunk readback and a progress notification at least every 10 s", async () => {
    const { clips, walks, footageNames } = project({ clipCount: DELETE_BATCH_CHUNK_SIZE * 2 + 3 });
    let clock = 0;
    const notify = vi.fn(async () => {});
    const tools = getUtilityTools(bridgeOptions, { now: () => clock });
    mockedSendCommand.mockImplementationOnce(async (script: string) => {
      // The plan is sent first; each later chunk costs 6 s of host time.
      const previous = mockedSendCommand.getMockImplementation();
      mockedSendCommand.mockImplementation(async (chunkScript: string) => { clock += 6_000; return previous!(chunkScript, undefined); });
      return previous!(script, undefined);
    });
    const result = await withInvocationContext({ progressToken: "delete-batch", notify }, () =>
      tools.delete_multiple_project_items.handler({ item_ids: clips.map((clip) => clip.nodeId) })) as Result;
    expect(result).toMatchObject({ success: true, data: { deleted: 53, planned: 53, chunksCompleted: 3, verified: true } });
    expect(mockedSendCommand).toHaveBeenCalledTimes(4);
    expect(walks.video).toBe(4);
    expect(footageNames()).toEqual([]);
    // Chunk 1 at 6 s: no notification yet; chunk 2 at 12 s: one; final chunk: always one.
    expect(notify.mock.calls.map(([notification]) => (notification as { params: { progress: number; total?: number } }).params)).toMatchObject([
      { progressToken: "delete-batch", progress: 50, total: 53, message: expect.stringContaining("Deleted 50 of 53") },
      { progressToken: "delete-batch", progress: 53, total: 53, message: expect.stringContaining("Deleted 53 of 53") },
    ]);
    expect(DELETE_BATCH_PROGRESS_INTERVAL_MS).toBe(10_000);
  });

  it("stops at the failing chunk and counts what was deleted before it", async () => {
    const { clips } = project({ clipCount: DELETE_BATCH_CHUNK_SIZE + 2, rejectSequence: true });
    const ids = [...clips.map((clip) => clip.nodeId), "Edit"];
    const result = await getUtilityTools(bridgeOptions).delete_multiple_project_items.handler({ item_ids: ids, confirm_remove_from_sequences: true }) as Result;
    expect(result.success).toBe(false);
    expect(result.error).toContain("Premiere rejected deletion of sequence: Edit");
    expect(result.error).toContain(`${DELETE_BATCH_CHUNK_SIZE + 2} of ${DELETE_BATCH_CHUNK_SIZE + 3} planned item(s) were deleted before the batch stopped`);
    expect(result.data).toMatchObject({ code: "DELETE_CHUNK_STOPPED", deleted: DELETE_BATCH_CHUNK_SIZE + 2, planned: DELETE_BATCH_CHUNK_SIZE + 3, chunksCompleted: 1, deletedInChunk: 2 });
    expect(mockedSendCommand).toHaveBeenCalledTimes(3);
  });

  it("reports an unverified chunk instead of success when an item survives", async () => {
    const { clips } = project({ clipCount: 1, deleteBinNoop: true });
    const result = await getUtilityTools(bridgeOptions).delete_multiple_project_items.handler({ item_ids: [clips[0].nodeId] }) as Result;
    expect(result.success).toBe(false);
    expect(result.error).toContain("The project changed");
    expect(result.data).toMatchObject({ code: "DELETE_CHUNK_STOPPED", deleted: 0, chunksCompleted: 0 });
  });

  it("deletes duplicates once and treats a child of a deleted bin as already gone", async () => {
    const { clips, rootNames } = project({ clipCount: 2 });
    const result = await getUtilityTools(bridgeOptions).delete_multiple_project_items.handler({ item_ids: ["Footage", clips[1].nodeId, "Footage"] }) as Result;
    expect(result).toMatchObject({ success: true, data: { deleted: 2, total: 3, planned: 2, items: [{ nodeId: "footage" }, { nodeId: "clip-1", alreadyGone: true }] } });
    expect(rootNames()).not.toContain("Footage");
  });

  it("does not count a bin whose delete returned without removing it", async () => {
    project();
    const original = mockedSendCommand.getMockImplementation()!;
    mockedSendCommand.mockImplementation(async (script, options) => original(script.replace("item.deleteBin();", "/* host no-op */"), options));
    const result = await getUtilityTools(bridgeOptions).delete_multiple_project_items.handler({ item_ids: ["Footage", "Edit"], confirm_remove_from_sequences: true }) as Result;
    expect(result).toMatchObject({ success: false, data: { deleted: 0, code: "DELETE_CHUNK_STOPPED" } });
  });

  it("caps a call at 500 items and validates ids before contacting Premiere", async () => {
    const tools = getUtilityTools(bridgeOptions);
    for (const item_ids of [[], Array.from({ length: DELETE_BATCH_MAX_ITEMS + 1 }, (_, i) => `id-${i}`), ["ok", " "]]) {
      await expect(tools.delete_multiple_project_items.handler({ item_ids })).resolves.toMatchObject({ success: false, error: expect.stringContaining("No project items were deleted"), data: { mutationOutcome: "not_applied" } });
    }
    expect(mockedSendCommand).not.toHaveBeenCalled();
    expect(tools.delete_multiple_project_items.parameters.properties.item_ids).toMatchObject({ minItems: 1, maxItems: DELETE_BATCH_MAX_ITEMS });
  });

  it("fails closed when the host returns no plan", async () => {
    mockedSendCommand.mockResolvedValueOnce({ success: true, data: {} });
    await expect(getUtilityTools(bridgeOptions).delete_multiple_project_items.handler({ item_ids: ["x"] }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("No project items were deleted"), data: { mutationOutcome: "not_applied" } });
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
  });
});

describe("shared timeline-usage index", () => {
  it("get_unused_media reads the same index and still excludes used items", async () => {
    const { walks } = project({ clipCount: 4 });
    const result = await getUtilityTools(bridgeOptions).get_unused_media.handler({}) as Result;
    // Four clips plus the sequence item itself, which no timeline uses.
    expect(result).toMatchObject({ success: true, data: { unusedCount: 5, returned: 5 } });
    expect((result.data!.items as Array<{ name: string }>).map((item) => item.name)).not.toContain("Interview A.mp4");
    expect(walks.video).toBe(1);
  });

  it("find_item_usages matches the index-based usage for a bin holding a sequence", async () => {
    project({ clipCount: 1, sequenceInBin: true });
    const result = await getUtilityTools(bridgeOptions).find_item_usages.handler({ item_ids: ["Sequences", "Footage"] }) as Result;
    // The Sequences bin holds the sequence item, so every clip on that timeline counts even though the media lives elsewhere.
    expect(result).toMatchObject({ success: true, data: { usedItems: 1, items: [
      { name: "Sequences", isBin: true, used: true, timelineClips: 1, sequences: [{ sequence: "Edit", tracks: [{ type: "video", index: 0, clips: 1 }] }] },
      { name: "Footage", isBin: true, used: false, timelineClips: 0, sequences: [] },
    ] } });
  });
});


it("preserves prior chunk changes when the next chunk safely refuses", async () => {
  const planned = Array.from({ length: DELETE_BATCH_CHUNK_SIZE + 1 }, (_, i) => ({ nodeId: String(i), name: String(i), kind: "sequence", timelineClips: 0 }));
  mockedSendCommand.mockReset();
  mockedSendCommand.mockResolvedValueOnce({ success: true, data: { planned, projectDocumentId: "document-a" } });
  mockedSendCommand.mockResolvedValueOnce({ success: true, data: { items: planned.slice(0, DELETE_BATCH_CHUNK_SIZE) } });
  mockedSendCommand.mockResolvedValueOnce({ success: false, error: "Refused", data: { mutationOutcome: "not_applied", projectChanged: false, items: [] } });
  const result = await getUtilityTools(bridgeOptions).delete_multiple_project_items.handler({ item_ids: planned.map(item => item.nodeId) }) as Result;
  expect(result.success).toBe(false);
  expect(result.data?.mutationOutcome).toBe("committed_unverified");
  expect(mutationReceipt(false, result.data, { dispatched: true }).outcome).toBe("committed_unverified");
  expect(result.data?.projectChanged).toBe(true);
  expect(result.data?.deleted).toBe(DELETE_BATCH_CHUNK_SIZE);
});


it("rechecks usage of every target before the chunk mutates anything", async () => {
  const h = project({ clipCount: 2 });
  const execute = mockedSendCommand.getMockImplementation()!;
  let calls = 0;
  mockedSendCommand.mockImplementation(async (...args) => {
    if (++calls === 2) h.timelineClip.projectItem = h.clips[1];
    return execute(...args);
  });
  const result = await getUtilityTools(bridgeOptions).delete_multiple_project_items.handler({ item_ids: h.clips.map(item => item.nodeId) });
  expect(result).toMatchObject({ success: false, data: { deleted: 0, mutationOutcome: "not_applied" } });
  expect(h.footageNames()).toEqual(["Clip 0.mov", "Clip 1.mov"]);
});

 it("preserves confirmed chunks when a later bridge call rejects", async () => {
  const planned = Array.from({ length: DELETE_BATCH_CHUNK_SIZE + 1 }, (_, i) => ({ nodeId: String(i), name: String(i), kind: "sequence", timelineClips: 0 }));
  mockedSendCommand.mockReset();
  mockedSendCommand.mockResolvedValueOnce({ success: true, data: { planned, projectDocumentId: "document-a" } });
  mockedSendCommand.mockResolvedValueOnce({ success: true, data: { items: planned.slice(0, DELETE_BATCH_CHUNK_SIZE) } });
  mockedSendCommand.mockRejectedValueOnce(new Error("cancelled"));
  const result = await getUtilityTools(bridgeOptions).delete_multiple_project_items.handler({ item_ids: planned.map(item => item.nodeId) }) as Result;
  expect(result).toMatchObject({ success: false, data: { deleted: DELETE_BATCH_CHUNK_SIZE, chunksCompleted: 1, projectChanged: true, mutationOutcome: "unknown" } });
  expect(result.data?.items).toHaveLength(DELETE_BATCH_CHUNK_SIZE);
  expect(mutationReceipt(false, result.data, { dispatched: true }).outcome).toBe("unknown");
  expect(mockedSendCommand).toHaveBeenCalledTimes(3);
 });
