import { describe, expect, it } from "vitest";
import { getExportTools, parseVideoQcOutput } from "../../src/tools/export.js";

describe("parseVideoQcOutput", () => {
  it("returns exact black and freeze intervals", () => {
    const stderr = [
      "[blackdetect] black_start:0 black_end:1.25 black_duration:1.25",
      "[freezedetect] lavfi.freezedetect.freeze_start: 2.5",
      "[freezedetect] lavfi.freezedetect.freeze_duration: 1.5",
      "[freezedetect] lavfi.freezedetect.freeze_end: 4",
    ].join("\n");
    expect(parseVideoQcOutput(stderr)).toEqual({
      blackFrames: [{ start: 0, end: 1.25, duration: 1.25 }],
      freezes: [{ start: 2.5, end: 4, duration: 1.5 }],
    });
  });
});

describe("analyze_video_qc boundary", () => {
  const tool = getExportTools({ tempDir: "/tmp/test" }).analyze_video_qc;
  it("rejects invalid thresholds and missing files before FFmpeg", async () => {
    await expect(tool.handler({ media_path: "missing.mp4", minimum_black_seconds: 0 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("minimum_black_seconds") });
    await expect(tool.handler({ media_path: "missing.mp4" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("not found") });
  });
});
