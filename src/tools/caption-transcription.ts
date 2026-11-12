import { createHash } from "node:crypto";
import { lstatSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, type BridgeOptions, type CommandResult } from "../bridge/file-bridge.js";
import { readEnvValue } from "../env-config.js";
import { findAudioOnlyPreset, type AudioOnlyPreset } from "./audio-export-preset.js";
import { resolveContainedOutputPath } from "./caption-authoring.js";
import { getExportTools } from "./export.js";
import {
  MAX_UPLOAD_BYTES,
  SOURCE_EXTENSIONS,
  TRANSCRIPTION_ENGINES,
  TranscriptionError,
  redactKey,
  type TranscriptionEngine,
  type TranscriptionOptions,
} from "./transcription-engines.js";

const MAX_PATH_LENGTH = 4096;
/** Source extensions that carry a picture: the whole file, picture included, is uploaded. */
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm"];
const isVideoFile = (file: string) => VIDEO_EXTENSIONS.includes(path.extname(file).toLowerCase());
/** Unity gain of Premiere's audio Volume > Level property (0 dB), see dbToPremiereLevel. */
const UNITY_LEVEL = 0.17782794;

type Json = Record<string, unknown>;

export interface CaptionTranscriptionDeps {
  /** Engines by id. Default: the built-in registry (ElevenLabs). */
  engines?: Record<string, TranscriptionEngine>;
  /** HTTP request function for the built-in engines. Default node:https request; tests inject a fake. */
  request?: typeof import("node:https").request;
  /** Sequence export. Default: export_sequence from getExportTools(bridgeOptions). */
  exportSequence?: (args: { output_path: string; preset_path?: string; range: "entire" }) => Promise<CommandResult>;
  /** Finds an audio-only Adobe Media Encoder system preset (used when no export_preset_path is given). Default: scans the AME install. Tests inject a fake. */
  findAudioPreset?: () => AudioOnlyPreset | null;
}

const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

function fail(error: string, data?: Json) {
  return data === undefined ? { success: false as const, error } : { success: false as const, error, data };
}

/** A name safe as a Windows/macOS file stem. Dots become underscores so the host never reads one as an extension. */
export function safeFileStem(name: string, fallback = "transcript"): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*.\u0000-\u001f]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^_+|_+$/g, "")
    .slice(0, 100)
    .trim();
  return cleaned || fallback;
}

/**
 * Read-only CEP script: which audio of the sequence is audible, and whether it is
 * exactly one untouched file. Sequence selection is escaped, never interpolated raw.
 */
export function buildSequenceAudioScript(sequenceId: string | null): string {
  const pick = sequenceId === null ? "var seq = __getCurrentActiveSequence();" : `var seq = __findSequence("${escapeForExtendScript(sequenceId)}");`;
  return buildToolScript(`
    ${pick}
    if (!seq) return __error("Sequence not found; nothing was uploaded.");
    var activeSeq = __getCurrentActiveSequence();
    var isActive = false;
    try { isActive = !!activeSeq && String(activeSeq.sequenceID) === String(seq.sequenceID); } catch (eActive) {}
    var reasons = [];
    var audible = [];
    var trackCount = 0;
    try { trackCount = seq.audioTracks.numTracks; } catch (eTracks) { return __error("Could not read the sequence audio tracks: " + eTracks); }
    for (var t = 0; t < trackCount; t++) {
      var track = seq.audioTracks[t];
      var muted = false;
      try { muted = !!track.isMuted(); } catch (eMute) { reasons.push("could not read the mute state of audio track A" + (t + 1)); }
      if (muted) continue;
      var clipCount = 0;
      try { clipCount = track.clips.numItems; } catch (eClips) { reasons.push("could not read the clips of audio track A" + (t + 1)); continue; }
      for (var c = 0; c < clipCount; c++) {
        var trackClip = track.clips[c];
        if (__isClipDisabled(trackClip)) continue;
        audible.push({ clip: trackClip, track: t });
      }
    }
    var candidate = null;
    if (audible.length === 0) {
      reasons.push("no enabled clip on an unmuted audio track");
    } else if (audible.length > 1) {
      reasons.push(audible.length + " enabled clips on unmuted audio tracks; the shortcut needs exactly one");
    } else {
      var clip = audible[0].clip;
      var item = null;
      try { item = clip.projectItem; } catch (eItem) {}
      var mediaPath = "";
      if (!item) {
        reasons.push("the clip has no project item");
      } else if (__projectItemKind(item) === "sequence") {
        reasons.push("the clip is a nested sequence, not a media file");
      } else {
        try { mediaPath = String(item.getMediaPath() || ""); } catch (ePath) {}
        if (!mediaPath) reasons.push("the project item has no media file path");
      }
      var speed = NaN;
      try { speed = Number(clip.getSpeed()); } catch (eSpeed) {}
      if (isNaN(speed)) {
        reasons.push("could not read the clip speed");
      } else if (Math.abs(speed - 1) > 0.0001) {
        reasons.push("the clip speed is " + speed + ", not 1");
      }
      var reversed = false;
      try { reversed = !!clip.isSpeedReversed(); } catch (eReverse) { reasons.push("could not read whether the clip is reversed"); }
      if (reversed) reasons.push("the clip is reversed");
      var volumeLevel = null;
      var componentCount = 0;
      try { componentCount = clip.components.numItems; } catch (eComponents) { reasons.push("could not read the clip audio components"); }
      for (var ci = 0; ci < componentCount; ci++) {
        var component = clip.components[ci];
        var displayName = "";
        var matchName = "";
        try { displayName = String(component.displayName); } catch (eName) {}
        try { matchName = String(component.matchName || ""); } catch (eMatch) {}
        if (matchName.indexOf("Internal Volume") === 0 || displayName === "Volume") {
          for (var pi = 0; pi < component.properties.numItems; pi++) {
            if (String(component.properties[pi].displayName) === "Level") { volumeLevel = component.properties[pi]; break; }
          }
        } else if (matchName.indexOf("Internal Channel Volume") === 0 || displayName === "Channel Volume") {
          continue;
        } else if (matchName.indexOf("Internal Panner") === 0 || displayName === "Panner") {
          continue;
        } else {
          reasons.push("the clip has an extra audio component: " + (displayName || matchName));
        }
      }
      if (!volumeLevel) {
        reasons.push("the clip has no Volume > Level property to check");
      } else {
        var timeVarying = false;
        try { timeVarying = !!volumeLevel.isTimeVarying(); } catch (eVarying) { reasons.push("could not read whether Volume Level has keyframes"); }
        if (timeVarying) reasons.push("Volume Level has keyframes");
        var levelValue = NaN;
        try { levelValue = Number(volumeLevel.getValue()); } catch (eLevel) {}
        if (isNaN(levelValue)) {
          reasons.push("could not read Volume Level");
        } else if (Math.abs(levelValue - ${UNITY_LEVEL}) > 0.001) {
          var levelDb = 0;
          if (levelValue > 0) levelDb = Math.round((20 * (Math.log(levelValue) / Math.LN10) + 15) * 100) / 100;
          if (levelValue > 0) {
            reasons.push("Volume Level is " + levelDb + " dB, not 0 dB");
          } else {
            reasons.push("Volume Level is silent, not 0 dB");
          }
        }
      }
      var startSeconds = NaN;
      var inSeconds = NaN;
      var outSeconds = NaN;
      try { startSeconds = Number(clip.start.seconds); inSeconds = Number(clip.inPoint.seconds); outSeconds = Number(clip.outPoint.seconds); } catch (eTimes) {}
      if (isNaN(startSeconds) || isNaN(inSeconds) || isNaN(outSeconds)) reasons.push("could not read the clip start and source in/out points");
      if (reasons.length === 0) {
        candidate = {
          nodeId: String(clip.nodeId),
          projectItemName: String(item.name),
          projectItemNodeId: __nodeIdOf(item),
          mediaPath: mediaPath,
          trackIndex: audible[0].track,
          startSeconds: startSeconds,
          inPointSeconds: inSeconds,
          outPointSeconds: outSeconds
        };
      }
    }
    return __result({
      sequence: { id: String(seq.sequenceID), name: String(seq.name), isActive: isActive },
      audibleClipCount: audible.length,
      reasons: reasons,
      candidate: candidate
    });
  `);
}

interface Candidate {
  nodeId: string;
  projectItemName: string;
  projectItemNodeId: string;
  mediaPath: string;
  trackIndex: number;
  startSeconds: number;
  inPointSeconds: number;
  outPointSeconds: number;
}

interface SequenceAudio {
  sequence: { id: string; name: string; isActive: boolean };
  audibleClipCount: number;
  reasons: string[];
  candidate: Candidate | null;
}

interface Acquired {
  file: string;
  source: "media_path" | "project_item_media" | "sequence_export";
  media: Json;
  stem: string;
  offset: number;
  range: { from_s: number; to_s: number } | null;
  extra: Json;
  /** Set for a sequence export: the stem the export was named with. */
  exportStem?: string;
  warnings?: string[];
}

/** Checks a file ElevenLabs can take; returns the reason it cannot, or null. */
function uploadProblem(file: string): string | null {
  const ext = path.extname(file).toLowerCase();
  if (!SOURCE_EXTENSIONS.includes(ext)) return `${ext || "(no extension)"} is not a format the engine takes (${SOURCE_EXTENSIONS.join(" ")})`;
  let size: number;
  try {
    const stat = statSync(file);
    if (!stat.isFile()) return "the path is not a file";
    size = stat.size;
  } catch {
    return "the file is not readable from here";
  }
  if (size === 0) return "the file is empty";
  if (size > MAX_UPLOAD_BYTES) return `the file is ${Math.round(size / 1048576)} MB; the upload limit is ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB`;
  return null;
}

/** A file stem no existing file in dir uses (with any extension): " 2", " 3" are added. */
function freeStem(dir: string, stem: string): string {
  const taken = new Set(readdirSync(dir).map((n) => n.toLowerCase()));
  const used = (s: string) => {
    const lower = s.toLowerCase();
    for (const name of taken) if (name === lower || name.startsWith(`${lower}.`)) return true;
    return false;
  };
  if (!used(stem)) return stem;
  for (let n = 2; n < 1000; n++) if (!used(`${stem} ${n}`)) return `${stem} ${n}`;
  throw new Error(`Every name from "${stem}" to "${stem} 999" is taken in ${dir}`);
}

/** Writes with flag "wx"; a taken name gets " 2", " 3" before its suffix. */
function writeUnique(dir: string, stem: string, suffix: string, data: string): string {
  for (let n = 1; n < 1000; n++) {
    const candidate = path.join(dir, n === 1 ? `${stem}${suffix}` : `${stem} ${n}${suffix}`);
    try {
      writeFileSync(candidate, data, { encoding: "utf8", flag: "wx" });
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new Error(`Every name from "${stem}${suffix}" to " 999" is taken in ${dir}`);
}

/** True when `file` is a regular file (not a link) inside `dir` whose name starts with `stem` + "."; the only kind of file this tool deletes. */
function isOwnExportInside(dir: string, file: string, stem: string): boolean {
  try {
    if (!lstatSync(file).isFile()) return false;
    const root = realpathSync(dir);
    const parent = realpathSync(path.dirname(file));
    const relative = path.relative(root, parent);
    if (relative !== "") return false;
    return path.basename(file).toLowerCase().startsWith(`${stem.toLowerCase()}.`);
  } catch {
    return false;
  }
}

function workspaceDirectory(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_PATH_LENGTH) throw new Error(`approved_workspace_path must be a non-empty string of at most ${MAX_PATH_LENGTH} characters`);
  const dir = value.trim();
  if (!path.isAbsolute(dir)) throw new Error("approved_workspace_path must be an absolute path");
  let isDirectory = false;
  try {
    isDirectory = statSync(dir).isDirectory();
  } catch {
    // reported below
  }
  if (!isDirectory) throw new Error("approved_workspace_path must be an existing directory");
  // The canonical path, so every path this tool writes or returns has the same form as resolveContainedOutputPath's
  // (on macOS the temp directory /var/... is a link to /private/var/...).
  return realpathSync(dir);
}

export function getCaptionTranscriptionTools(bridgeOptions: BridgeOptions, deps: CaptionTranscriptionDeps = {}) {
  const engineIds = Object.keys(TRANSCRIPTION_ENGINES);
  const engines: Record<string, TranscriptionEngine> = deps.engines ?? Object.fromEntries(engineIds.map((id) => [id, TRANSCRIPTION_ENGINES[id](deps.request)]));
  const exportSequence = deps.exportSequence ?? ((args: Parameters<NonNullable<CaptionTranscriptionDeps["exportSequence"]>>[0]) => getExportTools(bridgeOptions).export_sequence.handler(args) as Promise<CommandResult>);

  const findAudioPreset = deps.findAudioPreset ?? (() => findAudioOnlyPreset());

  return {
    transcribe_audio: {
      description:
        "Transcribe speech to word-level JSON with a THIRD-PARTY engine (ElevenLabs Scribe), not Adobe: an audio or video file is UPLOADED to ElevenLabs (US-hosted; the picture is uploaded too when the source is a video file) and needs ELEVENLABS_API_KEY; confirm_upload: true is required and nothing is sent without it. " +
        "Source is one of media_path (an audio or video file; no Premiere call), or a sequence: when its only audible clip is one untouched media file that file is uploaded directly (offset and audible range returned; an .mp4 or .mov is uploaded with its picture), otherwise the active sequence is exported to the workspace first. Without export_preset_path the export uses an audio-only Adobe Media Encoder system preset (WAV, else AAC, MP3 or AIFF, found under the AME install's MediaIO/systempresets and checked to render no video), so only sound is uploaded; export_preset_used names the preset. Only if none is found does it fall back to the H.264 preset, which writes picture and sound, so the picture is uploaded too and a warning says so. The exported file stays in the workspace (named in exported_file_left_in_workspace) unless delete_export_after_upload is true. " +
        "Writes the engine's raw JSON into approved_workspace_path and returns its path, revision, summary and the offset to give plan_captions. For Adobe's own on-device Speech to Text use prepare_transcript_workflow.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          confirm_upload: { type: "boolean", description: "Must be true. Records that the user agreed to send this audio or video file to ElevenLabs, a third-party service (US-hosted), for transcription (the picture is uploaded too when the source is a video file). Without it nothing is sent." },
          approved_workspace_path: { type: "string", maxLength: MAX_PATH_LENGTH, description: "Absolute existing directory where the transcript JSON (and, for a sequence export, the exported file) is written." },
          output_path: { type: "string", maxLength: MAX_PATH_LENGTH, description: "Optional absolute .json path for the engine's raw response; must be inside approved_workspace_path and must not exist. Default: '<name>.elevenlabs.json' in the workspace, with ' 2', ' 3' added if the name is taken." },
          media_path: { type: "string", maxLength: MAX_PATH_LENGTH, description: `Source A: absolute path of an audio or video file (${SOURCE_EXTENSIONS.join(" ")}), at most 1 GB. No Premiere call is made. Give exactly one of media_path, sequence_id or use_active_sequence.` },
          sequence_id: { type: "string", minLength: 1, maxLength: 512, description: "Source B: exact sequence ID whose audio to transcribe. Exporting it needs it to be the active sequence (call set_active_sequence first)." },
          use_active_sequence: { type: "boolean", description: "Source B: transcribe the active sequence instead of naming a sequence_id." },
          media_shortcut: { type: "boolean", description: "Sequence sources only. Default true: when the sequence's only audible clip is one untouched media file (speed 1, not reversed, enabled, default Volume/Channel Volume/Panner only, Volume Level unkeyed at 0 dB), upload that file directly. false forces an export of the sequence mix." },
          export_preset_path: { type: "string", maxLength: MAX_PATH_LENGTH, description: "Optional absolute .epr preset for the sequence export (sequence sources that cannot use the shortcut). Default: an audio-only Adobe Media Encoder system preset (WAV, AAC, MP3 or AIFF) when one is installed, so only sound is uploaded; if none is found, Premiere's H.264 preset, which writes picture and sound (a warning says so)." },
          delete_export_after_upload: { type: "boolean", description: "Sequence export only. Default false: the exported file stays in approved_workspace_path and is named in exported_file_left_in_workspace. true: after a successful transcription delete that exported file (only that file, only when it is inside the workspace and this call created it)." },
          include_media_path: { type: "boolean", description: "Include the source media's absolute path in the result for a sequence clip used directly. Default false: media paths are treated as sensitive." },
          engine: { type: "string", enum: engineIds, description: "Transcription engine. Only elevenlabs (Scribe) so far." },
          model: { type: "string", minLength: 1, maxLength: 64, description: "Engine model id. Default scribe_v1." },
          language: { type: "string", minLength: 2, maxLength: 8, description: "ISO 639-1 or 639-3 language code. Omit to auto-detect." },
          diarize: { type: "boolean", description: "Label who is speaking. Default true." },
          num_speakers: { type: "integer", minimum: 1, maximum: 32, description: "Number of speakers, if known." },
          tag_audio_events: { type: "boolean", description: "Mark laughter, applause and similar as audio events. Default true." },
        },
        required: ["confirm_upload", "approved_workspace_path"],
      },
      handler: async (args: Record<string, unknown>) => {
        let key: string | undefined;
        try {
          if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
          if (args.confirm_upload !== true) {
            return fail("confirm_upload: true is required. An audio or video file is uploaded to ElevenLabs, a third-party service (US-hosted), for transcription (the picture is uploaded too when the source is a video file); nothing was sent.");
          }
          const engineId = args.engine === undefined ? "elevenlabs" : args.engine;
          if (typeof engineId !== "string" || !Object.prototype.hasOwnProperty.call(engines, engineId)) {
            return fail(`Unknown engine ${JSON.stringify(engineId)}; available: ${Object.keys(engines).join(", ")}. Nothing was sent.`);
          }
          const engine = engines[engineId];
          const useActive = args.use_active_sequence === true;
          const sources = [args.media_path !== undefined, args.sequence_id !== undefined, useActive].filter(Boolean).length;
          if (sources !== 1) return fail("Give exactly one of media_path, sequence_id or use_active_sequence: true. Nothing was sent.");
          if (args.media_path !== undefined && (typeof args.media_path !== "string" || !args.media_path.trim() || args.media_path.length > MAX_PATH_LENGTH)) throw new Error("media_path must be a non-empty string");
          if (args.sequence_id !== undefined && (typeof args.sequence_id !== "string" || !args.sequence_id.trim() || args.sequence_id.length > 512)) throw new Error("sequence_id must be a non-empty string of at most 512 characters");
          if (args.delete_export_after_upload !== undefined && typeof args.delete_export_after_upload !== "boolean") throw new Error("delete_export_after_upload must be a boolean");
          if (args.export_preset_path !== undefined && (typeof args.export_preset_path !== "string" || !path.isAbsolute(args.export_preset_path))) throw new Error("export_preset_path must be an absolute path");

          if (engine.keyEnvVar) {
            key = readEnvValue(process.env[engine.keyEnvVar]);
            if (!key) return fail(`${engine.keyEnvVar} is not set. Set it in the environment of the MCP server and restart the client; nothing was sent.`);
          }
          const options: TranscriptionOptions = {
            model: engine.defaultModel,
            diarize: true,
            tag_audio_events: true,
          };
          if (args.model !== undefined) {
            if (typeof args.model !== "string" || !args.model.trim() || args.model.length > 64) throw new Error("model must be a non-empty string of at most 64 characters");
            options.model = args.model.trim();
          }
          if (args.language !== undefined) {
            if (typeof args.language !== "string" || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,4})?$/.test(args.language)) throw new Error("language must be an ISO 639 code such as en, eng or pt-BR");
            options.language = args.language;
          }
          if (args.diarize !== undefined) {
            if (typeof args.diarize !== "boolean") throw new Error("diarize must be a boolean");
            options.diarize = args.diarize;
          }
          if (args.tag_audio_events !== undefined) {
            if (typeof args.tag_audio_events !== "boolean") throw new Error("tag_audio_events must be a boolean");
            options.tag_audio_events = args.tag_audio_events;
          }
          if (args.num_speakers !== undefined) {
            if (typeof args.num_speakers !== "number" || !Number.isInteger(args.num_speakers) || args.num_speakers < 1 || args.num_speakers > 32) throw new Error("num_speakers must be an integer from 1 through 32");
            options.num_speakers = args.num_speakers;
          }

          const workspace = workspaceDirectory(args.approved_workspace_path);
          let explicitTarget: string | null = null;
          if (args.output_path !== undefined) {
            explicitTarget = resolveContainedOutputPath(workspace, args.output_path);
            if (path.extname(explicitTarget).toLowerCase() !== ".json") throw new Error("output_path must use the .json extension");
          }

          // ---- 1. find the audio to upload ----
          let acquired: Acquired;
          if (typeof args.media_path === "string") {
            const file = args.media_path.trim();
            if (!path.isAbsolute(file)) throw new Error("media_path must be an absolute path");
            const problem = uploadProblem(file);
            if (problem) return fail(`media_path cannot be transcribed: ${problem}. Nothing was sent.`);
            acquired = { file, source: "media_path", media: { name: path.basename(file) }, stem: safeFileStem(path.parse(file).name), offset: 0, range: null, extra: {} };
            if (isVideoFile(file)) acquired.warnings = ["media_path is a video file: the picture is uploaded to ElevenLabs together with the sound. Use an audio file to upload audio only."];
          } else {
            const inspected = await sendCommand(buildSequenceAudioScript(useActive ? null : (args.sequence_id as string)), bridgeOptions);
            if (!inspected.success) return fail(`${inspected.error ?? "Could not read the sequence audio"}; nothing was sent.`);
            const audio = inspected.data as SequenceAudio;
            if (audio.audibleClipCount === 0) return fail("The sequence has no enabled clip on an unmuted audio track, so there is nothing to transcribe. Nothing was sent.", { sequence: audio.sequence });
            const skipped: string[] = [];
            if (args.media_shortcut === false) skipped.push("media_shortcut was false");
            skipped.push(...audio.reasons);
            const sequenceInfo = { id: audio.sequence.id, name: audio.sequence.name };
            let direct: Acquired | null = null;
            const c = audio.candidate;
            if (c && audio.reasons.length === 0 && args.media_shortcut !== false) {
              const problem = uploadProblem(c.mediaPath);
              if (problem) {
                skipped.push(`the clip's media file cannot be uploaded directly: ${problem}`);
              } else {
                const media: Json = { project_item_name: c.projectItemName, project_item_node_id: c.projectItemNodeId, clip_node_id: c.nodeId };
                if (args.include_media_path === true) media.path = c.mediaPath;
                direct = {
                  file: c.mediaPath,
                  source: "project_item_media",
                  media,
                  stem: safeFileStem(audio.sequence.name),
                  offset: round6(c.startSeconds - c.inPointSeconds),
                  range: { from_s: round6(c.inPointSeconds), to_s: round6(c.outPointSeconds) },
                  extra: { sequence: sequenceInfo, media_shortcut_skipped: [] },
                };
                if (isVideoFile(c.mediaPath)) direct.warnings = ["The clip's media file is a video file: the picture is uploaded to ElevenLabs together with the sound."];
              }
            }
            if (direct) {
              acquired = direct;
            } else {
              if (!audio.sequence.isActive) {
                return fail("The sequence's audio has to be exported, and only the active sequence can be exported. Call set_active_sequence for this sequence first. Nothing was sent.", { sequence: sequenceInfo, media_shortcut_skipped: skipped });
              }
              const stem = freeStem(workspace, `${safeFileStem(audio.sequence.name, "sequence")} transcription audio`);
              // No extension: the export adds the one the preset writes (.mp4 for the default H.264 preset).
              let presetPath: string | undefined = args.export_preset_path as string | undefined;
              let presetChoice: Json;
              let audioPreset: AudioOnlyPreset | null = null;
              if (presetPath !== undefined) {
                presetChoice = { path: presetPath, source: "export_preset_path" };
              } else {
                try {
                  audioPreset = findAudioPreset();
                } catch {
                  audioPreset = null;
                }
                if (audioPreset) {
                  presetPath = audioPreset.path;
                  presetChoice = { path: audioPreset.path, name: audioPreset.name, format: audioPreset.format, install: audioPreset.install, source: "audio_only_default" };
                } else {
                  presetChoice = { path: null, source: "h264_default" };
                }
              }
              const exported = await exportSequence({ output_path: path.join(workspace, stem), ...(presetPath !== undefined ? { preset_path: presetPath } : {}), range: "entire" });
              const exportData = (exported.data ?? undefined) as Json | undefined;
              if (!exported.success) return fail(`Sequence audio export failed: ${exported.error ?? "unknown error"}. Nothing was sent.`, { sequence: sequenceInfo, media_shortcut_skipped: skipped, export: exportData ?? null });
              if (exportData?.verified !== true) return fail("Sequence audio export was written but not verified (see export); nothing was sent.", { sequence: sequenceInfo, media_shortcut_skipped: skipped, export: exportData ?? null });
              const exportedFile = typeof exportData.outputPath === "string" ? exportData.outputPath : "";
              const problem = exportedFile ? uploadProblem(exportedFile) : "the export reported no output path";
              if (problem) return fail(`The exported audio cannot be transcribed: ${problem}. Nothing was sent.`, { sequence: sequenceInfo, media_shortcut_skipped: skipped, export: exportData });
              acquired = {
                file: exportedFile,
                source: "sequence_export",
                media: { name: path.basename(exportedFile), path: exportedFile },
                stem: safeFileStem(audio.sequence.name),
                offset: 0,
                range: null,
                extra: { sequence: sequenceInfo, media_shortcut_skipped: skipped, export_preset_used: { ...presetChoice, ...(typeof exportData.presetUsed === "string" ? { reported_by_export: exportData.presetUsed } : {}) } },
                exportStem: stem,
              };
              if (presetPath === undefined) {
                acquired.warnings = ["No audio-only Adobe Media Encoder preset was found and no export_preset_path was given, so the default H.264 preset exported picture and sound: the picture is uploaded to ElevenLabs too. Pass an audio-only .epr as export_preset_path to upload audio only."];
              } else if (isVideoFile(exportedFile)) {
                acquired.warnings = ["The exported file is a video file: the picture is uploaded to ElevenLabs together with the sound. Use an audio-only preset to upload audio only."];
              }
            }
          }

          // ---- 2. upload ----
          const uploadBytes = statSync(acquired.file).size;
          const { raw, summary } = await engine.transcribe(acquired.file, options, key);

          // ---- 3. write the engine's response ----
          const text = `${JSON.stringify(raw, null, 2)}\n`;
          let transcriptPath: string;
          if (explicitTarget) {
            writeFileSync(explicitTarget, text, { encoding: "utf8", flag: "wx" });
            transcriptPath = explicitTarget;
          } else {
            transcriptPath = writeUnique(workspace, acquired.stem, `.${engine.id}.json`, text);
          }
          // ---- 4. the exported file: named, or deleted when asked ----
          const warnings = [...(acquired.warnings ?? [])];
          let exportedLeft: string | null = null;
          let exportedDeleted = false;
          if (acquired.source === "sequence_export") {
            exportedLeft = acquired.file;
            if (args.delete_export_after_upload === true) {
              if (isOwnExportInside(workspace, acquired.file, acquired.exportStem ?? "")) {
                try {
                  unlinkSync(acquired.file);
                  exportedDeleted = true;
                  exportedLeft = null;
                } catch (deleteError) {
                  warnings.push(`delete_export_after_upload: the exported file could not be deleted (${redactKey(deleteError instanceof Error ? deleteError.message : String(deleteError), key)}); it is still in the workspace.`);
                }
              } else {
                warnings.push("delete_export_after_upload: the exported file is not a plain file this call created inside approved_workspace_path, so it was not deleted.");
              }
            }
          } else if (args.delete_export_after_upload === true) {
            warnings.push("delete_export_after_upload had no effect: no sequence export was made, so no file was created or deleted.");
          }
          const revision = `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
          const planArguments: Json = { transcript_path: transcriptPath, approved_workspace_path: workspace, offset: acquired.offset };
          if (acquired.range) {
            planArguments.from_s = acquired.range.from_s;
            planArguments.to_s = acquired.range.to_s;
          }
          return {
            success: true as const,
            data: {
              engine: engine.id,
              model: options.model,
              source: acquired.source,
              media: acquired.media,
              ...acquired.extra,
              transcript_path: transcriptPath,
              transcript_revision: revision,
              transcript_bytes: Buffer.byteLength(text, "utf8"),
              summary,
              offset_seconds: acquired.offset,
              audible_source_range: acquired.range,
              upload_bytes: uploadBytes,
              uploaded_file_kind: isVideoFile(acquired.file) ? "video (picture and sound)" : "audio",
              ...(acquired.source === "sequence_export" ? { exported_file_left_in_workspace: exportedLeft, exported_file_deleted: exportedDeleted } : {}),
              warnings,
              privacy: `${engine.privacy} The raw response was written to the workspace; the transcript is a local file.`,
              offset_meaning: "Sequence time = transcript time + offset_seconds. When audible_source_range is set, only words from from_s to to_s of the transcript are heard in the sequence.",
              next: [
                { tool: "plan_captions", arguments: planArguments, why: "Turn the transcript into a caption plan; pass offset (and from_s/to_s when present) so cue times land on the sequence timeline." },
                { tool: "create_caption_track", arguments: { action: "import_plan" }, alternative: "add_caption_graphics", why: "Import the plan as a caption track, or place it as caption graphics." },
              ],
            },
          };
        } catch (error) {
          const message = redactKey(error instanceof Error ? error.message : String(error), key);
          if (error instanceof TranscriptionError) return fail(message, { code: error.code, ...(error.status !== undefined ? { status: error.status } : {}) });
          return fail(message);
        }
      },
    },
  };
}
