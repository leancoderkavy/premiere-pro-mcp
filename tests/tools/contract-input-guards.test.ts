import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { getAdvancedTools } from "../../src/tools/advanced.js";
import { getPlayheadTools } from "../../src/tools/playhead.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn(),
  getTempDir: vi.fn().mockReturnValue("/tmp/premiere-contract-guards"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
beforeEach(() => vi.clearAllMocks());

describe("contract input guards", () => {
  it("rejects empty timeline names before contacting Premiere", async () => {
    const tool = getAdvancedTools({ tempDir: "/tmp/premiere-contract-guards" }).rename_clip;
    await expect(tool.handler({ node_id: "clip", new_name: "  " })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("empty"),
    });
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("rejects negative and nonfinite playhead times before contacting Premiere", async () => {
    const tool = getPlayheadTools({ tempDir: "/tmp/premiere-contract-guards" }).set_playhead_position;
    for (const time_seconds of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(tool.handler({ time_seconds })).resolves.toMatchObject({
        success: false,
        error: expect.stringContaining("finite, non-negative"),
      });
    }
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("clamps excessive playhead times and reports the host readback", async () => {
    let position = "0";
    const sequence = {
      end: String(10 * 254016000000),
      timebase: String(254016000000 / 25),
      setPlayerPosition(ticks: string) { position = ticks; },
      getPlayerPosition() { return { ticks: position }; },
    };
    vi.mocked(sendCommand).mockImplementation(async (script) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app: { project: { activeSequence: sequence } } }))));
    const tool = getPlayheadTools({ tempDir: "/tmp/premiere-contract-guards" }).set_playhead_position;
    await expect(tool.handler({ time_seconds: 999999 })).resolves.toMatchObject({
      success: true, data: { requestedSeconds: 999999, positionSeconds: 10, clamped: true, verified: true },
    });
  });
});
