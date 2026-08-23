import { describe, expect, it } from "vitest";
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
  it("rejects invalid thresholds and missing files", async () => {
    await expect(tool.handler({ media_path: "missing.mp4", threshold: 2 })).resolves.toMatchObject({ success: false });
    await expect(tool.handler({ media_path: "missing.mp4" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("not found") });
  });
});
