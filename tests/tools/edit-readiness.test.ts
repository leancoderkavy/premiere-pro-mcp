import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }) }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getInspectionTools } from "../../src/tools/inspection.js";

const mocked = vi.mocked(sendCommand);
const tool = getInspectionTools({ tempDir: "/tmp/test" }).inspect_edit_readiness;
beforeEach(() => vi.clearAllMocks());

describe("inspect_edit_readiness", () => {
  it("checks five structural defect classes in one read-only bridge call", async () => {
    await tool.handler({ primary_video_track: 0, maximum_scale_percent: 125 });
    expect(mocked).toHaveBeenCalledTimes(1);
    const script = mocked.mock.calls[0][0];
    for (const marker of ["PRIMARY_TRACK_GAP", "EMPTY_VIDEO_TIMELINE", "DISABLED_CLIP", "MUTED_TRACK", "EXCESSIVE_SCALE"]) {
      expect(script).toContain(marker);
    }
    expect(script).not.toMatch(/setMute\(|setValue\(|remove\(|insertClip\(/);
  });

  it("rejects invalid thresholds locally", async () => {
    await expect(tool.handler({ primary_video_track: -1 })).resolves.toMatchObject({ success: false });
    await expect(tool.handler({ maximum_scale_percent: 0 })).resolves.toMatchObject({ success: false });
    expect(mocked).not.toHaveBeenCalled();
  });
});
