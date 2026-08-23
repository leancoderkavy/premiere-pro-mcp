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

import { getExportTools, parseSceneChangeOutput } from "../../src/tools/export.js";

describe("parseSceneChangeOutput", () => {
  it("pairs times with scores and keeps the strongest nearby event", () => {
    const output = [
      "n:1 pts:100 pts_time:1.00",
      "lavfi.scene_score=0.40",
      "n:2 pts:110 pts_time:1.10",
      "lavfi.scene_score=0.75",
      "n:3 pts:300 pts_time:3.00",
      "lavfi.scene_score=0.55",
    ].join("\n");
    expect(parseSceneChangeOutput(output, 0.25)).toEqual([
      { timeSeconds: 1.1, score: 0.75 },
      { timeSeconds: 3, score: 0.55 },
    ]);
  });
});

describe("detect_source_scene_changes boundary", () => {
  const tool = getExportTools({ tempDir: "/tmp/test" }).detect_source_scene_changes;
  beforeEach(() => vi.clearAllMocks());

  it("rejects invalid thresholds and missing files", async () => {
    await expect(tool.handler({ media_path: "missing.mp4", threshold: 2 })).resolves.toMatchObject({ success: false });
    await expect(tool.handler({ media_path: "missing.mp4", minimum_interval_seconds: -1 })).resolves.toMatchObject({ success: false });
    await expect(tool.handler({ media_path: "missing.mp4", maximum_events: 0 })).resolves.toMatchObject({ success: false });
    await expect(tool.handler({ media_path: "missing.mp4" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("not found") });
  });

  it("returns bounded source-relative scene candidates from one local FFmpeg pass", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-scene-detect-"));
    const mediaPath = join(directory, "source.mp4");
    writeFileSync(mediaPath, "video-fixture");
    mockedExecFileAsync.mockResolvedValueOnce({
      stdout: "n:1 pts:100 pts_time:1.00\nlavfi.scene_score=0.40\nn:2 pts:300 pts_time:3.00\nlavfi.scene_score=0.55",
      stderr: "",
    });

    await expect(tool.handler({ media_path: mediaPath, threshold: 0.3, minimum_interval_seconds: 0.25, maximum_events: 1 }))
      .resolves.toMatchObject({
        success: true,
        data: {
          mediaPath,
          totalDetected: 2,
          truncated: true,
          sceneChanges: [{ timeSeconds: 1, score: 0.4 }],
        },
      });
    expect(mockedExecFileAsync).toHaveBeenCalledTimes(1);
  });

  it("keeps an FFmpeg scene-detection failure explicit", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-scene-error-"));
    const mediaPath = join(directory, "source.mp4");
    writeFileSync(mediaPath, "video-fixture");
    mockedExecFileAsync.mockRejectedValueOnce(Object.assign(new Error("decode failed"), { stderr: "bad video stream" }));

    await expect(tool.handler({ media_path: mediaPath }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("bad video stream") });
  });
});
