import { describe, expect, it } from "vitest";
import { analyzeBeatPcm, getAudioTools } from "../../src/tools/audio.js";

describe("detect_beats analysis", () => {
  it("recovers a phase-aligned 120 BPM pulse train", () => {
    const sampleRate = 200;
    const samples = new Int16Array(sampleRate * 12);
    for (let at = 0; at < samples.length; at += sampleRate / 2) {
      for (let width = 0; width < 4; width++) samples[at + width] = 30_000;
    }
    const result = analyzeBeatPcm(samples, sampleRate);
    expect(result.bpm).toBeCloseTo(120, 0);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.beatTimesSeconds.slice(0, 4)).toEqual([0, 0.5, 1, 1.5]);
  });

  it("rejects audio shorter than two seconds", () => {
    expect(() => analyzeBeatPcm(new Int16Array(100), 200)).toThrow("at least two seconds");
  });

  it("fails argument and missing-file checks before invoking FFmpeg", async () => {
    const tool = getAudioTools({ tempDir: "/tmp/beat-tests" }).detect_beats;
    await expect(tool.handler({ media_path: "", max_beats: 0 })).resolves.toMatchObject({ success: false });
    await expect(tool.handler({ media_path: "definitely-missing.wav" })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("not found"),
    });
  });
});
