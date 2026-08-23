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

import { getAudioTools } from "../../src/tools/audio.js";

const tool = getAudioTools({ tempDir: "/tmp/test" }).normalize_loudness_file;

beforeEach(() => vi.clearAllMocks());

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "premiere-normalize-"));
  const inputPath = join(directory, "input.wav");
  const outputPath = join(directory, "normalized.wav");
  writeFileSync(inputPath, "input-audio");
  return { inputPath, outputPath };
}

function measuredSummary(integratedLufs = -16.2, truePeakDbfs = -1.5) {
  return `Summary:\n  Integrated loudness:\n    I: ${integratedLufs} LUFS\n  Loudness range:\n    LRA: 4.1 LU\n  True peak:\n    Peak: ${truePeakDbfs} dBFS`;
}

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

  it("writes a new derivative and remeasures that exact output", async () => {
    const { inputPath, outputPath } = fixture();
    mockedExecFileAsync.mockImplementationOnce(async () => {
      writeFileSync(outputPath, "normalized-audio");
      return { stdout: "", stderr: "" };
    });
    mockedExecFileAsync.mockResolvedValueOnce({ stdout: "", stderr: measuredSummary() });

    await expect(tool.handler({
      input_path: inputPath,
      output_path: outputPath,
      target_lufs: -16,
      max_true_peak_dbfs: -1,
      tolerance_lu: 0.5,
    })).resolves.toMatchObject({
      success: true,
      data: {
        inputPath,
        outputPath,
        verified: true,
        loudnessPass: true,
        truePeakPass: true,
      },
    });
    expect(mockedExecFileAsync).toHaveBeenCalledTimes(2);
  });

  it("reports a new but out-of-target derivative without claiming verification", async () => {
    const { inputPath, outputPath } = fixture();
    mockedExecFileAsync.mockImplementationOnce(async () => {
      writeFileSync(outputPath, "normalized-audio");
      return { stdout: "", stderr: "" };
    });
    mockedExecFileAsync.mockResolvedValueOnce({ stdout: "", stderr: measuredSummary(-12, -0.5) });

    await expect(tool.handler({
      input_path: inputPath,
      output_path: outputPath,
      target_lufs: -16,
      max_true_peak_dbfs: -1,
      tolerance_lu: 0.5,
    })).resolves.toMatchObject({
      success: true,
      data: { verified: false, loudnessPass: false, truePeakPass: false },
    });
  });

  it("makes missing tools, timeouts, failed writes, and unverifiable outputs explicit", async () => {
    const missingTool = fixture();
    mockedExecFileAsync.mockRejectedValueOnce(Object.assign(new Error("not found"), { code: "ENOENT" }));
    await expect(tool.handler({ input_path: missingTool.inputPath, output_path: missingTool.outputPath }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("not found on PATH") });

    const timeout = fixture();
    mockedExecFileAsync.mockRejectedValueOnce(Object.assign(new Error("timeout"), { killed: true }));
    await expect(tool.handler({ input_path: timeout.inputPath, output_path: timeout.outputPath }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("timed out") });

    const noOutput = fixture();
    mockedExecFileAsync.mockResolvedValueOnce({ stdout: "", stderr: "" });
    await expect(tool.handler({ input_path: noOutput.inputPath, output_path: noOutput.outputPath }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("no non-empty output") });

    const noMeasurement = fixture();
    mockedExecFileAsync.mockImplementationOnce(async () => {
      writeFileSync(noMeasurement.outputPath, "normalized-audio");
      return { stdout: "", stderr: "" };
    });
    mockedExecFileAsync.mockResolvedValueOnce({ stdout: "", stderr: measuredSummary(Number.NEGATIVE_INFINITY) });
    await expect(tool.handler({ input_path: noMeasurement.inputPath, output_path: noMeasurement.outputPath }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("not measurable") });
  });

  it("rejects unsafe destinations and preserves an FFmpeg failure detail", async () => {
    const unsafe = fixture();
    await expect(tool.handler({ input_path: unsafe.inputPath, output_path: unsafe.outputPath, tolerance_lu: -1 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("tolerance_lu") });

    writeFileSync(unsafe.outputPath, "do-not-overwrite");
    await expect(tool.handler({ input_path: unsafe.inputPath, output_path: unsafe.outputPath }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("will not be overwritten") });

    const failure = fixture();
    mockedExecFileAsync.mockRejectedValueOnce(Object.assign(new Error("decode failed"), { stderr: "bad audio stream" }));
    await expect(tool.handler({ input_path: failure.inputPath, output_path: failure.outputPath }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("bad audio stream") });
  });
});
