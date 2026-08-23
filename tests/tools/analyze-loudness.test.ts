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

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

vi.mock("node:child_process", () => ({ execFile: mockedExecFile }));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getAudioTools, parseEbur128Summary } from "../../src/tools/audio.js";

const mockedSendCommand = vi.mocked(sendCommand);
const tools = getAudioTools({ tempDir: "/tmp/test", timeoutMs: 1000 });

beforeEach(() => vi.clearAllMocks());

function enqueueFfmpegResult(stderr = "") {
  mockedExecFileAsync.mockResolvedValueOnce({ stdout: "", stderr });
}

function enqueueFfmpegFailure(error: Error) {
  mockedExecFileAsync.mockRejectedValueOnce(error);
}

function createMediaFixture() {
  const directory = mkdtempSync(join(tmpdir(), "premiere-loudness-"));
  const mediaPath = join(directory, "dialogue.wav");
  writeFileSync(mediaPath, "audio-fixture");
  return mediaPath;
}

const measurableSummary = `
Summary:
  Integrated loudness:
    I:         -16.2 LUFS
  Loudness range:
    LRA:         4.1 LU
  True peak:
    Peak:       -1.3 dBFS
`;

describe("parseEbur128Summary", () => {
  it("extracts the final integrated loudness, range, and true peak", () => {
    const output = `
Summary:

  Integrated loudness:
    I:         -16.2 LUFS
    Threshold: -26.2 LUFS

  Loudness range:
    LRA:         4.1 LU

  True peak:
    Peak:       -1.3 dBFS
`;
    expect(parseEbur128Summary(output)).toEqual({
      integratedLufs: -16.2,
      loudnessRangeLu: 4.1,
      truePeakDbfs: -1.3,
    });
  });

  it("reports digital silence as unmeasurable instead of fabricating a number", () => {
    const output = `Integrated loudness:\n I: -inf LUFS\nLoudness range:\n LRA: 0.0 LU\nTrue peak:\n Peak: -inf dBFS`;
    expect(parseEbur128Summary(output)).toEqual({
      integratedLufs: null,
      loudnessRangeLu: 0,
      truePeakDbfs: null,
    });
  });
});

describe("analyze_loudness argument boundary", () => {
  it("rejects invalid targets before contacting Premiere or FFmpeg", async () => {
    await expect(tools.analyze_loudness.handler({ media_path: "missing.wav", target_lufs: 4 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("target_lufs") });
    await expect(tools.analyze_loudness.handler({ media_path: "missing.wav", tolerance_lu: -1 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("tolerance_lu") });
    await expect(tools.analyze_loudness.handler({ media_path: "missing.wav", max_true_peak_dbfs: 1 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("max_true_peak_dbfs") });
    await expect(tools.analyze_loudness.handler({}))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("media_path") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("resolves project-item paths through one read-only bridge call", async () => {
    mockedSendCommand.mockResolvedValueOnce({ success: false, error: "Project item not found" });
    const result = await tools.analyze_loudness.handler({ project_item_id: "missing" });
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
    expect(mockedSendCommand.mock.calls[0][0]).toContain("getMediaPath");
    expect(result).toMatchObject({ success: false, error: "Project item not found" });
  });

  it("returns a local EBU R128 measurement and evaluates an optional delivery target", async () => {
    const mediaPath = createMediaFixture();
    enqueueFfmpegResult();
    enqueueFfmpegResult(measurableSummary);

    await expect(tools.analyze_loudness.handler({
      media_path: mediaPath,
      target_lufs: -16,
      tolerance_lu: 0.5,
      max_true_peak_dbfs: -1,
    })).resolves.toMatchObject({
      success: true,
      data: {
        mediaPath,
        integratedLufs: -16.2,
        loudnessRangeLu: 4.1,
        truePeakDbfs: -1.3,
        target: {
          lufs: -16,
          toleranceLu: 0.5,
          deltaLu: -0.2,
          loudnessPass: true,
          truePeakPass: true,
          passes: true,
        },
      },
    });
    expect(mockedExecFileAsync).toHaveBeenCalledTimes(2);
  });

  it("resolves a project item to a local file before measuring it", async () => {
    const mediaPath = createMediaFixture();
    mockedSendCommand.mockResolvedValueOnce({ success: true, data: { mediaPath, name: "Dialogue" } });
    enqueueFfmpegResult();
    enqueueFfmpegResult(measurableSummary);

    await expect(tools.analyze_loudness.handler({ project_item_id: "dialogue-item" }))
      .resolves.toMatchObject({ success: true, data: { mediaPath, projectItemName: "Dialogue", target: null } });
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
  });

  it("reports a failed target and true-peak check without changing the media", async () => {
    const mediaPath = createMediaFixture();
    enqueueFfmpegResult();
    enqueueFfmpegResult(measurableSummary);

    await expect(tools.analyze_loudness.handler({
      media_path: mediaPath,
      target_lufs: -14,
      tolerance_lu: 0.1,
      max_true_peak_dbfs: -2,
    })).resolves.toMatchObject({
      success: true,
      data: {
        target: {
          loudnessPass: false,
          truePeakPass: false,
          passes: false,
        },
      },
    });
  });

  it("reports unavailable analysis prerequisites, timeouts, and digital silence without making up a metric", async () => {
    const mediaPath = createMediaFixture();
    enqueueFfmpegFailure(new Error("not found"));
    await expect(tools.analyze_loudness.handler({ media_path: mediaPath }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("not found on PATH") });

    enqueueFfmpegResult();
    enqueueFfmpegFailure(Object.assign(new Error("timed out"), { killed: true }));
    await expect(tools.analyze_loudness.handler({ media_path: mediaPath }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("timed out") });

    enqueueFfmpegResult();
    enqueueFfmpegResult("Integrated loudness:\n I: -inf LUFS");
    await expect(tools.analyze_loudness.handler({ media_path: mediaPath }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("did not return measurable") });
  });

  it("does not invoke FFmpeg for an unavailable file and preserves an analysis error detail", async () => {
    await expect(tools.analyze_loudness.handler({ media_path: "missing-dialogue.wav" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("Media file not found") });
    expect(mockedExecFileAsync).not.toHaveBeenCalled();

    const mediaPath = createMediaFixture();
    enqueueFfmpegResult();
    enqueueFfmpegFailure(Object.assign(new Error("decode failed"), { stderr: "invalid stream" }));
    await expect(tools.analyze_loudness.handler({ media_path: mediaPath }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("invalid stream") });
  });
});
