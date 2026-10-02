import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Physical source end from integer stream timestamps, never an editable Out
 * mark or rounded format.duration. The shortest A/V stream is a conservative
 * bound for a shared source file. Unknown clocks and stills fail closed.
 */
export async function probeMediaDurationSeconds(mediaPath: string): Promise<number | null> {
  if (!mediaPath || !existsSync(mediaPath)) return null;
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "stream=codec_type,duration_ts,time_base", "-of", "json", mediaPath],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    const parsed: unknown = JSON.parse(String(stdout));
    if (!parsed || typeof parsed !== "object" || !("streams" in parsed) || !Array.isArray(parsed.streams)) return null;
    const durations: number[] = [];
    for (const stream of parsed.streams) {
      if (!stream || typeof stream !== "object") return null;
      if (stream.codec_type !== "audio" && stream.codec_type !== "video") continue;
      if ((typeof stream.duration_ts !== "number" && typeof stream.duration_ts !== "string") ||
        typeof stream.time_base !== "string" || !/^\d+\/\d+$/.test(stream.time_base)) return null;
      const ticks = Number(stream.duration_ts);
      const [numerator, denominator] = stream.time_base.split("/").map(Number);
      if (!Number.isSafeInteger(ticks) || ticks <= 0 || !Number.isSafeInteger(numerator) || numerator <= 0 || !Number.isSafeInteger(denominator) || denominator <= 0) return null;
      const numeratorTicks = ticks * numerator;
      if (!Number.isSafeInteger(numeratorTicks)) return null;
      const duration = numeratorTicks / denominator;
      if (!Number.isFinite(duration) || duration <= 0) return null;
      durations.push(duration);
    }
    return durations.length ? Math.min(...durations) : null;
  } catch {
    return null;
  }
}
