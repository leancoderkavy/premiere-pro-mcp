import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
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

import {
  evaluateDeliveryConformance,
  getExportTools,
  parseRationalRate,
  validateDeliveryConformanceContract,
} from "../../src/tools/export.js";

const probe = {
  format: { format_name: "mov,mp4,m4a", duration: "10.020", bit_rate: "12000000" },
  streams: [
    { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30000/1001", bit_rate: "10000000" },
    { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 },
  ],
};

describe("delivery conformance comparisons", () => {
  it("parses rational frame rates and rejects malformed contracts", () => {
    expect(parseRationalRate("30000/1001")).toBeCloseTo(29.97003, 5);
    expect(parseRationalRate("0/0")).toBeNull();
    expect(validateDeliveryConformanceContract({})).toContain("At least one");
    expect(validateDeliveryConformanceContract({ width: -1 })).toContain("positive integer");
    expect(validateDeliveryConformanceContract({ minimumVideoBitrateKbps: 20, maximumVideoBitrateKbps: 10 })).toContain("cannot exceed");
  });

  it("reports matching and mismatching fields independently", () => {
    const checks = evaluateDeliveryConformance(probe, {
      allowedContainerNames: ["mp4"], videoCodec: "h264", audioCodec: "pcm_s24le",
      width: 1920, height: 720, frameRate: 29.97, frameRateTolerance: 0.01,
      durationSeconds: 10, durationToleranceSeconds: 0.05,
      minimumVideoBitrateKbps: 9000, maximumVideoBitrateKbps: 11000,
      audioSampleRateHz: 48000, audioChannels: 2,
    });
    expect(checks.find(check => check.id === "container")?.status).toBe("pass");
    expect(checks.find(check => check.id === "audio_codec")?.status).toBe("fail");
    expect(checks.find(check => check.id === "height")?.status).toBe("fail");
    expect(checks.find(check => check.id === "frame_rate")?.status).toBe("pass");
    expect(checks.find(check => check.id === "maximum_video_bitrate")?.status).toBe("pass");
  });

  it("fails expected streams that are missing and preserves unavailable loudness", () => {
    const checks = evaluateDeliveryConformance({ format: {}, streams: [] }, {
      videoCodec: "prores", audioChannels: 2, targetLufs: -23, maximumTruePeakDbfs: -1,
    }, null, "No audio stream was available for EBU R128 analysis");
    expect(checks.find(check => check.id === "video_codec")?.status).toBe("fail");
    expect(checks.find(check => check.id === "audio_channels")?.status).toBe("fail");
    expect(checks.find(check => check.id === "integrated_loudness")?.status).toBe("not_evaluated");
    expect(checks.find(check => check.id === "true_peak")?.status).toBe("not_evaluated");
  });
});

describe("verify_delivery_conformance boundary", () => {
  const tool = getExportTools({ tempDir: "/tmp/test" }).verify_delivery_conformance;
  beforeEach(() => vi.clearAllMocks());

  function mediaFile() {
    const directory = mkdtempSync(join(tmpdir(), "premiere-delivery-conformance-"));
    const mediaPath = join(directory, "delivery.mp4");
    writeFileSync(mediaPath, "delivery-fixture");
    return mediaPath;
  }

  it("returns a complete local conformance report", async () => {
    const mediaPath = mediaFile();
    mockedExecFileAsync
      .mockResolvedValueOnce({ stdout: JSON.stringify(probe), stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "Summary:\n Integrated loudness:\n I: -23.0 LUFS\n True peak:\n Peak: -2.0 dBFS" });
    await expect(tool.handler({
      output_path: mediaPath, allowed_container_names: ["mp4"], video_codec: "h264",
      frame_rate: 29.97, frame_rate_tolerance: 0.01, target_lufs: -23,
      maximum_true_peak_dbfs: -1,
    })).resolves.toMatchObject({
      success: true,
      data: { mediaPath, conforms: true, evaluated: 5, notEvaluated: 0 },
    });
    expect(mockedExecFileAsync).toHaveBeenCalledTimes(2);
  });

  it("keeps ffprobe process failures explicit", async () => {
    const mediaPath = mediaFile();
    mockedExecFileAsync.mockRejectedValueOnce(Object.assign(new Error("probe failed"), { stderr: "invalid media" }));
    await expect(tool.handler({ output_path: mediaPath, video_codec: "h264" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("invalid media") });
  });

  it("reports ffprobe timeouts and refuses a file that changes during inspection", async () => {
    const timedOutPath = mediaFile();
    mockedExecFileAsync.mockRejectedValueOnce(Object.assign(new Error("timeout"), { killed: true }));
    await expect(tool.handler({ output_path: timedOutPath, video_codec: "h264" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("timed out") });

    const changingPath = mediaFile();
    mockedExecFileAsync.mockImplementationOnce(async () => {
      appendFileSync(changingPath, "changed");
      return { stdout: JSON.stringify(probe), stderr: "" };
    });
    await expect(tool.handler({ output_path: changingPath, video_codec: "h264" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("changed during") });
  });
});
