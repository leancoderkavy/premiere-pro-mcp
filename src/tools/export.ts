import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import { createReadStream, readFileSync, unlinkSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { parseEbur128Summary } from "./audio.js";

const execFileAsync = promisify(execFile);
const VIDEO_QC_TIMEOUT_MS = 300_000;
const MAX_FAILURE_DIAGNOSTIC_LENGTH = 4_096;
export const MAX_CAPTURE_FRAME_BYTES = 8 * 1024 * 1024;

export type ConformanceStatus = "pass" | "fail" | "not_evaluated";

export interface DeliveryConformanceCheck {
  id: string;
  status: ConformanceStatus;
  expected: unknown;
  actual: unknown;
  detail?: string;
}

export interface DeliveryConformanceContract {
  allowedContainerNames?: string[];
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  frameRateTolerance?: number;
  durationSeconds?: number;
  durationToleranceSeconds?: number;
  minimumVideoBitrateKbps?: number;
  maximumVideoBitrateKbps?: number;
  audioSampleRateHz?: number;
  audioChannels?: number;
  targetLufs?: number;
  loudnessToleranceLu?: number;
  maximumTruePeakDbfs?: number;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseRationalRate(value: unknown): number | null {
  if (typeof value !== "string") {
    const parsed = finiteNumber(value);
    return parsed !== null && parsed > 0 ? parsed : null;
  }
  const parts = value.split("/");
  if (parts.length === 2) {
    const numerator = Number(parts[0]);
    const denominator = Number(parts[1]);
    const parsed = Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0 ? numerator / denominator : null;
    return parsed !== null && parsed > 0 ? parsed : null;
  }
  const parsed = finiteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function boundedFailureDiagnostic(value: unknown): string {
  const diagnostic = String(value ?? "").trim();
  return diagnostic.length > MAX_FAILURE_DIAGNOSTIC_LENGTH
    ? `${diagnostic.slice(0, MAX_FAILURE_DIAGNOSTIC_LENGTH - 1)}…`
    : diagnostic;
}

export function validateDeliveryConformanceContract(contract: DeliveryConformanceContract): string | null {
  if (!contract || typeof contract !== "object") return "contract is required";
  const expectations = [
    contract.allowedContainerNames, contract.videoCodec, contract.audioCodec,
    contract.width, contract.height, contract.frameRate, contract.durationSeconds,
    contract.minimumVideoBitrateKbps, contract.maximumVideoBitrateKbps,
    contract.audioSampleRateHz, contract.audioChannels, contract.targetLufs,
    contract.maximumTruePeakDbfs,
  ];
  if (contract.allowedContainerNames !== undefined && (!Array.isArray(contract.allowedContainerNames) || contract.allowedContainerNames.length === 0 || contract.allowedContainerNames.some(value => !normalized(value)))) {
    return "allowed_container_names must contain at least one non-empty container name";
  }
  for (const [name, value] of Object.entries({ video_codec: contract.videoCodec, audio_codec: contract.audioCodec })) {
    if (value !== undefined && !normalized(value)) return `${name} must be a non-empty string`;
  }
  for (const [name, value] of Object.entries({ width: contract.width, height: contract.height, audio_sample_rate_hz: contract.audioSampleRateHz, audio_channels: contract.audioChannels })) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) return `${name} must be a positive integer`;
  }
  for (const [name, value] of Object.entries({ frame_rate: contract.frameRate, duration_seconds: contract.durationSeconds, minimum_video_bitrate_kbps: contract.minimumVideoBitrateKbps, maximum_video_bitrate_kbps: contract.maximumVideoBitrateKbps })) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) return `${name} must be a finite value greater than 0`;
  }
  for (const [name, value] of Object.entries({ frame_rate_tolerance: contract.frameRateTolerance, duration_tolerance_seconds: contract.durationToleranceSeconds, loudness_tolerance_lu: contract.loudnessToleranceLu })) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) return `${name} must be a finite non-negative value`;
  }
  if (contract.frameRateTolerance !== undefined && contract.frameRate === undefined) return "frame_rate_tolerance requires frame_rate";
  if (contract.durationToleranceSeconds !== undefined && contract.durationSeconds === undefined) return "duration_tolerance_seconds requires duration_seconds";
  if (contract.loudnessToleranceLu !== undefined && contract.targetLufs === undefined) return "loudness_tolerance_lu requires target_lufs";
  if (contract.minimumVideoBitrateKbps !== undefined && contract.maximumVideoBitrateKbps !== undefined && contract.minimumVideoBitrateKbps > contract.maximumVideoBitrateKbps) return "minimum_video_bitrate_kbps cannot exceed maximum_video_bitrate_kbps";
  if (contract.targetLufs !== undefined && (!Number.isFinite(contract.targetLufs) || contract.targetLufs < -100 || contract.targetLufs > 0)) return "target_lufs must be from -100 through 0";
  if (contract.maximumTruePeakDbfs !== undefined && (!Number.isFinite(contract.maximumTruePeakDbfs) || contract.maximumTruePeakDbfs < -100 || contract.maximumTruePeakDbfs > 0)) return "maximum_true_peak_dbfs must be from -100 through 0";
  if (!expectations.some(value => value !== undefined)) return "At least one delivery conformance expectation is required";
  return null;
}

export function evaluateDeliveryConformance(
  probe: Record<string, unknown>,
  contract: DeliveryConformanceContract,
  loudness?: { integratedLufs: number | null; truePeakDbfs: number | null } | null,
  loudnessUnavailableReason?: string,
): DeliveryConformanceCheck[] {
  const streams = Array.isArray(probe.streams) ? probe.streams.filter((value): value is Record<string, unknown> => !!value && typeof value === "object") : [];
  const format = probe.format && typeof probe.format === "object" ? probe.format as Record<string, unknown> : {};
  const video = streams.find(stream => {
    if (stream.codec_type !== "video") return false;
    const disposition = stream.disposition && typeof stream.disposition === "object" ? stream.disposition as Record<string, unknown> : {};
    return finiteNumber(disposition.attached_pic) !== 1;
  });
  const audio = streams.find(stream => stream.codec_type === "audio");
  const checks: DeliveryConformanceCheck[] = [];
  const exact = (id: string, expected: unknown, actual: unknown) => checks.push({ id, status: normalized(actual) === normalized(expected) ? "pass" : "fail", expected, actual: actual ?? null });
  const numeric = (id: string, expected: number, actualValue: unknown, tolerance = 0, unavailableReason?: string) => {
    const actual = finiteNumber(actualValue);
    const unavailable = actual === null ? unavailableReason : undefined;
    checks.push({ id, status: unavailable ? "not_evaluated" : actual !== null && Math.abs(actual - expected) <= tolerance ? "pass" : "fail", expected, actual, detail: unavailable ?? `tolerance=${tolerance}` });
  };
  if (contract.allowedContainerNames) {
    const actualNames = normalized(format.format_name).split(",").filter(Boolean);
    const allowed = contract.allowedContainerNames.map(normalized);
    checks.push({ id: "container_demuxer_family", status: actualNames.some(name => allowed.includes(name)) ? "pass" : "fail", expected: contract.allowedContainerNames, actual: actualNames, detail: "Matches ffprobe demuxer-family aliases only; aliases such as mov and mp4 do not identify an exact container subtype." });
  }
  if (contract.videoCodec !== undefined) exact("video_codec", contract.videoCodec, video?.codec_name);
  if (contract.audioCodec !== undefined) exact("audio_codec", contract.audioCodec, audio?.codec_name);
  if (contract.width !== undefined) numeric("width", contract.width, video?.width, 0, video ? "Video width metadata was unavailable" : undefined);
  if (contract.height !== undefined) numeric("height", contract.height, video?.height, 0, video ? "Video height metadata was unavailable" : undefined);
  if (contract.frameRate !== undefined) numeric("frame_rate", contract.frameRate, parseRationalRate(video?.avg_frame_rate) ?? parseRationalRate(video?.r_frame_rate), contract.frameRateTolerance ?? 0.001, video ? "Video frame-rate metadata was unavailable" : undefined);
  if (contract.durationSeconds !== undefined) numeric("duration", contract.durationSeconds, format.duration, contract.durationToleranceSeconds ?? 0.05, "Duration metadata was unavailable");
  const bitrate = video ? finiteNumber(video.bit_rate) : null;
  const bitrateUnavailable = !video ? "No video stream was available for video bitrate evaluation" : bitrate === null ? "Video bitrate metadata was unavailable" : undefined;
  if (contract.minimumVideoBitrateKbps !== undefined) checks.push({ id: "minimum_video_bitrate", status: bitrateUnavailable ? "not_evaluated" : bitrate !== null && bitrate / 1000 >= contract.minimumVideoBitrateKbps ? "pass" : "fail", expected: contract.minimumVideoBitrateKbps, actual: bitrate === null ? null : bitrate / 1000, detail: bitrateUnavailable });
  if (contract.maximumVideoBitrateKbps !== undefined) checks.push({ id: "maximum_video_bitrate", status: bitrateUnavailable ? "not_evaluated" : bitrate !== null && bitrate / 1000 <= contract.maximumVideoBitrateKbps ? "pass" : "fail", expected: contract.maximumVideoBitrateKbps, actual: bitrate === null ? null : bitrate / 1000, detail: bitrateUnavailable });
  if (contract.audioSampleRateHz !== undefined) numeric("audio_sample_rate", contract.audioSampleRateHz, audio?.sample_rate, 0, audio ? "Audio sample-rate metadata was unavailable" : undefined);
  if (contract.audioChannels !== undefined) numeric("audio_channels", contract.audioChannels, audio?.channels, 0, audio ? "Audio channel-count metadata was unavailable" : undefined);
  if (contract.targetLufs !== undefined) {
    const actual = loudness?.integratedLufs ?? null;
    const unavailable = loudnessUnavailableReason ?? (actual === null ? "Integrated loudness measurement was unavailable" : undefined);
    checks.push({ id: "integrated_loudness", status: unavailable ? "not_evaluated" : Math.abs(actual! - contract.targetLufs) <= (contract.loudnessToleranceLu ?? 1) ? "pass" : "fail", expected: contract.targetLufs, actual, detail: unavailable ?? `tolerance=${contract.loudnessToleranceLu ?? 1} LU` });
  }
  if (contract.maximumTruePeakDbfs !== undefined) {
    const actual = loudness?.truePeakDbfs ?? null;
    const unavailable = loudnessUnavailableReason ?? (actual === null ? "True-peak measurement was unavailable" : undefined);
    checks.push({ id: "true_peak", status: unavailable ? "not_evaluated" : actual! <= contract.maximumTruePeakDbfs ? "pass" : "fail", expected: contract.maximumTruePeakDbfs, actual, detail: unavailable });
  }
  return checks;
}

export interface VideoQcInterval {
  start: number;
  end: number;
  duration: number;
}

export function parseVideoQcOutput(stderr: string) {
  const blackFrames: VideoQcInterval[] = [];
  const freezes: VideoQcInterval[] = [];
  for (const match of stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g)) {
    blackFrames.push({ start: Number(match[1]), end: Number(match[2]), duration: Number(match[3]) });
  }
  let freezeStart: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const start = line.match(/freeze_start:\s*([\d.]+)/);
    if (start) freezeStart = Number(start[1]);
    const end = line.match(/freeze_end:\s*([\d.]+)/);
    if (end && freezeStart !== null) {
      const endSeconds = Number(end[1]);
      freezes.push({ start: freezeStart, end: endSeconds, duration: Number((endSeconds - freezeStart).toFixed(3)) });
      freezeStart = null;
    }
  }
  return { blackFrames, freezes };
}

export interface SceneChange {
  timeSeconds: number;
  score: number;
}

export function parseSceneChangeOutput(output: string, minimumIntervalSeconds = 0): SceneChange[] {
  const events: SceneChange[] = [];
  let pendingTime: number | null = null;
  for (const line of output.split(/\r?\n/)) {
    const time = line.match(/\bpts_time:([\d.]+)/);
    if (time) pendingTime = Number(time[1]);
    const score = line.match(/lavfi\.scene_score=([\d.]+)/);
    if (score && pendingTime !== null) {
      const event = { timeSeconds: pendingTime, score: Number(score[1]) };
      const previous = events.at(-1);
      if (!previous || event.timeSeconds - previous.timeSeconds >= minimumIntervalSeconds) events.push(event);
      else if (event.score > previous.score) events[events.length - 1] = event;
      pendingTime = null;
    }
  }
  return events;
}

export type DeliveryChecksumAlgorithm = "sha256" | "sha512";

export interface DeliveryFileVerification {
  path: string;
  exists: true;
  regularFile: true;
  sizeBytes: number;
  modifiedAt: string;
  checksum: {
    algorithm: DeliveryChecksumAlgorithm;
    value: string;
  };
  matchesExpectedChecksum?: boolean;
  matchesExpectedSize?: boolean;
  valid: boolean;
}

export function deliveryFileChangedDuringHash(
  before: { dev: number; ino: number; size: number; mtimeMs: number },
  after: { dev: number; ino: number; size: number; mtimeMs: number },
): boolean {
  return (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  );
}

export async function verifyDeliveryFile(
  outputPath: string,
  options: {
    algorithm?: DeliveryChecksumAlgorithm;
    expectedChecksum?: string;
    expectedSizeBytes?: number;
    minimumSizeBytes?: number;
  } = {},
): Promise<DeliveryFileVerification> {
  const path = resolve(outputPath);
  if (!existsSync(path)) throw new Error(`Delivery file does not exist: ${path}`);
  const stats = statSync(path);
  if (!stats.isFile()) throw new Error(`Delivery path is not a regular file: ${path}`);

  const minimumSizeBytes = options.minimumSizeBytes ?? 1;
  if (!Number.isSafeInteger(minimumSizeBytes) || minimumSizeBytes < 0) {
    throw new Error("minimum_size_bytes must be a non-negative integer");
  }
  if (stats.size < minimumSizeBytes) {
    throw new Error(`Delivery file is ${stats.size} bytes; expected at least ${minimumSizeBytes}`);
  }

  const algorithm = options.algorithm ?? "sha256";
  if (algorithm !== "sha256" && algorithm !== "sha512") {
    throw new Error("checksum_algorithm must be 'sha256' or 'sha512'");
  }
  const hash = createHash(algorithm);
  await new Promise<void>((resolveHash, rejectHash) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectHash);
    stream.on("end", resolveHash);
  });
  const checksum = hash.digest("hex");
  const finalStats = statSync(path);
  if (!finalStats.isFile() || deliveryFileChangedDuringHash(stats, finalStats)) {
    throw new Error(`Delivery file changed while its checksum was being calculated: ${path}`);
  }

  const expectedChecksum = options.expectedChecksum?.trim().toLowerCase();
  const expectedLength = algorithm === "sha256" ? 64 : 128;
  if (expectedChecksum !== undefined && !new RegExp(`^[a-f0-9]{${expectedLength}}$`).test(expectedChecksum)) {
    throw new Error(`expected_checksum must be a ${expectedLength}-character hexadecimal ${algorithm} digest`);
  }
  const expectedSize = options.expectedSizeBytes;
  if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize < 0)) {
    throw new Error("expected_size_bytes must be a non-negative integer");
  }
  const matchesExpectedChecksum = expectedChecksum === undefined ? undefined : checksum === expectedChecksum;
  const matchesExpectedSize = expectedSize === undefined ? undefined : stats.size === expectedSize;

  return {
    path,
    exists: true,
    regularFile: true,
    sizeBytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    checksum: { algorithm, value: checksum },
    ...(matchesExpectedChecksum === undefined ? {} : { matchesExpectedChecksum }),
    ...(matchesExpectedSize === undefined ? {} : { matchesExpectedSize }),
    valid: matchesExpectedChecksum !== false && matchesExpectedSize !== false,
  };
}

const SAME_AS_PROJECT_RE = /SameAsProject|Same\s+as\s+Project/i;
const MAX_EXPORT_PRESET_BYTES = 8 * 1024 * 1024;

export function decodeExportPresetContents(contents: Buffer): string {
  if (contents.length >= 2 && contents[0] === 0x1f && contents[1] === 0x8b) {
    try {
      return gunzipSync(contents).toString("utf8");
    } catch {
      // Fall through to a raw scan when the gzip payload is truncated.
    }
  }
  return contents.toString("utf8");
}

export function exportPresetUsesSameAsProject(contents: Buffer): boolean {
  return SAME_AS_PROJECT_RE.test(decodeExportPresetContents(contents));
}

export function inspectExportPresetFile(presetPath: string) {
  const path = resolve(presetPath);
  if (extname(path).toLowerCase() !== ".epr") throw new Error("Export preset must use the .epr extension");
  if (!existsSync(path)) throw new Error(`Export preset does not exist: ${path}`);
  const stats = statSync(path);
  if (!stats.isFile()) throw new Error(`Export preset path is not a regular file: ${path}`);
  if (stats.size === 0) throw new Error(`Export preset is empty: ${path}`);
  if (stats.size > MAX_EXPORT_PRESET_BYTES) throw new Error(`Export preset exceeds ${MAX_EXPORT_PRESET_BYTES} bytes`);
  const contents = readFileSync(path);
  if (exportPresetUsesSameAsProject(contents)) {
    throw new Error(
      "This Adobe Media Encoder preset uses a Same as Project output destination. Premiere copies the project to a scratch folder for AME, so the encoded file will not land at the requested output_path. Use a preset with an explicit output location.",
    );
  }
  return { path, exists: true as const, regularFile: true as const, sizeBytes: stats.size, modifiedAt: stats.mtime.toISOString() };
}

/** Audio stream layout via ffprobe, or null when ffprobe or an audio stream is unavailable. */
async function audioLayout(path: string): Promise<{ channels: number; sampleRate: number } | null> {
  try {
    const { stdout } = await promisify(execFile)("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels,sample_rate", "-of", "json", path], { timeout: 15000 });
    const stream = JSON.parse(stdout).streams?.[0];
    return stream ? { channels: Number(stream.channels), sampleRate: Number(stream.sample_rate) } : null;
  } catch {
    return null;
  }
}

export function getExportTools(bridgeOptions: BridgeOptions) {
  return {
    validate_export_preset: {
      description:
        "Validate that an Adobe Media Encoder .epr preset exists and ask the active Premiere sequence which output extension it produces",
      parameters: {
        type: "object" as const,
        properties: {
          preset_path: {
            type: "string",
            description: "Full path to an Adobe Media Encoder export preset (.epr)",
          },
        },
        required: ["preset_path"],
      },
      handler: async (args: { preset_path: string }) => {
        let file;
        try {
          file = inspectExportPresetFile(args.preset_path);
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var presetPath = "${escapeForExtendScript(file.path)}";
          var extension = seq.getExportFileExtension(presetPath);
          if (!extension) return __error("Premiere could not resolve an output extension for this preset");
          return __result({ presetPath: presetPath, outputExtension: extension });
        `);
        const result = await sendCommand(script, bridgeOptions);
        if (!result.success) return result;
        return {
          success: true,
          data: {
            ...file,
            ...((result.data ?? {}) as Record<string, unknown>),
            hostValidated: true,
          },
        };
      },
    },

    verify_delivery_file: {
      description:
        "Verify that an exported delivery is a non-empty regular file and calculate a SHA-256 or SHA-512 checksum; optionally compare expected size and checksum",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Full path to the exported delivery file",
          },
          checksum_algorithm: {
            type: "string",
            enum: ["sha256", "sha512"],
            description: "Checksum algorithm (default: sha256)",
          },
          expected_checksum: {
            type: "string",
            description: "Optional expected hexadecimal checksum to compare",
          },
          expected_size_bytes: {
            type: "number",
            description: "Optional exact expected file size in bytes",
          },
          minimum_size_bytes: {
            type: "number",
            description: "Minimum acceptable file size in bytes (default: 1)",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: {
        output_path: string;
        checksum_algorithm?: DeliveryChecksumAlgorithm;
        expected_checksum?: string;
        expected_size_bytes?: number;
        minimum_size_bytes?: number;
      }) => {
        try {
          const verification = await verifyDeliveryFile(args.output_path, {
            algorithm: args.checksum_algorithm,
            expectedChecksum: args.expected_checksum,
            expectedSizeBytes: args.expected_size_bytes,
            minimumSizeBytes: args.minimum_size_bytes,
          });
          return { success: true, data: verification };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    },

    verify_delivery_conformance: {
      description:
        "Verify a local exported file against an explicit delivery contract using ffprobe and optional EBU R128 analysis. Returns pass, fail, or not_evaluated per check; it does not prove Premiere render lineage or visual approval.",
      operationalCapability: {
        backend: "local" as const,
        backends: ["local" as const],
        status: "supported" as const,
        minimumPremiereVersion: null,
        authority: "filesystem" as const,
        verificationBoundary: "local_filesystem" as const,
        hostVerificationRequired: false,
        notes: ["Reads a local delivery with ffprobe and optional FFmpeg decoding; it does not contact Premiere Pro."],
      },
      parameters: {
        type: "object" as const,
        properties: {
          output_path: { type: "string", description: "Existing local delivery file" },
          allowed_container_names: { type: "array", items: { type: "string" }, description: "Allowed ffprobe demuxer-family aliases, such as mov or mp4. This cannot distinguish exact subtypes when ffprobe reports a shared alias family." },
          video_codec: { type: "string", description: "Expected video codec name, such as h264 or prores" },
          audio_codec: { type: "string", description: "Expected audio codec name, such as aac or pcm_s24le" },
          width: { type: "integer", description: "Expected video width in pixels" },
          height: { type: "integer", description: "Expected video height in pixels" },
          frame_rate: { type: "number", description: "Expected frames per second; rational ffprobe rates are compared numerically" },
          frame_rate_tolerance: { type: "number", description: "Allowed absolute frame-rate difference (default: 0.001)" },
          duration_seconds: { type: "number", description: "Expected duration in seconds" },
          duration_tolerance_seconds: { type: "number", description: "Allowed absolute duration difference (default: 0.05)" },
          minimum_video_bitrate_kbps: { type: "number", description: "Optional minimum selected-video-stream bitrate in kilobits per second" },
          maximum_video_bitrate_kbps: { type: "number", description: "Optional maximum selected-video-stream bitrate in kilobits per second" },
          audio_sample_rate_hz: { type: "integer", description: "Expected audio sample rate" },
          audio_channels: { type: "integer", description: "Expected audio channel count" },
          target_lufs: { type: "number", description: "Optional integrated loudness target from -100 through 0 LUFS" },
          loudness_tolerance_lu: { type: "number", description: "Allowed absolute loudness difference (default: 1 LU)" },
          maximum_true_peak_dbfs: { type: "number", description: "Optional maximum true peak from -100 through 0 dBFS" },
        },
        required: ["output_path"],
      },
      handler: async (args: {
        output_path: string;
        allowed_container_names?: string[];
        video_codec?: string;
        audio_codec?: string;
        width?: number;
        height?: number;
        frame_rate?: number;
        frame_rate_tolerance?: number;
        duration_seconds?: number;
        duration_tolerance_seconds?: number;
        minimum_video_bitrate_kbps?: number;
        maximum_video_bitrate_kbps?: number;
        audio_sample_rate_hz?: number;
        audio_channels?: number;
        target_lufs?: number;
        loudness_tolerance_lu?: number;
        maximum_true_peak_dbfs?: number;
      }) => {
        const contract: DeliveryConformanceContract = {
          allowedContainerNames: args.allowed_container_names,
          videoCodec: args.video_codec,
          audioCodec: args.audio_codec,
          width: args.width,
          height: args.height,
          frameRate: args.frame_rate,
          frameRateTolerance: args.frame_rate_tolerance,
          durationSeconds: args.duration_seconds,
          durationToleranceSeconds: args.duration_tolerance_seconds,
          minimumVideoBitrateKbps: args.minimum_video_bitrate_kbps,
          maximumVideoBitrateKbps: args.maximum_video_bitrate_kbps,
          audioSampleRateHz: args.audio_sample_rate_hz,
          audioChannels: args.audio_channels,
          targetLufs: args.target_lufs,
          loudnessToleranceLu: args.loudness_tolerance_lu,
          maximumTruePeakDbfs: args.maximum_true_peak_dbfs,
        };
        const contractError = validateDeliveryConformanceContract(contract);
        if (contractError) return { success: false, error: contractError };
        const mediaPath = resolve(args.output_path);
        let before: ReturnType<typeof statSync>;
        try {
          before = statSync(mediaPath);
          if (!before.isFile()) return { success: false, error: `Delivery file not found on disk: ${mediaPath}` };
        } catch {
          return { success: false, error: `Delivery file not found on disk: ${mediaPath}` };
        }
        const changedSinceStart = () => {
          try {
            const current = statSync(mediaPath);
            return !current.isFile() || deliveryFileChangedDuringHash(before, current);
          } catch {
            return true;
          }
        };
        let probe: Record<string, unknown>;
        try {
          const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-protocol_whitelist", "file,crypto,data", "-show_format", "-show_streams", "-of", "json", mediaPath], { timeout: 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
          const parsed = JSON.parse(stdout) as unknown;
          const candidate = parsed && typeof parsed === "object" ? parsed as { format?: unknown; streams?: unknown } : null;
          if (!candidate || !candidate.format || typeof candidate.format !== "object" || !Array.isArray(candidate.streams)) {
            if (changedSinceStart()) return { success: false, error: `Delivery file changed during conformance inspection: ${mediaPath}` };
            return { success: false, error: "ffprobe returned an invalid delivery report" };
          }
          probe = candidate as Record<string, unknown>;
        } catch (error) {
          const failure = error as { code?: string; killed?: boolean; stderr?: string; message?: string };
          if (changedSinceStart()) return { success: false, error: `Delivery file changed during conformance inspection: ${mediaPath}` };
          if (failure.code === "ENOENT") return { success: false, error: "ffprobe was not found on PATH" };
          if (failure.killed) return { success: false, error: "ffprobe delivery conformance inspection timed out after 60 seconds" };
          return {
            success: false,
            error: `ffprobe delivery conformance inspection failed: ${boundedFailureDiagnostic(failure.stderr) || boundedFailureDiagnostic(failure.message) || "unknown error"}`,
          };
        }
        let loudness: ReturnType<typeof parseEbur128Summary> | null = null;
        let loudnessUnavailableReason: string | undefined;
        if (contract.targetLufs !== undefined || contract.maximumTruePeakDbfs !== undefined) {
          const streams = Array.isArray(probe.streams) ? probe.streams as Array<Record<string, unknown>> : [];
          if (!streams.some(stream => stream.codec_type === "audio")) loudnessUnavailableReason = "No audio stream was available for EBU R128 analysis";
          else {
            try {
              const measured = await execFileAsync("ffmpeg", ["-nostdin", "-hide_banner", "-protocol_whitelist", "file,crypto,data", "-i", mediaPath, "-map", "0:a:0", "-vn", "-sn", "-dn", "-af", "ebur128=peak=true", "-f", "null", "-"], { timeout: VIDEO_QC_TIMEOUT_MS, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
              loudness = parseEbur128Summary(measured.stderr);
            } catch (error) {
              const failure = error as { code?: string; killed?: boolean; stderr?: string; message?: string };
              if (failure.stderr) loudness = parseEbur128Summary(failure.stderr);
              loudnessUnavailableReason = failure.code === "ENOENT" ? "ffmpeg was not found on PATH" : failure.killed ? "EBU R128 analysis timed out" : "EBU R128 analysis was unavailable";
            }
          }
        }
        if (changedSinceStart()) return { success: false, error: `Delivery file changed during conformance inspection: ${mediaPath}` };
        const checks = evaluateDeliveryConformance(probe, contract, loudness, loudnessUnavailableReason);
        return {
          success: true,
          data: {
            mediaPath,
            checks,
            conforms: checks.length > 0 && checks.every(check => check.status === "pass"),
            evaluated: checks.filter(check => check.status !== "not_evaluated").length,
            notEvaluated: checks.filter(check => check.status === "not_evaluated").length,
            verificationScope: "Local ffprobe metadata and optional decoded EBU R128 measurements only. This does not prove Premiere render lineage, visual quality, editorial approval, or destination-platform acceptance.",
          },
        };
      },
    },

    analyze_video_qc: {
      description:
        "Analyze a local video delivery for sustained black and frozen sections with FFmpeg. Read-only: it does not contact Premiere or modify the file.",
      parameters: {
        type: "object" as const,
        properties: {
          media_path: { type: "string", description: "Path to an existing local video file" },
          minimum_black_seconds: { type: "number", description: "Minimum black duration to report (default: 0.5)" },
          minimum_freeze_seconds: { type: "number", description: "Minimum frozen duration to report (default: 1)" },
        },
        required: ["media_path"],
      },
      handler: async (args: { media_path: string; minimum_black_seconds?: number; minimum_freeze_seconds?: number }) => {
        const blackSeconds = args.minimum_black_seconds ?? 0.5;
        const freezeSeconds = args.minimum_freeze_seconds ?? 1;
        if (!Number.isFinite(blackSeconds) || blackSeconds <= 0 || blackSeconds > 60) {
          return { success: false, error: "minimum_black_seconds must be a finite value greater than 0 and at most 60" };
        }
        if (!Number.isFinite(freezeSeconds) || freezeSeconds <= 0 || freezeSeconds > 60) {
          return { success: false, error: "minimum_freeze_seconds must be a finite value greater than 0 and at most 60" };
        }
        const mediaPath = resolve(args.media_path);
        if (!existsSync(mediaPath) || !statSync(mediaPath).isFile()) {
          return { success: false, error: `Video file not found on disk: ${mediaPath}` };
        }
        try {
          const result = await execFileAsync("ffmpeg", [
            "-nostdin", "-hide_banner", "-i", mediaPath,
            "-vf", `blackdetect=d=${blackSeconds}:pix_th=0.10,freezedetect=n=-50dB:d=${freezeSeconds}`,
            "-an", "-f", "null", "-",
          ], { timeout: VIDEO_QC_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
          const findings = parseVideoQcOutput(result.stderr);
          return {
            success: true,
            data: {
              mediaPath,
              thresholds: { minimumBlackSeconds: blackSeconds, minimumFreezeSeconds: freezeSeconds },
              ...findings,
              passes: findings.blackFrames.length === 0 && findings.freezes.length === 0,
              verificationScope: "Local decoded-video sampling only. Review intentional fades, slates, stills, and end cards before treating a finding as a defect.",
            },
          };
        } catch (error) {
          const failure = error as { killed?: boolean; code?: string; stderr?: string; message?: string };
          if (failure.code === "ENOENT") return { success: false, error: "ffmpeg was not found on PATH" };
          if (failure.killed) return { success: false, error: "ffmpeg video QC timed out after 300 seconds" };
          return { success: false, error: `ffmpeg video QC failed: ${(failure.stderr ?? failure.message ?? "unknown error").split(/\r?\n/).filter(Boolean).slice(-3).join(" ")}` };
        }
      },
    },

    detect_source_scene_changes: {
      description:
        "Detect probable visual cuts in a local source file using FFmpeg scene scores. Read-only and source-relative; it does not cut a Premiere timeline.",
      parameters: {
        type: "object" as const,
        properties: {
          media_path: { type: "string", description: "Path to an existing local video file" },
          threshold: { type: "number", description: "Scene-score threshold from 0.01 through 1 (default: 0.3)" },
          minimum_interval_seconds: { type: "number", description: "Keep only the strongest event within this interval (default: 0.25)" },
          maximum_events: { type: "number", description: "Maximum returned changes (default: 500; maximum: 2000)" },
        },
        required: ["media_path"],
      },
      handler: async (args: { media_path: string; threshold?: number; minimum_interval_seconds?: number; maximum_events?: number }) => {
        const threshold = args.threshold ?? 0.3;
        const minimumInterval = args.minimum_interval_seconds ?? 0.25;
        const maximumEvents = args.maximum_events ?? 500;
        if (!Number.isFinite(threshold) || threshold < 0.01 || threshold > 1) return { success: false, error: "threshold must be from 0.01 through 1" };
        if (!Number.isFinite(minimumInterval) || minimumInterval < 0 || minimumInterval > 60) return { success: false, error: "minimum_interval_seconds must be from 0 through 60" };
        if (!Number.isInteger(maximumEvents) || maximumEvents < 1 || maximumEvents > 2000) return { success: false, error: "maximum_events must be an integer from 1 through 2000" };
        const mediaPath = resolve(args.media_path);
        if (!existsSync(mediaPath) || !statSync(mediaPath).isFile()) return { success: false, error: `Video file not found on disk: ${mediaPath}` };
        try {
          const result = await execFileAsync("ffmpeg", [
            "-nostdin", "-hide_banner", "-i", mediaPath,
            "-vf", `select='gt(scene,${threshold})',showinfo,metadata=print`,
            "-an", "-f", "null", "-",
          ], { timeout: VIDEO_QC_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
          const all = parseSceneChangeOutput(`${result.stdout}\n${result.stderr}`, minimumInterval);
          const sceneChanges = all.slice(0, maximumEvents);
          return {
            success: true,
            data: {
              mediaPath, threshold, minimumIntervalSeconds: minimumInterval,
              totalDetected: all.length, truncated: all.length > sceneChanges.length, sceneChanges,
              verificationScope: "Local source-file pixel analysis only. Times are source-relative probabilities, not verified editorial cuts or Premiere timeline positions.",
            },
          };
        } catch (error) {
          const failure = error as { code?: string; killed?: boolean; stderr?: string; message?: string };
          if (failure.code === "ENOENT") return { success: false, error: "ffmpeg was not found on PATH" };
          if (failure.killed) return { success: false, error: "ffmpeg scene detection timed out after 300 seconds" };
          return { success: false, error: `ffmpeg scene detection failed: ${(failure.stderr ?? failure.message ?? "unknown error").split(/\r?\n/).filter(Boolean).slice(-3).join(" ")}` };
        }
      },
    },

    export_sequence: {
      description:
        "Export the active sequence directly (Premiere renders it; blocks until done) with an Adobe Media Encoder preset. The output extension must match what the preset writes (an H.264 preset in AME's QuickTime folder writes .mov); a missing extension is added. Refuses an output_path that already exists unless overwrite is true. Fails if Premiere rejects the render, and verifies a non-empty file was written (for an overwrite, that the file changed). range 'work_area' fails closed unless the work area is enabled and covers only part of the sequence — otherwise Premiere would encode the entire timeline.",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Full output file path (e.g., '/Users/me/exports/video.mp4')",
          },
          preset_path: {
            type: "string",
            description: "Path to an AME preset file (.epr). Uses the default H.264 (MP4) Match Source preset if omitted.",
          },
          range: {
            type: "string",
            enum: ["entire", "in_to_out", "work_area"],
            description:
              "What to render: the entire sequence (default), the sequence in/out range (set_sequence_in_out_points), or the work area. work_area requires an enabled work area around part of the sequence; unset or full-sequence work areas are refused instead of encoding everything. Scripts cannot set the work area on current Premiere builds, so prefer in_to_out for a ranged export.",
          },
          work_area_only: {
            type: "boolean",
            description: "Deprecated alias for range: 'work_area'",
          },
          overwrite: {
            type: "boolean",
            description: "Replace a file that already exists at output_path (default: false, which refuses the export). The replacement is only reported as written when the file's size or modification time changes.",
          },
          timeout_minutes: {
            type: "number",
            minimum: 1,
            maximum: 240,
            description: "How long to wait for the render (default: 15; long sequences such as full podcast episodes may need more)",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: { output_path: string; preset_path?: string; range?: "entire" | "in_to_out" | "work_area"; work_area_only?: boolean; overwrite?: boolean; timeout_minutes?: number }) => {
        const range = args.range ?? (args.work_area_only ? "work_area" : "entire");
        if (args.preset_path) {
          try {
            inspectExportPresetFile(args.preset_path);
          } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
          }
        }
        const timeoutMinutes = args.timeout_minutes ?? 15;
        if (!Number.isFinite(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > 240) {
          return { success: false, error: "timeout_minutes must be between 1 and 240" };
        }
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var outputPath = "${escapeForExtendScript(args.output_path)}";
          
          ${args.preset_path
            ? `var presetPath = "${escapeForExtendScript(args.preset_path)}";`
            : `var presetPath = __findH264Preset();
               if (!presetPath) return __error("Could not locate a default H.264 preset. Pass preset_path explicitly.");`
          }

          var presetExtension = "";
          try { presetExtension = String(seq.getExportFileExtension(presetPath) || "").replace(/^\\./, "").toLowerCase(); } catch (eExt) {}
          var slash = Math.max(outputPath.lastIndexOf("/"), outputPath.lastIndexOf(String.fromCharCode(92)));
          var dot = outputPath.lastIndexOf(".");
          var givenExtension = dot > slash ? outputPath.substring(dot + 1).toLowerCase() : "";
          if (presetExtension) {
            if (!givenExtension) {
              outputPath = outputPath + "." + presetExtension;
            } else if (givenExtension !== presetExtension && !(givenExtension === "m4v" && presetExtension === "mp4")) {
              return __error("The preset writes ." + presetExtension + " files but output_path ends in ." + givenExtension + "; nothing was exported. Use ." + presetExtension + " or pick a preset for ." + givenExtension + " (get_encoder_presets lists each preset's extension).");
            }
          }

          var rangeStart = 0;
          var rangeEnd = parseFloat(seq.end) / TICKS_PER_SECOND;
          ${range === "in_to_out" ? `
          var markIn = __sequencePointSeconds(seq.getInPoint());
          var markOut = __sequencePointSeconds(seq.getOutPoint());
          if (markIn === null || markOut === null || markOut <= markIn || (markIn <= 0 && Math.abs(markOut - rangeEnd) < 0.001)) {
            return __error("range 'in_to_out' needs sequence in/out points around part of the sequence (set_sequence_in_out_points); nothing was exported.");
          }
          rangeStart = markIn; rangeEnd = markOut;` : ""}
          ${range === "work_area" ? `
          if (typeof seq.isWorkAreaEnabled === "function" && seq.isWorkAreaEnabled() !== true) {
            return __error("range 'work_area' needs the work area enabled (is_work_area_enabled); nothing was exported.");
          }
          var workIn = __workAreaSeconds(seq.getWorkAreaInPoint());
          var workOut = __workAreaSeconds(seq.getWorkAreaOutPoint());
          if (workIn === null || workOut === null || workOut <= workIn || (workIn <= 0 && Math.abs(workOut - rangeEnd) < 0.001)) {
            return __error("range 'work_area' needs a work area around part of the sequence; nothing was exported. Scripts cannot set the work area on current Premiere builds — use range 'in_to_out' after set_sequence_in_out_points.");
          }
          rangeStart = workIn; rangeEnd = workOut;` : ""}

          // A file already at output_path must not pass the written-file check below.
          var existing = new File(outputPath);
          var existedBefore = existing.exists;
          ${args.overwrite ? "" : `if (existedBefore) return __error("A file already exists at " + outputPath + "; nothing was exported. Choose a new output_path or pass overwrite: true.");`}
          var sizeBefore = existedBefore ? existing.length : -1;
          var modifiedBefore = existedBefore && existing.modified ? existing.modified.getTime() : null;

          var exportResult = seq.exportAsMediaDirect(
            outputPath,
            presetPath,
            ${range === "in_to_out" ? "app.encoder.ENCODE_IN_TO_OUT" : range === "work_area" ? "app.encoder.ENCODE_WORKAREA" : "app.encoder.ENCODE_ENTIRE"}
          );
          // Premiere documents a boolean; false means the render was rejected.
          // Some hosts throw instead; buildToolScript already maps that to __error.
          if (exportResult === false) return __error("Premiere rejected the sequence export; nothing was written to " + outputPath + ".");
          var written = new File(outputPath);
          if (!written.exists || written.length <= 0) {
            return __error("Premiere did not write " + outputPath + (exportResult ? " (" + exportResult + ")" : "") + ".");
          }
          if (existedBefore) {
            var modifiedAfter = written.modified ? written.modified.getTime() : null;
            if (modifiedAfter === modifiedBefore && written.length === sizeBefore) {
              return __error("The file already at " + outputPath + " was not replaced (same size and modification time as before the export).");
            }
          }

          return __result({
            exported: true, verified: true, outputPath: outputPath, sizeBytes: written.length,
            replacedExistingFile: existedBefore,
            extension: presetExtension || givenExtension, presetUsed: presetPath,
            range: "${range}",
            rangeStartSeconds: Math.round(rangeStart * 1000) / 1000,
            expectedDurationSeconds: Math.round((rangeEnd - rangeStart) * 1000) / 1000
          });
        `);
        return sendCommand(script, { ...bridgeOptions, timeoutMs: timeoutMinutes * 60000 });
      },
    },

    export_frame: {
      description: "Export the current frame as an image file",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Full output file path (e.g., '/Users/me/frame.png'). Extension determines format.",
          },
          time_seconds: {
            type: "number",
            description: "Time position in seconds to export. Uses current playhead if omitted.",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: { output_path: string; time_seconds?: number }) => {
        const script = buildToolScript(`
          var outputPath = "${escapeForExtendScript(args.output_path)}";
          var ticks = ${args.time_seconds !== undefined
            ? `__secondsToTicks(${args.time_seconds}).toString()`
            : "null"};

          var res = __exportStillFrame(outputPath, ticks);
          if (!res.ok) return __error(res.error + " [" + res.notes.join("; ") + "]");

          return __result({ exported: true, outputPath: res.path, method: res.method });
        `);
        return sendCommand(script, { ...bridgeOptions, timeoutMs: 60000 });
      },
    },

    export_sequence_review_frames: {
      description:
        "Export 2-24 evenly spaced, file-verified frames from an active-sequence range in one bridge round trip for visual review. This samples rendered output; it does not prove playback, audio, or editorial quality.",
      parameters: {
        type: "object" as const,
        properties: {
          output_dir: {
            type: "string",
            description: "Existing directory where review_001.png through review_NNN.png will be written",
          },
          frame_count: {
            type: "number",
            description: "Number of evenly spaced frames to export (default: 6; minimum: 2; maximum: 24)",
          },
          start_seconds: {
            type: "number",
            description: "Optional non-negative range start in seconds (default: sequence start)",
          },
          end_seconds: {
            type: "number",
            description: "Optional positive range end in seconds (default: sequence end)",
          },
        },
        required: ["output_dir"],
      },
      handler: async (args: {
        output_dir: string;
        frame_count?: number;
        start_seconds?: number;
        end_seconds?: number;
      }) => {
        const frameCount = args.frame_count ?? 6;
        if (!Number.isInteger(frameCount) || frameCount < 2 || frameCount > 24) {
          return { success: false, error: "frame_count must be an integer from 2 through 24" };
        }
        if (typeof args.output_dir !== "string" || args.output_dir.trim() === "") {
          return { success: false, error: "output_dir must be a non-empty directory path" };
        }
        for (const [name, value] of [["start_seconds", args.start_seconds], ["end_seconds", args.end_seconds]] as const) {
          if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
            return { success: false, error: `${name} must be a finite non-negative number` };
          }
        }
        if (args.start_seconds !== undefined && args.end_seconds !== undefined && args.end_seconds <= args.start_seconds) {
          return { success: false, error: "end_seconds must be greater than start_seconds" };
        }

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var outputFolder = new Folder("${escapeForExtendScript(resolve(args.output_dir))}");
          if (!outputFolder.exists) return __error("Output directory does not exist: " + outputFolder.fsName);

          var sequenceEndSeconds = __ticksToSeconds(seq.end);
          var rangeStart = ${args.start_seconds ?? 0};
          var rangeEnd = ${args.end_seconds !== undefined ? args.end_seconds : "sequenceEndSeconds"};
          if (rangeEnd > sequenceEndSeconds) rangeEnd = sequenceEndSeconds;
          if (rangeStart < 0 || rangeEnd <= rangeStart) {
            return __error("The requested review range is empty or outside the active sequence");
          }

          var requested = ${frameCount};
          var span = rangeEnd - rangeStart;
          var frames = [];
          var failures = [];
          for (var i = 0; i < requested; i++) {
            var atSeconds = rangeStart + (span * i / (requested - 1));
            if (atSeconds >= rangeEnd) atSeconds = Math.max(rangeStart, rangeEnd - 0.001);
            var number = String(i + 1);
            while (number.length < 3) number = "0" + number;
            var requestedPath = outputFolder.fsName + "/review_" + number + ".png";
            var result = __exportStillFrame(requestedPath, __secondsToTicks(atSeconds).toString());
            if (result.ok) {
              frames.push({ index: i, timeSeconds: atSeconds, outputPath: result.path, method: result.method });
            } else {
              failures.push({ index: i, timeSeconds: atSeconds, requestedPath: requestedPath, error: result.error, notes: result.notes });
            }
          }

          if (!frames.length) return __error("Premiere did not write any review frames");
          return __result({
            sequence: { name: seq.name, durationSeconds: sequenceEndSeconds },
            range: { startSeconds: rangeStart, endSeconds: rangeEnd },
            requested: requested,
            exported: frames.length,
            complete: frames.length === requested,
            frames: frames,
            failures: failures,
            verificationScope: "Each returned frame path was verified on disk by the Premiere bridge. Playback, audio, and editorial quality remain unverified."
          });
        `);
        return sendCommand(script, { ...bridgeOptions, timeoutMs: Math.max(60000, frameCount * 30000) });
      },
    },

    export_sequence_marker_review_frames: {
      description:
        "Export up to 24 file-verified composite frames at active-sequence marker positions in one bridge request for marker-driven review. It reads markers and writes image files only; it does not add, update, or remove Premiere markers.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          output_dir: {
            type: "string",
            description: "Existing directory where marker_review_001.png through marker_review_NNN.png will be written",
          },
          marker_type: {
            type: "string",
            description: "Optional exact Premiere marker type to include (for example Comment or Chapter).",
          },
          start_seconds: {
            type: "number",
            description: "Optional non-negative lower bound for marker positions in seconds.",
          },
          end_seconds: {
            type: "number",
            description: "Optional positive exclusive upper bound for marker positions in seconds.",
          },
          limit: {
            type: "number",
            description: "Maximum chronological marker frames to export (default: 12; minimum: 1; maximum: 24).",
          },
        },
        required: ["output_dir"],
      },
      handler: async (args: {
        output_dir: string;
        marker_type?: string;
        start_seconds?: number;
        end_seconds?: number;
        limit?: number;
      }) => {
        const limit = args.limit ?? 12;
        if (!Number.isInteger(limit) || limit < 1 || limit > 24) {
          return { success: false, error: "limit must be an integer from 1 through 24" };
        }
        if (typeof args.output_dir !== "string" || args.output_dir.trim() === "") {
          return { success: false, error: "output_dir must be a non-empty directory path" };
        }
        const markerType = args.marker_type?.trim();
        if (args.marker_type !== undefined && !markerType) {
          return { success: false, error: "marker_type must be a non-empty string when provided" };
        }
        if (markerType && markerType.length > 64) {
          return { success: false, error: "marker_type must be at most 64 characters" };
        }
        for (const [name, value] of [["start_seconds", args.start_seconds], ["end_seconds", args.end_seconds]] as const) {
          if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
            return { success: false, error: `${name} must be a finite non-negative number` };
          }
        }
        if (args.start_seconds !== undefined && args.end_seconds !== undefined && args.end_seconds <= args.start_seconds) {
          return { success: false, error: "end_seconds must be greater than start_seconds" };
        }

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var outputFolder = new Folder("${escapeForExtendScript(resolve(args.output_dir))}");
          if (!outputFolder.exists) return __error("Output directory does not exist: " + outputFolder.fsName);

          var sequenceEndSeconds = __ticksToSeconds(seq.end);
          var rangeStart = ${args.start_seconds ?? 0};
          var rangeEnd = ${args.end_seconds !== undefined ? args.end_seconds : "sequenceEndSeconds"};
          if (rangeEnd > sequenceEndSeconds) rangeEnd = sequenceEndSeconds;
          if (rangeStart < 0 || rangeEnd <= rangeStart) {
            return __error("The requested marker range is empty or outside the active sequence");
          }

          var requiredType = ${markerType ? `"${escapeForExtendScript(markerType)}"` : "null"};
          var matched = [];
          var marker = seq.markers.getFirstMarker();
          while (marker) {
            var atSeconds = Number(marker.start.seconds);
            if (isFinite(atSeconds) && atSeconds >= rangeStart && atSeconds < rangeEnd && (!requiredType || String(marker.type) === requiredType)) {
              matched.push({
                timeSeconds: atSeconds,
                name: String(marker.name || ""),
                comments: String(marker.comments || ""),
                type: String(marker.type || "")
              });
            }
            marker = seq.markers.getNextMarker(marker);
          }
          matched.sort(function(a, b) { return a.timeSeconds - b.timeSeconds; });
          if (!matched.length) return __error("No matching sequence markers were found in the requested range");

          var requested = Math.min(matched.length, ${limit});
          var frames = [];
          var failures = [];
          for (var i = 0; i < requested; i++) {
            var entry = matched[i];
            var number = String(i + 1);
            while (number.length < 3) number = "0" + number;
            var requestedPath = outputFolder.fsName + "/marker_review_" + number + ".png";
            var result = __exportStillFrame(requestedPath, __secondsToTicks(entry.timeSeconds).toString());
            if (result.ok) {
              frames.push({ index: i, marker: entry, outputPath: result.path, method: result.method });
            } else {
              failures.push({ index: i, marker: entry, requestedPath: requestedPath, error: result.error, notes: result.notes });
            }
          }

          if (!frames.length) return __error("Premiere did not write any marker review frames");
          return __result({
            sequence: { name: seq.name, durationSeconds: sequenceEndSeconds },
            range: { startSeconds: rangeStart, endSeconds: rangeEnd },
            markerType: requiredType,
            matched: matched.length,
            requested: requested,
            exported: frames.length,
            complete: frames.length === requested,
            truncated: matched.length > requested,
            frames: frames,
            failures: failures,
            verificationScope: "Each returned frame path was verified on disk by the Premiere bridge at the matched marker start. This reads existing markers and does not prove playback, audio, marker intent, or editorial quality."
          });
        `);
        return sendCommand(script, { ...bridgeOptions, timeoutMs: Math.max(60000, limit * 30000) });
      },
    },

    export_sequence_clip_review_frames: {
      description:
        "Export one file-verified composite frame at the midpoint of each clip on a chosen video track in one bridge request. Read-only in Premiere; it does not mute tracks or claim visual quality.",
      parameters: {
        type: "object" as const,
        properties: {
          output_dir: { type: "string", description: "Existing directory for clip_001.png and subsequent review frames" },
          track_index: { type: "number", description: "Zero-based video track index (default: 0)" },
          limit: { type: "number", description: "Maximum clips to sample (default: 20; maximum: 50)" },
        },
        required: ["output_dir"],
      },
      handler: async (args: { output_dir: string; track_index?: number; limit?: number }) => {
        const trackIndex = args.track_index ?? 0;
        const limit = args.limit ?? 20;
        if (!Number.isInteger(trackIndex) || trackIndex < 0) {
          return { success: false, error: "track_index must be a non-negative integer" };
        }
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
          return { success: false, error: "limit must be an integer from 1 through 50" };
        }
        if (typeof args.output_dir !== "string" || !args.output_dir.trim()) {
          return { success: false, error: "output_dir must be a non-empty directory path" };
        }
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          if (${trackIndex} >= seq.videoTracks.numTracks) return __error("Video track index is out of range");
          var outputFolder = new Folder("${escapeForExtendScript(resolve(args.output_dir))}");
          if (!outputFolder.exists) return __error("Output directory does not exist: " + outputFolder.fsName);
          var track = seq.videoTracks[${trackIndex}];
          var frames = [];
          var failures = [];
          var count = Math.min(track.clips.numItems, ${limit});
          for (var i = 0; i < count; i++) {
            var clip = track.clips[i];
            var atSeconds = clip.start.seconds + ((clip.end.seconds - clip.start.seconds) / 2);
            var number = String(i + 1);
            while (number.length < 3) number = "0" + number;
            var requestedPath = outputFolder.fsName + "/clip_" + number + ".png";
            var result = __exportStillFrame(requestedPath, __secondsToTicks(atSeconds).toString());
            if (result.ok) frames.push({ index: i, clipName: clip.name, nodeId: clip.nodeId, timeSeconds: atSeconds, outputPath: result.path, method: result.method });
            else failures.push({ index: i, clipName: clip.name, timeSeconds: atSeconds, error: result.error, notes: result.notes });
          }
          if (!count) return __error("The selected video track contains no clips");
          if (!frames.length) return __error("Premiere did not write any clip review frames");
          return __result({
            trackIndex: ${trackIndex}, requested: count, exported: frames.length,
            complete: frames.length === count, frames: frames, failures: failures,
            verificationScope: "Each returned path exists on disk. Frames show the finished composite at each selected clip midpoint; composition and editorial quality require human or vision review."
          });
        `);
        return sendCommand(script, { ...bridgeOptions, timeoutMs: Math.max(60000, limit * 30000) });
      },
    },

    export_as_fcp_xml: {
      description: "Export the active sequence as a Final Cut Pro XML file. Fails when Premiere writes no file or leaves a pre-existing output unchanged.",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Full output file path (e.g., '/Users/me/export.xml')",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: { output_path: string }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var outputFile = new File("${escapeForExtendScript(args.output_path)}");
          if (!outputFile.parent || !outputFile.parent.exists) {
            return __error("The FCP XML export directory does not exist: " + outputFile.parent);
          }
          var existedBefore = !!outputFile.exists;
          var lengthBefore = existedBefore ? Number(outputFile.length) : -1;
          var modifiedBefore = "";
          try { if (existedBefore) modifiedBefore = String(outputFile.modified); } catch (eSnap) {}
          
          seq.exportAsFinalCutProXML(outputFile.fsName);
          if (!outputFile.exists || !(outputFile.length > 0)) return __error("Premiere did not write the requested FCP XML file.");
          var modifiedAfter = "";
          try { modifiedAfter = String(outputFile.modified); } catch (eAfter) {}
          if (existedBefore && Number(outputFile.length) === lengthBefore && modifiedAfter === modifiedBefore) {
            return __error("Premiere did not write a new FCP XML file (the existing output was unchanged).");
          }
          return __result({ exported: true, verified: true, outputPath: outputFile.fsName, format: "FCP XML" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    export_aaf: {
      description: "Unavailable on the CEP backend. Use export_aaf_uxp with an authenticated Premiere 26.3+ UXP bridge.",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Full output file path (e.g., '/Users/me/export.aaf')",
          },
          mix_down_video: {
            type: "boolean",
            description: "Mix down video to single track (default: true)",
          },
          explode_to_mono: {
            type: "boolean",
            description: "Explode multichannel audio to mono (default: false)",
          },
          sample_rate: {
            type: "number",
            description: "Audio sample rate (default: 48000)",
          },
          bits_per_sample: {
            type: "number",
            description: "Audio bit depth (default: 16)",
          },
        },
        required: ["output_path"],
      },
      handler: async (_args: {
        output_path: string;
        mix_down_video?: boolean;
        explode_to_mono?: boolean;
        sample_rate?: number;
        bits_per_sample?: number;
      }) => {
        return {
          success: false,
          error: "export_aaf is unavailable on the CEP backend because this Premiere host does not expose Sequence.exportAsAAF. Use export_aaf_uxp with an authenticated Premiere 26.3+ UXP bridge. No export was attempted.",
        };
      },
    },

    add_to_render_queue: {
      description:
        "Request an Adobe Media Encoder render-queue handoff for the active sequence. Requires a saved project and an .epr preset_path. Same as Project presets are refused before Premiere is contacted because AME encodes from a scratch project copy. Optional start_batch requests processing of every ready AME queue job, including unrelated jobs.",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Full output file path",
          },
          preset_path: {
            type: "string",
            description: "Required path to an AME preset file (.epr). Omitting this raises an Illegal Parameter error on current Premiere hosts.",
          },
          start_batch: {
            type: "boolean",
            description: "Opt in to start the entire ready Adobe Media Encoder queue after this handoff, including unrelated jobs. Default false (enqueue only). A successful call does not verify that any render started or completed.",
          },
        },
        required: ["output_path", "preset_path"],
      },
      handler: async (args: { output_path: string; preset_path?: string; start_batch?: boolean }) => {
        if (typeof args.preset_path !== "string" || !args.preset_path.trim()) {
          return {
            success: false,
            error: "preset_path is required. Pass a .epr file; omitting it falls through to an Illegal Parameter error on this host.",
          };
        }
        const outputPath = resolve(args.output_path);
        const presetPath = resolve(args.preset_path);
        try {
          inspectExportPresetFile(presetPath);
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var encoder = app.encoder;
          if (!encoder) return __error("Adobe Media Encoder not available");
          var savedProjectPath = "";
          try { savedProjectPath = String(app.project.path || ""); } catch (projectPathError) { savedProjectPath = ""; }
          if (!savedProjectPath || savedProjectPath === "undefined") {
            return __error("Save the Premiere project to a real .prproj path before AME handoff. Unsaved or scratch projects make Adobe Media Encoder resolve a Same as Project output token against a disposable folder.");
          }
          
          var outputFile = new File("${escapeForExtendScript(outputPath)}");
          if (!outputFile.parent || !outputFile.parent.exists) {
            return __error("The requested AME output directory does not exist: " + (outputFile.parent ? outputFile.parent.fsName : outputFile.fsName));
          }
          var outputPath = outputFile.fsName;
          var presetFile = new File("${escapeForExtendScript(presetPath)}");
          if (!presetFile.exists) return __error("AME preset file does not exist: " + presetFile.fsName);
          var presetPath = presetFile.fsName;
          encoder.launchEncoder();
          
          var jobId = encoder.encodeSequence(
            seq,
            outputPath,
            presetPath,
            0, // workAreaType (Number)
            true // removeUponCompletion (Boolean; Premiere type-checks this natively)
          );
          if (!jobId || String(jobId) === "0") return __error("Adobe Media Encoder did not queue the sequence export.");
          
          var batchStartOutcome = "not_requested";
          if (${args.start_batch === true ? "true" : "false"}) {
            try {
              var startBatchAccepted = app.encoder.startBatch();
              batchStartOutcome = (startBatchAccepted === true || startBatchAccepted === 1) ? "requested" : "rejected";
            } catch (startBatchError) {
              batchStartOutcome = "unavailable: " + (startBatchError && startBatchError.message ? startBatchError.message : startBatchError);
            }
          }
          
          return __result({
            accepted: true,
            verified: false,
            outcome: "committed_unverified",
            jobId: String(jobId),
            outputPath: outputPath,
            savedProjectPath: savedProjectPath,
            queueBatchStart: batchStartOutcome,
            verificationScope: batchStartOutcome === "requested"
              ? "Premiere returned an AME job ID and accepted a request to start all ready AME jobs. Batch startup and output-file creation are not verified by this tool."
              : "Premiere returned an AME job ID. Batch startup and output-file creation are not verified by this tool."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_render_queue_status: {
      description:
        "Report the Adobe Media Encoder queue running state, or fail closed with a named capability error when this Premiere build exposes no queue-status method on app.encoder.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var encoder = app.encoder;
          if (!encoder) return __error("Adobe Media Encoder not available");

          if (typeof encoder.isRunning !== "function") {
            return __error("This Premiere build does not expose app.encoder.isRunning, and app.encoder exposes no other documented queue-status method, so the Adobe Media Encoder queue state cannot be read. Check the Adobe Media Encoder application directly. Exporting through export_sequence or encode_project_item is a separate code path and is unaffected.");
          }

          var isRunning;
          try {
            isRunning = encoder.isRunning();
          } catch (encoderStatusError) {
            return __error("app.encoder.isRunning exists but Premiere could not read the queue state: " + encoderStatusError.toString());
          }
          if (typeof isRunning !== "boolean") {
            return __error("app.encoder.isRunning did not return a boolean queue state, so the Adobe Media Encoder queue status cannot be trusted.");
          }

          return __result({
            isRunning: isRunning,
            source: "app.encoder.isRunning",
            info: "Check Adobe Media Encoder application for detailed per-job queue status."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    create_subclip: {
      description: "Create a subclip from a project item with in/out points",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the source project item",
          },
          name: {
            type: "string",
            description: "Name for the subclip",
          },
          in_seconds: {
            type: "number",
            description: "In-point in seconds",
          },
          out_seconds: {
            type: "number",
            description: "Out-point in seconds",
          },
        },
        required: ["item_id", "name", "in_seconds", "out_seconds"],
      },
      handler: async (args: { item_id: string; name: string; in_seconds: number; out_seconds: number }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");
          
          var inTicks = __secondsToTicks(${args.in_seconds}).toString();
          var outTicks = __secondsToTicks(${args.out_seconds}).toString();
          
          var subclip = item.createSubClip(
            "${escapeForExtendScript(args.name)}",
            inTicks,
            outTicks,
            0, // hasHardBoundaries
            1, // takeVideo
            1  // takeAudio
          );
          
          if (!subclip) return __error("Failed to create subclip");
          return __result({ created: true, name: "${escapeForExtendScript(args.name)}", source: item.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    capture_frame: {
      description: "Capture the current frame and return it as inline image data for the LLM to see. This lets the AI visually inspect the current state of the timeline.",
      parameters: {
        type: "object" as const,
        properties: {
          time_seconds: {
            type: "number",
            description: "Time position in seconds to capture. Uses current playhead if omitted.",
          },
        },
      },
      handler: async (args: { time_seconds?: number }) => {
        const tempPath = join(tmpdir(), `mcp_frame_capture_${Date.now()}.png`);
        const escapedPath = escapeForExtendScript(tempPath);

        const script = buildToolScript(`
          var outputPath = "${escapedPath}";
          var ticks = ${args.time_seconds !== undefined
            ? `__secondsToTicks(${args.time_seconds}).toString()`
            : "null"};

          var res = __exportStillFrame(outputPath, ticks);
          if (!res.ok) return __error(res.error + " [" + res.notes.join("; ") + "]");

          return __result({ exported: true, outputPath: res.path, method: res.method });
        `);

        const result = await sendCommand(script, { ...bridgeOptions, timeoutMs: 60000 });
        if (!result.success) return result;

        // __exportStillFrame already proved the file exists, but it may have landed at a
        // path other than the one we asked for (Media Encoder appends a frame number to
        // still exports), so read back the path it reports rather than the one we chose.
        const framePath = (result.data as { outputPath?: string } | undefined)?.outputPath ?? tempPath;

        if (!existsSync(framePath)) {
          return { success: false, error: "Frame export reported success but no file exists at: " + framePath };
        }

        try {
          const frameSize = statSync(framePath).size;
          if (frameSize > MAX_CAPTURE_FRAME_BYTES) {
            return {
              success: false,
              error: `Captured frame exceeds the ${MAX_CAPTURE_FRAME_BYTES}-byte inline response limit`,
            };
          }
          const base64 = readFileSync(framePath).toString("base64");
          return {
            success: true,
            data: {
              captured: true,
              mimeType: "image/png",
              base64: base64,
            },
          };
        } catch (e) {
          return { success: false, error: `Failed to read captured frame: ${e instanceof Error ? e.message : String(e)}` };
        } finally {
          try { unlinkSync(framePath); } catch {}
        }
      },
    },

    export_omf: {
      description: "Export the active sequence as an OMF file (Open Media Framework, for audio post-production)",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Full output file path (e.g., '/Users/me/export.omf')",
          },
          sample_rate: {
            type: "number",
            description: "Audio sample rate (default: 48000)",
          },
          bits_per_sample: {
            type: "number",
            description: "Audio bit depth (default: 16)",
          },
          audio_encapsulated: {
            type: "boolean",
            description: "Embed audio in OMF (true) or reference external files (false). Default: true",
          },
          audio_file_format: {
            type: "number",
            description: "Audio format: 0=AIFF, 1=WAV. Default: 1",
          },
          trim_audio_files: {
            type: "boolean",
            description: "Trim audio to used range plus handles (default: true)",
          },
          handle_frames: {
            type: "number",
            description: "Handle length in frames when trimming (default: 1000)",
          },
          include_pan: {
            type: "boolean",
            description: "Include pan information in the OMF (default: false)",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: {
        output_path: string;
        sample_rate?: number;
        bits_per_sample?: number;
        audio_encapsulated?: boolean;
        audio_file_format?: number;
        trim_audio_files?: boolean;
        handle_frames?: number;
        include_pan?: boolean;
      }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var outputFile = new File("${escapeForExtendScript(args.output_path)}");
          if (!outputFile.parent || !outputFile.parent.exists) {
            return __error("The OMF output directory does not exist: " + outputFile.parent);
          }
          if (outputFile.exists) {
            return __error("Refusing to treat a pre-existing OMF as a new export. Choose a new output_path or remove the existing file first.");
          }
          
          app.project.exportOMF(
            seq,
            outputFile.fsName,
            "OMFTitle",
            ${args.sample_rate ?? 48000},
            ${args.bits_per_sample ?? 16},
            ${args.audio_encapsulated !== false ? 1 : 0},
            ${args.audio_file_format ?? 1},
            ${args.trim_audio_files !== false ? 1 : 0},
            ${args.handle_frames ?? 1000},
            ${args.include_pan === true ? 1 : 0}
          );
          if (!outputFile.exists) return __error("Premiere did not write the requested OMF file.");
          
          return __result({ exported: true, outputPath: outputFile.fsName, format: "OMF", verified: true });
        `);
        return sendCommand(script, { ...bridgeOptions, timeoutMs: 120000 });
      },
    },

    encode_project_item: {
      description:
        "Request an Adobe Media Encoder encode for a project item. The returned job ID is an unverified handoff; verify queue presence or the output file independently.",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item to encode",
          },
          output_path: {
            type: "string",
            description: "Full output file path",
          },
          preset_path: {
            type: "string",
            description: "Path to an AME preset file (.epr)",
          },
          remove_on_completion: {
            type: "boolean",
            description: "Remove from queue on completion (default: true)",
          },
        },
        required: ["item_id", "output_path", "preset_path"],
      },
      handler: async (args: {
        item_id: string;
        output_path: string;
        preset_path: string;
        remove_on_completion?: boolean;
      }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Project item not found: ${escapeForExtendScript(args.item_id)}");
          var savedProjectPath = "";
          try { savedProjectPath = String(app.project.path || ""); } catch (projectPathError) { savedProjectPath = ""; }
          if (!savedProjectPath || savedProjectPath === "undefined") {
            return __error("Save the Premiere project to a real .prproj path before AME handoff. Unsaved or scratch projects make Adobe Media Encoder resolve a Same as Project output token against a disposable folder.");
          }
          var outputFile = new File("${escapeForExtendScript(args.output_path)}");
          if (!outputFile.parent || !outputFile.parent.exists) {
            return __error("The requested AME output directory does not exist: " + outputFile.parent);
          }
          
          app.encoder.launchEncoder();
          var jobId = app.encoder.encodeProjectItem(
            item,
            outputFile.fsName,
            "${escapeForExtendScript(args.preset_path)}",
            app.encoder.ENCODE_IN_TO_OUT,
            ${args.remove_on_completion !== false ? "true" : "false"}
          );
          if (!jobId || String(jobId) === "0") return __error("Adobe Media Encoder did not queue the project-item export.");
          app.encoder.startBatch();
          
          return __result({
            accepted: true,
            verified: false,
            outcome: "committed_unverified",
            jobId: String(jobId),
            item: item.name,
            outputPath: outputFile.fsName,
            verificationScope: "Premiere returned an AME job ID. Queue presence and output-file creation are not verified by this tool."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    encode_file: {
      description:
        "Request an Adobe Media Encoder encode for an external file. The returned job ID is an unverified handoff; verify queue presence or the output file independently.",
      parameters: {
        type: "object" as const,
        properties: {
          input_path: {
            type: "string",
            description: "Full path to the input file",
          },
          output_path: {
            type: "string",
            description: "Full output file path",
          },
          preset_path: {
            type: "string",
            description: "Path to an AME preset file (.epr)",
          },
          in_seconds: {
            type: "number",
            description: "Optional start time in seconds",
          },
          out_seconds: {
            type: "number",
            description: "Optional end time in seconds",
          },
          remove_on_completion: {
            type: "boolean",
            description: "Remove from queue on completion (default: true)",
          },
        },
        required: ["input_path", "output_path", "preset_path"],
      },
      handler: async (args: {
        input_path: string;
        output_path: string;
        preset_path: string;
        in_seconds?: number;
        out_seconds?: number;
        remove_on_completion?: boolean;
      }) => {
        const hasRange = args.in_seconds !== undefined || args.out_seconds !== undefined;
        if (hasRange && (args.in_seconds === undefined || args.out_seconds === undefined)) {
          return { success: false, error: "Pass both in_seconds and out_seconds, or omit both to encode the entire file." };
        }
        if (hasRange && (!Number.isFinite(args.in_seconds) || !Number.isFinite(args.out_seconds)
          || args.in_seconds! < 0 || args.out_seconds! <= args.in_seconds!)) {
          return { success: false, error: "in_seconds and out_seconds must define a finite, non-empty range." };
        }
        const inSeconds = args.in_seconds ?? 0;
        const outSeconds = args.out_seconds ?? 0;

        const script = buildToolScript(`
          var inputFile = new File("${escapeForExtendScript(args.input_path)}");
          if (!inputFile.exists) return __error("Input file does not exist: " + inputFile.fsName);
          var savedProjectPath = "";
          try { savedProjectPath = String(app.project.path || ""); } catch (projectPathError) { savedProjectPath = ""; }
          if (!savedProjectPath || savedProjectPath === "undefined") {
            return __error("Save the Premiere project to a real .prproj path before AME handoff. Unsaved or scratch projects make Adobe Media Encoder resolve a Same as Project output token against a disposable folder.");
          }
          var outputFile = new File("${escapeForExtendScript(args.output_path)}");
          if (!outputFile.parent || !outputFile.parent.exists) {
            return __error("The requested AME output directory does not exist: " + outputFile.parent);
          }
          app.encoder.launchEncoder();
          
          var srcIn = new Time();
          srcIn.seconds = ${inSeconds};
          var srcOut = new Time();
          srcOut.seconds = ${outSeconds};
          var removeUponCompletion = ${args.remove_on_completion !== false ? "true" : "false"};
          var presetFile = new File("${escapeForExtendScript(args.preset_path)}");
          if (!presetFile.exists) return __error("AME preset file does not exist: " + presetFile.fsName);

          // Documented signature (live 25.2): encodeFile(input, output, preset,
          // removeUponCompletion, [startTime, stopTime]) with Time objects. The
          // previous extra workArea argument made Premiere throw "Illegal Parameter type".
          var jobId = ${hasRange
            ? "app.encoder.encodeFile(String(inputFile.fsName), String(outputFile.fsName), String(presetFile.fsName), removeUponCompletion, srcIn, srcOut)"
            : "app.encoder.encodeFile(String(inputFile.fsName), String(outputFile.fsName), String(presetFile.fsName), removeUponCompletion)"};
          if (!jobId || String(jobId) === "0") return __error("Adobe Media Encoder did not queue the file export.");
          app.encoder.startBatch();
          
          return __result({
            accepted: true,
            verified: false,
            outcome: "committed_unverified",
            jobId: String(jobId),
            inputPath: inputFile.fsName,
            outputPath: outputFile.fsName,
            range: ${hasRange ? `{ inSeconds: ${inSeconds}, outSeconds: ${outSeconds} }` : `"entire"`},
            verificationScope: "Premiere returned an AME job ID. Queue presence and output-file creation are not verified by this tool."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    manage_proxies: {
      description:
        "Create, attach, or toggle proxies for a project item. " +
        "Note: 'create' only requests a proxy encode from Adobe Media Encoder and returns an unverified handoff. " +
        "Independently verify the AME queue or output file before calling this tool again with action 'attach' " +
        "and proxy_path set to the output_path you passed here. There is no single-call create-and-attach " +
        "in Premiere's ExtendScript API.",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          action: {
            type: "string",
            enum: ["create", "attach", "toggle"],
            description: "Action to perform on proxies",
          },
          proxy_path: {
            type: "string",
            description: "Path to an existing proxy file (required for 'attach')",
          },
          output_path: {
            type: "string",
            description: "Full output path for the proxy to be rendered to (required for 'create')",
          },
          preset_path: {
            type: "string",
            description:
              "Path to a proxy ingest preset (.epr) for 'create'. " +
              "If omitted, the server lists Premiere's IngestPresets/Proxy presets and AME H.264 system presets, " +
              "skips every preset whose output destination is Same as Project (Adobe's shipped proxy presets are), " +
              "and uses the first remaining one. Fails with a clear error when none qualify.",
          },
        },
        required: ["item_id", "action"],
      },
      handler: async (args: {
        item_id: string;
        action: string;
        proxy_path?: string;
        output_path?: string;
        preset_path?: string;
      }) => {
        let presetPath = args.preset_path;
        const skippedPresets: string[] = [];
        if (args.action === "create" && args.output_path && !presetPath) {
          const listing = await sendCommand(
            buildToolScript(`return __result({ candidates: __listProxyPresetCandidates() });`),
            bridgeOptions,
          );
          if (!listing.success) return listing;
          const rawCandidates = (listing.data as { candidates?: unknown } | undefined)?.candidates;
          const candidates = Array.isArray(rawCandidates)
            ? rawCandidates.filter((value): value is string => typeof value === "string" && value.length > 0)
            : [];
          for (const candidate of candidates) {
            try {
              presetPath = inspectExportPresetFile(candidate).path;
              break;
            } catch {
              skippedPresets.push(candidate);
            }
          }
          if (!presetPath) {
            return {
              success: false,
              error:
                candidates.length === 0
                  ? "Could not locate any proxy or H.264 export preset. Pass preset_path explicitly (an .epr with an explicit output destination)."
                  : `All ${candidates.length} auto-discovered presets use a Same as Project output destination or could not be read, so AME would not write the proxy to output_path. Pass preset_path explicitly (an .epr with an explicit output destination).`,
              skippedPresetCount: skippedPresets.length,
            };
          }
        }
        const autoDiscovered = presetPath !== args.preset_path;
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");

          var action = "${args.action}";

          if (action === "create") {
            ${!args.output_path
              ? `return __error("output_path is required for the 'create' action");`
              : `var outputPath = "${escapeForExtendScript(args.output_path)}";
                 var presetPath = "${escapeForExtendScript(presetPath ?? "")}";

                 // ProjectItem has no createProxy(). Proxy generation must go through
                 // Adobe Media Encoder; the result is attached in a separate step once
                 // AME has finished writing the file.
                 app.encoder.launchEncoder();
                 var jobId = app.encoder.encodeProjectItem(item, outputPath, presetPath, app.encoder.ENCODE_ENTIRE, true);
                 if (!jobId || String(jobId) === "0") return __error("Adobe Media Encoder did not queue the proxy encode.");
                 app.encoder.startBatch();

                 return __result({
                   action: "create",
                   item: item.name,
                   accepted: true,
                   verified: false,
                   outcome: "committed_unverified",
                   jobId: String(jobId),
                   outputPath: outputPath,
                   presetUsed: presetPath,
                   presetAutoDiscovered: ${autoDiscovered ? "true" : "false"},
                   skippedSameAsProjectPresets: ${skippedPresets.length},
                   verificationScope: "Premiere returned an AME job ID. Queue presence and proxy-file creation are not verified by this tool.",
                   nextStep: "Verify the proxy file exists, then call manage_proxies with action 'attach' and proxy_path set to outputPath."
                 });`
            }
          } else if (action === "attach") {
            ${args.proxy_path
              ? `var attachPath = "${escapeForExtendScript(args.proxy_path)}";
                 if (!new File(attachPath).exists) return __error("Proxy file does not exist: " + attachPath);
                 var attached = item.attachProxy(attachPath, 0);
                 if (!attached) {
                   var mediaPath = "";
                   try { mediaPath = String(item.getMediaPath()); } catch (eMedia) {}
                   return __jsonStringify({ success: false, error: "attachProxy() failed for: " + attachPath, data: { proxyPath: attachPath, mediaPath: mediaPath } });
                 }
                 var proxyReadback = "";
                 try { proxyReadback = String(item.getProxyPath()); } catch (eProxyPath) {}
                 if (!item.hasProxy()) return __error("attachProxy() returned true but the item reports no proxy");
                 return __result({ action: "attach", item: item.name, proxyPath: proxyReadback || attachPath, attached: true, verified: true });`
              : `return __error("proxy_path is required for attach action");`
            }
          } else if (action === "toggle") {
            // Proxy display is an application setting: app.getEnableProxies()/setEnableProxies()
            // (live 25.2; app.project.isProxyEnabled does not exist).
            if (typeof app.getEnableProxies !== "function" || typeof app.setEnableProxies !== "function") {
              return __error("This Premiere build does not expose app.getEnableProxies/setEnableProxies; toggle proxies in the Program Monitor.");
            }
            var wasEnabled = Number(app.getEnableProxies()) === 1;
            app.setEnableProxies(wasEnabled ? 0 : 1);
            var nowEnabled = Number(app.getEnableProxies()) === 1;
            if (nowEnabled === wasEnabled) return __error("Premiere did not change the proxy display setting.");
            return __result({ action: "toggle", proxiesEnabled: nowEnabled, verified: true, scope: "application-wide proxy display" });
          }

          return __error("Unknown proxy action: " + action);
        `);
        const result = await sendCommand(script, bridgeOptions);
        const failure = result as { success: boolean; data?: { proxyPath?: string; mediaPath?: string } };
        if (!result.success && args.action === "attach" && failure.data?.proxyPath && failure.data.mediaPath) {
          // Premiere refuses a proxy whose audio channel layout differs from the
          // original (live 25.2: a stereo 48 kHz proxy for a mono 44.1 kHz clip).
          const [proxy, original] = await Promise.all([audioLayout(failure.data.proxyPath), audioLayout(failure.data.mediaPath)]);
          if (proxy && original && proxy.channels !== original.channels) {
            return {
              ...result,
              error: `${result.error}. The proxy has ${proxy.channels} audio channel(s) but the original has ${original.channels}; Premiere only attaches proxies whose audio channels match. Encode the proxy with a preset that keeps the source's channel layout.`,
              data: { ...failure.data, proxyAudio: proxy, originalAudio: original },
            };
          }
        }
        return result;
      },
    },
  };
}
