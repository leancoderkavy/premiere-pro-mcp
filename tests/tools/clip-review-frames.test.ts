import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }) }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getExportTools } from "../../src/tools/export.js";
import { mutationReceipt } from "../../src/workflows/mutation-receipt.js";

const mocked = vi.mocked(sendCommand);
const tool = getExportTools({ tempDir: "/tmp/test" }).export_sequence_clip_review_frames;
beforeEach(() => vi.clearAllMocks());

describe("export_sequence_clip_review_frames", () => {
  it("samples up to twenty clip midpoints in one bridge round trip", async () => {
    await tool.handler({ output_dir: "/tmp/review" });
    expect(mocked).toHaveBeenCalledTimes(1);
    const script = mocked.mock.calls[0][0];
    expect(script).toContain("Math.min(track.clips.numItems, 20)");
    expect(script).toContain("clip.start.seconds + ((clip.end.seconds - clip.start.seconds) / 2)");
    expect(script).toContain("__exportStillFrame(");
    expect(script).toContain("result.recoveryRequired");
  });

  it("rejects unsafe bounds before contacting Premiere", async () => {
    await expect(tool.handler({ output_dir: "/tmp", track_index: -1 })).resolves.toMatchObject({ success: false });
    await expect(tool.handler({ output_dir: "/tmp", limit: 51 })).resolves.toMatchObject({ success: false });
    expect(mocked).not.toHaveBeenCalled();
  });

  it("marks an empty video track as not applied before still export", async () => {
    await tool.handler({ output_dir: "/tmp/review", track_index: 0 });
    const script = mocked.mock.calls[0][0];
    let calls = 0;
    const result = JSON.parse(String(runInNewContext(String(script), {
      app: {
        project: {
          activeSequence: {
            videoTracks: { numTracks: 1, 0: { clips: { numItems: 0 } } },
          },
        },
      },
      Folder: function Folder(this: { exists: boolean; fsName: string }, path: string) {
        this.exists = true;
        this.fsName = path;
      },
      __exportStillFrame: () => {
        calls += 1;
        return { ok: true, path: "/tmp/review/clip_001.png", method: "qe" };
      },
      __error: (msg: string, data?: unknown) => JSON.stringify({ success: false, error: msg, data }),
      __refuse: (msg: string, data?: unknown) => JSON.stringify({ success: false, error: msg, data }),
      __result: (data: unknown) => JSON.stringify({ success: true, data }),
    })));
    expect(calls).toBe(0);
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("contains no clips"),
      data: { mutationOutcome: "not_applied", timelineChanged: false },
    });
    expect(mutationReceipt(false, result.data, { dispatched: true }, "export_sequence_clip_review_frames").outcome).toBe("not_applied");
  });
});
