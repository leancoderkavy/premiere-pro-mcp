import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupTempDirs, makeTempDir } from "../helpers/temp-dir.js";

const { mockedExecFile, mockedExecFileAsync } = vi.hoisted(() => {
  const mockedExecFileAsync = vi.fn();
  const mockedExecFile = vi.fn();
  mockedExecFile[Symbol.for("nodejs.util.promisify.custom")] = mockedExecFileAsync;
  return { mockedExecFile, mockedExecFileAsync };
});

vi.mock("node:child_process", () => ({ execFile: mockedExecFile }));

import { getAudioTools } from "../../src/tools/audio.js";

afterAll(cleanupTempDirs);

const tool = getAudioTools({ tempDir: "/tmp/test" }).normalize_loudness_file;

beforeEach(() => vi.clearAllMocks());

function fixture() {
  const directory = makeTempDir("premiere-normalize-");
  const inputPath = join(directory, "input.wav");
  const outputPath = join(directory, "normalized.wav");
  writeFileSync(inputPath, "input-audio");
  return { inputPath, outputPath };
}

const FIRST_PASS = `[Parsed_loudnorm_0 @ 0x1]\n{\n\t"input_i" : "-8.20",\n\t"input_tp" : "3.00",\n\t"input_lra" : "4.10",\n\t"input_thresh" : "-18.40",\n\t"target_offset" : "0.10"\n}`;

/**
 * Answer ffprobe, the loudnorm measuring pass, the applying pass and the EBU R128
 * remeasure by their arguments. `fail` rejects one stage with the given error.
 */
function ffmpegHost(outputPath: string, options: { measured?: string; writes?: boolean; fail?: { stage: string; error: unknown } } = {}) {
  mockedExecFileAsync.mockImplementation(async (command: string, args: string[]) => {
    const stage = command === "ffprobe" ? "probe"
      : args.some((a) => a.includes("ebur128")) ? "remeasure"
      : args.includes(outputPath) ? "apply" : "measure";
    if (options.fail?.stage === stage) throw options.fail.error;
    if (stage === "probe") return { stdout: JSON.stringify({ streams: [{ sample_rate: "48000", bit_rate: "317000" }] }), stderr: "" };
    if (stage === "measure") return { stdout: "", stderr: FIRST_PASS };
    if (stage === "apply") {
      if (options.writes !== false) writeFileSync(outputPath, "normalized-audio");
      return { stdout: "", stderr: FIRST_PASS.replace(/\}\s*$/, ',\n\t"normalization_type" : "linear"\n}') };
    }
    return { stdout: "", stderr: options.measured ?? measuredSummary() };
  });
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

  it("measures, applies linearly with the measured values, and remeasures that exact output", async () => {
    const { inputPath, outputPath } = fixture();
    ffmpegHost(outputPath);

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
        normalizationType: "linear",
        input: { integratedLufs: -8.2, truePeakDbfs: 3 },
        audio: { sampleRate: 48000 },
      },
    });
    const apply = mockedExecFileAsync.mock.calls.find(([, args]) => (args as string[]).includes(outputPath) && !(args as string[]).some((a) => a.includes("ebur128")))![1] as string[];
    const filter = apply[apply.indexOf("-af") + 1];
    expect(filter).toContain("measured_I=-8.20");
    expect(filter).toContain("linear=true");
    // Single-pass loudnorm resampled to 96 kHz (live); the source rate is kept.
    expect(apply.slice(apply.indexOf("-ar"), apply.indexOf("-ar") + 2)).toEqual(["-ar", "48000"]);
  });

  it("keeps an AAC container's bitrate instead of ffmpeg's lower default", async () => {
    const { inputPath } = fixture();
    const outputPath = inputPath.replace("input.wav", "normalized.mp4");
    ffmpegHost(outputPath);
    await tool.handler({ input_path: inputPath, output_path: outputPath });
    const apply = mockedExecFileAsync.mock.calls.find(([, args]) => (args as string[]).includes(outputPath) && !(args as string[]).some((a) => a.includes("ebur128")))![1] as string[];
    expect(apply.slice(apply.indexOf("-b:a"), apply.indexOf("-b:a") + 2)).toEqual(["-b:a", "317k"]);
  });

  it("reports a new but out-of-target derivative without claiming verification", async () => {
    const { inputPath, outputPath } = fixture();
    ffmpegHost(outputPath, { measured: measuredSummary(-12, -0.5) });

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
    ffmpegHost(missingTool.outputPath, { fail: { stage: "measure", error: Object.assign(new Error("not found"), { code: "ENOENT" }) } });
    await expect(tool.handler({ input_path: missingTool.inputPath, output_path: missingTool.outputPath }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("not found on PATH") });

    const timeout = fixture();
    ffmpegHost(timeout.outputPath, { fail: { stage: "apply", error: Object.assign(new Error("timeout"), { killed: true }) } });
    await expect(tool.handler({ input_path: timeout.inputPath, output_path: timeout.outputPath }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("timed out") });

    const noOutput = fixture();
    ffmpegHost(noOutput.outputPath, { writes: false });
    await expect(tool.handler({ input_path: noOutput.inputPath, output_path: noOutput.outputPath }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("no non-empty output") });

    const noMeasurement = fixture();
    ffmpegHost(noMeasurement.outputPath, { measured: measuredSummary(Number.NEGATIVE_INFINITY) });
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
    ffmpegHost(failure.outputPath, { fail: { stage: "measure", error: Object.assign(new Error("decode failed"), { stderr: "bad audio stream" }) } });
    await expect(tool.handler({ input_path: failure.inputPath, output_path: failure.outputPath }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("bad audio stream") });
  });

  it("renders again with a lowered ceiling when encoding pushes the true peak over it, and keeps the passing attempt", async () => {
    const { inputPath } = fixture();
    const outputPath = inputPath.replace("input.wav", "normalized.mp4");
    const applies: string[][] = [];
    mockedExecFileAsync.mockImplementation(async (command: string, args: string[]) => {
      if (command === "ffprobe") return { stdout: JSON.stringify({ streams: [{ sample_rate: "48000", bit_rate: "317000" }] }), stderr: "" };
      if (args.some((a) => a.includes("ebur128"))) {
        // The first AAC render overshoots the -1.5 dBFS ceiling; the retry lands under it.
        return { stdout: "", stderr: measuredSummary(-16.1, args.includes(outputPath) ? -0.9 : -1.7) };
      }
      if (args.some((a) => a.includes("measured_I"))) {
        applies.push(args);
        writeFileSync(args[args.length - 1], args.includes(outputPath) ? "attempt-1" : "attempt-2");
        return { stdout: "", stderr: FIRST_PASS };
      }
      return { stdout: "", stderr: FIRST_PASS };
    });

    const result = await tool.handler({ input_path: inputPath, output_path: outputPath, max_true_peak_dbfs: -1.5 });
    expect(result).toMatchObject({
      success: true,
      data: {
        verified: true,
        truePeakPass: true,
        measured: { truePeakDbfs: -1.7 },
        attempts: [
          { attempt: 1, appliedTruePeakDbfs: -1.5, truePeakDbfs: -0.9, truePeakPass: false, kept: false },
          { attempt: 2, appliedTruePeakDbfs: -2.2, truePeakDbfs: -1.7, truePeakPass: true, kept: true },
        ],
      },
    });
    expect(applies).toHaveLength(2);
    expect(applies[1][applies[1].indexOf("-af") + 1]).toContain("TP=-2.2");
    expect(readFileSync(outputPath, "utf8")).toBe("attempt-2");
    expect(readdirSync(dirname(outputPath)).filter((name) => name.includes(".retry-"))).toEqual([]);
  });

  it("preserves unrelated files at the former predictable retry and backup paths", async () => {
    const { inputPath, outputPath } = fixture();
    const collision = join(dirname(outputPath), `.normalized.retry-2-${process.pid}.wav`);
    const backupCollision = `${collision}.previous`;
    writeFileSync(collision, "unrelated-retry");
    writeFileSync(backupCollision, "unrelated-backup");
    mockedExecFileAsync.mockImplementation(async (command: string, args: string[]) => {
      if (command === "ffprobe") return { stdout: JSON.stringify({ streams: [{ sample_rate: "48000" }] }), stderr: "" };
      if (args.some(value => value.includes("ebur128"))) return { stdout: "", stderr: measuredSummary(-16, args.includes(outputPath) ? -0.5 : -2) };
      if (args.some(value => value.includes("measured_I"))) {
        const destination = args[args.length - 1];
        if (existsSync(destination)) throw new Error("refusing existing output");
        writeFileSync(destination, "normalized-audio");
      }
      return { stdout: "", stderr: FIRST_PASS };
    });
    await expect(tool.handler({ input_path: inputPath, output_path: outputPath })).resolves.toMatchObject({ success: true });
    expect(readFileSync(collision, "utf8")).toBe("unrelated-retry");
    expect(readFileSync(backupCollision, "utf8")).toBe("unrelated-backup");
    expect(readdirSync(dirname(outputPath)).filter(name => name.startsWith(".mcp-normalize-"))).toEqual([]);
  });

  it("keeps the first output and stops when max_attempts is 1 or a retry fails", async () => {
    const single = fixture();
    ffmpegHost(single.outputPath, { measured: measuredSummary(-16, -0.5) });
    await expect(tool.handler({ input_path: single.inputPath, output_path: single.outputPath, max_attempts: 1 }))
      .resolves.toMatchObject({ success: true, data: { verified: false, attempts: [{ attempt: 1, kept: true }] } });

    // ffmpegHost writes only the real output path, so the retry produces no file.
    const failedRetry = fixture();
    ffmpegHost(failedRetry.outputPath, { measured: measuredSummary(-16, -0.5) });
    await expect(tool.handler({ input_path: failedRetry.inputPath, output_path: failedRetry.outputPath }))
      .resolves.toMatchObject({ success: true, data: { verified: false, attempts: [{ attempt: 1, kept: true }] } });
    expect(readFileSync(failedRetry.outputPath, "utf8")).toBe("normalized-audio");

    await expect(tool.handler({ input_path: "in.wav", output_path: "out.wav", max_attempts: 5 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("max_attempts") });
  });
});
