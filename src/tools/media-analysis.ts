import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { promisify } from "node:util";
import type { BridgeOptions } from "../bridge/file-bridge.js";

const execFileAsync = promisify(execFile);
const ANALYSIS_TIMEOUT_MS = 300_000;

type ExecFailure = Error & { killed?: boolean; stderr?: string };

function inputPath(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const path = resolve(value);
  return existsSync(path) && statSync(path).isFile() ? path : null;
}

function failureMessage(error: unknown, operation: string): string {
  const failure = error as ExecFailure;
  if (failure.killed) return `${operation} timed out after 300 seconds`;
  const detail = (failure.stderr ?? failure.message ?? "unknown error")
    .split(/\r?\n/).filter(Boolean).slice(-3).join(" ");
  return `${operation} failed: ${detail}`;
}

export interface MediaProbeResult {
  format: Record<string, unknown>;
  streams: Array<Record<string, unknown>>;
  chapters: Array<Record<string, unknown>>;
}

export function parseMediaProbeJson(stdout: string): MediaProbeResult {
  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  return {
    format: parsed.format && typeof parsed.format === "object" ? parsed.format as Record<string, unknown> : {},
    streams: Array.isArray(parsed.streams) ? parsed.streams.filter((v): v is Record<string, unknown> => !!v && typeof v === "object") : [],
    chapters: Array.isArray(parsed.chapters) ? parsed.chapters.filter((v): v is Record<string, unknown> => !!v && typeof v === "object") : [],
  };
}

export interface TransientCandidate { timeSeconds: number; peakDbfs: number }

export function parseTransientCandidates(output: string, thresholdDbfs: number, minimumIntervalSeconds: number): TransientCandidate[] {
  const candidates: TransientCandidate[] = [];
  let time: number | null = null;
  for (const line of output.split(/\r?\n/)) {
    const timeMatch = line.match(/\bpts_time:([\d.]+)/);
    if (timeMatch) time = Number(timeMatch[1]);
    const peakMatch = line.match(/lavfi\.astats\.Overall\.Peak_level=(-?[\d.]+)/);
    if (!peakMatch || time === null) continue;
    const peakDbfs = Number(peakMatch[1]);
    if (peakDbfs >= thresholdDbfs) {
      const previous = candidates.at(-1);
      const candidate = { timeSeconds: time, peakDbfs };
      if (!previous || time - previous.timeSeconds >= minimumIntervalSeconds) candidates.push(candidate);
      else if (peakDbfs > previous.peakDbfs) candidates[candidates.length - 1] = candidate;
    }
    time = null;
  }
  return candidates;
}

export interface InterlaceAnalysis { tff: number; bff: number; progressive: number; undetermined: number; classification: "tff" | "bff" | "progressive" | "mixed" | "undetermined" }

export function parseIdetOutput(output: string): InterlaceAnalysis {
  const matches = [...output.matchAll(/Multi frame detection:\s*TFF:\s*(\d+)\s+BFF:\s*(\d+)\s+Progressive:\s*(\d+)\s+Undetermined:\s*(\d+)/g)];
  const match = matches.at(-1);
  const tff = Number(match?.[1] ?? 0);
  const bff = Number(match?.[2] ?? 0);
  const progressive = Number(match?.[3] ?? 0);
  const undetermined = Number(match?.[4] ?? 0);
  const known = tff + bff + progressive;
  let classification: InterlaceAnalysis["classification"] = "undetermined";
  if (known > 0) {
    const dominant = Math.max(tff, bff, progressive);
    if (dominant / known < 0.8) classification = "mixed";
    else classification = dominant === progressive ? "progressive" : dominant === tff ? "tff" : "bff";
  }
  return { tff, bff, progressive, undetermined, classification };
}

export interface PictureBounds { width: number; height: number; x: number; y: number; samples: number }

export function parseCropDetectOutput(output: string): PictureBounds | null {
  const counts = new Map<string, number>();
  for (const match of output.matchAll(/\bcrop=(\d+):(\d+):(\d+):(\d+)/g)) {
    const key = `${match[1]}:${match[2]}:${match[3]}:${match[4]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const winner = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!winner) return null;
  const [width, height, x, y] = winner[0].split(":").map(Number);
  return { width, height, x, y, samples: winner[1] };
}

export function getMediaAnalysisTools(_bridgeOptions: BridgeOptions) {
  return {
    inspect_media_streams: {
      description: "Inspect a local media file with ffprobe and return container, stream, codec, time-base, channel, and chapter metadata. Read-only and independent of Premiere.",
      parameters: { type: "object", properties: { media_path: { type: "string", description: "Existing local media file" } }, required: ["media_path"] },
      handler: async (args: { media_path?: string }) => {
        const path = inputPath(args.media_path);
        if (!path) return { success: false, error: "media_path must identify an existing regular file" };
        try {
          const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-show_chapters", "-of", "json", path], { timeout: 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
          const data = parseMediaProbeJson(stdout);
          return { success: true, data: { mediaPath: path, ...data, streamCount: data.streams.length } };
        } catch (error) { return { success: false, error: failureMessage(error, "ffprobe media inspection") }; }
      },
    },
    generate_media_contact_sheet: {
      description: "Generate a new, disk-verified PNG contact sheet from evenly sampled source frames. Refuses to overwrite an existing output and does not modify Premiere or the source.",
      parameters: { type: "object", properties: {
        media_path: { type: "string", description: "Existing local video file" },
        output_path: { type: "string", description: "New .png output path" },
        columns: { type: "integer", description: "Grid columns from 2 through 8 (default: 4)" },
        rows: { type: "integer", description: "Grid rows from 2 through 8 (default: 3)" },
        thumbnail_width: { type: "integer", description: "Thumbnail width from 160 through 1280 pixels (default: 320)" },
      }, required: ["media_path", "output_path"] },
      handler: async (args: { media_path?: string; output_path?: string; columns?: number; rows?: number; thumbnail_width?: number }) => {
        const path = inputPath(args.media_path);
        if (!path) return { success: false, error: "media_path must identify an existing regular file" };
        if (typeof args.output_path !== "string" || extname(args.output_path).toLowerCase() !== ".png") return { success: false, error: "output_path must be a new .png file" };
        const outputPath = resolve(args.output_path);
        if (existsSync(outputPath)) return { success: false, error: "output_path already exists; contact sheets never overwrite files" };
        const columns = args.columns ?? 4, rows = args.rows ?? 3, width = args.thumbnail_width ?? 320;
        if (![columns, rows].every(v => Number.isInteger(v) && v >= 2 && v <= 8)) return { success: false, error: "columns and rows must be integers from 2 through 8" };
        if (!Number.isInteger(width) || width < 160 || width > 1280) return { success: false, error: "thumbnail_width must be an integer from 160 through 1280" };
        try {
          const probe = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path], { timeout: 60_000, windowsHide: true });
          const duration = Number(probe.stdout.trim());
          if (!Number.isFinite(duration) || duration <= 0) return { success: false, error: "ffprobe did not return a positive media duration" };
          const frames = columns * rows;
          const interval = Math.max(duration / frames, 0.04);
          await execFileAsync("ffmpeg", ["-v", "error", "-i", path, "-vf", `fps=1/${interval},scale=${width}:-1,tile=${columns}x${rows}`, "-frames:v", "1", outputPath], { timeout: ANALYSIS_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
          if (!existsSync(outputPath) || !statSync(outputPath).isFile() || statSync(outputPath).size < 1) return { success: false, error: "ffmpeg completed without creating a non-empty contact sheet" };
          return { success: true, data: { mediaPath: path, outputPath, grid: { columns, rows, requestedFrames: frames }, thumbnailWidth: width, sizeBytes: statSync(outputPath).size, outputDirectory: dirname(outputPath), verified: true } };
        } catch (error) { return { success: false, error: failureMessage(error, "contact-sheet generation") }; }
      },
    },
    detect_audio_transients: {
      description: "Find probable beat or edit-point transients from decoded audio peaks. Returns candidates for editorial review; it does not claim musical beat-grid accuracy or change a timeline.",
      parameters: { type: "object", properties: {
        media_path: { type: "string", description: "Existing local audio or video file" },
        threshold_dbfs: { type: "number", description: "Minimum transient peak from -60 through 0 dBFS (default: -12)" },
        minimum_interval_seconds: { type: "number", description: "Minimum spacing from 0.05 through 10 seconds (default: 0.25)" },
        maximum_events: { type: "integer", description: "Maximum returned candidates from 1 through 1000 (default: 200)" },
      }, required: ["media_path"] },
      handler: async (args: { media_path?: string; threshold_dbfs?: number; minimum_interval_seconds?: number; maximum_events?: number }) => {
        const path = inputPath(args.media_path);
        if (!path) return { success: false, error: "media_path must identify an existing regular file" };
        const threshold = args.threshold_dbfs ?? -12, interval = args.minimum_interval_seconds ?? 0.25, maximum = args.maximum_events ?? 200;
        if (!Number.isFinite(threshold) || threshold < -60 || threshold > 0) return { success: false, error: "threshold_dbfs must be from -60 through 0" };
        if (!Number.isFinite(interval) || interval < 0.05 || interval > 10) return { success: false, error: "minimum_interval_seconds must be from 0.05 through 10" };
        if (!Number.isInteger(maximum) || maximum < 1 || maximum > 1000) return { success: false, error: "maximum_events must be an integer from 1 through 1000" };
        try {
          const result = await execFileAsync("ffmpeg", ["-v", "info", "-i", path, "-vn", "-af", "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.Peak_level", "-f", "null", "-"], { timeout: ANALYSIS_TIMEOUT_MS, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
          const all = parseTransientCandidates(`${result.stdout}\n${result.stderr}`, threshold, interval);
          return { success: true, data: { mediaPath: path, thresholdDbfs: threshold, minimumIntervalSeconds: interval, totalDetected: all.length, truncated: all.length > maximum, candidates: all.slice(0, maximum), verificationScope: "Peak-derived transient candidates only; confirm rhythm and editorial suitability by listening." } };
        } catch (error) { return { success: false, error: failureMessage(error, "audio transient analysis") }; }
      },
    },
    analyze_video_interlacing: {
      description: "Classify decoded video frames as progressive, top-field-first, bottom-field-first, mixed, or undetermined using FFmpeg idet. Read-only delivery preflight.",
      parameters: { type: "object", properties: { media_path: { type: "string", description: "Existing local video file" }, sample_seconds: { type: "number", description: "Decode sample duration from 1 through 300 seconds (default: 30)" } }, required: ["media_path"] },
      handler: async (args: { media_path?: string; sample_seconds?: number }) => {
        const path = inputPath(args.media_path);
        if (!path) return { success: false, error: "media_path must identify an existing regular file" };
        const seconds = args.sample_seconds ?? 30;
        if (!Number.isFinite(seconds) || seconds < 1 || seconds > 300) return { success: false, error: "sample_seconds must be from 1 through 300" };
        try {
          const result = await execFileAsync("ffmpeg", ["-v", "info", "-i", path, "-t", String(seconds), "-vf", "idet", "-an", "-f", "null", "-"], { timeout: ANALYSIS_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
          const analysis = parseIdetOutput(`${result.stdout}\n${result.stderr}`);
          return { success: true, data: { mediaPath: path, sampleSeconds: seconds, ...analysis, passesProgressiveDelivery: analysis.classification === "progressive", verificationScope: "Decoded sample only; mixed and undetermined results require visual or scope review." } };
        } catch (error) { return { success: false, error: failureMessage(error, "interlace analysis") }; }
      },
    },
    detect_active_picture_bounds: {
      description: "Detect the most frequent active-picture crop rectangle in decoded video, exposing probable letterbox or pillarbox bars without modifying the source.",
      parameters: { type: "object", properties: { media_path: { type: "string", description: "Existing local video file" }, sample_seconds: { type: "number", description: "Decode sample duration from 1 through 300 seconds (default: 30)" }, limit: { type: "integer", description: "Cropdetect black threshold from 0 through 255 (default: 24)" } }, required: ["media_path"] },
      handler: async (args: { media_path?: string; sample_seconds?: number; limit?: number }) => {
        const path = inputPath(args.media_path);
        if (!path) return { success: false, error: "media_path must identify an existing regular file" };
        const seconds = args.sample_seconds ?? 30, limit = args.limit ?? 24;
        if (!Number.isFinite(seconds) || seconds < 1 || seconds > 300) return { success: false, error: "sample_seconds must be from 1 through 300" };
        if (!Number.isInteger(limit) || limit < 0 || limit > 255) return { success: false, error: "limit must be an integer from 0 through 255" };
        try {
          const result = await execFileAsync("ffmpeg", ["-v", "info", "-i", path, "-t", String(seconds), "-vf", `cropdetect=limit=${limit}:round=2:reset=0`, "-an", "-f", "null", "-"], { timeout: ANALYSIS_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
          const bounds = parseCropDetectOutput(`${result.stdout}\n${result.stderr}`);
          if (!bounds) return { success: false, error: "cropdetect returned no active-picture measurements" };
          return { success: true, data: { mediaPath: path, sampleSeconds: seconds, limit, activePicture: bounds, verificationScope: "Most frequent decoded crop candidate; intentional borders and dark scenes require visual review." } };
        } catch (error) { return { success: false, error: failureMessage(error, "active-picture detection") }; }
      },
    },
  };
}
