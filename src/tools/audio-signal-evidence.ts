import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Decoded evidence only. It cannot determine whether silence was intended. */
export type AudioSignalEvidence =
  | { status: "signal_detected"; peakDbfs: number; method: "ffmpeg_astats" }
  | { status: "silent"; peakDbfs: null; method: "ffmpeg_astats" }
  | { status: "no_audio_stream"; peakDbfs: null; method: "ffprobe" }
  | { status: "unavailable"; peakDbfs: null; reason: string };

type CommandRunner = (command: string, args: string[], options: { timeout: number; maxBuffer: number; windowsHide: boolean }) => Promise<{ stdout: string; stderr: string }>;
const defaultRunner: CommandRunner = async (command, args, options) => {
  const result = await execFileAsync(command, args, options);
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
};

/**
 * Inspect the first audio stream over its full decoded duration. A finite peak
 * is reported as a signal even when very quiet; no subjective threshold is used.
 * Missing tools, corrupt/empty streams and incomplete decode fail closed.
 */
export async function inspectAudioSignal(path: string, run: CommandRunner = defaultRunner): Promise<AudioSignalEvidence> {
  try {
    const before = statSync(path);
    if (!before.isFile()) return { status: "unavailable", peakDbfs: null, reason: "Export is not a regular file" };
    const changed = () => {
      try {
        const after = statSync(path);
        return !after.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs;
      } catch { return true; }
    };
    const probe = await run("ffprobe", ["-v", "error", "-protocol_whitelist", "file,crypto,data", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "json", path], { timeout: 60_000, maxBuffer: 1024 * 1024, windowsHide: true });
    const report: unknown = JSON.parse(probe.stdout);
    if (!report || typeof report !== "object" || !("streams" in report) || !Array.isArray(report.streams)) {
      return { status: "unavailable", peakDbfs: null, reason: "ffprobe returned an invalid audio stream report" };
    }
    if (changed()) return { status: "unavailable", peakDbfs: null, reason: "Export changed during audio signal inspection" };
    if (report.streams.length === 0) return { status: "no_audio_stream", peakDbfs: null, method: "ffprobe" };
    const measurement = await run("ffmpeg", ["-nostdin", "-hide_banner", "-nostats", "-loglevel", "info", "-xerror", "-protocol_whitelist", "file,crypto,data", "-i", path, "-map", "0:a:0", "-vn", "-sn", "-dn", "-af", "astats=metadata=0:reset=0", "-f", "null", "-"], { timeout: 300_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    if (changed()) return { status: "unavailable", peakDbfs: null, reason: "Export changed during audio signal inspection" };
    // astats reports each channel and finally Overall. The final peak is the
    // global peak; a sample count is required to reject empty/partial output.
    const overall = measurement.stderr.slice(measurement.stderr.lastIndexOf("Overall"));
    const peak = overall.match(/Peak level dB:\s*(-?inf|[-+]?\d+(?:\.\d+)?)/i)?.[1];
    const samples = Number(overall.match(/Number of samples:\s*(\d+)/i)?.[1]);
    if (!peak || !Number.isFinite(samples) || samples <= 0) return { status: "unavailable", peakDbfs: null, reason: "FFmpeg returned no complete audio sample measurement" };
    if (peak.toLowerCase() === "-inf") return { status: "silent", peakDbfs: null, method: "ffmpeg_astats" };
    const peakDbfs = Number(peak);
    if (!Number.isFinite(peakDbfs)) return { status: "unavailable", peakDbfs: null, reason: "FFmpeg returned an invalid audio peak" };
    return { status: "signal_detected", peakDbfs, method: "ffmpeg_astats" };
  } catch (error) {
    const failure = error as { code?: string; killed?: boolean };
    return { status: "unavailable", peakDbfs: null, reason: failure.code === "ENOENT" ? "ffprobe or ffmpeg was not found on PATH" : failure.killed ? "Audio signal inspection timed out" : "Audio signal inspection could not complete" };
  }
}
