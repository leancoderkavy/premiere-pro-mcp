import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getExportTools } from "../../src/tools/export.js";
import { mutationReceipt } from "../../src/workflows/mutation-receipt.js";

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
    expect(script).toContain("result.recoveryRequired");
    expect(script).toContain("verified on disk by the Premiere bridge at the matched marker start");
  });

  it("marks an empty marker search as not applied before still export", async () => {
    await tool.handler({ output_dir: "/tmp/review", start_seconds: 0, end_seconds: 5 });
    const script = mockedSendCommand.mock.calls[0][0];
    let calls = 0;
    const TICKS = 254016000000;
    const result = JSON.parse(String(runInNewContext(String(script), {
      app: {
        project: {
          activeSequence: {
            name: "Seq",
            end: String(TICKS * 10),
            markers: { getFirstMarker: () => null, getNextMarker: () => null },
          },
        },
      },
      Folder: function Folder(this: { exists: boolean; fsName: string }, path: string) {
        this.exists = true;
        this.fsName = path;
      },
      __ticksToSeconds: (ticks: string | number) => Number(ticks) / TICKS,
      __secondsToTicks: (seconds: number) => Math.round(seconds * TICKS),
      __exportStillFrame: () => {
        calls += 1;
        return { ok: true, path: "/tmp/review/marker_review_001.png", method: "qe" };
      },
      __error: (msg: string, data?: unknown) => JSON.stringify({ success: false, error: msg, data }),
      __result: (data: unknown) => JSON.stringify({ success: true, data }),
    })));
    expect(calls).toBe(0);
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("No matching sequence markers"),
      data: { mutationOutcome: "not_applied", timelineChanged: false },
    });
    expect(mutationReceipt(false, result.data, { dispatched: true }, "export_sequence_marker_review_frames").outcome).toBe("not_applied");
  });
});
