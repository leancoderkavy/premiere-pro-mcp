import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockedExecFile, mockedExecFileAsync } = vi.hoisted(() => {
  const mockedExecFileAsync = vi.fn();
  const mockedExecFile = vi.fn();
  mockedExecFile[Symbol.for("nodejs.util.promisify.custom")] = mockedExecFileAsync;
  return { mockedExecFile, mockedExecFileAsync };
});

vi.mock("node:child_process", () => ({ execFile: mockedExecFile }));

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
  beforeEach(() => vi.clearAllMocks());

  it("rejects invalid thresholds and missing files before FFmpeg", async () => {
    await expect(tool.handler({ media_path: "missing.mp4", minimum_black_seconds: 0 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("minimum_black_seconds") });
    await expect(tool.handler({ media_path: "missing.mp4" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("not found") });
    await expect(tool.handler({ media_path: "missing.mp4", minimum_freeze_seconds: 0 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("minimum_freeze_seconds") });
  });

  it("reports decoded findings without modifying the delivery file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-video-qc-"));
    const mediaPath = join(directory, "delivery.mp4");
    writeFileSync(mediaPath, "video-fixture");
    mockedExecFileAsync.mockResolvedValueOnce({
      stdout: "",
      stderr: [
        "black_start:0 black_end:1.25 black_duration:1.25",
        "lavfi.freezedetect.freeze_start: 2.5",
        "lavfi.freezedetect.freeze_end: 4",
      ].join("\n"),
    });

    await expect(tool.handler({ media_path: mediaPath, minimum_black_seconds: 1, minimum_freeze_seconds: 1 }))
      .resolves.toMatchObject({
        success: true,
        data: {
          mediaPath,
          passes: false,
          blackFrames: [{ start: 0, end: 1.25, duration: 1.25 }],
          freezes: [{ start: 2.5, end: 4, duration: 1.5 }],
        },
      });
    expect(mockedExecFileAsync).toHaveBeenCalledTimes(1);
  });

  it("preserves a non-timeout FFmpeg failure detail", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-video-qc-error-"));
    const mediaPath = join(directory, "delivery.mp4");
    writeFileSync(mediaPath, "video-fixture");
    mockedExecFileAsync.mockRejectedValueOnce(Object.assign(new Error("decode failed"), { stderr: "invalid stream" }));

    await expect(tool.handler({ media_path: mediaPath }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("invalid stream") });
  });
});
