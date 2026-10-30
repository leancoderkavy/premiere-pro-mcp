import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { inspectAudioSignal } from "../../src/tools/audio-signal-evidence.js";

let directory: string;
let file: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "audio signal ")); file = join(directory, 'quoted "clip".wav'); writeFileSync(file, "fixture"); });
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe("inspectAudioSignal", () => {
  const probe = JSON.stringify({ streams: [{ index: 1 }] });
  const stats = (peak: string, samples = 100) => `[Parsed_astats] Overall\n[Parsed_astats] Peak level dB: ${peak}\n[Parsed_astats] Number of samples: ${samples}\n`;
  it("reports finite peak without imposing an audibility threshold", async () => {
    const run = vi.fn().mockResolvedValueOnce({ stdout: probe, stderr: "" }).mockResolvedValueOnce({ stdout: "", stderr: stats("-95.0") });
    expect(await inspectAudioSignal(file, run)).toEqual({ status: "signal_detected", peakDbfs: -95, method: "ffmpeg_astats" });
    expect(run.mock.calls[0][1]).toContain(file);
    expect(run.mock.calls[1][1]).toContain(file);
    expect(run.mock.calls[1][1]).toContain("-xerror");
  });
  it("distinguishes digital silence from a missing stream", async () => {
    const silent = vi.fn().mockResolvedValueOnce({ stdout: probe, stderr: "" }).mockResolvedValueOnce({ stdout: "", stderr: stats("-inf") });
    expect(await inspectAudioSignal(file, silent)).toEqual({ status: "silent", peakDbfs: null, method: "ffmpeg_astats" });
    const missing = vi.fn().mockResolvedValue({ stdout: '{"streams":[]}', stderr: "" });
    expect(await inspectAudioSignal(file, missing)).toEqual({ status: "no_audio_stream", peakDbfs: null, method: "ffprobe" });
    expect(missing).toHaveBeenCalledTimes(1);
  });
  it("does not classify empty or incomplete measurements as silence", async () => {
    const run = vi.fn().mockResolvedValueOnce({ stdout: probe, stderr: "" }).mockResolvedValueOnce({ stdout: "", stderr: stats("-inf", 0) });
    expect(await inspectAudioSignal(file, run)).toMatchObject({ status: "unavailable" });
  });
  it("reports missing tools, timeout, corrupt probe and decoder failure as unavailable", async () => {
    for (const error of [Object.assign(new Error(), { code: "ENOENT" }), Object.assign(new Error(), { killed: true }), new Error("decode")]) {
      expect(await inspectAudioSignal(file, vi.fn().mockRejectedValue(error))).toMatchObject({ status: "unavailable" });
    }
    expect(await inspectAudioSignal(file, vi.fn().mockResolvedValue({ stdout: "not json", stderr: "" }))).toMatchObject({ status: "unavailable" });
    const decodeFailure = vi.fn().mockResolvedValueOnce({ stdout: probe, stderr: "" }).mockRejectedValueOnce(new Error("corrupt audio"));
    expect(await inspectAudioSignal(file, decodeFailure)).toMatchObject({ status: "unavailable" });
  });
  it("rejects evidence if the file changes during decoding", async () => {
    const run = vi.fn().mockResolvedValueOnce({ stdout: probe, stderr: "" }).mockImplementationOnce(async () => { writeFileSync(file, "modified fixture"); return { stdout: "", stderr: stats("-inf") }; });
    expect(await inspectAudioSignal(file, run)).toMatchObject({ status: "unavailable", reason: expect.stringContaining("changed") });
  });
});

function writePcmWav(path: string, samples: number[]): void {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(96000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) => bytes.writeInt16LE(sample, 44 + index * 2));
  writeFileSync(path, bytes);
}

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 && spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
describe.skipIf(!hasFfmpeg)("real decoded audio", () => {
  it("distinguishes silence and a very quiet nonzero sample", async () => {
    const samples = Array<number>(48000).fill(0);
    writePcmWav(file, samples);
    expect(await inspectAudioSignal(file)).toMatchObject({ status: "silent" });
    samples[24000] = 1;
    writePcmWav(file, samples);
    expect(await inspectAudioSignal(file)).toMatchObject({ status: "signal_detected" });
  });
  it("recognizes an image file without an audio stream", async () => {
    const bitmap = Buffer.alloc(58);
    bitmap.write("BM", 0); bitmap.writeUInt32LE(bitmap.length, 2); bitmap.writeUInt32LE(54, 10);
    bitmap.writeUInt32LE(40, 14); bitmap.writeInt32LE(1, 18); bitmap.writeInt32LE(1, 22);
    bitmap.writeUInt16LE(1, 26); bitmap.writeUInt16LE(24, 28); bitmap.writeUInt32LE(4, 34);
    const imagePath = join(directory, "image.bmp");
    writeFileSync(imagePath, bitmap);
    expect(await inspectAudioSignal(imagePath)).toMatchObject({ status: "no_audio_stream" });
  });
  it("does not call an empty audio stream silent", async () => {
    writePcmWav(file, []);
    expect(await inspectAudioSignal(file)).toMatchObject({ status: "unavailable" });
  });
});
