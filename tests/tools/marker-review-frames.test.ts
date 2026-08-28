import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getExportTools } from "../../src/tools/export.js";

const mockedSendCommand = vi.mocked(sendCommand);
const tool = getExportTools({ tempDir: "/tmp/test", timeoutMs: 1000 }).export_sequence_marker_review_frames;

beforeEach(() => vi.clearAllMocks());

describe("export_sequence_marker_review_frames", () => {
  it("exports chronological marker anchors in one bounded bridge request", async () => {
    await tool.handler({
      output_dir: "/tmp/review",
      marker_type: "Comment",
      start_seconds: 2,
      end_seconds: 18,
      limit: 8,
    });

    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain('var requiredType = "Comment"');
    expect(script).toContain("matched.sort(function(a, b)");
    expect(script).toContain("var requested = Math.min(matched.length, 8)");
    expect(script).toContain("marker_review_");
    expect(script).toContain("__exportStillFrame(");
    expect(script).toContain("truncated: matched.length > requested");
  });

  it("rejects invalid filters and bounds before contacting Premiere", async () => {
    await expect(tool.handler({ output_dir: "/tmp/review", limit: 25 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("1 through 24") });
    await expect(tool.handler({ output_dir: "/tmp/review", marker_type: " " }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("non-empty") });
    await expect(tool.handler({ output_dir: "/tmp/review", start_seconds: 9, end_seconds: 2 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("greater than") });
    await expect(tool.handler({ output_dir: "", limit: 1 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("non-empty") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("reports file verification and partial-export boundaries in the generated request", async () => {
    await tool.handler({ output_dir: "/tmp/review", limit: 2 });

    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("failures.push");
    expect(script).toContain("complete: frames.length === requested");
    expect(script).toContain("verified on disk by the Premiere bridge at the matched marker start");
  });
});
