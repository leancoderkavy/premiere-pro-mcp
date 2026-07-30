import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Cap on a single ffmpeg analysis pass. Decode-only, so this is generous. */
const FFMPEG_TIMEOUT_MS = 300_000;

export interface SilenceInterval {
  start: number;
  end: number;
  duration: number;
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
      description: "Adjust the audio level (volume) of a clip in dB",
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
  };
}
