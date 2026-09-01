import { appendFileSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
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
    expect(parseRationalRate("0/1")).toBeNull();
    expect(parseRationalRate(0)).toBeNull();
    expect(validateDeliveryConformanceContract({})).toContain("At least one");
    expect(validateDeliveryConformanceContract({ width: -1 })).toContain("positive integer");
    expect(validateDeliveryConformanceContract({ minimumVideoBitrateKbps: 20, maximumVideoBitrateKbps: 10 })).toContain("cannot exceed");
    expect(parseRationalRate(24)).toBe(24);
    expect(parseRationalRate("bad")).toBeNull();
    expect(validateDeliveryConformanceContract({ allowedContainerNames: [] })).toContain("container name");
    expect(validateDeliveryConformanceContract({ audioChannels: 1.5 })).toContain("positive integer");
    expect(validateDeliveryConformanceContract({ durationSeconds: 0 })).toContain("greater than 0");
    expect(validateDeliveryConformanceContract({ durationToleranceSeconds: -1 })).toContain("non-negative");
    expect(validateDeliveryConformanceContract({ targetLufs: 1 })).toContain("target_lufs");
    expect(validateDeliveryConformanceContract({ maximumTruePeakDbfs: 1 })).toContain("maximum_true_peak");
    expect(validateDeliveryConformanceContract({ frameRateTolerance: 0.01 })).toContain("frame_rate_tolerance requires frame_rate");
    expect(validateDeliveryConformanceContract({ durationToleranceSeconds: 0.01 })).toContain("duration_tolerance_seconds requires duration_seconds");
    expect(validateDeliveryConformanceContract({ loudnessToleranceLu: 1 })).toContain("loudness_tolerance_lu requires target_lufs");
    expect(validateDeliveryConformanceContract({ videoCodec: "h264", frameRateTolerance: 0.01 })).toContain("frame_rate_tolerance requires frame_rate");
    expect(validateDeliveryConformanceContract({ videoCodec: " " })).toContain("non-empty");
    expect(validateDeliveryConformanceContract({ audioCodec: "" })).toContain("non-empty");
  });

  it("falls back from unusable stream metadata and does not fail missing measurements", () => {
    const checks = evaluateDeliveryConformance({
      format: { bit_rate: "12000000" },
      streams: [{ codec_type: "video", avg_frame_rate: "0/1", r_frame_rate: "24/1", bit_rate: "N/A" }],
    }, {
      frameRate: 24, minimumVideoBitrateKbps: 11000, targetLufs: -23, maximumTruePeakDbfs: -1,
    }, { integratedLufs: -23, truePeakDbfs: null });
    expect(checks.find(check => check.id === "frame_rate")?.status).toBe("pass");
    expect(checks.find(check => check.id === "minimum_video_bitrate")?.status).toBe("pass");
    expect(checks.find(check => check.id === "integrated_loudness")?.status).toBe("pass");
    expect(checks.find(check => check.id === "true_peak")?.status).toBe("not_evaluated");
  });

  it("reports matching and mismatching fields independently", () => {
    const checks = evaluateDeliveryConformance(probe, {
      allowedContainerNames: ["mp4"], videoCodec: "h264", audioCodec: "pcm_s24le",
      width: 1920, height: 720, frameRate: 29.97, frameRateTolerance: 0.01,
      durationSeconds: 10, durationToleranceSeconds: 0.05,
      minimumVideoBitrateKbps: 9000, maximumVideoBitrateKbps: 11000,
      audioSampleRateHz: 48000, audioChannels: 2,
    });
    expect(checks.find(check => check.id === "container_demuxer_family")).toMatchObject({
      status: "pass", detail: expect.stringContaining("do not identify an exact container subtype"),
    });
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

  it("evaluates loudness failures and does not evaluate video bitrate without video", () => {
    const checks = evaluateDeliveryConformance({ format: { format_name: "matroska", bit_rate: "5000000" }, streams: [{ codec_type: "audio", codec_name: "aac" }] }, {
      allowedContainerNames: ["mov"], minimumVideoBitrateKbps: 1000, maximumVideoBitrateKbps: 2000,
      targetLufs: -23, loudnessToleranceLu: 0.5, maximumTruePeakDbfs: -1,
    }, { integratedLufs: -20, truePeakDbfs: -0.5 });
    expect(checks.find(check => check.id === "minimum_video_bitrate")).toMatchObject({
      status: "not_evaluated", detail: expect.stringContaining("No video stream"),
    });
    expect(checks.find(check => check.id === "maximum_video_bitrate")?.status).toBe("not_evaluated");
    expect(checks.filter(check => !check.id.includes("video_bitrate")).every(check => check.status === "fail")).toBe(true);

    const missingBitrate = evaluateDeliveryConformance({ format: {}, streams: [{ codec_type: "video", bit_rate: "N/A" }] }, {
      minimumVideoBitrateKbps: 1000,
    });
    expect(missingBitrate.find(check => check.id === "minimum_video_bitrate")).toMatchObject({
      status: "not_evaluated", detail: "Video bitrate metadata was unavailable",
    });

    const coverArtOnly = evaluateDeliveryConformance({
      format: { bit_rate: "5000000" },
      streams: [{ codec_type: "video", codec_name: "mjpeg", width: 1000, disposition: { attached_pic: 1 } }],
    }, { videoCodec: "mjpeg", width: 1000, minimumVideoBitrateKbps: 1000 });
    expect(coverArtOnly.find(check => check.id === "video_codec")?.status).toBe("fail");
    expect(coverArtOnly.find(check => check.id === "width")?.status).toBe("fail");
    expect(coverArtOnly.find(check => check.id === "minimum_video_bitrate")?.status).toBe("not_evaluated");
  });
});

describe("verify_delivery_conformance boundary", () => {
  const tool = getExportTools({ tempDir: "/tmp/test" }).verify_delivery_conformance;
  beforeEach(() => vi.clearAllMocks());

  it("reports its local filesystem-only operational boundary", () => {
    expect(tool.operationalCapability).toMatchObject({
      backend: "local", backends: ["local"], authority: "filesystem",
      verificationBoundary: "local_filesystem", hostVerificationRequired: false,
      minimumPremiereVersion: null,
    });
  });

  function mediaFile() {
    const directory = mkdtempSync(join(tmpdir(), "premiere-delivery-conformance-"));
    const mediaPath = join(directory, "delivery.mp4");
    writeFileSync(mediaPath, "delivery-fixture");
    return mediaPath;
  }

  it("returns an explicit failure for a missing baseline file", async () => {
    const missingPath = join(tmpdir(), `missing-delivery-${Date.now()}.mp4`);
    await expect(tool.handler({ output_path: missingPath, video_codec: "h264" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("not found on disk") });
    expect(mockedExecFileAsync).not.toHaveBeenCalled();
  });

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
    expect(mockedExecFileAsync).toHaveBeenNthCalledWith(1, "ffprobe", expect.arrayContaining(["-protocol_whitelist", "file,crypto,data"]), expect.any(Object));
    expect(mockedExecFileAsync).toHaveBeenNthCalledWith(2, "ffmpeg", expect.arrayContaining(["-protocol_whitelist", "file,crypto,data", "-map", "0:a:0"]), expect.any(Object));
  });

  it("keeps ffprobe process failures explicit", async () => {
    const mediaPath = mediaFile();
    mockedExecFileAsync.mockRejectedValueOnce(Object.assign(new Error("probe failed"), { stderr: "invalid media" }));
    await expect(tool.handler({ output_path: mediaPath, video_codec: "h264" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("invalid media") });

    const emptyStderrPath = mediaFile();
    mockedExecFileAsync.mockRejectedValueOnce(Object.assign(new Error("probe failed"), { stderr: "" }));
    await expect(tool.handler({ output_path: emptyStderrPath, video_codec: "h264" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("probe failed") });
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

    const disappearingPath = mediaFile();
    mockedExecFileAsync.mockImplementationOnce(async () => {
      unlinkSync(disappearingPath);
      return { stdout: JSON.stringify(probe), stderr: "" };
    });
    await expect(tool.handler({ output_path: disappearingPath, video_codec: "h264" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("changed during") });

    const rejectedAfterDeletionPath = mediaFile();
    mockedExecFileAsync.mockImplementationOnce(async () => {
      unlinkSync(rejectedAfterDeletionPath);
      throw Object.assign(new Error("probe failed"), { stderr: "invalid media" });
    });
    await expect(tool.handler({ output_path: rejectedAfterDeletionPath, video_codec: "h264" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("changed during") });

    const invalidAfterChangePath = mediaFile();
    mockedExecFileAsync.mockImplementationOnce(async () => {
      appendFileSync(invalidAfterChangePath, "changed");
      return { stdout: "null", stderr: "" };
    });
    await expect(tool.handler({ output_path: invalidAfterChangePath, video_codec: "h264" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("changed during") });
  });

  it("handles missing tools, invalid probe JSON, and unavailable loudness without overclaiming", async () => {
    const missingToolPath = mediaFile();
    mockedExecFileAsync.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));
    await expect(tool.handler({ output_path: missingToolPath, video_codec: "h264" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("ffprobe was not found") });

    const invalidJsonPath = mediaFile();
    mockedExecFileAsync.mockResolvedValueOnce({ stdout: "null", stderr: "" });
    await expect(tool.handler({ output_path: invalidJsonPath, video_codec: "h264" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("invalid delivery report") });

    const incompleteProbePath = mediaFile();
    mockedExecFileAsync.mockResolvedValueOnce({ stdout: JSON.stringify({ format: {} }), stderr: "" });
    await expect(tool.handler({ output_path: incompleteProbePath, video_codec: "h264" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("invalid delivery report") });

    const silentPath = mediaFile();
    mockedExecFileAsync.mockResolvedValueOnce({ stdout: JSON.stringify({ format: {}, streams: [] }), stderr: "" });
    await expect(tool.handler({ output_path: silentPath, target_lufs: -23 }))
      .resolves.toMatchObject({ success: true, data: { conforms: false, evaluated: 0, notEvaluated: 1 } });

    const unreadableAudioPath = mediaFile();
    mockedExecFileAsync
      .mockResolvedValueOnce({ stdout: JSON.stringify(probe), stderr: "" })
      .mockRejectedValueOnce(Object.assign(new Error("decode"), { stderr: "no measurement" }));
    await expect(tool.handler({ output_path: unreadableAudioPath, target_lufs: -23 }))
      .resolves.toMatchObject({ success: true, data: { conforms: false, notEvaluated: 1 } });

    const partialAudioPath = mediaFile();
    mockedExecFileAsync
      .mockResolvedValueOnce({ stdout: JSON.stringify(probe), stderr: "" })
      .mockRejectedValueOnce(Object.assign(new Error("decode"), { stderr: "Summary:\n Integrated loudness:\n I: -23.0 LUFS\n True peak:\n Peak: -2.0 dBFS" }));
    await expect(tool.handler({ output_path: partialAudioPath, target_lufs: -23, maximum_true_peak_dbfs: -1 }))
      .resolves.toMatchObject({ success: true, data: { conforms: false, evaluated: 0, notEvaluated: 2 } });
  });
});
