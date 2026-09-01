import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
  getMediaAnalysisTools,
  parseCropDetectOutput,
  parseIdetOutput,
  parseMediaProbeJson,
  parseMotionPeakCandidates,
  parseTransientCandidates,
} from "../../src/tools/media-analysis.js";

const tools = getMediaAnalysisTools({ tempDir: "/tmp/test" });

beforeEach(() => vi.clearAllMocks());

function fixture(extension = ".mov") {
  const directory = mkdtempSync(join(tmpdir(), "premiere-media-analysis-"));
  const path = join(directory, `fixture${extension}`);
  writeFileSync(path, "fixture");
  return path;
}

describe("media analysis parsers", () => {
  it("normalizes ffprobe JSON", () => {
    expect(parseMediaProbeJson(JSON.stringify({
      format: { duration: "2.0" }, streams: [{ codec_type: "video" }, null], chapters: [{ id: 1 }],
    }))).toEqual({ format: { duration: "2.0" }, streams: [{ codec_type: "video" }], chapters: [{ id: 1 }] });
    expect(parseMediaProbeJson("{}")).toEqual({ format: {}, streams: [], chapters: [] });
    expect(parseMediaProbeJson(JSON.stringify({ format: "bad", streams: "bad", chapters: [null, "bad"] })))
      .toEqual({ format: {}, streams: [], chapters: [] });
  });

  it("keeps the strongest transient inside the minimum interval", () => {
    const output = [
      "frame:0 pts_time:0.10", "lavfi.astats.Overall.Peak_level=-8",
      "frame:1 pts_time:0.20", "lavfi.astats.Overall.Peak_level=-3",
      "frame:2 pts_time:1.00", "lavfi.astats.Overall.Peak_level=-20",
      "frame:3 pts_time:1.50", "lavfi.astats.Overall.Peak_level=-6",
    ].join("\n");
    expect(parseTransientCandidates(output, -12, 0.25)).toEqual([
      { timeSeconds: 0.2, peakDbfs: -3 }, { timeSeconds: 1.5, peakDbfs: -6 },
    ]);
  });

  it("keeps local motion maxima and the strongest peak inside the minimum interval", () => {
    const output = [
      "frame:0 pts_time:0", "lavfi.signalstats.YAVG=2",
      "frame:1 pts_time:0.25", "lavfi.signalstats.YAVG=15",
      "frame:2 pts_time:0.5", "lavfi.signalstats.YAVG=2",
      "frame:3 pts_time:0.75", "lavfi.signalstats.YAVG=20",
      "frame:4 pts_time:1", "lavfi.signalstats.YAVG=2",
      "frame:5 pts_time:2", "lavfi.signalstats.YAVG=18",
    ].join("\n");
    expect(parseMotionPeakCandidates(output, 12, 1)).toEqual([
      { timeSeconds: 0.75, difference: 20 }, { timeSeconds: 2, difference: 18 },
    ]);
  });

  it("classifies progressive, mixed, and absent idet summaries", () => {
    expect(parseIdetOutput("Multi frame detection: TFF: 1 BFF: 0 Progressive: 99 Undetermined: 0").classification).toBe("progressive");
    expect(parseIdetOutput("Multi frame detection: TFF: 50 BFF: 0 Progressive: 50 Undetermined: 0").classification).toBe("mixed");
    expect(parseIdetOutput("").classification).toBe("undetermined");
    expect(parseIdetOutput("Multi frame detection: TFF: 90 BFF: 5 Progressive: 5 Undetermined: 1").classification).toBe("tff");
    expect(parseIdetOutput("Multi frame detection: TFF: 5 BFF: 90 Progressive: 5 Undetermined: 1").classification).toBe("bff");
  });

  it("selects the most frequent active-picture rectangle", () => {
    const output = "crop=1920:800:0:140\ncrop=1920:800:0:140\ncrop=1900:800:10:140";
    expect(parseCropDetectOutput(output)).toEqual({ width: 1920, height: 800, x: 0, y: 140, samples: 2 });
    expect(parseCropDetectOutput("no crop data")).toBeNull();
  });
});

describe("media analysis tool contracts", () => {
  it("rejects missing files and unsafe output arguments before spawning", async () => {
    await expect(tools.inspect_media_streams.handler({ media_path: "" })).resolves.toMatchObject({ success: false });
    const directory = mkdtempSync(join(tmpdir(), "premiere-media-directory-"));
    mkdirSync(join(directory, "nested"));
    await expect(tools.inspect_media_streams.handler({ media_path: join(directory, "nested") })).resolves.toMatchObject({ success: false });
    await expect(tools.inspect_media_streams.handler({ media_path: "missing.mov" })).resolves.toMatchObject({ success: false });
    const mediaPath = fixture();
    await expect(tools.generate_media_contact_sheet.handler({ media_path: mediaPath, output_path: "sheet.jpg" })).resolves.toMatchObject({ success: false, error: expect.stringContaining(".png") });
    const existingOutput = fixture(".png");
    await expect(tools.generate_media_contact_sheet.handler({ media_path: mediaPath, output_path: existingOutput })).resolves.toMatchObject({ success: false, error: expect.stringContaining("already exists") });
    await expect(tools.generate_media_contact_sheet.handler({ media_path: mediaPath, output_path: join(directory, "sheet.png"), columns: 1 })).resolves.toMatchObject({ success: false });
    await expect(tools.generate_media_contact_sheet.handler({ media_path: mediaPath, output_path: join(directory, "sheet.png"), thumbnail_width: 20 })).resolves.toMatchObject({ success: false });
    await expect(tools.detect_audio_transients.handler({ media_path: mediaPath, threshold_dbfs: 1 })).resolves.toMatchObject({ success: false });
    await expect(tools.detect_audio_transients.handler({ media_path: mediaPath, minimum_interval_seconds: 20 })).resolves.toMatchObject({ success: false });
    await expect(tools.detect_audio_transients.handler({ media_path: mediaPath, maximum_events: 0 })).resolves.toMatchObject({ success: false });
    await expect(tools.detect_motion_peaks.handler({ media_path: mediaPath, sample_seconds: 0 })).resolves.toMatchObject({ success: false });
    await expect(tools.detect_motion_peaks.handler({ media_path: mediaPath, samples_per_second: 11 })).resolves.toMatchObject({ success: false });
    await expect(tools.detect_motion_peaks.handler({ media_path: mediaPath, threshold: 256 })).resolves.toMatchObject({ success: false });
    await expect(tools.detect_motion_peaks.handler({ media_path: mediaPath, minimum_interval_seconds: 0 })).resolves.toMatchObject({ success: false });
    await expect(tools.detect_motion_peaks.handler({ media_path: mediaPath, maximum_events: 0 })).resolves.toMatchObject({ success: false });
    await expect(tools.analyze_video_interlacing.handler({ media_path: mediaPath, sample_seconds: 0 })).resolves.toMatchObject({ success: false });
    await expect(tools.detect_active_picture_bounds.handler({ media_path: mediaPath, sample_seconds: 301 })).resolves.toMatchObject({ success: false });
    await expect(tools.detect_active_picture_bounds.handler({ media_path: mediaPath, limit: 300 })).resolves.toMatchObject({ success: false });
    expect(mockedExecFileAsync).not.toHaveBeenCalled();
  });

  it("returns structured media inspection", async () => {
    const mediaPath = fixture();
    mockedExecFileAsync.mockResolvedValueOnce({ stdout: JSON.stringify({ format: { format_name: "mov" }, streams: [{ codec_name: "h264" }] }), stderr: "" });
    await expect(tools.inspect_media_streams.handler({ media_path: mediaPath })).resolves.toMatchObject({
      success: true, data: { mediaPath, streamCount: 1, format: { format_name: "mov" } },
    });
  });

  it("returns bounded transient, interlace, and picture findings", async () => {
    const mediaPath = fixture();
    mockedExecFileAsync.mockResolvedValueOnce({ stdout: "", stderr: "pts_time:1\nlavfi.astats.Overall.Peak_level=-4" });
    await expect(tools.detect_audio_transients.handler({ media_path: mediaPath, maximum_events: 1 })).resolves.toMatchObject({ success: true, data: { candidates: [{ timeSeconds: 1, peakDbfs: -4 }] } });

    mockedExecFileAsync.mockResolvedValueOnce({ stdout: "", stderr: "pts_time:1\nlavfi.signalstats.YAVG=20" });
    await expect(tools.detect_motion_peaks.handler({ media_path: mediaPath, threshold: 12, maximum_events: 1 })).resolves.toMatchObject({ success: true, data: { candidates: [{ timeSeconds: 1, difference: 20 }] } });
    expect(mockedExecFileAsync.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining(["-t", "60", "-an", "-f", "null", "-"]));

    mockedExecFileAsync.mockResolvedValueOnce({ stdout: "", stderr: "Multi frame detection: TFF: 0 BFF: 0 Progressive: 20 Undetermined: 0" });
    await expect(tools.analyze_video_interlacing.handler({ media_path: mediaPath })).resolves.toMatchObject({ success: true, data: { classification: "progressive", passesProgressiveDelivery: true } });

    mockedExecFileAsync.mockResolvedValueOnce({ stdout: "", stderr: "crop=1920:800:0:140" });
    await expect(tools.detect_active_picture_bounds.handler({ media_path: mediaPath })).resolves.toMatchObject({ success: true, data: { activePicture: { width: 1920, height: 800 } } });
  });

  it("creates and verifies a new contact sheet without overwriting", async () => {
    const mediaPath = fixture();
    const outputPath = join(mkdtempSync(join(tmpdir(), "premiere-contact-sheet-")), "sheet.png");
    mockedExecFileAsync.mockResolvedValueOnce({ stdout: "4", stderr: "" });
    mockedExecFileAsync.mockImplementationOnce(async (_command: string, args: string[]) => {
      writeFileSync(args.at(-1)!, "png-output");
      return { stdout: "", stderr: "" };
    });
    await expect(tools.generate_media_contact_sheet.handler({ media_path: mediaPath, output_path: outputPath }))
      .resolves.toMatchObject({ success: true, data: { outputPath, verified: true, grid: { requestedFrames: 12 } } });
  });

  it("fails closed when contact-sheet duration or output verification is unavailable", async () => {
    const mediaPath = fixture();
    const directory = mkdtempSync(join(tmpdir(), "premiere-contact-sheet-failure-"));
    mockedExecFileAsync.mockResolvedValueOnce({ stdout: "not-a-duration", stderr: "" });
    await expect(tools.generate_media_contact_sheet.handler({ media_path: mediaPath, output_path: join(directory, "duration.png") }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("positive media duration") });
    mockedExecFileAsync.mockResolvedValueOnce({ stdout: "2", stderr: "" }).mockResolvedValueOnce({ stdout: "", stderr: "" });
    await expect(tools.generate_media_contact_sheet.handler({ media_path: mediaPath, output_path: join(directory, "missing.png") }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("non-empty") });
  });

  it("fails closed on tool errors and missing measurements", async () => {
    const mediaPath = fixture();
    mockedExecFileAsync.mockRejectedValueOnce(Object.assign(new Error("timed out"), { killed: true }));
    await expect(tools.inspect_media_streams.handler({ media_path: mediaPath })).resolves.toMatchObject({ success: false, error: expect.stringContaining("timed out") });
    mockedExecFileAsync.mockResolvedValueOnce({ stdout: "", stderr: "" });
    await expect(tools.detect_active_picture_bounds.handler({ media_path: mediaPath })).resolves.toMatchObject({ success: false, error: expect.stringContaining("no active-picture") });
    mockedExecFileAsync.mockRejectedValueOnce(Object.assign(new Error("decode failed"), { stderr: "bad stream" }));
    await expect(tools.analyze_video_interlacing.handler({ media_path: mediaPath })).resolves.toMatchObject({ success: false, error: expect.stringContaining("bad stream") });
  });
});
