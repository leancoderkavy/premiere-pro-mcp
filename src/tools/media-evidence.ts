import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Physical source end from integer stream timestamps, never an editable Out
 * mark or rounded format.duration. The shortest A/V stream is a conservative
 * bound for a shared source file. Unknown clocks and stills fail closed.
 */
async function probeMediaClocks(mediaPath: string): Promise<Array<{ numerator: bigint; denominator: bigint }> | null> {
  if (!mediaPath || !existsSync(mediaPath)) return null;
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "stream=codec_type,duration_ts,time_base", "-of", "json", mediaPath],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    const parsed: unknown = JSON.parse(String(stdout));
    if (!parsed || typeof parsed !== "object" || !("streams" in parsed) || !Array.isArray(parsed.streams)) return null;
    const durations: Array<{ numerator: bigint; denominator: bigint }> = [];
    for (const stream of parsed.streams) {
      if (!stream || typeof stream !== "object") return null;
      if (stream.codec_type !== "audio" && stream.codec_type !== "video") continue;
      if ((typeof stream.duration_ts !== "number" && typeof stream.duration_ts !== "string") ||
        typeof stream.time_base !== "string" || !/^\d+\/\d+$/.test(stream.time_base)) return null;
      const ticks = Number(stream.duration_ts);
      const [numerator, denominator] = stream.time_base.split("/").map(Number);
      if (!Number.isSafeInteger(ticks) || ticks <= 0 || !Number.isSafeInteger(numerator) || numerator <= 0 || !Number.isSafeInteger(denominator) || denominator <= 0) return null;
      durations.push({ numerator: BigInt(ticks) * BigInt(numerator), denominator: BigInt(denominator) });
    }
    return durations.length ? durations : null;
  } catch {
    return null;
  }
}

/** Decimal seconds are useful for reporting; physical edit caps use the exact tick probe below. */
export async function probeMediaDurationSeconds(mediaPath: string): Promise<number | null> {
  const clocks = await probeMediaClocks(mediaPath);
  if (!clocks) return null;
  const durations = clocks.map((clock) => Number(clock.numerator) / Number(clock.denominator));
  return durations.every((duration) => Number.isFinite(duration) && duration > 0) ? Math.min(...durations) : null;
}

/** Floor the rational source end directly in integer arithmetic, before any float conversion. */
export async function probeMediaDurationTicks(mediaPath: string): Promise<number | null> {
  const clocks = await probeMediaClocks(mediaPath);
  if (!clocks) return null;
  const ends = clocks.map((clock) => clock.numerator * 254016000000n / clock.denominator);
  const end = ends.reduce((shortest, candidate) => candidate < shortest ? candidate : shortest);
  if (end <= 0n || end > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(end);
}
