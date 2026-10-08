import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";
import { getMediaTools } from "../../src/tools/media.js";
import { getSelectionTools } from "../../src/tools/selection.js";
const opts = { tempDir: "/tmp/backlog", timeoutMs: 1000 };
const sent = vi.mocked(sendCommand);
const target = getTrackTargetingTools(opts), media = getMediaTools(opts);
function install(item: object) { sent.mockImplementation(async script => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app: { project: { rootItem: { children: Object.assign({ numItems: 1 }, [item]) } } } })))); }
beforeEach(() => { vi.clearAllMocks(); });
describe("backlog notes", () => {
  it.each([false, true])("explains still Out verification when readable duration=%s", async readable => {
    let inside = 2, outside = 3;
    const packet = `<premierePrivateProjectMetaData:Column.Intrinsic.MediaType><rdf:value>Still Image</rdf:value></premierePrivateProjectMetaData:Column.Intrinsic.MediaType>` + (readable ? `<premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration>00:00:05:00</premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration><premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>25 fps</premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>` : "");
    install({ nodeId: 'still"\\id', name: "Still", type: 1, getProjectMetadata: () => packet, getInPoint: () => ({ seconds: inside }), getOutPoint: () => ({ seconds: outside }), clearInPoint: () => { inside = 0; }, clearOutPoint: () => { outside = 5; } });
    const result = await target.clear_item_in_out.handler({ item_id: 'still"\\id' });
    expect(result).toMatchObject({ success: readable, data: { verified: readable, stillImage: true, inSeconds: 0, outSeconds: 5 } });
    if (!readable) expect(result).toMatchObject({ error: expect.stringContaining("Still-image Out cannot be independently verified"), data: { outcome: "committed_unverified", unverifiedFields: ["outPoint"] } });
  });
  it("does not verify a still when Out clearing is ignored", async () => {
    install({ nodeId: "s", name: "Still", type: 1, getProjectMetadata: () => '<premierePrivateProjectMetaData:Column.Intrinsic.MediaType>Still Image</premierePrivateProjectMetaData:Column.Intrinsic.MediaType><premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration>00:00:05:00</premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration><premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>25 fps</premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>', getInPoint: () => ({ seconds: 0 }), getOutPoint: () => ({ seconds: 3 }), clearInPoint() {}, clearOutPoint() {} });
    expect(await target.clear_item_in_out.handler({ item_id: "s" })).toMatchObject({ success: false, data: { verified: false } });
  });
  it("shares the start-time implementation and preserves both receipts", async () => {
    let start = 0;
    install({ nodeId: 'source"\\id', type: 1, name: "Source", setStartTime: (ticks: string) => { start = Number(ticks) / 254016000000; }, startTime: () => ({ seconds: start }) });
    const args = { item_id: 'source"\\id', start_seconds: 0.5 };
    expect(await media.set_start_time.handler(args)).toMatchObject({ success: true, data: { set: true, verified: true, startSeconds: 0.5 } });
    const originalScript = sent.mock.lastCall?.[0];
    expect(await target.set_clip_start_time.handler(args)).toMatchObject({ success: true, data: { verified: true, startSeconds: 0.5 } });
    expect(sent.mock.lastCall?.[0]).toBe(originalScript);
    expect(target.set_clip_start_time.description).toContain("Alias of set_start_time");
  });
  it("both start-time names refuse ignored writes and invalid inputs", async () => {
    install({ nodeId: "s", type: 1, name: "Source", setStartTime() {}, startTime: () => ({ seconds: 0 }) });
    for (const tool of [media.set_start_time, target.set_clip_start_time]) {
      expect(await tool.handler({ item_id: "s", start_seconds: 2 })).toMatchObject({ success: false });
      expect(await tool.handler({ item_id: "s", start_seconds: NaN })).toMatchObject({ success: false });
    }
    expect(sent).toHaveBeenCalledTimes(2);
  });
  it("documents source labels and absence of timeline label access", () => {
    const description = getSelectionTools(opts).select_clips_by_color.description;
    expect(description).toContain("source project item");
    expect(description).toContain("no timeline track-item label getter");
  });
});
