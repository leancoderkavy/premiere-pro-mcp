import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";
import { getMediaTools } from "../../src/tools/media.js";
import { getUtilityTools } from "../../src/tools/utility.js";
import { getProjectTools } from "../../src/tools/project.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/project-items", timeoutMs: 5000 };
type Result = { success: boolean; error?: string; data?: Record<string, unknown> };
beforeEach(() => vi.clearAllMocks());

/** Project with a root bin holding a used clip (on a timeline) and an unused Bars item. */
function project(options: { startTimeWritable?: boolean; existingBin?: string; deleteBinNoop?: boolean; frameTicks?: number; offlineBars?: boolean; usedInBin?: boolean; sequenceInBin?: boolean; nestSequence?: boolean } = {}) {
  let startTicks = 0;
  type Node = { nodeId: string; name: string; type: number; children?: { numItems: number; [i: number]: Node }; parent?: Node };
  const makeBin = (nodeId: string, name: string): Node => ({ nodeId, name, type: 2, children: { numItems: 0 } });
  const root = makeBin("root", "Project");
  const add = (bin: Node, child: Node) => { const kids = bin.children!; kids[kids.numItems] = child; kids.numItems++; child.parent = bin; };
  const remove = (bin: Node, child: Node) => {
    const kids = bin.children!; const list: Node[] = [];
    for (let i = 0; i < kids.numItems; i++) if (kids[i] !== child) list.push(kids[i]);
    for (let i = 0; i < kids.numItems; i++) delete kids[i];
    list.forEach((n, i) => { kids[i] = n; }); kids.numItems = list.length;
  };
  const used = { nodeId: "used", name: "Interview A.mp4", type: 1, startTime: () => ({ seconds: startTicks / 254016000000 }), setStartTime: (t: string) => { if (options.startTimeWritable !== false) startTicks = parseFloat(t); } } as Node & Record<string, unknown>;
  const bars = { nodeId: "bars", name: "Bars 1080p", type: 1 } as Node & Record<string, unknown>;
  if (options.offlineBars) (bars as Record<string, unknown>).isOffline = () => true;
  const oldBin = makeBin("oldbin", "Old Bin") as Node & Record<string, unknown>;
  oldBin.deleteBin = () => remove(root, oldBin);
  if (options.usedInBin) add(root, oldBin);
  for (const item of [used, bars]) {
    add(options.usedInBin && item === used ? oldBin : root, item);
    (item as Record<string, unknown>).moveBin = (bin: Node) => { remove(item.parent!, item); add(bin, item); };
  }
  (root as Record<string, unknown>).createBin = (name: string) => {
    const bin = makeBin(`bin-${name}`, name) as Node & Record<string, unknown>;
    bin.deleteBin = () => { if (!options.deleteBinNoop) remove(root, bin); };
    add(root, bin);
    return bin;
  };
  if (options.existingBin) add(root, makeBin("user-bin", options.existingBin));
  const timelineClip = { projectItem: used, name: used.name };
  const seqItem = { nodeId: "seqitem", name: "Edit", type: 1, isSequence: () => true } as Node & Record<string, unknown>;
  if (options.sequenceInBin) {
    const sequencesBin = makeBin("seqbin", "Sequences") as Node & Record<string, unknown>;
    sequencesBin.deleteBin = () => remove(root, sequencesBin);
    add(root, sequencesBin);
    add(sequencesBin, seqItem);
  } else if (options.nestSequence) {
    add(root, seqItem);
  }
  const seq = { name: "Edit", sequenceID: "edit-seq", timebase: String(options.frameTicks ?? 254016000000 / 25), videoTracks: { numTracks: 1, 0: { clips: { numItems: 1, 0: timelineClip } } }, audioTracks: { numTracks: 0 }, projectItem: seqItem };
  const sequences: { numSequences: number; [i: number]: typeof seq } = { numSequences: 1, 0: seq };
  if (options.nestSequence) {
    const nestClip = { projectItem: seqItem, name: "Edit" };
    sequences[1] = { name: "Master", sequenceID: "master-seq", timebase: seq.timebase, videoTracks: { numTracks: 1, 0: { clips: { numItems: 1, 0: nestClip } } }, audioTracks: { numTracks: 0 }, projectItem: { nodeId: "masteritem" } };
    sequences.numSequences = 2;
  }
  mockedSendCommand.mockImplementation(async (script: string) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
    app: { project: { rootItem: root, sequences, activeSequence: seq } },
    // A fixed clock, so the temporary bin name ("mcp-delete-1000") is predictable.
    Date: function FixedDate(this: { getTime: () => number }) { this.getTime = () => 1000; },
    Time: function Time(this: { ticks: string; seconds: number }) { let s = 0; Object.defineProperty(this, "seconds", { get: () => s, set: (v: number) => { s = v; } }); Object.defineProperty(this, "ticks", { get: () => String(Math.round(s * 254016000000)) }); },
  }))));
  const names = () => { const out: string[] = []; for (let i = 0; i < root.children!.numItems; i++) out.push(root.children![i].name); return out; };
  return { names };
}

describe("set_poster_frame", () => {
  it("fails without touching Premiere (it used to reset the frame rate to ~0 fps)", async () => {
    const result = await getTrackTargetingTools(bridgeOptions).set_poster_frame.handler({ item_id: "used", time_seconds: 26 }) as Result;
    expect(result.success).toBe(false);
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

describe("start time", () => {
  it("set_start_time and set_clip_start_time verify the readback", async () => {
    project();
    await expect(getMediaTools(bridgeOptions).set_start_time.handler({ item_id: "used", start_seconds: 3600 })).resolves.toMatchObject({ success: true, data: { verified: true, startSeconds: 3600 } });
    await expect(getTrackTargetingTools(bridgeOptions).set_clip_start_time.handler({ item_id: "used", start_seconds: 10 })).resolves.toMatchObject({ success: true, data: { verified: true } });
  });

  it("reports failure when Premiere ignores the write", async () => {
    project({ startTimeWritable: false });
    await expect(getMediaTools(bridgeOptions).set_start_time.handler({ item_id: "used", start_seconds: 3600 })).resolves.toMatchObject({ success: false });
  });

  it.each([23.976, 29.97, 25])("keeps project-item source offset independent of the %s fps active sequence grid", async (fps) => {
    const frameTicks = 254016000000 * (fps === 23.976 ? 1001 / 24000 : fps === 29.97 ? 1001 / 30000 : 1 / 25);
    project({ frameTicks });
    const result = await getTrackTargetingTools(bridgeOptions).set_clip_start_time.handler({ item_id: "used", start_seconds: 0.5 }) as Result;
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ startSeconds: 0.5, verified: true });
    expect(result.data).not.toHaveProperty("appliedSeconds");
  });
});

describe("delete_project_item for clip items", () => {
  it("deletes an unused item through a temporary bin and leaves no bin behind", async () => {
    const { names } = project();
    await expect(getUtilityTools(bridgeOptions).delete_project_item.handler({ item_id: "bars" })).resolves.toMatchObject({ success: true, data: { deleted: true, verified: true } });
    expect(names()).toEqual(["Interview A.mp4"]);
  });

  it("refuses an item that is used on a timeline", async () => {
    const { names } = project();
    const result = await getUtilityTools(bridgeOptions).delete_project_item.handler({ item_id: "used" }) as Result;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/used by 1 timeline clip\(s\) in Edit/);
    expect(result.error).toContain("confirm_remove_from_sequences");
    expect(names()).toEqual(["Interview A.mp4", "Bars 1080p"]);
  });

  it("deletes a used item only when the caller confirms, and reports the timeline clips it removes", async () => {
    const { names } = project();
    await expect(getUtilityTools(bridgeOptions).delete_project_item.handler({ item_id: "used", confirm_remove_from_sequences: true }))
      .resolves.toMatchObject({ success: true, data: { deleted: true, verified: true, timelineClipsRemoved: 1, sequencesChanged: ["Edit"] } });
    expect(names()).toEqual(["Bars 1080p"]);
  });

  it("refuses when a bin with the temporary name already exists", async () => {
    const { names } = project({ existingBin: "mcp-delete-1000" });
    await expect(getUtilityTools(bridgeOptions).delete_project_item.handler({ item_id: "bars" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("already exists") });
    expect(names()).toEqual(["Interview A.mp4", "Bars 1080p", "mcp-delete-1000"]);
  });

  it("reports failure, not success, when the temporary bin and item survive", async () => {
    project({ deleteBinNoop: true });
    const result = await getUtilityTools(bridgeOptions).delete_project_item.handler({ item_id: "bars" }) as Result;
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("The project changed") });
    expect(result.error).toContain("still in the project");
  });

  it("names the documented UXP route as preferred", () => {
    const tools = getUtilityTools(bridgeOptions);
    for (const tool of [tools.delete_project_item, tools.delete_multiple_project_items]) {
      expect(tool.description).toContain("organize_project_items_uxp with action 'remove'");
      expect(tool.description).toContain("preferred");
    }
  });

  it("delete_multiple_project_items refuses a used item before deleting anything", async () => {
    const { names } = project();
    await expect(getUtilityTools(bridgeOptions).delete_multiple_project_items.handler({ item_ids: ["bars", "used"] }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("No project items were deleted") });
    expect(names()).toEqual(["Interview A.mp4", "Bars 1080p"]);
  });
});

describe("timeline-usage and offline guards", () => {
  it("find_item_usages lists sequences and tracks for an item and for a bin's contents", async () => {
    project({ usedInBin: true });
    const result = await getUtilityTools(bridgeOptions).find_item_usages.handler({ item_ids: ["Old Bin", "bars"] }) as Result;
    expect(result).toMatchObject({
      success: true,
      data: {
        usedItems: 1,
        safeToDelete: false,
        items: [
          { name: "Old Bin", isBin: true, used: true, timelineClips: 1, sequences: [{ sequence: "Edit", clips: 1, tracks: [{ type: "video", index: 0, clips: 1 }] }] },
          { name: "Bars 1080p", used: false, timelineClips: 0, sequences: [] },
        ],
      },
    });
    await expect(getUtilityTools(bridgeOptions).find_item_usages.handler({ item_ids: [] }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("item_ids") });
  });

  it("delete_bin refuses a bin whose contents are on a timeline and lists where", async () => {
    const { names } = project({ usedInBin: true });
    const result = await getProjectTools(bridgeOptions).delete_bin.handler({ bin_id: "Old Bin" }) as Result;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/holds media used by 1 timeline clip\(s\) in Edit/);
    expect(result.data).toMatchObject({ code: "ITEM_IN_USE", usages: [{ sequence: "Edit", tracks: [{ type: "video", index: 0 }] }] });
    expect(names()).toContain("Old Bin");
    await expect(getProjectTools(bridgeOptions).delete_bin.handler({ bin_id: "Old Bin", confirm_remove_from_sequences: true }))
      .resolves.toMatchObject({ success: true, data: { deleted: true, verified: true, timelineClipsRemoved: 1, sequencesChanged: ["Edit"] } });
    expect(names()).not.toContain("Old Bin");
  });

  it("delete_bin refuses a Sequences bin whose media lives in another bin", async () => {
    const { names } = project({ sequenceInBin: true });
    const listed = await getUtilityTools(bridgeOptions).find_item_usages.handler({ item_ids: ["Sequences"] }) as Result;
    expect(listed).toMatchObject({
      success: true,
      data: { usedItems: 1, safeToDelete: false, items: [{ name: "Sequences", used: true, timelineClips: 1, sequences: [{ sequence: "Edit" }] }] },
    });
    const result = await getProjectTools(bridgeOptions).delete_bin.handler({ bin_id: "Sequences" }) as Result;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/holds media used by 1 timeline clip\(s\) in Edit/);
    expect(result.data).toMatchObject({ code: "ITEM_IN_USE", usages: [{ sequence: "Edit", tracks: [{ type: "video", index: 0 }] }] });
    expect(names()).toContain("Sequences");
  });

  it("delete_project_item refuses a sequence nested on another timeline", async () => {
    const { names } = project({ nestSequence: true });
    const result = await getUtilityTools(bridgeOptions).delete_project_item.handler({ item_id: "seqitem" }) as Result;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/used by 1 timeline clip\(s\) in Master/);
    expect(result.data).toMatchObject({ code: "ITEM_IN_USE" });
    expect(names()).toContain("Edit");
    await expect(getUtilityTools(bridgeOptions).delete_multiple_project_items.handler({ item_ids: ["bars", "seqitem"] }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("No project items were deleted") });
    expect(names()).toEqual(expect.arrayContaining(["Interview A.mp4", "Bars 1080p", "Edit"]));
  });

  it("refuses offline media unless allow_offline is true", async () => {
    const { names } = project({ offlineBars: true });
    await expect(getUtilityTools(bridgeOptions).delete_project_item.handler({ item_id: "bars" }))
      .resolves.toMatchObject({ success: false, data: { code: "ITEM_OFFLINE", offlineItems: ["Bars 1080p"] } });
    await expect(getUtilityTools(bridgeOptions).delete_multiple_project_items.handler({ item_ids: ["bars"] }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("No project items were deleted") });
    expect(names()).toContain("Bars 1080p");
    await expect(getUtilityTools(bridgeOptions).delete_project_item.handler({ item_id: "bars", allow_offline: true }))
      .resolves.toMatchObject({ success: true, data: { deleted: true } });
    expect(names()).not.toContain("Bars 1080p");
  });
});
