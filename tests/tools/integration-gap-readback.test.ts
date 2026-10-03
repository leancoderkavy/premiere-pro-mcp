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
describe("integration gap readback", () => {
  it.each(["close_source_monitor", "close_all_source_clips"] as const)("%s verifies undefined empty state", async name => {
    let item: unknown = { nodeId: "a", name: "Audio" };
    const sourceMonitor = { getProjectItem: () => item, closeClip: () => { item = undefined; }, closeAllClips: () => { item = undefined; } };
    install({ sourceMonitor, project: {} });
    const tools = getSourceMonitorTools(opts);
    expect(name in tools).toBe(true);
    await expect(tools[name].handler()).resolves.toMatchObject({ success: true, data: { verified: true } });
  });
  it.each(["undefined", "null", "throw", "missing"])("refuses source playback with %s state", async kind => {
    const play = vi.fn();
    const sourceMonitor: Record<string, unknown> = { play };
    if (kind !== "missing") sourceMonitor.getProjectItem = () => { if (kind === "throw") throw new Error("unreadable"); return kind === "null" ? null : undefined; };
    install({ sourceMonitor });
    await expect(getPlaybackTools(opts).play_source_monitor.handler({})).resolves.toMatchObject({ success: false });
    expect(play).not.toHaveBeenCalled();
  });
});
