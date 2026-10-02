import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, type BridgeOptions } from "../bridge/file-bridge.js";
import { probeMediaDurationSeconds } from "./media-evidence.js";

interface SourceEntry { nodeId: string; mediaPath: string; position: string; }
interface SourceEvidence { sequenceId: string; entries: SourceEntry[]; }

/** Read every edited source before probing, then bind the mutation to that snapshot. */
export async function prepareAdjacentMediaBounds(options: BridgeOptions, nodeId: string, includeLinked: boolean, slide: boolean) {
  const inspection = await sendCommand(buildToolScript(`
    var target = __findClip("${escapeForExtendScript(nodeId)}");
    if (!target) return __error("Clip not found");
    var seq = app.project.activeSequence;
    if (!seq.sequenceID) return __error("Sequence identity cannot be verified; nothing was changed.");
    var targets = [target];
    ${includeLinked ? 'var partners = __linkedPartnerClips(target); for (var pi = 0; pi < partners.length; pi++) targets.push(partners[pi]);' : ''}
    var entries = [], seen = {};
    for (var ti = 0; ti < targets.length; ti++) {
      var current = targets[ti];
      var track = current.trackType === "video" ? seq.videoTracks[current.trackIndex] : seq.audioTracks[current.trackIndex];
      var clips = [current.clip, track.clips[current.clipIndex + 1]];
      ${slide ? 'clips.push(track.clips[current.clipIndex - 1]);' : ''}
      for (var ci = 0; ci < clips.length; ci++) {
        var clip = clips[ci];
        if (!clip) return __error("Required adjacent clip is missing; nothing was changed.");
        var speed = null, reversed = null;
        try { speed = Number(clip.getSpeed()); reversed = clip.isSpeedReversed(); } catch (speedError) {}
        if (speed !== 1 || reversed !== false) return __error("Only verified forward, normal-speed clips support this source-bound edit; nothing was changed.");
        var id = String(clip.nodeId);
        if (seen[id]) continue;
        seen[id] = true;
        var path = "";
        try { path = String(clip.projectItem.getMediaPath() || ""); } catch (pathError) {}
        if (!path) return __error("Physical media duration cannot be verified for an edited clip; nothing was changed.");
        if (entries.length >= 256) return __error("Too many linked edit sources to inspect safely; nothing was changed.");
        entries.push({ nodeId: id, mediaPath: path, position: __clipPositionKey(id) });
      }
    }
    return __result({ sequenceId: String(seq.sequenceID), entries: entries });
  `), options);
  if (!inspection.success) return { success: false as const, error: inspection.error || "Could not inspect edit sources; nothing was changed." };
  const data = inspection.data as SourceEvidence | undefined;
  if (!data || typeof data.sequenceId !== "string" || !Array.isArray(data.entries) || !data.entries.length || data.entries.length > 256 ||
    data.entries.some((entry) => !entry || typeof entry.nodeId !== "string" || typeof entry.mediaPath !== "string" || !entry.mediaPath || typeof entry.position !== "string" || entry.position.includes("?"))) {
    return { success: false as const, error: "Physical media evidence was incomplete; nothing was changed." };
  }
  const durations = new Map<string, number>();
  for (const entry of data.entries) {
    if (!durations.has(entry.mediaPath)) {
      const duration = await probeMediaDurationSeconds(entry.mediaPath);
      if (duration === null || !Number.isFinite(duration) || duration <= 0) return { success: false as const, error: "Physical media duration could not be verified. Install ffprobe and use readable finite media; nothing was changed." };
      durations.set(entry.mediaPath, duration);
    }
  }
  const entries = data.entries.map((entry) => `{"nodeId":"${escapeForExtendScript(entry.nodeId)}","mediaPath":"${escapeForExtendScript(entry.mediaPath)}","position":"${escapeForExtendScript(entry.position)}","endTicks":${Math.round(durations.get(entry.mediaPath)! * 254016000000)}}`).join(",");
  return { success: true as const, script: `
    var sourceEvidence = [${entries}];
    if (String(app.project.activeSequence.sequenceID) !== "${escapeForExtendScript(data.sequenceId)}") return __error("Active sequence changed during media inspection; nothing was changed.");
    var sourceEnds = {};
    for (var ei = 0; ei < sourceEvidence.length; ei++) {
      var evidence = sourceEvidence[ei], inspected = __findClip(evidence.nodeId);
      if (!inspected || __clipPositionKey(evidence.nodeId) !== evidence.position) return __error("Clip placement or source window changed during media inspection; nothing was changed.");
      var currentPath = "";
      try { currentPath = String(inspected.clip.projectItem.getMediaPath() || ""); } catch (pathError) {}
      if (currentPath !== evidence.mediaPath) return __error("Media source changed during duration inspection; nothing was changed.");
      var speed = null, reversed = null;
      try { speed = Number(inspected.clip.getSpeed()); reversed = inspected.clip.isSpeedReversed(); } catch (speedError) {}
      if (speed !== 1 || reversed !== false) return __error("Clip speed changed or cannot be verified; nothing was changed.");
      sourceEnds[evidence.nodeId] = evidence.endTicks;
      var existingIn = parseFloat(inspected.clip.inPoint.ticks), existingOut = parseFloat(inspected.clip.outPoint.ticks);
      if (!isFinite(existingIn) || !isFinite(existingOut) || existingIn < 0 || existingOut <= existingIn || existingOut > evidence.endTicks + 1) return __error("An existing source window is outside its physical media duration. Nothing was changed.");
      var recordDuration = parseFloat(inspected.clip.end.ticks) - parseFloat(inspected.clip.start.ticks);
      if (!isFinite(recordDuration) || recordDuration <= 0 || Math.abs(recordDuration - (existingOut - existingIn)) > 1) return __error("An existing normal-speed clip has inconsistent timeline/source duration. Nothing was changed.");
    }
  ` };
}
