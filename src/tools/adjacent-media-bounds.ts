import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, type BridgeOptions } from "../bridge/file-bridge.js";
import { probeMediaDurationTicks } from "./media-evidence.js";

interface SourceEntry { nodeId: string; mediaPath: string; position: string; trackType: "video" | "audio"; trackIndex: number; clipIndex: number; }
interface SourceEvidence { projectDocumentId: string; sequenceId: string; linkedNodeIds: string[]; entries: SourceEntry[]; }

// Scoped to adjacent edits: unknown linkage must not silently become primary-only.
const strictLinkedPartners = `
  function adjacentLinkedPartners(target) {
    var linked = target.clip.getLinkedItems();
    if (!linked || typeof linked.numItems !== "number" || !isFinite(linked.numItems) || linked.numItems < 0 || Math.floor(linked.numItems) !== linked.numItems || linked.numItems > 256) throw new Error("Linked membership is unreadable");
    var partners = [], seen = {};
    for (var li = 0; li < linked.numItems; li++) {
      var member = linked[li];
      if (!member || typeof member.nodeId !== "string" || !member.nodeId.length) throw new Error("Linked member identity is unreadable");
      var id = member.nodeId;
      if (id === String(target.clip.nodeId) || seen["$" + id]) continue;
      var found = __findClip(id);
      if (!found) throw new Error("Linked member could not be located");
      seen["$" + id] = true; partners.push(found);
    }
    partners.sort(function(a, b) { var left = String(a.clip.nodeId), right = String(b.clip.nodeId); if (left < right) return -1; if (left > right) return 1; return 0; });
    return partners;
  }
`;

/** Read every edited source before probing, then bind the mutation to that snapshot. */
export async function prepareAdjacentMediaBounds(options: BridgeOptions, nodeId: string, includeLinked: boolean, slide: boolean) {
  const inspection = await sendCommand(buildToolScript(`
    var target = __findClip("${escapeForExtendScript(nodeId)}");
    if (!target) return __error("Clip not found");
    var seq = app.project.activeSequence;
    if (!seq.sequenceID) return __error("Sequence identity cannot be verified; nothing was changed.");
    var documentId = null;
    try { documentId = app.project.documentID; } catch (documentIdentityError) {}
    if ((typeof documentId !== "string" && typeof documentId !== "number") || String(documentId).replace(/\\s/g, "") === "") return __error("Project identity cannot be verified; nothing was changed.");
    ${strictLinkedPartners}
    var targets = [target], linkedNodeIds = [];
    var partners = [];
    ${includeLinked ? 'try { partners = adjacentLinkedPartners(target); } catch (linkedError) { return __error("Linked membership could not be read; nothing was changed. " + String(linkedError)); } for (var pi = 0; pi < partners.length; pi++) { targets.push(partners[pi]); linkedNodeIds.push(String(partners[pi].clip.nodeId)); }' : ''}
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
        if ((speed !== 1 && speed !== 100) || reversed !== false) return __error("Only verified forward, normal-speed clips support this source-bound edit; nothing was changed.");
        var id = String(clip.nodeId);
        if (seen[id]) continue;
        seen[id] = true;
        var path = "";
        try { path = String(clip.projectItem.getMediaPath() || ""); } catch (pathError) {}
        if (!path) return __error("Physical media duration cannot be verified for an edited clip; nothing was changed.");
        if (entries.length >= 256) return __error("Too many linked edit sources to inspect safely; nothing was changed.");
        var placement = __findClip(id);
        if (!placement) return __error("Edited clip placement cannot be verified; nothing was changed.");
        entries.push({ nodeId: id, mediaPath: path, position: __clipPositionKey(id), trackType: placement.trackType, trackIndex: placement.trackIndex, clipIndex: placement.clipIndex });
      }
    }
    return __result({ projectDocumentId: String(documentId), sequenceId: String(seq.sequenceID), linkedNodeIds: linkedNodeIds, entries: entries });
  `), options);
  if (!inspection.success) return { success: false as const, error: inspection.error || "Could not inspect edit sources; nothing was changed." };
  const data = inspection.data as SourceEvidence | undefined;
  if (!data || typeof data.projectDocumentId !== "string" || !data.projectDocumentId.trim() || typeof data.sequenceId !== "string" || !Array.isArray(data.linkedNodeIds) || data.linkedNodeIds.length > 256 || data.linkedNodeIds.some((id) => typeof id !== "string" || !id) || new Set(data.linkedNodeIds).size !== data.linkedNodeIds.length || !Array.isArray(data.entries) || !data.entries.length || data.entries.length > 256 ||
    data.entries.some((entry) => !entry || typeof entry.nodeId !== "string" || typeof entry.mediaPath !== "string" || !entry.mediaPath || typeof entry.position !== "string" || entry.position.includes("?") ||
      (entry.trackType !== "video" && entry.trackType !== "audio") || !Number.isInteger(entry.trackIndex) || entry.trackIndex < 0 || !Number.isInteger(entry.clipIndex) || entry.clipIndex < 0)) {
    return { success: false as const, error: "Physical media evidence was incomplete; nothing was changed." };
  }
  const durationTicks = new Map<string, number>();
  for (const entry of data.entries) {
    if (!durationTicks.has(entry.mediaPath)) {
      const endTicks = await probeMediaDurationTicks(entry.mediaPath);
      if (endTicks === null || !Number.isSafeInteger(endTicks) || endTicks <= 0) return { success: false as const, error: "Physical media duration could not be verified. Install ffprobe and use readable finite media; nothing was changed." };
      durationTicks.set(entry.mediaPath, endTicks);
    }
  }
  const entries = data.entries.map((entry) => `{"nodeId":"${escapeForExtendScript(entry.nodeId)}","mediaPath":"${escapeForExtendScript(entry.mediaPath)}","position":"${escapeForExtendScript(entry.position)}","trackType":"${entry.trackType}","trackIndex":${entry.trackIndex},"clipIndex":${entry.clipIndex},"endTicks":${durationTicks.get(entry.mediaPath)!}}`).join(",");
  return { success: true as const, script: `
    ${strictLinkedPartners}
    var sourceEvidence = [${entries}];
    var currentDocumentId = null;
    try { currentDocumentId = app.project.documentID; } catch (documentIdentityError) {}
    if (currentDocumentId === null || currentDocumentId === undefined || String(currentDocumentId) !== "${escapeForExtendScript(data.projectDocumentId)}") return __error("Active project changed or its identity cannot be verified during media inspection; nothing was changed.");
    if (String(app.project.activeSequence.sequenceID) !== "${escapeForExtendScript(data.sequenceId)}") return __error("Active sequence changed during media inspection; nothing was changed.");
    var validatedPartners = [];
    ${includeLinked ? `var currentTarget = __findClip("${escapeForExtendScript(nodeId)}");
    if (!currentTarget) return __error("Edit target disappeared; nothing was changed.");
    try { validatedPartners = adjacentLinkedPartners(currentTarget); } catch (linkedError) { return __error("Linked membership could not be read; nothing was changed. " + String(linkedError)); }
    var expectedLinkedIds = [${data.linkedNodeIds.map((id) => '"' + escapeForExtendScript(id) + '"').join(",")}];
    if (validatedPartners.length !== expectedLinkedIds.length) return __error("Linked membership changed during media inspection; nothing was changed.");
    for (var pi = 0; pi < validatedPartners.length; pi++) if (String(validatedPartners[pi].clip.nodeId) !== expectedLinkedIds[pi]) return __error("Linked membership changed during media inspection; nothing was changed.");` : ''}
    var sourceEnds = {};
    for (var ei = 0; ei < sourceEvidence.length; ei++) {
      var evidence = sourceEvidence[ei], inspected = __findClip(evidence.nodeId);
      if (!inspected || __clipPositionKey(evidence.nodeId) !== evidence.position) return __error("Clip placement or source window changed during media inspection; nothing was changed.");
      if (inspected.trackType !== evidence.trackType || inspected.trackIndex !== evidence.trackIndex || inspected.clipIndex !== evidence.clipIndex) return __error("Clip track or collection position changed during media inspection; nothing was changed.");
      var currentPath = "";
      try { currentPath = String(inspected.clip.projectItem.getMediaPath() || ""); } catch (pathError) {}
      if (currentPath !== evidence.mediaPath) return __error("Media source changed during duration inspection; nothing was changed.");
      var speed = null, reversed = null;
      try { speed = Number(inspected.clip.getSpeed()); reversed = inspected.clip.isSpeedReversed(); } catch (speedError) {}
      if ((speed !== 1 && speed !== 100) || reversed !== false) return __error("Clip speed changed or cannot be verified; nothing was changed.");
      sourceEnds[evidence.nodeId] = evidence.endTicks;
      var existingIn = parseFloat(inspected.clip.inPoint.ticks), existingOut = parseFloat(inspected.clip.outPoint.ticks);
      if (!isFinite(existingIn) || !isFinite(existingOut) || existingIn < 0 || existingOut <= existingIn || existingOut > evidence.endTicks) return __error("An existing source window is outside its physical media duration. Nothing was changed.");
      var recordDuration = parseFloat(inspected.clip.end.ticks) - parseFloat(inspected.clip.start.ticks);
      if (!isFinite(recordDuration) || recordDuration <= 0 || Math.abs(recordDuration - (existingOut - existingIn)) > 1) return __error("An existing normal-speed clip has inconsistent timeline/source duration. Nothing was changed.");
    }
  ` };
}
