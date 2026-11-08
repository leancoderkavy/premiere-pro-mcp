import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getExportTools } from "../../src/tools/export.js";
import { mutationReceipt } from "../../src/workflows/mutation-receipt.js";

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
    await expect(tools.export_sequence_review_frames.handler({ output_dir: "/tmp/review", frame_count: 1 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("2 through 24") });
    await expect(tools.export_sequence_review_frames.handler({ output_dir: "/tmp/review", start_seconds: 8, end_seconds: 4 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("greater than") });
    await expect(tools.export_sequence_review_frames.handler({ output_dir: "/tmp/review", start_seconds: -1 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("non-negative") });
    await expect(tools.export_sequence_review_frames.handler({ output_dir: "", frame_count: 6 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("non-empty") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("reports partial export failures instead of claiming the whole review succeeded", async () => {
    await tools.export_sequence_review_frames.handler({ output_dir: "/tmp/review", frame_count: 4 });

    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain("failures.push");
    expect(script).toContain("complete: frames.length === requested");
    expect(script).toContain("result.recoveryRequired");
    expect(script).toContain("Temporal animation, playback, audio, and editorial quality remain unverified");
  });

  it("stops the batch after sequence-mark recovery instead of returning success", async () => {
    await tools.export_sequence_review_frames.handler({ output_dir: "/tmp/review", frame_count: 4 });
    const script = mockedSendCommand.mock.calls[0][0];
    let calls = 0;
    const TICKS = 254016000000;
    const result = JSON.parse(String(runInNewContext(String(script), {
      app: { project: { activeSequence: { name: "Seq", end: String(TICKS * 10), sequenceID: "s1" } } },
      Folder: function Folder(this: { exists: boolean; fsName: string }, path: string) {
        this.exists = true;
        this.fsName = path;
      },
      __ticksToSeconds: (ticks: string | number) => Number(ticks) / TICKS,
      __secondsToTicks: (seconds: number) => Math.round(seconds * TICKS),
      __exportStillFrame: () => {
        calls += 1;
        return { ok: false, recoveryRequired: true, error: "unrestored", notes: ["AME"] };
      },
      __error: (msg: string, data?: unknown) => JSON.stringify({ success: false, error: msg, data }),
      __result: (data: unknown) => JSON.stringify({ success: true, data }),
    })));
    expect(calls).toBe(1);
    expect(result).toMatchObject({ success: false, error: "unrestored" });
  });

  it("marks a review range past the sequence end as not applied before still export", async () => {
    await tools.export_sequence_review_frames.handler({ output_dir: "/tmp/review", frame_count: 4, start_seconds: 15 });
    const script = mockedSendCommand.mock.calls[0][0];
    let calls = 0;
    const TICKS = 254016000000;
    const result = JSON.parse(String(runInNewContext(String(script), {
      app: { project: { activeSequence: { name: "Seq", end: String(TICKS * 10), sequenceID: "s1" } } },
      Folder: function Folder(this: { exists: boolean; fsName: string }, path: string) {
        this.exists = true;
        this.fsName = path;
      },
      __ticksToSeconds: (ticks: string | number) => Number(ticks) / TICKS,
      __secondsToTicks: (seconds: number) => Math.round(seconds * TICKS),
      __exportStillFrame: () => {
        calls += 1;
        return { ok: true, path: "/tmp/review/review_001.png", method: "qe" };
      },
      __error: (msg: string, data?: unknown) => JSON.stringify({ success: false, error: msg, data }),
      __result: (data: unknown) => JSON.stringify({ success: true, data }),
    })));
    expect(calls).toBe(0);
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("empty or outside"),
      data: { mutationOutcome: "not_applied", timelineChanged: false },
    });
    expect(mutationReceipt(false, result.data, { dispatched: true }, "export_sequence_review_frames").outcome).toBe("not_applied");
  });
});
