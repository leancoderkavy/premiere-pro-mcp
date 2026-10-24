import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { promisify } from "node:util";
import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import { currentInvocation } from "../workflows/invocation-context.js";

/**
 * create_source_freeze_frame (#880 item 13).
 *
 * Route: the frame is decoded with ffmpeg straight from the project item's media
 * file, not through Premiere. Premiere's documented ExtendScript and UXP APIs
 * have no source-time still exporter; the only frame exporters are the
 * undocumented QE `exportFramePNG/JPEG` on the *sequence* (what freeze_frame
 * uses). Reaching a source frame through Premiere would mean opening the item in
 * the Source Monitor and driving undocumented QE source-monitor state, which
 * changes the user's UI and cannot be read back. ffmpeg needs no host UI state
 * and its output is verified on disk before Premiere is touched.
 */

const execFileNative = promisify(execFile);
const FFMPEG_TIMEOUT_MS = 120_000;
const MAX_DURATION_SECONDS = 3600;
const MAX_SCALE_PERCENT = 10000;
const MAX_POSITION_PIXELS = 100000;

export interface SourceVideoProbe {
  durationSeconds: number;
  frameRate: number;
  width: number;
  height: number;
  /** r_frame_rate and avg_frame_rate disagree, so frame snapping is approximate. */
  variableFrameRate: boolean;
}

export interface SourceFreezeFrameDependencies {
  probeSourceVideo?: (mediaPath: string) => Promise<SourceVideoProbe>;
  extractSourceFrame?: (mediaPath: string, seekSeconds: number, outputPath: string) => Promise<void>;
}

function ratio(value: unknown): number {
  if (typeof value !== "string") return NaN;
  const [numerator, denominator] = value.split("/").map(Number);
  if (denominator === undefined) return numerator;
  return denominator > 0 ? numerator / denominator : NaN;
}

export async function defaultProbeSourceVideo(mediaPath: string): Promise<SourceVideoProbe> {
  const { stdout } = await execFileNative("ffprobe", [
    "-v", "error", "-protocol_whitelist", "file", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,avg_frame_rate,r_frame_rate:format=duration",
    "-of", "json", `file:${mediaPath}`,
  ], { encoding: "utf8", timeout: 60_000, windowsHide: true, maxBuffer: 1024 * 1024, signal: currentInvocation()?.signal });
  const parsed = JSON.parse(String(stdout)) as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> };
  const stream = Array.isArray(parsed.streams) ? parsed.streams[0] : undefined;
  if (!stream) throw new Error("ffprobe found no video stream");
  const average = ratio(stream.avg_frame_rate), nominal = ratio(stream.r_frame_rate);
  const frameRate = Number.isFinite(average) && average > 0 ? average : nominal;
  return {
    durationSeconds: Number(parsed.format?.duration),
    frameRate,
    width: Number(stream.width),
    height: Number(stream.height),
    variableFrameRate: Number.isFinite(average) && Number.isFinite(nominal) && Math.abs(average - nominal) > 0.01,
  };
}

export async function defaultExtractSourceFrame(mediaPath: string, seekSeconds: number, outputPath: string): Promise<void> {
  const jpeg = /\.jpe?g$/i.test(outputPath);
  // -n never overwrites; input -ss is frame-accurate (decode-and-discard) and
  // relative to the file's first timestamp, which is Premiere's source time 0.
  // scale=iw*sar converts anamorphic storage pixels to square pixels so the
  // imported still is not distorted.
  await execFileNative("ffmpeg", [
    "-v", "error", "-nostdin", "-n", "-ss", seekSeconds.toFixed(6),
    "-protocol_whitelist", "file", "-i", `file:${mediaPath}`,
    "-frames:v", "1", "-an", "-vf", "scale=iw*sar:ih,setsar=1",
    ...(jpeg ? ["-q:v", "2"] : []), "-update", "1", `file:${outputPath}`,
  ], { encoding: "utf8", timeout: FFMPEG_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024, signal: currentInvocation()?.signal });
}

type Point = [number, number];
interface ZoomArgs { from_scale?: number; to_scale?: number; from_position?: unknown; to_position?: unknown; ease?: unknown }
interface PlaceArgs { track_index?: number; start_seconds?: number }
export interface SourceFreezeFrameArgs {
  source_item_id?: string;
  source_time_seconds?: number;
  output_path?: string;
  duration_seconds?: number;
  place?: PlaceArgs;
  zoom?: ZoomArgs;
  time_seconds?: unknown;
}

function point(value: unknown, name: string): { point?: Point; error?: string } {
  if (value === undefined) return {};
  if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= MAX_POSITION_PIXELS)) {
    return { error: `zoom.${name} must be [x, y] in sequence pixels, each finite and within ±${MAX_POSITION_PIXELS}.` };
  }
  return { point: [value[0], value[1]] };
}

function failureDetail(error: unknown): string {
  const failure = error as Error & { killed?: boolean; code?: string; stderr?: string };
  if (failure.code === "ENOENT") return "was not found on PATH. Install FFmpeg (brew install ffmpeg, or winget install Gyan.FFmpeg) and retry";
  if (failure.killed) return "timed out";
  return String(failure.stderr || failure.message || "unknown error").split(/\r?\n/).filter(Boolean).slice(-3).join(" ");
}

const SHARED_HELPERS = `
          function __sffOccupant(track, startTicks, endTicks) {
            for (var oc = 0; oc < track.clips.numItems; oc++) {
              var other = track.clips[oc];
              var otherStart = parseFloat(other.start.ticks), otherEnd = parseFloat(other.end.ticks);
              if (!isFinite(otherStart) || !isFinite(otherEnd)) return { name: String(other.name), unreadable: true };
              if (otherStart < endTicks - 1 && otherEnd > startTicks + 1) {
                return { name: String(other.name), startSeconds: __ticksToSeconds(otherStart), endSeconds: __ticksToSeconds(otherEnd) };
              }
            }
            return null;
          }
          function __sffSnap(seconds, frameTicks) {
            return Math.round(seconds * TICKS_PER_SECOND / frameTicks) * frameTicks;
          }
`;

export function createSourceFreezeFrameTool(bridgeOptions: BridgeOptions, dependencies: SourceFreezeFrameDependencies = {}) {
  const probeSourceVideo = dependencies.probeSourceVideo ?? defaultProbeSourceVideo;
  const extractSourceFrame = dependencies.extractSourceFrame ?? defaultExtractSourceFrame;
  return {
    description:
      "Create a freeze frame from a project item at a SOURCE-media time (not a sequence time; for a sequence time use freeze_frame). Decodes the frame with ffmpeg from the item's media file (requires ffmpeg/ffprobe on PATH; no Source Monitor or QE state is used), refuses to overwrite an existing output file, imports the still and sets its Out mark to duration_seconds. Optional place puts it on an empty range of one video track (refuses an occupied or locked range rather than overwriting); optional zoom (requires place) adds Motion Scale and optional Position keyframes at the clip's first and last frame for a punch-in. Every step is read back; partial success reports which steps were committed but not verified. Refuses before any change when the item has no readable local media, the time is past the media end, or the item's interpreted frame rate differs from the file's.",
    parameters: {
      type: "object" as const,
      additionalProperties: false,
      properties: {
        source_item_id: { type: "string", description: "Node ID (preferred) or exact name of the source video project item." },
        source_time_seconds: { type: "number", minimum: 0, description: "Seconds from the first frame of the source media (media time zero, not its start timecode and not its In mark). Snapped down to the item's frame grid." },
        output_path: { type: "string", description: "New .png, .jpg or .jpeg path for the frame. Must not exist; its folder must exist." },
        duration_seconds: { type: "number", description: "Length of the still in seconds, written as its Out mark and read back (default 2, at most 3600)." },
        place: {
          type: "object",
          additionalProperties: false,
          description: "Optional placement on the active sequence. The range must be empty; nothing is overwritten.",
          properties: {
            track_index: { type: "integer", minimum: 0, description: "Video track index (0-based)." },
            start_seconds: { type: "number", minimum: 0, description: "Timeline start in seconds, snapped to the sequence frame grid." },
          },
          required: ["track_index", "start_seconds"],
        },
        zoom: {
          type: "object",
          additionalProperties: false,
          description: "Optional punch-in keyframes on the placed clip's Motion effect (requires place). Scale is percent as Premiere reports it for the placed still; Position is in sequence pixels.",
          properties: {
            from_scale: { type: "number", description: "Motion Scale percent at the clip's first frame (above 0, at most 10000)." },
            to_scale: { type: "number", description: "Motion Scale percent at the clip's last frame (above 0, at most 10000)." },
            from_position: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2, description: "Optional [x, y] Motion Position in sequence pixels at the first frame. Defaults to the clip's current position when only to_position is given." },
            to_position: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2, description: "Optional [x, y] Motion Position in sequence pixels at the last frame. Defaults to from_position when only from_position is given." },
            ease: { type: "string", enum: ["linear", "bezier"], description: "Keyframe interpolation (default linear, Premiere's default for new keys). bezier is written with setInterpolationTypeAtKey and cannot be read back; without handle control it may render like linear." },
          },
          required: ["from_scale", "to_scale"],
        },
      },
      required: ["source_item_id", "source_time_seconds", "output_path"],
    },
    handler: async (args: SourceFreezeFrameArgs) => {
      // ---- Validate everything before contacting Premiere or ffmpeg. ----
      if (args.time_seconds !== undefined) {
        return { success: false, error: "create_source_freeze_frame takes source_time_seconds (source media time), not time_seconds. For a sequence time use freeze_frame. Nothing was changed." };
      }
      if (typeof args.source_item_id !== "string" || args.source_item_id.trim() === "") {
        return { success: false, error: "source_item_id must be a non-empty project item node ID or name. Nothing was changed." };
      }
      const sourceTime = args.source_time_seconds;
      if (typeof sourceTime !== "number" || !Number.isFinite(sourceTime) || sourceTime < 0) {
        return { success: false, error: "source_time_seconds must be a finite, non-negative number of seconds from the source media's first frame. Nothing was changed." };
      }
      const durationSeconds = args.duration_seconds ?? 2;
      if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_DURATION_SECONDS) {
        return { success: false, error: "duration_seconds must be a finite number above 0 and at most 3600. Nothing was changed." };
      }
      if (typeof args.output_path !== "string" || args.output_path.trim() === "" || ![".png", ".jpg", ".jpeg"].includes(extname(args.output_path).toLowerCase())) {
        return { success: false, error: "output_path must be a .png, .jpg or .jpeg file path. Nothing was changed." };
      }
      const outputPath = resolve(args.output_path);
      if (existsSync(outputPath)) {
        return { success: false, error: `output_path already exists (${outputPath}); create_source_freeze_frame never overwrites or renames an existing file. Choose a new path. Nothing was changed.` };
      }
      if (!existsSync(dirname(outputPath)) || !statSync(dirname(outputPath)).isDirectory()) {
        return { success: false, error: `The output folder ${dirname(outputPath)} does not exist. Nothing was changed.` };
      }
      const place = args.place;
      if (place !== undefined) {
        if (!place || typeof place !== "object" || !Number.isSafeInteger(place.track_index) || (place.track_index as number) < 0 ||
            typeof place.start_seconds !== "number" || !Number.isFinite(place.start_seconds) || place.start_seconds < 0 || place.start_seconds > 86400) {
          return { success: false, error: "place needs track_index (non-negative integer) and start_seconds (finite, 0 through 86400). Nothing was changed." };
        }
      }
      const zoom = args.zoom;
      let fromPosition: Point | undefined, toPosition: Point | undefined;
      let ease: "linear" | "bezier" = "linear";
      if (zoom !== undefined) {
        if (!place) return { success: false, error: "zoom requires place: keyframes go on the placed timeline clip. Nothing was changed." };
        if (!zoom || typeof zoom !== "object") return { success: false, error: "zoom must be an object. Nothing was changed." };
        for (const name of ["from_scale", "to_scale"] as const) {
          const value = zoom[name];
          if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MAX_SCALE_PERCENT) {
            return { success: false, error: `zoom.${name} must be a finite Scale percent above 0 and at most ${MAX_SCALE_PERCENT}. Nothing was changed.` };
          }
        }
        const from = point(zoom.from_position, "from_position"), to = point(zoom.to_position, "to_position");
        if (from.error || to.error) return { success: false, error: `${from.error ?? to.error} Nothing was changed.` };
        fromPosition = from.point;
        toPosition = to.point ?? from.point;
        if (zoom.ease !== undefined && zoom.ease !== "linear" && zoom.ease !== "bezier") {
          return { success: false, error: "zoom.ease must be linear or bezier. Nothing was changed." };
        }
        ease = zoom.ease === "bezier" ? "bezier" : "linear";
      }
      const itemId = escapeForExtendScript(args.source_item_id);
      const trackIndex = place ? (place.track_index as number) : 0;
      const startSeconds = place ? (place.start_seconds as number) : 0;

      // ---- Step 1: read-only preflight in Premiere. ----
      const preflight = await sendCommand(buildToolScript(`
          ${SHARED_HELPERS}
          var item = __findProjectItemByNodeId("${itemId}") || __findProjectItem("${itemId}");
          if (!item) return __error("Project item not found: ${itemId}. Nothing was changed.");
          if (__isBinItem(item)) return __error("Project item " + item.name + " is a bin, not source media. Nothing was changed.");
          var isSequence = false;
          try { isSequence = typeof item.isSequence === "function" && !!item.isSequence(); } catch (eSeqKind) {}
          if (isSequence) return __error("Project item " + item.name + " is a sequence. create_source_freeze_frame reads a media file; use freeze_frame for sequence time. Nothing was changed.");
          var offline = false;
          try { offline = typeof item.isOffline === "function" && !!item.isOffline(); } catch (eOffline) {}
          if (offline) return __error("Project item " + item.name + " is offline. Relink it first. Nothing was changed.");
          var mediaPath = "";
          try { mediaPath = String(item.getMediaPath() || ""); } catch (eMediaPath) {}
          if (!mediaPath) return __error("Project item " + item.name + " has no readable media path (synthetic, merged or multicam items are not supported). Nothing was changed.");
          var interpretedFps = null;
          try { interpretedFps = parseFloat(item.getFootageInterpretation().frameRate); } catch (eFps) {}
          if (!(interpretedFps > 0 && interpretedFps <= 1000)) interpretedFps = null;
          var placement = null;
          if (${place ? "true" : "false"}) {
            var seq = app.project.activeSequence;
            if (!seq) return __error("place needs an active sequence. Nothing was changed.");
            var frameTicks = __sequenceFrameTicks(seq);
            if (!isFinite(frameTicks)) return __error("The active sequence frame grid is unreadable. Nothing was changed.");
            if (${trackIndex} >= seq.videoTracks.numTracks) return __error("Video track index ${trackIndex} is out of range: the sequence has " + seq.videoTracks.numTracks + " video track(s). Nothing was changed.");
            var track = seq.videoTracks[${trackIndex}];
            if (__isTrackLocked(track)) return __error("Video track ${trackIndex} is locked. Nothing was changed.");
            var startTicks = __sffSnap(${startSeconds}, frameTicks);
            var spanTicks = Math.max(frameTicks, __sffSnap(${durationSeconds}, frameTicks));
            var occupant = __sffOccupant(track, startTicks, startTicks + spanTicks);
            if (occupant) return __error("Video track ${trackIndex} is not empty from " + __ticksToSeconds(startTicks) + "s for ${durationSeconds}s: clip '" + occupant.name + "' is there. create_source_freeze_frame never overwrites; choose an empty range or track. Nothing was changed.", { code: "RANGE_OCCUPIED", occupant: occupant });
            var frame = __sequenceFrameSize(seq);
            placement = { frameTicks: frameTicks, startTicks: startTicks, frameWidth: frame.width, frameHeight: frame.height };
          }
          return __result({ nodeId: String(item.nodeId), itemName: item.name, mediaPath: mediaPath, interpretedFps: interpretedFps, placement: placement });
        `), bridgeOptions) as { success: boolean; error?: string; data?: Record<string, any> };
      if (!preflight.success) return preflight;
      const source = preflight.data ?? {};
      const mediaPath = typeof source.mediaPath === "string" ? source.mediaPath : "";
      if (!mediaPath || !existsSync(mediaPath) || !statSync(mediaPath).isFile()) {
        return { success: false, error: `The source media for ${String(source.itemName)} is not a readable local file (${mediaPath || "no path"}). Nothing was changed.` };
      }
      if (zoom && (fromPosition || toPosition) && !(Number(source.placement?.frameWidth) > 0 && Number(source.placement?.frameHeight) > 0)) {
        return { success: false, error: "The sequence frame size is unreadable, so zoom positions cannot be converted. Nothing was changed." };
      }

      // ---- Step 2: probe and decode the source frame with ffmpeg. ----
      let probe: SourceVideoProbe;
      try { probe = await probeSourceVideo(mediaPath); } catch (error) {
        return { success: false, error: `ffprobe ${failureDetail(error)}. The source frame was not extracted; nothing was changed.` };
      }
      if (!(probe.durationSeconds > 0) || !(probe.frameRate > 0) || !Number.isFinite(probe.frameRate)) {
        return { success: false, error: "ffprobe did not report a positive duration and frame rate for the source video. Nothing was changed." };
      }
      const interpreted = typeof source.interpretedFps === "number" ? source.interpretedFps : null;
      if (interpreted !== null && Math.abs(interpreted - probe.frameRate) > 0.01) {
        return { success: false, error: `The project item is interpreted at ${interpreted} fps but its file plays at ${probe.frameRate.toFixed(3)} fps, so a source time is ambiguous. Reset the footage interpretation or use freeze_frame on a sequence. Nothing was changed.` };
      }
      const fps = interpreted ?? probe.frameRate;
      const frameIndex = Math.floor(sourceTime * fps + 1e-6);
      const frameSeconds = frameIndex / fps;
      if (frameSeconds >= probe.durationSeconds) {
        return { success: false, error: `source_time_seconds ${sourceTime} is at or past the source media end (${probe.durationSeconds}s). Nothing was changed.` };
      }
      // Seek a quarter frame early: ffmpeg drops frames before the seek point, so
      // the previous frame is discarded and this frame survives float rounding.
      const seekSeconds = Math.max(0, frameSeconds - 0.25 / fps);
      try { await extractSourceFrame(mediaPath, seekSeconds, outputPath); } catch (error) {
        return { success: false, error: `ffmpeg ${failureDetail(error)}. Premiere was not changed.`, data: { outputPath, exported: existsSync(outputPath) } };
      }
      if (!existsSync(outputPath) || !statSync(outputPath).isFile() || statSync(outputPath).size < 1) {
        return { success: false, error: "ffmpeg finished without writing a non-empty frame file. Premiere was not changed.", data: { outputPath, exported: false } };
      }
      const extraction = {
        mediaPath,
        requestedSourceSeconds: sourceTime,
        frameIndex,
        frameSeconds: Math.round(frameSeconds * 1e6) / 1e6,
        frameRate: fps,
        variableFrameRate: probe.variableFrameRate,
        method: "ffmpeg_source_decode",
        timingBoundary: "ffmpeg_accurate_seek_first_frame_at_or_after_frame_start",
      };

      // ---- Step 3: import, set length, place and keyframe, reading each back. ----
      const positionScript = (value: Point | undefined) => value ? `[${value[0]}, ${value[1]}]` : "null";
      const script = buildToolScript(`
          ${SHARED_HELPERS}
          var outputPath = "${escapeForExtendScript(outputPath)}";
          var completed = ["exported"];
          var unverified = [];
          var report = { exported: true, path: outputPath, extraction: {
            mediaPath: "${escapeForExtendScript(mediaPath)}",
            requestedSourceSeconds: ${sourceTime},
            frameIndex: ${frameIndex},
            frameSeconds: ${extraction.frameSeconds},
            frameRate: ${fps},
            variableFrameRate: ${probe.variableFrameRate ? "true" : "false"},
            method: "${extraction.method}",
            timingBoundary: "${extraction.timingBoundary}"
          } };
          function __sffDone(extraFailure, data) {
            report.completed = completed;
            report.unverified = unverified;
            if (extraFailure) {
              report.outcome = "committed_unverified";
              report.verified = false;
              report.projectChanged = true;
              return __error(extraFailure, report);
            }
            report.verified = unverified.length === 0;
            report.outcome = report.verified ? "verified" : "committed_unverified";
            return __result(report);
          }

          var root = app.project.rootItem;
          var before = {};
          for (var b = 0; b < __childCount(root); b++) { var existing = __childAt(root, b); if (existing) before[String(existing.nodeId)] = true; }
          try { app.project.importFiles([outputPath], true, root, false); } catch (eImport) {
            return __error("The frame was written to " + outputPath + " but Premiere's import threw: " + eImport.toString() + ". Inspect the project before retrying.", { exported: true, imported: false, path: outputPath, outcome: "failed", mutationAttempted: true });
          }
          var imported = null;
          for (var a = 0; a < __childCount(root); a++) {
            var child = __childAt(root, a);
            if (!child || before[String(child.nodeId)]) continue;
            var childPath = "";
            try { childPath = String(child.getMediaPath()); } catch (ePath) {}
            if (new File(childPath).fsName === new File(outputPath).fsName) { imported = child; break; }
          }
          if (!imported) {
            return __error("The frame was written to " + outputPath + " but Premiere did not import it as a new project item.", { exported: true, imported: false, path: outputPath });
          }
          completed.push("imported");
          report.imported = true;
          report.nodeId = String(imported.nodeId);
          report.itemName = imported.name;

          // Same Out-mark rule as freeze_frame: stills report a frame grid
          // (25 fps on 26.5.2) and floor marks to it, so write a quarter frame late.
          var requestedDuration = ${durationSeconds};
          var stillFps = 0;
          try { stillFps = parseFloat(imported.getFootageInterpretation().frameRate); } catch (eStillRate) {}
          if (!(stillFps >= 1 && stillFps <= 240)) stillFps = 25;
          var stillFrames = Math.max(1, Math.round(requestedDuration * stillFps));
          var appliedDuration = null;
          try {
            imported.setOutPoint((stillFrames + 0.25) / stillFps, 4);
            appliedDuration = Number(imported.getOutPoint(4).seconds) - Number(imported.getInPoint(4).seconds);
          } catch (eStillOut) { appliedDuration = null; }
          var durationVerified = appliedDuration !== null && isFinite(appliedDuration) && Math.abs(appliedDuration - stillFrames / stillFps) < 0.5 / stillFps;
          report.requestedDurationSeconds = requestedDuration;
          report.appliedDurationSeconds = appliedDuration;
          if (durationVerified) completed.push("duration"); else unverified.push("duration");

          if (!${place ? "true" : "false"}) return __sffDone(null);

          var seq = app.project.activeSequence;
          if (!seq) return __sffDone("The still was imported but the active sequence is gone; it was not placed.");
          var frameTicks = __sequenceFrameTicks(seq);
          if (!isFinite(frameTicks)) return __sffDone("The still was imported but the sequence frame grid is unreadable; it was not placed.");
          if (${trackIndex} >= seq.videoTracks.numTracks) return __sffDone("The still was imported but video track ${trackIndex} no longer exists; it was not placed.");
          var track = seq.videoTracks[${trackIndex}];
          if (__isTrackLocked(track)) return __sffDone("The still was imported but video track ${trackIndex} is now locked; it was not placed.");
          var startTicks = __sffSnap(${startSeconds}, frameTicks);
          var spanSeconds = durationVerified ? appliedDuration : requestedDuration;
          var expectedTicks = Math.max(frameTicks, __sffSnap(spanSeconds, frameTicks));
          // Re-check right before the edit: the timeline may have changed since preflight.
          var occupant = __sffOccupant(track, startTicks, startTicks + expectedTicks);
          if (occupant) {
            report.occupant = occupant;
            return __sffDone("The still was imported but video track ${trackIndex} is no longer empty at " + __ticksToSeconds(startTicks) + "s (clip '" + occupant.name + "'); it was not placed. Nothing on the timeline was changed.");
          }
          var placedEdit = __overwriteItemOnRequestedTracks(seq, imported, String(startTicks), ${trackIndex}, 0, true, false);
          if (!placedEdit.ok) {
            report.timelineChanged = placedEdit.attempted ? null : false;
            return __sffDone("The still was imported but placement failed: " + placedEdit.error + (placedEdit.attempted ? " Inspect the timeline before retrying." : ""));
          }
          var clip = null;
          for (var ci = 0; ci < track.clips.numItems; ci++) {
            var candidate = track.clips[ci];
            var candidateId = "";
            try { candidateId = candidate.projectItem ? String(candidate.projectItem.nodeId) : ""; } catch (eCandidate) {}
            if (candidateId !== String(imported.nodeId)) continue;
            if (Math.abs(parseFloat(candidate.start.ticks) - startTicks) <= frameTicks / 2) { clip = candidate; break; }
          }
          if (!clip) {
            report.timelineChanged = null;
            return __sffDone("Premiere accepted the overwrite but the still was not found on video track ${trackIndex} at " + __ticksToSeconds(startTicks) + "s. Inspect the timeline before retrying.");
          }
          var placedTicks = parseFloat(clip.end.ticks) - parseFloat(clip.start.ticks);
          report.placement = {
            trackIndex: ${trackIndex},
            clipNodeId: String(clip.nodeId),
            startSeconds: __ticksToSeconds(parseFloat(clip.start.ticks)),
            endSeconds: __ticksToSeconds(parseFloat(clip.end.ticks)),
            expectedDurationSeconds: __ticksToSeconds(expectedTicks)
          };
          if (Math.abs(placedTicks - expectedTicks) <= frameTicks / 2) completed.push("placement"); else unverified.push("placement");

          if (!${zoom ? "true" : "false"}) return __sffDone(null);

          var keyBase = __clipKeyframeBase(clip);
          if (!keyBase.ok) return __sffDone("The still was placed but zoom keyframes were not added: " + keyBase.error);
          var motion = null;
          for (var mc = 0; mc < clip.components.numItems; mc++) {
            var component = clip.components[mc];
            if (component && (component.matchName === "AE.ADBE Motion" || component.displayName === "Motion")) { motion = component; break; }
          }
          if (!motion) return __sffDone("The still was placed but it has no Motion effect; zoom keyframes were not added.");
          var scaleHeight = null, scaleWidth = null, positionProp = null;
          for (var mp = 0; mp < motion.properties.numItems; mp++) {
            var prop = motion.properties[mp];
            if (__videoIntrinsicPropertyMatches(prop, "Scale") || __videoIntrinsicPropertyMatches(prop, "Scale Height")) scaleHeight = prop;
            else if (__videoIntrinsicPropertyMatches(prop, "Scale Width")) scaleWidth = prop;
            else if (__videoIntrinsicPropertyMatches(prop, "Position")) positionProp = prop;
          }
          var uniform = __isUniformScale(motion);
          if (!scaleHeight || (!uniform && !scaleWidth)) return __sffDone("The still was placed but Motion Scale could not be resolved; zoom keyframes were not added.");
          var fromPosition = ${positionScript(fromPosition)};
          var toPosition = ${positionScript(toPosition)};
          if ((fromPosition || toPosition) && !positionProp) return __sffDone("The still was placed but Motion Position could not be resolved; zoom keyframes were not added.");
          if (toPosition && !fromPosition) {
            try { var current = positionProp.getValue(); fromPosition = [Number(current[0]) * ${Number(source.placement?.frameWidth) || 1}, Number(current[1]) * ${Number(source.placement?.frameHeight) || 1}]; } catch (eCurrent) { fromPosition = null; }
            if (!fromPosition || !isFinite(fromPosition[0]) || !isFinite(fromPosition[1])) return __sffDone("The still was placed but its current Position is unreadable; zoom keyframes were not added.");
          }
          var lastSeconds = Math.max(0, keyBase.durationSeconds - frameTicks / TICKS_PER_SECOND);
          var interp = ${ease === "bezier" ? 5 : "null"};

          function __sffKeyPair(property, first, last, tolerance) {
            var outcome = { ok: false, readBack: [null, null], keyCount: null, error: "" };
            try {
              if (!property.isTimeVarying()) property.setTimeVarying(true);
              var times = [__clipKeyTime(keyBase, 0), __clipKeyTime(keyBase, lastSeconds)];
              var values = [first, last];
              for (var kv = 0; kv < 2; kv++) {
                property.addKey(times[kv]);
                property.setValueAtKey(times[kv], values[kv], true);
                if (interp !== null) property.setInterpolationTypeAtKey(times[kv], interp, true);
              }
              var matches = true;
              for (var kr = 0; kr < 2; kr++) {
                var got = property.getValueAtKey(times[kr]);
                outcome.readBack[kr] = got;
                if (values[kr] instanceof Array) {
                  if (!got || Math.abs(Number(got[0]) - values[kr][0]) > tolerance || Math.abs(Number(got[1]) - values[kr][1]) > tolerance) matches = false;
                } else if (got === null || got === undefined || Math.abs(Number(got) - values[kr]) > tolerance) matches = false;
              }
              var keys = property.getKeys();
              outcome.keyCount = keys && typeof keys.length === "number" ? keys.length : null;
              outcome.ok = matches && outcome.keyCount === 2;
            } catch (eKey) { outcome.error = eKey.toString(); }
            return outcome;
          }

          var zoomReport = { firstKeySeconds: 0, lastKeySeconds: lastSeconds, ease: "${ease}", uniformScale: uniform };
          var zoomOk = true, zoomErrors = [];
          var scaleResult = __sffKeyPair(scaleHeight, ${zoom?.from_scale ?? 100}, ${zoom?.to_scale ?? 100}, 0.01);
          zoomReport.scale = { from: ${zoom?.from_scale ?? 100}, to: ${zoom?.to_scale ?? 100}, readBack: scaleResult.readBack, keyCount: scaleResult.keyCount };
          if (!scaleResult.ok) { zoomOk = false; if (scaleResult.error) zoomErrors.push("Scale: " + scaleResult.error); }
          if (!uniform) {
            var widthResult = __sffKeyPair(scaleWidth, ${zoom?.from_scale ?? 100}, ${zoom?.to_scale ?? 100}, 0.01);
            zoomReport.scaleWidth = { readBack: widthResult.readBack, keyCount: widthResult.keyCount };
            if (!widthResult.ok) { zoomOk = false; if (widthResult.error) zoomErrors.push("Scale Width: " + widthResult.error); }
          }
          if (fromPosition) {
            var frameWidth = ${Number(source.placement?.frameWidth) || 0}, frameHeight = ${Number(source.placement?.frameHeight) || 0};
            var positionResult = __sffKeyPair(positionProp, [fromPosition[0] / frameWidth, fromPosition[1] / frameHeight], [toPosition[0] / frameWidth, toPosition[1] / frameHeight], 0.0001);
            zoomReport.position = { fromPixels: fromPosition, toPixels: toPosition, normalizedReadBack: positionResult.readBack, keyCount: positionResult.keyCount };
            if (!positionResult.ok) { zoomOk = false; if (positionResult.error) zoomErrors.push("Position: " + positionResult.error); }
          }
          report.zoom = zoomReport;
          if (zoomErrors.length) zoomReport.errors = zoomErrors;
          if (zoomOk) completed.push("zoom_keyframes"); else unverified.push("zoom_keyframes");
          if (interp !== null) {
            unverified.push("keyframe_interpolation");
            zoomReport.interpolationNote = "Premiere has no interpolation getter; bezier was written but not read back.";
          }
          report.renderVerified = false;
          report.verificationScope = "Premiere parameter readback only; verify playback or an exported frame before delivery.";
          return __sffDone(null);
        `);
      return sendCommand(script, bridgeOptions);
    },
  };
}
