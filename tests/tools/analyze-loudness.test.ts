import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getAudioTools, parseEbur128Summary } from "../../src/tools/audio.js";

const mockedSendCommand = vi.mocked(sendCommand);
const tools = getAudioTools({ tempDir: "/tmp/test", timeoutMs: 1000 });

beforeEach(() => vi.clearAllMocks());

describe("parseEbur128Summary", () => {
  it("extracts the final integrated loudness, range, and true peak", () => {
    const output = `
Summary:

  Integrated loudness:
    I:         -16.2 LUFS
    Threshold: -26.2 LUFS

  Loudness range:
    LRA:         4.1 LU

  True peak:
    Peak:       -1.3 dBFS
`;
    expect(parseEbur128Summary(output)).toEqual({
      integratedLufs: -16.2,
      loudnessRangeLu: 4.1,
      truePeakDbfs: -1.3,
    });
  });

  it("reports digital silence as unmeasurable instead of fabricating a number", () => {
    const output = `Integrated loudness:\n I: -inf LUFS\nLoudness range:\n LRA: 0.0 LU\nTrue peak:\n Peak: -inf dBFS`;
    expect(parseEbur128Summary(output)).toEqual({
      integratedLufs: null,
      loudnessRangeLu: 0,
      truePeakDbfs: null,
    });
  });
});

describe("analyze_loudness argument boundary", () => {
  it("rejects invalid targets before contacting Premiere or FFmpeg", async () => {
    await expect(tools.analyze_loudness.handler({ media_path: "missing.wav", target_lufs: 4 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("target_lufs") });
    await expect(tools.analyze_loudness.handler({ media_path: "missing.wav", tolerance_lu: -1 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("tolerance_lu") });
    await expect(tools.analyze_loudness.handler({}))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("media_path") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("resolves project-item paths through one read-only bridge call", async () => {
    mockedSendCommand.mockResolvedValueOnce({ success: false, error: "Project item not found" });
    const result = await tools.analyze_loudness.handler({ project_item_id: "missing" });
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
    expect(mockedSendCommand.mock.calls[0][0]).toContain("getMediaPath");
    expect(result).toMatchObject({ success: false, error: "Project item not found" });
  });
});
