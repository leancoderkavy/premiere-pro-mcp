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

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: mockedExecFile }));

import { analyzeBeatPcm, getAudioTools } from "../../src/tools/audio.js";

const tools = getAudioTools({ tempDir: "/tmp/beat-tests" });

beforeEach(() => vi.clearAllMocks());

function pulsePcm(seconds = 12) {
  const sampleRate = 200;
  const samples = new Int16Array(sampleRate * seconds);
  for (let at = 0; at < samples.length; at += sampleRate / 2) {
    for (let width = 0; width < 4; width++) samples[at + width] = 30_000;
  }
  return { sampleRate, samples };
}

function sampleBuffer(samples: Int16Array) {
  const buffer = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index++) buffer.writeInt16LE(samples[index], index * 2);
  return buffer;
}

function createMediaFixture() {
  const directory = mkdtempSync(join(tmpdir(), "premiere-beats-"));
  const mediaPath = join(directory, "music.wav");
  writeFileSync(mediaPath, "audio-fixture");
  return mediaPath;
}

describe("detect_beats analysis", () => {
  it("recovers a phase-aligned 120 BPM pulse train", () => {
    const { sampleRate, samples } = pulsePcm();
    const result = analyzeBeatPcm(samples, sampleRate);
    expect(result.bpm).toBeCloseTo(120, 0);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.beatTimesSeconds.slice(0, 4)).toEqual([0, 0.5, 1, 1.5]);
  });

  it("rejects short or silent audio instead of fabricating a grid", () => {
    expect(() => analyzeBeatPcm(new Int16Array(100), 200)).toThrow("at least two seconds");
    expect(() => analyzeBeatPcm(new Int16Array(800), 200)).toThrow("No repeating beat evidence");
  });

  it("validates each input before invoking FFmpeg", async () => {
    await expect(tools.detect_beats.handler({ media_path: "" }))
      .resolves.toMatchObject({ success: false, error: "media_path is required." });
    await expect(tools.detect_beats.handler({ media_path: "missing.wav", max_beats: 0 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("max_beats") });
    await expect(tools.detect_beats.handler({ media_path: "definitely-missing.wav" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("not found") });
    expect(mockedExecFileAsync).not.toHaveBeenCalled();
  });

  it("decodes a bounded stream and reports truncation without mutating Premiere", async () => {
    const mediaPath = createMediaFixture();
    mockedExecFileAsync.mockResolvedValueOnce({ stdout: sampleBuffer(pulsePcm().samples), stderr: Buffer.alloc(0) });
    await expect(tools.detect_beats.handler({ media_path: mediaPath, max_beats: 3 })).resolves.toMatchObject({
      success: true,
      data: { bpm: 120, beatTimesSeconds: [0, 0.5, 1], beatTimesTruncated: true, reliable: true },
    });
    expect(mockedExecFileAsync).toHaveBeenCalledTimes(1);
    const args = mockedExecFileAsync.mock.calls[0][1] as string[];
    expect(args).toEqual(expect.arrayContaining(["-t", "1800", "-ar", "200", "pipe:1"]));
  });

  it("distinguishes missing FFmpeg, timeout, and decode failures", async () => {
    const mediaPath = createMediaFixture();
    mockedExecFileAsync.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));
    await expect(tools.detect_beats.handler({ media_path: mediaPath }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("not found on PATH") });

    mockedExecFileAsync.mockRejectedValueOnce(Object.assign(new Error("timeout"), { killed: true }));
    await expect(tools.detect_beats.handler({ media_path: mediaPath }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("timed out") });

    mockedExecFileAsync.mockRejectedValueOnce(Object.assign(new Error("decode"), { stderr: "invalid stream" }));
    await expect(tools.detect_beats.handler({ media_path: mediaPath }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("invalid stream") });
  });
});
