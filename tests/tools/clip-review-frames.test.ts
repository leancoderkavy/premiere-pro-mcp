import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }) }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getExportTools } from "../../src/tools/export.js";

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
  });

  it("rejects unsafe bounds before contacting Premiere", async () => {
    await expect(tool.handler({ output_dir: "/tmp", track_index: -1 })).resolves.toMatchObject({ success: false });
    await expect(tool.handler({ output_dir: "/tmp", limit: 51 })).resolves.toMatchObject({ success: false });
    expect(mocked).not.toHaveBeenCalled();
  });
});
