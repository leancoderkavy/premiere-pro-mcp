import { describe, expect, it } from "vitest";
import { getAudioTools } from "../../src/tools/audio.js";

const tool = getAudioTools({ tempDir: "/tmp/test" }).normalize_loudness_file;

describe("normalize_loudness_file safety boundary", () => {
  it("rejects invalid standards values before filesystem or FFmpeg work", async () => {
    await expect(tool.handler({ input_path: "in.wav", output_path: "out.wav", target_lufs: 0 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("target_lufs") });
    await expect(tool.handler({ input_path: "in.wav", output_path: "out.wav", max_true_peak_dbfs: 2 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("max_true_peak") });
  });

  it("never permits in-place normalization", async () => {
    await expect(tool.handler({ input_path: "same.wav", output_path: "same.wav" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("differ") });
  });

  it("fails before FFmpeg when the input is missing", async () => {
    await expect(tool.handler({ input_path: "missing.wav", output_path: "new.wav" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("not found") });
  });
});
