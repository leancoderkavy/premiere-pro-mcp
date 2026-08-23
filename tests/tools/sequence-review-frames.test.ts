import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getExportTools } from "../../src/tools/export.js";

const mockedSendCommand = vi.mocked(sendCommand);
const tools = getExportTools({ tempDir: "/tmp/test", timeoutMs: 1000 });

beforeEach(() => vi.clearAllMocks());

describe("export_sequence_review_frames", () => {
  it("reduces a six-frame review from six MCP/bridge calls to one bounded bridge call", async () => {
    await tools.export_sequence_review_frames.handler({ output_dir: "/tmp/review", frame_count: 6 });

    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("var requested = 6");
    expect(script).toContain("for (var i = 0; i < requested; i++)");
    expect(script).toContain("__exportStillFrame(");
    expect(script).toContain("frames.length === requested");
  });

  it("fails invalid counts and ranges before contacting Premiere", async () => {
    await expect(tools.export_sequence_review_frames.handler({ output_dir: "/tmp/review", frame_count: 25 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("2 through 24") });
    await expect(tools.export_sequence_review_frames.handler({ output_dir: "/tmp/review", start_seconds: 8, end_seconds: 4 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("greater than") });
    await expect(tools.export_sequence_review_frames.handler({ output_dir: "", frame_count: 6 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("non-empty") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("reports partial export failures instead of claiming the whole review succeeded", async () => {
    await tools.export_sequence_review_frames.handler({ output_dir: "/tmp/review", frame_count: 4 });

    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("failures.push");
    expect(script).toContain("complete: frames.length === requested");
    expect(script).toContain("Playback, audio, and editorial quality remain unverified");
  });
});
