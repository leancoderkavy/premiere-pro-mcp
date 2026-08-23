import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Cap on a single ffmpeg analysis pass. Decode-only, so this is generous. */
const FFMPEG_TIMEOUT_MS = 300_000;

export interface SilenceInterval {
  start: number;
  end: number;
  duration: number;
}

export interface LoudnessMeasurement {
  integratedLufs: number | null;
  loudnessRangeLu: number | null;
  truePeakDbfs: number | null;
}

function finiteMetric(value: string | undefined): number | null {
  if (!value || value.toLowerCase().includes("inf")) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parse the final summary emitted by ffmpeg's EBU R128 filter. */
export function parseEbur128Summary(stderr: string): LoudnessMeasurement {
  const summaries = [...stderr.matchAll(/Summary:\s*([\s\S]*?)(?=(?:\r?\n\S)|$)/g)];
  const summary = summaries.at(-1)?.[1] ?? stderr;
  return {
    integratedLufs: finiteMetric(summary.match(/Integrated loudness:[\s\S]*?\bI:\s*(-?(?:inf|\d+(?:\.\d+)?))\s+LUFS/i)?.[1]),
    loudnessRangeLu: finiteMetric(summary.match(/Loudness range:[\s\S]*?\bLRA:\s*(-?(?:inf|\d+(?:\.\d+)?))\s+LU/i)?.[1]),
    truePeakDbfs: finiteMetric(summary.match(/True peak:[\s\S]*?\bPeak:\s*(-?(?:inf|\d+(?:\.\d+)?))\s+dBFS/i)?.[1]),
  };
}

/**
 * Parse ffmpeg's silencedetect output.
 *
 * silencedetect writes to stderr as `silence_start: 12.5` and
 * `silence_end: 18.25 | silence_duration: 5.75`. A run of silence that reaches
 * the end of the file has a start with no matching end, so it is closed at the
 * media duration.
 */
export function parseSilenceDetectOutput(
  stderr: string,
  totalDuration: number | null,
): SilenceInterval[] {
  const intervals: SilenceInterval[] = [];
  let pendingStart: number | null = null;

  for (const line of stderr.split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (start) {
      pendingStart = Math.max(0, Number.parseFloat(start[1]));
      continue;
    }
    const end = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (end && pendingStart !== null) {
      const endSeconds = Number.parseFloat(end[1]);
      intervals.push({
        start: pendingStart,
        end: endSeconds,
        duration: Number((endSeconds - pendingStart).toFixed(3)),
      });
      pendingStart = null;
    }
  }

  // Silence running to EOF never gets a silence_end line.
  if (pendingStart !== null && totalDuration !== null && totalDuration > pendingStart) {
    intervals.push({
      start: pendingStart,
      end: totalDuration,
      duration: Number((totalDuration - pendingStart).toFixed(3)),
    });
  }

  return intervals;
}

/** Pull the media duration out of ffmpeg's `Duration: 00:00:20.00` banner line. */
export function parseDurationSeconds(stderr: string): number | null {
  const match = stderr.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return null;
  return (
    Number.parseInt(match[1], 10) * 3600 +
    Number.parseInt(match[2], 10) * 60 +
    Number.parseFloat(match[3])
  );
}

/**
 * Invert the silence ranges into the segments worth keeping. This is what an
 * actual "strip the dead air" edit needs, and deriving it here avoids every
 * caller reimplementing the same interval arithmetic.
 */
export function invertToSegments(
  silences: SilenceInterval[],
  totalDuration: number | null,
): SilenceInterval[] {
  if (totalDuration === null) return [];
  const segments: SilenceInterval[] = [];
  let cursor = 0;

  for (const silence of silences) {
    if (silence.start > cursor) {
      segments.push({
        start: cursor,
        end: silence.start,
        duration: Number((silence.start - cursor).toFixed(3)),
      });
    }
    cursor = Math.max(cursor, silence.end);
  }

  if (cursor < totalDuration) {
    segments.push({
      start: cursor,
      end: totalDuration,
      duration: Number((totalDuration - cursor).toFixed(3)),
    });
  }

  return segments;
}

export function getAudioTools(bridgeOptions: BridgeOptions) {
  return {
    adjust_audio_levels: {
      description: "Adjust a clip's Volume > Level in dB. Does not read or change Essential Sound Amplify automation.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the audio or video clip",
          },
          level_db: {
            type: "number",
            description: "Audio level in dB (0 = unity, negative = quieter, positive = louder)",
          },
        },
        required: ["node_id", "level_db"],
      },
      handler: async (args: { node_id: string; level_db: number }) => {
        const amplitude = Math.pow(10, args.level_db / 20);
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          // Find the Volume component
          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            if (comp.displayName === "Volume" || comp.matchName === "audioVolume") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                if (comp.properties[p].displayName === "Level") {
                  var levelProp = comp.properties[p];
                  var requestedAmplitude = ${amplitude};
                  var writeResult = levelProp.setValue(requestedAmplitude, true);
                  var appliedAmplitude = Number(levelProp.getValue());
                  if (isNaN(appliedAmplitude) || Math.abs(appliedAmplitude - requestedAmplitude) > 0.0001) {
                    return __error("Premiere did not apply the requested audio level (requested " + requestedAmplitude + ", read back " + appliedAmplitude + "). Effect-property writes are known to no-op on some Premiere Pro 26.3 installations.");
                  }
                  return __result({ adjusted: true, verified: true, clipName: clip.name, levelDb: ${args.level_db}, amplitude: appliedAmplitude, writeResult: writeResult });
                }
              }
            }
          }
          
          return __error("Could not find Volume/Level property on clip");
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_audio_keyframes: {
      description: "Add audio level keyframes to create fades or level changes",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          keyframes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                time_seconds: { type: "number", description: "Time in seconds relative to clip start" },
                level_db: { type: "number", description: "Audio level in dB" },
              },
              required: ["time_seconds", "level_db"],
            },
            description: "Array of keyframe objects with time_seconds and level_db",
          },
        },
        required: ["node_id", "keyframes"],
      },
      handler: async (args: { node_id: string; keyframes: Array<{ time_seconds: number; level_db: number }> }) => {
        // Premiere stores audio Level as amplitude ratio (0-1+), not dB.
        // Convert: amp = 10^(dB/20). Clamp very low values to a small epsilon
        // so AddKey accepts them (a true 0 sometimes silently fails).
        const keyframeCode = args.keyframes
          .map((kf) => {
            const amp = Math.max(Math.pow(10, kf.level_db / 20), 0.0000001);
            return `
            (function() {
              var t = new Time();
              t.ticks = __secondsToTicks(${kf.time_seconds}).toString();
              var wrote = false;
              try { levelProp.addKey(t); } catch(e1) {}
              try { levelProp.setValueAtKey(t, ${amp}, 1); wrote = true; }
              catch(e2) { try { levelProp.setValueAtTime(t, ${amp}, 1); wrote = true; } catch(e3) {} }
              var readBack = NaN;
              try { readBack = Number(levelProp.getValueAtTime(t)); } catch(e4) {}
              if (!wrote || isNaN(readBack) || Math.abs(readBack - ${amp}) > 0.0001) {
                verificationErrors.push("${kf.time_seconds}s requested ${amp}, read back " + readBack);
              }
            })();`;
          })
          .join("\n");

        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var levelProp = null;

          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            if (comp.displayName === "Volume" || comp.matchName === "audioVolume") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                if (comp.properties[p].displayName === "Level") {
                  levelProp = comp.properties[p];
                  break;
                }
              }
            }
          }

          if (!levelProp) return __error("Could not find audio Level property");

          var verificationErrors = [];
          try { levelProp.setTimeVarying(true); } catch(e) {}
          ${keyframeCode}

          if (verificationErrors.length) {
            return __error("Premiere did not apply one or more audio keyframes: " + verificationErrors.join("; ") + ". Effect-property writes are known to no-op on some Premiere Pro 26.3 installations.");
          }
          return __result({ keyframesAdded: ${args.keyframes.length}, verified: true, clipName: clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    mute_track: {
      description: "Mute or unmute an audio track",
      parameters: {
        type: "object" as const,
        properties: {
          track_index: {
            type: "number",
            description: "Audio track index (0-based)",
          },
          muted: {
            type: "boolean",
            description: "True to mute, false to unmute",
          },
        },
        required: ["track_index", "muted"],
      },
      handler: async (args: { track_index: number; muted: boolean }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          if (${args.track_index} >= seq.audioTracks.numTracks) return __error("Track index out of range");

          var track = seq.audioTracks[${args.track_index}];
          track.setMute(${args.muted ? 1 : 0});

          return __result({ trackIndex: ${args.track_index}, muted: ${args.muted}, trackName: track.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    detect_silence: {
      description:
        "Find silent ranges in a media file and return both the silences and the complementary segments worth keeping. Analysis only — nothing in the project or on the timeline is modified. Requires ffmpeg on PATH: Premiere's scripting API exposes no audio-level or waveform data, so silence cannot be measured through the bridge.",
      parameters: {
        type: "object" as const,
        properties: {
          media_path: {
            type: "string",
            description:
              "Absolute path to the media file to analyse. Provide this or project_item_id.",
          },
          project_item_id: {
            type: "string",
            description:
              "Node ID or name of a project item whose media path is resolved through Premiere. Provide this or media_path.",
          },
          noise_threshold_db: {
            type: "number",
            description:
              "Level at or below which audio counts as silence, in dBFS. Closer to 0 is more aggressive (default: -30).",
          },
          min_duration_seconds: {
            type: "number",
            description:
              "Shortest run of silence to report, in seconds (default: 1.5).",
          },
        },
      },
      handler: async (args: {
        media_path?: string;
        project_item_id?: string;
        noise_threshold_db?: number;
        min_duration_seconds?: number;
      }) => {
        const noiseDb = args.noise_threshold_db ?? -30;
        const minDuration = args.min_duration_seconds ?? 1.5;

        if (!args.media_path && !args.project_item_id) {
          return {
            success: false,
            error: "detect_silence requires media_path or project_item_id.",
          };
        }
        // These are interpolated into the ffmpeg filter string, so they must be
        // finite numbers and nothing else.
        if (!Number.isFinite(noiseDb) || noiseDb > 0) {
          return {
            success: false,
            error: `noise_threshold_db must be a finite dBFS value at or below 0 (got ${noiseDb}).`,
          };
        }
        if (!Number.isFinite(minDuration) || minDuration <= 0) {
          return {
            success: false,
            error: `min_duration_seconds must be a finite value greater than 0 (got ${minDuration}).`,
          };
        }

        let mediaPath = args.media_path;
        let itemName: string | undefined;

        if (!mediaPath) {
          const escaped = escapeForExtendScript(args.project_item_id as string);
          const lookup = await sendCommand(
            buildToolScript(`
              var item = __findProjectItem("${escaped}");
              if (!item) return __error("Project item not found: ${escaped}");
              var path = "";
              try { path = item.getMediaPath(); } catch(e) {}
              if (!path) return __error("Project item '${escaped}' has no media path — it may be a sequence, a bin, or a synthetic item such as a title or colour matte.");
              return __result({ mediaPath: path, name: item.name });
            `),
            bridgeOptions,
          );
          if (!lookup.success) return lookup;
          const data = lookup.data as { mediaPath: string; name?: string };
          mediaPath = data.mediaPath;
          itemName = data.name;
        }

        if (!existsSync(mediaPath)) {
          return {
            success: false,
            error: `Media file not found on disk: ${mediaPath}${
              itemName ? ` (resolved from project item '${itemName}')` : ""
            }. It may be offline or relinked.`,
          };
        }

        try {
          await execFileAsync("ffmpeg", ["-version"], { timeout: 10_000 });
        } catch {
          return {
            success: false,
            error:
              "ffmpeg was not found on PATH. detect_silence needs it because Premiere's scripting API exposes no audio-level data. Install ffmpeg (brew install ffmpeg, or winget install ffmpeg) and retry.",
          };
        }

        // Arguments are passed as an array and never through a shell, so a path
        // containing shell metacharacters cannot inject a command.
        const ffmpegArgs = [
          "-nostdin",
          "-hide_banner",
          "-i",
          mediaPath,
          "-af",
          `silencedetect=noise=${noiseDb}dB:d=${minDuration}`,
          "-f",
          "null",
          "-",
        ];

        let stderr: string;
        try {
          // silencedetect reports on stderr, and `-f null -` exits 0 on success.
          const result = await execFileAsync("ffmpeg", ffmpegArgs, {
            timeout: FFMPEG_TIMEOUT_MS,
            maxBuffer: 32 * 1024 * 1024,
          });
          stderr = result.stderr;
        } catch (error) {
          const failure = error as {
            killed?: boolean;
            stderr?: string;
            message?: string;
          };
          if (failure.killed) {
            return {
              success: false,
              error: `ffmpeg timed out after ${FFMPEG_TIMEOUT_MS / 1000}s analysing ${mediaPath}.`,
            };
          }
          const detail = (failure.stderr ?? failure.message ?? "")
            .split(/\r?\n/)
            .filter((line) => line.trim())
            .slice(-3)
            .join(" ");
          return {
            success: false,
            error: `ffmpeg could not analyse ${mediaPath}: ${detail || "unknown error"}`,
          };
        }

        const totalDuration = parseDurationSeconds(stderr);
        const silenceIntervals = parseSilenceDetectOutput(stderr, totalDuration);
        const segments = invertToSegments(silenceIntervals, totalDuration);
        const silentSeconds = silenceIntervals.reduce(
          (sum, interval) => sum + interval.duration,
          0,
        );

        return {
          success: true,
          data: {
            mediaPath,
            projectItemName: itemName,
            noiseThresholdDb: noiseDb,
            minDurationSeconds: minDuration,
            totalDurationSeconds: totalDuration,
            silenceIntervals,
            segments,
            silentSeconds: Number(silentSeconds.toFixed(3)),
            note: "Detection only — no clip was cut or removed. Times are relative to the start of the media file, not the timeline.",
          },
        };
      },
    },

    analyze_loudness: {
      description:
        "Measure integrated loudness (LUFS), loudness range (LU), and true peak (dBFS) from a local media file using FFmpeg's EBU R128 filter. Analysis only: it does not normalize audio or change Premiere.",
      parameters: {
        type: "object" as const,
        properties: {
          media_path: {
            type: "string",
            description: "Absolute path to a local audio or video file. Provide this or project_item_id.",
          },
          project_item_id: {
            type: "string",
            description: "Project item whose local media path should be resolved through Premiere. Provide this or media_path.",
          },
          target_lufs: {
            type: "number",
            description: "Optional delivery target in LUFS (for example -14 streaming, -16 podcast, or -23 broadcast)",
          },
          tolerance_lu: {
            type: "number",
            description: "Allowed absolute difference from target_lufs (default: 1 LU)",
          },
          max_true_peak_dbfs: {
            type: "number",
            description: "Optional maximum acceptable true peak in dBFS (commonly -1 or -2)",
          },
        },
      },
      handler: async (args: {
        media_path?: string;
        project_item_id?: string;
        target_lufs?: number;
        tolerance_lu?: number;
        max_true_peak_dbfs?: number;
      }) => {
        if (!args.media_path && !args.project_item_id) {
          return { success: false, error: "analyze_loudness requires media_path or project_item_id." };
        }
        const tolerance = args.tolerance_lu ?? 1;
        if (args.target_lufs !== undefined && (!Number.isFinite(args.target_lufs) || args.target_lufs > 0 || args.target_lufs < -100)) {
          return { success: false, error: "target_lufs must be a finite value from -100 through 0" };
        }
        if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 20) {
          return { success: false, error: "tolerance_lu must be a finite value from 0 through 20" };
        }
        if (args.max_true_peak_dbfs !== undefined && (!Number.isFinite(args.max_true_peak_dbfs) || args.max_true_peak_dbfs > 0 || args.max_true_peak_dbfs < -100)) {
          return { success: false, error: "max_true_peak_dbfs must be a finite value from -100 through 0" };
        }

        let mediaPath = args.media_path;
        let itemName: string | undefined;
        if (!mediaPath) {
          const escaped = escapeForExtendScript(args.project_item_id as string);
          const lookup = await sendCommand(buildToolScript(`
            var item = __findProjectItem("${escaped}");
            if (!item) return __error("Project item not found: ${escaped}");
            var path = "";
            try { path = item.getMediaPath(); } catch(e) {}
            if (!path) return __error("Project item has no local media path");
            return __result({ mediaPath: path, name: item.name });
          `), bridgeOptions);
          if (!lookup.success) return lookup;
          const data = lookup.data as { mediaPath: string; name?: string };
          mediaPath = data.mediaPath;
          itemName = data.name;
        }
        if (!existsSync(mediaPath)) {
          return { success: false, error: `Media file not found on disk: ${mediaPath}` };
        }

        try {
          await execFileAsync("ffmpeg", ["-version"], { timeout: 10_000 });
        } catch {
          return {
            success: false,
            error: "ffmpeg was not found on PATH. analyze_loudness requires FFmpeg because Premiere scripting exposes no EBU R128 measurements.",
          };
        }

        let stderr: string;
        try {
          const result = await execFileAsync("ffmpeg", [
            "-nostdin", "-hide_banner", "-i", mediaPath,
            "-vn", "-sn", "-dn", "-af", "ebur128=peak=true", "-f", "null", "-",
          ], { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
          stderr = result.stderr;
        } catch (error) {
          const failure = error as { killed?: boolean; stderr?: string; message?: string };
          if (failure.killed) {
            return { success: false, error: `ffmpeg timed out after ${FFMPEG_TIMEOUT_MS / 1000}s measuring ${mediaPath}.` };
          }
          const detail = (failure.stderr ?? failure.message ?? "").split(/\r?\n/).filter(Boolean).slice(-3).join(" ");
          return { success: false, error: `ffmpeg could not measure loudness for ${mediaPath}: ${detail || "unknown error"}` };
        }

        const measurement = parseEbur128Summary(stderr);
        if (measurement.integratedLufs === null) {
          return {
            success: false,
            error: "FFmpeg completed but did not return measurable integrated loudness. The file may contain no audio or digital silence.",
          };
        }
        const deltaLu = args.target_lufs === undefined
          ? null
          : Number((measurement.integratedLufs - args.target_lufs).toFixed(1));
        const loudnessPass = deltaLu === null ? null : Math.abs(deltaLu) <= tolerance;
        const truePeakPass = args.max_true_peak_dbfs === undefined || measurement.truePeakDbfs === null
          ? null
          : measurement.truePeakDbfs <= args.max_true_peak_dbfs;

        return {
          success: true,
          data: {
            mediaPath,
            projectItemName: itemName,
            ...measurement,
            target: args.target_lufs === undefined ? null : {
              lufs: args.target_lufs,
              toleranceLu: tolerance,
              deltaLu,
              loudnessPass,
              maxTruePeakDbfs: args.max_true_peak_dbfs ?? null,
              truePeakPass,
              passes: loudnessPass && (truePeakPass !== false),
            },
            verificationScope: "Local decoded-media measurement only. This does not normalize audio or prove a Premiere sequence mix or final export unless that exact exported file was measured.",
          },
        };
      },
    },

    normalize_loudness_file: {
      description:
        "Create a new loudness-normalized media derivative with FFmpeg, then remeasure that exact output using EBU R128. Never overwrites the input or an existing output file.",
      parameters: {
        type: "object" as const,
        properties: {
          input_path: { type: "string", description: "Existing local audio or video file" },
          output_path: { type: "string", description: "New output path; must not already exist" },
          target_lufs: { type: "number", description: "Integrated loudness target from -70 through -5 LUFS (default: -16)" },
          max_true_peak_dbfs: { type: "number", description: "True-peak ceiling from -9 through 0 dBFS (default: -1.5)" },
          tolerance_lu: { type: "number", description: "Post-render integrated-loudness tolerance (default: 1 LU)" },
        },
        required: ["input_path", "output_path"],
      },
      handler: async (args: { input_path: string; output_path: string; target_lufs?: number; max_true_peak_dbfs?: number; tolerance_lu?: number }) => {
        const inputPath = resolve(args.input_path);
        const outputPath = resolve(args.output_path);
        const target = args.target_lufs ?? -16;
        const truePeak = args.max_true_peak_dbfs ?? -1.5;
        const tolerance = args.tolerance_lu ?? 1;
        if (!Number.isFinite(target) || target < -70 || target > -5) return { success: false, error: "target_lufs must be from -70 through -5" };
        if (!Number.isFinite(truePeak) || truePeak < -9 || truePeak > 0) return { success: false, error: "max_true_peak_dbfs must be from -9 through 0" };
        if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 5) return { success: false, error: "tolerance_lu must be from 0 through 5" };
        if (inputPath === outputPath) return { success: false, error: "output_path must differ from input_path" };
        if (!existsSync(inputPath) || !statSync(inputPath).isFile()) return { success: false, error: `Input file not found: ${inputPath}` };
        if (existsSync(outputPath)) return { success: false, error: `Output already exists and will not be overwritten: ${outputPath}` };
        if (!existsSync(dirname(outputPath)) || !statSync(dirname(outputPath)).isDirectory()) return { success: false, error: `Output directory does not exist: ${dirname(outputPath)}` };

        try {
          await execFileAsync("ffmpeg", [
            "-nostdin", "-hide_banner", "-n", "-i", inputPath,
            "-af", `loudnorm=I=${target}:TP=${truePeak}:LRA=11`,
            "-c:v", "copy", outputPath,
          ], { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
        } catch (error) {
          const failure = error as { code?: string; killed?: boolean; stderr?: string; message?: string };
          if (failure.code === "ENOENT") return { success: false, error: "ffmpeg was not found on PATH" };
          if (failure.killed) return { success: false, error: "ffmpeg loudness normalization timed out after 300 seconds" };
          return { success: false, error: `ffmpeg normalization failed: ${(failure.stderr ?? failure.message ?? "unknown error").split(/\r?\n/).filter(Boolean).slice(-3).join(" ")}` };
        }
        if (!existsSync(outputPath) || !statSync(outputPath).isFile() || statSync(outputPath).size < 1) {
          return { success: false, error: "ffmpeg reported completion but no non-empty output file exists" };
        }

        let measurement: LoudnessMeasurement;
        try {
          const measured = await execFileAsync("ffmpeg", [
            "-nostdin", "-hide_banner", "-i", outputPath,
            "-vn", "-sn", "-dn", "-af", "ebur128=peak=true", "-f", "null", "-",
          ], { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
          measurement = parseEbur128Summary(measured.stderr);
        } catch (error) {
          return { success: false, error: `Normalized output exists but EBU R128 verification failed: ${error instanceof Error ? error.message : String(error)}` };
        }
        if (measurement.integratedLufs === null) return { success: false, error: "Normalized output exists but integrated loudness was not measurable" };
        const deltaLu = Number((measurement.integratedLufs - target).toFixed(1));
        const loudnessPass = Math.abs(deltaLu) <= tolerance;
        const truePeakPass = measurement.truePeakDbfs !== null && measurement.truePeakDbfs <= truePeak;
        return {
          success: true,
          data: {
            inputPath, outputPath, outputSizeBytes: statSync(outputPath).size,
            target: { integratedLufs: target, maxTruePeakDbfs: truePeak, toleranceLu: tolerance },
            measured: measurement, deltaLu,
            verified: loudnessPass && truePeakPass,
            loudnessPass, truePeakPass,
            verificationScope: "The new output file exists and was remeasured locally. This does not prove subjective mix quality, rights, or Premiere timeline state.",
          },
        };
      },
    },
  };
}
