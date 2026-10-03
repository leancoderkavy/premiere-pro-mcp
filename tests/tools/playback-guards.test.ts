import { describe, it, expect, vi, beforeEach } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getPlaybackTools } from "../../src/tools/playback.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/test-bridge", timeoutMs: 5000 };

async function playSource(args: { speed?: number }, sourceMonitor: Record<string, unknown>) {
  mockedSendCommand.mockClear();
  const result = await getPlaybackTools(bridgeOptions).play_source_monitor.handler(args);
  if (!mockedSendCommand.mock.calls.length) return result as { success: boolean; error?: string };
  const script = mockedSendCommand.mock.calls[0][0] as string;
  return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app: { sourceMonitor } })));
}

beforeEach(() => vi.clearAllMocks());

describe("play_source_monitor guards (#642)", () => {
  it("fails without playing when no clip is loaded", async () => {
    const play = vi.fn();
    const result = await playSource({}, { getProjectItem: () => null, play });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("No clip is loaded") });
    expect(play).not.toHaveBeenCalled();
  });

  it("plays the loaded clip and names it", async () => {
    const play = vi.fn();
    const result = await playSource({ speed: 2 }, { getProjectItem: () => ({ name: "A001.mov" }), play });
    expect(result).toMatchObject({ success: true, data: { playbackRequested: true, playbackVerified: false, speed: 2, clip: "A001.mov" } });
    expect(play).toHaveBeenCalledWith(2);
  });

  it("refuses playback on hosts without getProjectItem", async () => {
    const play = vi.fn();
    const result = await playSource({}, { play });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("Cannot confirm Source Monitor state") });
    expect(play).not.toHaveBeenCalled();
  });

  it("rejects a speed that is not a usable number before building a script", async () => {
    for (const speed of [0, 100, Number.NaN, "1); app.quit(" as unknown as number]) {
      const result = await playSource({ speed }, {});
      expect(result).toMatchObject({ success: false, error: expect.stringContaining("speed must be") });
    }
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

describe("stop_playback target (#642)", () => {
  it("refuses target source without stopping anything", async () => {
    mockedSendCommand.mockClear();
    const result = await getPlaybackTools(bridgeOptions).stop_playback.handler({ target: "source" });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("no documented call that stops only the Source Monitor") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("rejects an unknown target and still stops the timeline by default", async () => {
    mockedSendCommand.mockClear();
    const tools = getPlaybackTools(bridgeOptions);
    expect(await tools.stop_playback.handler({ target: "program" })).toMatchObject({ success: false });
    expect(mockedSendCommand).not.toHaveBeenCalled();
    await tools.stop_playback.handler({});
    expect(mockedSendCommand.mock.calls[0][0]).toContain("qe.stopPlayback()");
  });
});
