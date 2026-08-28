import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }) }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getInspectionTools } from "../../src/tools/inspection.js";

const mocked = vi.mocked(sendCommand);
const tool = getInspectionTools({ tempDir: "/tmp/test" }).inspect_edit_readiness;
const reviewReport = getInspectionTools({ tempDir: "/tmp/test" }).inspect_sequence_review_report;
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

describe("inspect_sequence_review_report", () => {
  it("builds one read-only, privacy-bounded handoff report", async () => {
    await reviewReport.handler({ sequence_id: "Final Cut", primary_video_track: 1, max_markers: 25 });
    expect(mocked).toHaveBeenCalledTimes(1);
    const script = mocked.mock.calls[0][0];
    for (const marker of [
      "sequence-review-handoff",
      "PRIMARY_VIDEO_TRACK_UNAVAILABLE",
      "DISABLED_CLIP",
      "MUTED_TRACK",
      "isOffline",
      "markersTruncated",
    ]) {
      expect(script).toContain(marker);
    }
    expect(script).not.toContain("getMediaPath");
    expect(script).not.toContain("entry.comments");
    expect(script).not.toMatch(/setValue\(|remove\(|insertClip\(|save\(/);
  });

  it("includes private marker comments only after explicit opt-in", async () => {
    await reviewReport.handler({ include_marker_comments: true });
    expect(mocked.mock.calls[0][0]).toContain("entry.comments");
  });

  it("rejects invalid bounded input before using the bridge", async () => {
    await expect(reviewReport.handler({ primary_video_track: -1 })).resolves.toMatchObject({ success: false });
    await expect(reviewReport.handler({ max_markers: 201 })).resolves.toMatchObject({ success: false });
    expect(mocked).not.toHaveBeenCalled();
  });
});
