import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (file: string, args: string[], options: unknown, callback: (error: Error | null, result?: { stdout: string; stderr: string }) => void) => {
    try { callback(null, execFileMock(file, args, options)); } catch (error) { callback(error as Error); }
  },
}));

import { defaultExtractSourceFrame, defaultProbeSourceVideo } from "../../src/tools/source-freeze-frame.js";

beforeEach(() => execFileMock.mockReset());

describe("source freeze-frame ffmpeg adapters", () => {
  it("probes the first video stream through the file protocol only", async () => {
    execFileMock.mockReturnValue({ stdout: JSON.stringify({ streams: [{ width: 1920, height: 1080, avg_frame_rate: "30000/1001", r_frame_rate: "30000/1001" }], format: { duration: "12.5" } }), stderr: "" });
    await expect(defaultProbeSourceVideo("/media/a.mov")).resolves.toEqual({ durationSeconds: 12.5, frameRate: 30000 / 1001, width: 1920, height: 1080, variableFrameRate: false });
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe("ffprobe");
    expect(args).toEqual(expect.arrayContaining(["-protocol_whitelist", "file", "file:/media/a.mov"]));
  });

  it("flags variable frame rate and falls back to r_frame_rate", async () => {
    execFileMock.mockReturnValue({ stdout: JSON.stringify({ streams: [{ width: 1280, height: 720, avg_frame_rate: "0/0", r_frame_rate: "25" }], format: { duration: "4" } }), stderr: "" });
    await expect(defaultProbeSourceVideo("/media/b.mp4")).resolves.toMatchObject({ frameRate: 25, variableFrameRate: false });
    execFileMock.mockReturnValue({ stdout: JSON.stringify({ streams: [{ width: 1280, height: 720, avg_frame_rate: "24/1", r_frame_rate: "30/1" }], format: { duration: "4" } }), stderr: "" });
    await expect(defaultProbeSourceVideo("/media/c.mp4")).resolves.toMatchObject({ frameRate: 24, variableFrameRate: true });
  });

  it("rejects media without a video stream", async () => {
    execFileMock.mockReturnValue({ stdout: JSON.stringify({ streams: [], format: { duration: "4" } }), stderr: "" });
    await expect(defaultProbeSourceVideo("/media/audio.wav")).rejects.toThrow("no video stream");
  });

  it("extracts one square-pixel frame without overwriting", async () => {
    execFileMock.mockReturnValue({ stdout: "", stderr: "" });
    await defaultExtractSourceFrame("/media/a.mov", 2.03, "/out/f.jpg");
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe("ffmpeg");
    expect(args).toEqual(expect.arrayContaining(["-n", "-ss", "2.030000", "file:/media/a.mov", "-frames:v", "1", "scale=iw*sar:ih,setsar=1", "-q:v", "2", "file:/out/f.jpg"]));
    await defaultExtractSourceFrame("/media/a.mov", 0, "/out/f.png");
    expect(execFileMock.mock.calls[1][1]).not.toContain("-q:v");
  });
});
