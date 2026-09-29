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
import { getMediaTools } from "../../src/tools/media.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/test-bridge", timeoutMs: 5000 };

/** One still on the project root whose refresh and restore behaviour is scripted per test. */
function host(options: { rate: number; afterRefresh: number; restoreSticks?: boolean }) {
  const state = { rate: options.rate, refreshed: 0, restores: [] as number[] };
  const item = {
    nodeId: "still-1",
    name: "poster.png",
    type: 1,
    getFootageInterpretation: () => ({ frameRate: state.rate, pixelAspectRatio: 1 }),
    setFootageInterpretation: (interp: { frameRate: number }) => {
      state.restores.push(interp.frameRate);
      if (options.restoreSticks !== false) state.rate = interp.frameRate;
      return true;
    },
    refreshMedia: () => { state.refreshed += 1; state.rate = options.afterRefresh; },
  };
  const root = { children: { numItems: 1, 0: item }, type: 3, name: "Project" };
  return { app: { project: { rootItem: root } }, state };
}

async function refresh(app: unknown) {
  mockedSendCommand.mockClear();
  await getMediaTools(bridgeOptions).refresh_media.handler({ item_id: "still-1" });
  const script = mockedSendCommand.mock.calls[0][0] as string;
  return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app })));
}

beforeEach(() => vi.clearAllMocks());

describe("refresh_media frame-rate guard (#642)", () => {
  it("restores and reads back a rate the refresh corrupted", async () => {
    const { app, state } = host({ rate: 29.97, afterRefresh: 2.75e-8 });
    const result = await refresh(app);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ frameRateBefore: 29.97, frameRateAfter: 29.97, frameRateAfterRefresh: 2.75e-8, repaired: true });
    expect(state.restores).toEqual([29.97]);
  });

  it("keeps a real rate change from the source file", async () => {
    const { app, state } = host({ rate: 29.97, afterRefresh: 25 });
    const result = await refresh(app);
    expect(result.data).toMatchObject({ frameRateBefore: 29.97, frameRateAfter: 25, repaired: false });
    expect(state.restores).toEqual([]);
  });

  it("fails with the manual fix when the restore does not stick", async () => {
    const { app } = host({ rate: 23.976, afterRefresh: 0, restoreSticks: false });
    const result = await refresh(app);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/could not be restored/);
    expect(result.error).toMatch(/set_footage_interpretation frame_rate 23\.976/);
  });
});
