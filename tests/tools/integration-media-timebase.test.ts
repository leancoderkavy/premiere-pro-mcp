import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn(), sendRawCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getSourceMonitorTools } from "../../src/tools/source-monitor.js";
import { getPlaybackTools } from "../../src/tools/playback.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";
const opts = { tempDir: "/tmp/integration-gap", timeoutMs: 5000 };
function install(app: unknown) {
  vi.mocked(sendCommand).mockImplementation(async script => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app }))));
}
describe("independent media duration", () => {
  it.each([
    ["00:00:04:15", "25.00 fps", 4.6], ["00:00:06:24000", "48000 Hz", 6.5],
  ])("verifies full duration %s using MediaTimebase %s", async (duration, timebase, out) => {
    const item = { nodeId: "a", name: "Media", type: 1, getInPoint: () => ({ seconds: 0 }), getOutPoint: () => ({ seconds: out }), clearInPoint() {}, clearOutPoint() {}, getProjectMetadata: () => `<premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration>${duration}</premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration><premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>${timebase}</premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>` };
    install({ project: { rootItem: { children: Object.assign({ numItems: 1 }, [item]) } } });
    await expect(getTrackTargetingTools(opts).clear_item_in_out.handler({ item_id: "a" })).resolves.toMatchObject({ success: true, data: { verified: true, outSeconds: out } });
  });
  it.each(["", "0 fps", "48000 Hz", "NaN fps"])("leaves unknown or incompatible duration %s unverified and reports In separately", async rate => {
    const item = { nodeId: "a", name: "Media", type: 1, getInPoint: () => ({ seconds: 0 }), getOutPoint: () => ({ seconds: 4.6 }), clearInPoint() {}, clearOutPoint() {}, getProjectMetadata: () => `<premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration>00:00:04:15</premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration><premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>${rate}</premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>` };
    install({ project: { rootItem: { children: Object.assign({ numItems: 1 }, [item]) } } });
    await expect(getTrackTargetingTools(opts).clear_item_in_out.handler({ item_id: "a" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("In cleared to 0 s; Out could not"), data: { outcome: "committed_unverified", unverifiedFields: ["outPoint"] } });
    expect(String(vi.mocked(sendCommand).mock.lastCall?.[0])).toContain("\\s+");
  });
});
