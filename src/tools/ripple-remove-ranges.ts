import { createHash, randomBytes } from "node:crypto";
import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { BridgeOptions, sendCommand } from "../bridge/file-bridge.js";
import { CapabilityConfig, requireCapability, resolveCapabilities } from "../security/capabilities.js";

export interface TimelineRange { start: number; end: number }
export interface RangeClip { nodeId: string; start: number; end: number }
export interface PlannedClip extends RangeClip { removed: boolean; shift: number }

// QE structural calls can exhaust Premiere's native ExtendScript stack before
// JavaScript's try/catch receives control. Keep each evalScript below this
// small bound; the next bridge command starts with a fresh native invocation.
export const RIPPLE_RAZORS_PER_COMMAND = 8;

/** Shared by preview and apply: one ordered sweep over ranges per clip. */
export function planRangeClip(clip: RangeClip, ranges: TimelineRange[], tolerance: number): PlannedClip {
  let shift = 0;
  let removed = false;
  let coveredUntil = clip.start;
  for (const range of ranges) {
    if (range.start <= coveredUntil + tolerance && range.end > coveredUntil) {
      coveredUntil = range.end;
      if (coveredUntil >= clip.end - tolerance) { removed = true; break; }
    } else if (clip.end > range.start + tolerance && clip.start < range.end - tolerance) {
      throw new Error(`Clip ${clip.nodeId} partially overlaps a removal range; razor boundaries first`);
    }
    if (range.end <= clip.start + tolerance) shift += range.end - range.start;
  }
  return { ...clip, removed, shift };
}

interface Args {
  sequence_id?: string;
  ranges: TimelineRange[];
  scope: "sync_locked";
  range_content: "delete";
  dry_run?: boolean;
  allow_large_ripple?: boolean;
  confirmation_token?: string;
}

function validate(args: Args): string | null {
  if (args.scope !== "sync_locked") return "scope must be sync_locked";
  if (args.range_content !== "delete") return "range_content must be delete";
  if (!Array.isArray(args.ranges) || args.ranges.length < 1 || args.ranges.length > 50) return "ranges must contain 1 to 50 intervals";
  let previousEnd = -Infinity;
  for (let i = 0; i < args.ranges.length; i++) {
    const r = args.ranges[i];
    if (!r || !Number.isFinite(r.start) || !Number.isFinite(r.end) || r.start < 0 || r.end <= r.start) return `ranges[${i}] must have finite non-negative start and end > start`;
    if (r.start < previousEnd) return "ranges must be sorted and non-overlapping";
    previousEnd = r.end;
  }
  return null;
}

const pending = new Map<string, { digest: string; fingerprint: string; expires: number }>();
function digest(args: Args) { return createHash("sha256").update(JSON.stringify({ sequence_id: args.sequence_id, ranges: args.ranges, scope: args.scope, range_content: args.range_content, allow_large_ripple: args.allow_large_ripple === true })).digest("hex"); }
function issue(args: Args, fingerprint: string): string {
  for (const [key, value] of pending) if (value.expires < Date.now()) pending.delete(key);
  const token = randomBytes(24).toString("hex");
  pending.set(token, { digest: digest(args), fingerprint, expires: Date.now() + 30 * 60 * 1000 });
  return token;
}
function consume(token: string | undefined, args: Args): string | null {
  if (!token) return null;
  const record = pending.get(token);
  pending.delete(token);
  return record && record.expires >= Date.now() && record.digest === digest(args) ? record.fingerprint : null;
}

/** Single generated-script helper owns preflight, razors, moves, and readback. */
export function rippleRemoveRangesScript(args: Args, mutate: boolean, expectedFingerprint?: string, phase: "all" | "razor" | "finish" = "all", operationId = "", maxRazors = RIPPLE_RAZORS_PER_COMMAND): string {
  const ranges = args.ranges.map((r) => `({ start: Math.round(__secondsToTicks(${r.start})), end: Math.round(__secondsToTicks(${r.end})) })`).join(",");
  const sequence = args.sequence_id ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");` : "var seq = app.project.activeSequence;";
  return buildToolScript(`
    ${sequence}
    if (!seq) return __error("No active sequence");
    // QE only reaches the active sequence. With another sequence active, the
    // sync-lock preflight read and the razors would hit that sequence instead.
    var activeForQE = app.project.activeSequence;
    if (!activeForQE || String(activeForQE.sequenceID) !== String(seq.sequenceID)) return __error("Ripple range removal edits through QE, which only reaches the active sequence. Make " + seq.name + " the active sequence (set_active_sequence) and preview again; nothing changed.", { mutationOutcome:"not_applied", timelineChanged:false, mutationAttempted:false, verified:false });
    app.enableQE();
    var qeSeq = qe.project.getActiveSequence();
    if (!qeSeq) return __error("Cannot read QE sequence or sync-lock state; nothing changed");
    var ft = parseFloat(seq.timebase);
    if (!ft || !isFinite(ft)) return __error("Sequence frame timebase is unreadable; nothing changed");
    var tol = ft / 2;
    var ranges = [${ranges}], adjustments = [];
    for (var nri = 0; nri < ranges.length; nri++) {
      var oldStart = ranges[nri].start, oldEnd = ranges[nri].end;
      ranges[nri].start = Math.round(oldStart / ft) * ft; ranges[nri].end = Math.round(oldEnd / ft) * ft;
      if (ranges[nri].end <= ranges[nri].start) return __error("A frame-snapped range is empty or reversed; nothing changed");
      if (nri && ranges[nri].start < ranges[nri-1].end) return __error("Frame-snapped ranges overlap; nothing changed");
      if (Math.abs(oldStart-ranges[nri].start) > ft / 1000 || Math.abs(oldEnd-ranges[nri].end) > ft / 1000) adjustments.push({ rangeIndex:nri, requestedStartSeconds:__ticksToSeconds(oldStart), requestedEndSeconds:__ticksToSeconds(oldEnd), startSeconds:__ticksToSeconds(ranges[nri].start), endSeconds:__ticksToSeconds(ranges[nri].end) });
    }
    var tracks = [];
    function addTracks(type, collection) {
      for (var ti = 0; ti < collection.numTracks; ti++) {
        var dt = collection[ti], qt = type === "video" ? qeSeq.getVideoTrackAt(ti) : qeSeq.getAudioTrackAt(ti);
        tracks.push({ type: type, index: ti, dom: dt, qe: qt });
      }
      return null;
    }
    var trackError = addTracks("video", seq.videoTracks) || addTracks("audio", seq.audioTracks);
    if (trackError) return __error("Ripple range removal refused; nothing changed. " + trackError);
    var transitionScopes = [];
    for (var tsi = 0; tsi < tracks.length; tsi++) transitionScopes.push({ type: tracks[tsi].type, index: tracks[tsi].index, start: ranges[0].start, end: Number.MAX_VALUE });
    var transitionFailure = __transitionEditGuard(seq, transitionScopes);
    if (transitionFailure) return transitionFailure;
    var clips = [], seen = {};
    for (var tr = 0; tr < tracks.length; tr++) {
      var t = tracks[tr];
      for (var ci = 0; ci < t.dom.clips.numItems; ci++) {
        var c = t.dom.clips[ci], id = String(c.nodeId);
        if (seen[id]) continue; seen[id] = true;
        clips.push({ id: id, type: t.type, track: t.index, start: parseFloat(c.start.ticks), end: parseFloat(c.end.ticks), name: String(c.name), obj: c });
      }
    }
    var fingerprintText = String(seq.sequenceID || "")+"|";
    for (var fi = 0; fi < clips.length; fi++) fingerprintText += clips[fi].id+":"+clips[fi].type+":"+clips[fi].track+":"+clips[fi].start+":"+clips[fi].end+";";
    var cuts = [], plan = [], errors = [];
    for (var ri = 0; ri < ranges.length; ri++) {
      cuts.push(ranges[ri].start, ranges[ri].end);
    }
    for (var ci2 = 0; ci2 < clips.length; ci2++) {
      var clip = clips[ci2], boundaries = [clip.start, clip.end];
      for (var ri2 = 0; ri2 < ranges.length; ri2++) {
        if (ranges[ri2].start > clip.start + tol && ranges[ri2].start < clip.end - tol) boundaries.push(ranges[ri2].start);
        if (ranges[ri2].end > clip.start + tol && ranges[ri2].end < clip.end - tol) boundaries.push(ranges[ri2].end);
      }
      boundaries.sort(function(a,b){return a-b;});
      for (var bi = 0; bi + 1 < boundaries.length; bi++) {
        var segStart = boundaries[bi], segEnd = boundaries[bi+1], removed = false, delta = 0;
        if (segEnd <= segStart + tol) continue;
        for (ri2 = 0; ri2 < ranges.length; ri2++) {
          var rg = ranges[ri2];
          if (segStart >= rg.start - tol && segEnd <= rg.end + tol) { removed = true; break; }
          if (rg.end <= segStart + tol) delta += rg.end - rg.start;
        }
        plan.push({ id: clip.id, segmentIndex:bi, type: clip.type, track: clip.track, start: segStart, end: segEnd, removed: removed, shift: delta, name: clip.name });
      }
    }
    // Bind confirmation to the complete plan without returning it to the caller.
    fingerprintText += "|plan:";
    for (ci2 = 0; ci2 < plan.length; ci2++) fingerprintText += plan[ci2].id+":"+plan[ci2].segmentIndex+":"+plan[ci2].type+":"+plan[ci2].track+":"+plan[ci2].start+":"+plan[ci2].end+":"+plan[ci2].removed+":"+plan[ci2].shift+";";
    var fingerprint = 2166136261;
    for (fi = 0; fi < fingerprintText.length; fi++) fingerprint = (fingerprint ^ fingerprintText.charCodeAt(fi)) * 16777619;
    fingerprint = String(fingerprint >>> 0);
    if (${mutate} && "${phase}" !== "finish" && "${escapeForExtendScript(expectedFingerprint ?? "")}" && fingerprint !== "${escapeForExtendScript(expectedFingerprint ?? "")}") return __error("Timeline changed since preview; no edit was applied. Preview the ranges again.", { mutationOutcome:"not_applied", timelineChanged:false });
    var participating = {};
    for (ci2 = 0; ci2 < plan.length; ci2++) if (plan[ci2].removed || plan[ci2].shift > 0) participating[plan[ci2].type+":"+plan[ci2].track] = true;
    for (ci2 = 0; ci2 < clips.length; ci2++) for (ri2 = 0; ri2 < ranges.length; ri2++) if (clips[ci2].start < ranges[ri2].end-tol && clips[ci2].end > ranges[ri2].start+tol) participating[clips[ci2].type+":"+clips[ci2].track] = true;
    for (tr = 0; tr < tracks.length; tr++) if (participating[tracks[tr].type+":"+tracks[tr].index]) {
      var lockState = null, syncState = null;
      try { lockState = typeof tracks[tr].dom.isLocked === "function" ? !!tracks[tr].dom.isLocked() : null; } catch (le) {}
      if (lockState === null) try { lockState = typeof tracks[tr].qe.isLocked === "function" ? !!tracks[tr].qe.isLocked() : null; } catch (lqe) {}
      try { syncState = typeof tracks[tr].qe.isSyncLocked === "function" ? !!tracks[tr].qe.isSyncLocked() : null; } catch (se) {}
      if (lockState !== false || syncState !== true) return __error("Ripple range removal refused; nothing changed. Participating "+tracks[tr].type+" track "+tracks[tr].index+" must be readable, unlocked, and sync-locked.");
    }
    // Deduplicate cut points and precompute spanning tracks from the initial snapshot.
    var uniqueCuts = [];
    for (var qi = 0; qi < cuts.length; qi++) { var foundCut = false; for (var qj = 0; qj < uniqueCuts.length; qj++) if (Math.abs(cuts[qi]-uniqueCuts[qj]) < tol) foundCut = true; if (!foundCut) uniqueCuts.push(cuts[qi]); }
    uniqueCuts.sort(function(a,b){return a-b;});
    var spanStarts = [], spanEnds = [];
    for (ci2 = 0; ci2 < clips.length; ci2++) {
      var spanKey = clips[ci2].type+":"+clips[ci2].track;
      spanStarts.push({ at: clips[ci2].start + tol, key: spanKey });
      spanEnds.push({ at: clips[ci2].end - tol, key: spanKey });
    }
    spanStarts.sort(function(a,b){return a.at-b.at;}); spanEnds.sort(function(a,b){return a.at-b.at;});
    var spanningByCut = [], spanCounts = {}, startCursor = 0, endCursor = 0;
    for (qi = 0; qi < uniqueCuts.length; qi++) {
      var sweepCut = uniqueCuts[qi];
      while (startCursor < spanStarts.length && spanStarts[startCursor].at < sweepCut) { var startKey = spanStarts[startCursor++].key; spanCounts[startKey] = (spanCounts[startKey] || 0) + 1; }
      while (endCursor < spanEnds.length && spanEnds[endCursor].at <= sweepCut) { var endKey = spanEnds[endCursor++].key; spanCounts[endKey] = (spanCounts[endKey] || 0) - 1; }
      spanningByCut[qi] = {};
      for (tr = 0; tr < tracks.length; tr++) { spanKey = tracks[tr].type+":"+tracks[tr].index; if (spanCounts[spanKey] > 0) spanningByCut[qi][spanKey] = true; }
    }
    var summary = { transitionsAffected: [], ranges: [], plannedClips: [], plannedClipsTruncated: false, plannedClipsTotal: plan.length, trackCounts: {}, clipsRemoved: 0, clipsShifted: 0, estimatedSeconds: 0, verified: false };
    for (ri = 0; ri < ranges.length; ri++) summary.ranges.push({ startSeconds: __ticksToSeconds(ranges[ri].start), endSeconds: __ticksToSeconds(ranges[ri].end), removedSeconds: __ticksToSeconds(ranges[ri].end-ranges[ri].start) });
    for (ci2 = 0; ci2 < plan.length; ci2++) {
      if (plan[ci2].removed) summary.clipsRemoved++; else if (plan[ci2].shift > 0) summary.clipsShifted++;
      var countKey = plan[ci2].type+":"+plan[ci2].track;
      if (!summary.trackCounts[countKey]) summary.trackCounts[countKey] = { removed: 0, shifted: 0, unchanged: 0 };
      if (plan[ci2].removed) summary.trackCounts[countKey].removed++;
      else if (plan[ci2].shift > 0) summary.trackCounts[countKey].shifted++;
      else summary.trackCounts[countKey].unchanged++;
      if (summary.plannedClips.length < 50) summary.plannedClips.push({ nodeId:plan[ci2].id, segmentIndex:plan[ci2].segmentIndex, trackType:plan[ci2].type, trackIndex:plan[ci2].track, startSeconds:__ticksToSeconds(plan[ci2].start), endSeconds:__ticksToSeconds(plan[ci2].end), remove:plan[ci2].removed, shiftSeconds:__ticksToSeconds(plan[ci2].shift) });
    }
    summary.plannedClipsTruncated = summary.plannedClipsTotal > summary.plannedClips.length;
    var totalRemovedTicks = 0; for (ri = 0; ri < ranges.length; ri++) totalRemovedTicks += ranges[ri].end-ranges[ri].start;
    summary.totalRemovedSeconds = __ticksToSeconds(totalRemovedTicks);
    summary.estimatedSeconds = Math.ceil(summary.clipsShifted * 0.15 + (summary.clipsRemoved + 1) * 0.5);
    summary.dryRun = ${!mutate};
    summary.adjustments = adjustments;
    summary.timelineFingerprint = fingerprint;
    if (${mutate} && "${phase}" !== "finish" && summary.clipsShifted > 400 && ${args.allow_large_ripple !== true}) return __error("Large ripple refused before mutation: "+summary.clipsShifted+" clips would move (estimated "+summary.estimatedSeconds+" seconds). Pass allow_large_ripple: true to proceed.", { movers:summary.clipsShifted, estimatedSeconds:summary.estimatedSeconds, mutationOutcome:"not_applied", timelineChanged:false });
    if (!${mutate}) return __result(summary);
    // Each command repeats preflight; bounded razor commands then recapture IDs
    // in the final command because Premiere replaces TrackItems at each split.
    var undoBefore = __readUndoIndex();
    // Live 26.5.2: pieces that move after the per-track razors come back unlinked
    // from their audio/video partners. Record each clip's link group (its sorted
    // linked node IDs) by track span so the moved pieces can be relinked.
    // The preflight snapshot already holds each clip, so this needs no extra DOM reads.
    var __rippleStore = $.global.__premiereMcpRippleOperations;
    if (!__rippleStore) { __rippleStore = {}; $.global.__premiereMcpRippleOperations = __rippleStore; }
    var __rippleOperation = __rippleStore["${escapeForExtendScript(operationId)}"];
    var origins = [];
    if (("${phase}" === "finish" || "${phase}" === "razor") && __rippleOperation) {
      origins = __rippleOperation.origins || [];
    } else {
      for (ci2 = 0; ci2 < clips.length; ci2++) {
        if (!participating[clips[ci2].type+":"+clips[ci2].track]) continue;
        var linkedIds = [], linked = null, snapshotClip = clips[ci2].obj;
        try { linked = snapshotClip && typeof snapshotClip.getLinkedItems === "function" ? snapshotClip.getLinkedItems() : null; } catch (linkReadErr) { linked = null; }
        if (linked && linked.numItems > 1) {
          for (var li = 0; li < linked.numItems; li++) linkedIds.push(String(linked[li].nodeId));
          linkedIds.sort();
          origins.push({ type:clips[ci2].type, track:clips[ci2].track, start:clips[ci2].start, end:clips[ci2].end, group:linkedIds.join(",") });
        }
      }
      if ("${phase}" === "razor") {
        __rippleOperation = { origins: origins, razorCutIndex: 0, razorTrackIndex: 0 };
        __rippleStore["${escapeForExtendScript(operationId)}"] = __rippleOperation;
      }
    }
    if ("${phase}" === "finish" && !__rippleOperation) return __error("Ripple range removal recovery state is unavailable after razoring; inspect the timeline before retrying.", { mutationOutcome:"unknown", timelineChanged:true, mutationAttempted:true, verified:false });
    if (!__rippleOperation) __rippleOperation = { razorCutIndex: 0, razorTrackIndex: 0 };
    var razorCalls = 0;
    // Resume from the precise cut/track boundary saved by the prior bridge
    // command. A cut can touch several tracks, so a cut index alone is not
    // sufficient to keep each command under the QE-call bound.
    var razorCutIndex = __rippleOperation ? (__rippleOperation.razorCutIndex || 0) : 0;
    var razorTrackIndex = __rippleOperation ? (__rippleOperation.razorTrackIndex || 0) : 0;
    if ("${phase}" !== "finish") for (qi = razorCutIndex; qi < uniqueCuts.length; qi++) {
      var cut = uniqueCuts[qi], tc = __qeTimecodeForTicks(seq, cut).timecode;
      for (tr = qi === razorCutIndex ? razorTrackIndex : 0; tr < tracks.length; tr++) {
        t = tracks[tr];
        if (!participating[t.type+":"+t.index]) continue;
        if (!spanningByCut[qi][t.type+":"+t.index]) continue;
        try { t.qe.razor(tc); } catch (razorErr) { return __error("Razor failed after mutation began; timeline state is unknown. Inspect before retrying: "+razorErr.toString(), { mutationOutcome:"unknown", timelineChanged:null, mutationAttempted:true, verified:false }); }
        razorCalls++;
        __rippleOperation.razorCutIndex = qi;
        __rippleOperation.razorTrackIndex = tr + 1;
        if ("${phase}" === "razor" && razorCalls >= ${Math.max(1, Math.floor(maxRazors))}) {
          var undoDuringRazors = __readUndoIndex();
          return __result({ complete:false, razorCalls:razorCalls, undoSteps:undoBefore !== null && undoDuringRazors !== null && undoDuringRazors > undoBefore ? undoDuringRazors - undoBefore : 0 });
        }
      }
      __rippleOperation.razorCutIndex = qi + 1;
      __rippleOperation.razorTrackIndex = 0;
    }
    if ("${phase}" === "razor") {
      var undoAfterRazors = __readUndoIndex();
      return __result({ complete:true, razorCalls:razorCalls, undoSteps:undoBefore !== null && undoAfterRazors !== null && undoAfterRazors > undoBefore ? undoAfterRazors - undoBefore : 0 });
    }
    // Re-read live clips after splits, then classify against snapped intervals.
    var live = [];
    for (tr=0; tr<tracks.length; tr++) { t=tracks[tr]; for (ci=0;ci<t.dom.clips.numItems;ci++) { c=t.dom.clips[ci]; live.push({clip:c, id:String(c.nodeId), type:t.type, track:t.index, start:parseFloat(c.start.ticks), end:parseFloat(c.end.ticks)}); } }
    var remove = [], move = [], linkPieces = {};
    for (ci2=0;ci2<live.length;ci2++) {
      var lc=live[ci2], inRange=false, shift=0, overlap=false;
      for (ri=0;ri<ranges.length;ri++) { rg=ranges[ri]; if(lc.start>=rg.start-tol && lc.end<=rg.end+tol){inRange=true;break;} if(lc.start<rg.end-tol && lc.end>rg.start+tol) overlap=true; if(rg.end<=lc.start+tol) shift+=rg.end-rg.start; }
      if(overlap && !inRange) return __error("A clip still straddles a snapped range edge after razoring; nothing removed, timeline may contain new cuts. Inspect before retrying.",{mutationOutcome:"unknown",timelineChanged:true,mutationAttempted:true,verified:false});
      if(inRange) remove.push(lc); else if(shift>0) move.push({clip:lc.clip,id:lc.id,type:lc.type,track:lc.track,start:lc.start,end:lc.end,shift:shift});
      if(!inRange){
        // A kept piece belongs with the pieces cut from its linked partners over the same span.
        for (var oi=0; oi<origins.length; oi++) { var origin=origins[oi]; if(origin.type===lc.type && origin.track===lc.track && lc.start>=origin.start-tol && lc.end<=origin.end+tol){ var pieceKey=origin.group+"@"+Math.round(lc.start)+"-"+Math.round(lc.end); if(!linkPieces[pieceKey]) linkPieces[pieceKey]=[]; linkPieces[pieceKey].push(lc.id); break; } }
      }
    }
    for (ci2=0;ci2<remove.length;ci2++) { try { remove[ci2].clip.remove(false,false); } catch(delErr) { return __error("Removal failed after mutation began; inspect timeline before retrying: "+delErr.toString(),{mutationOutcome:"unknown",timelineChanged:true,mutationAttempted:true,verified:false}); } }
    move.sort(function(a,b){return a.start-b.start;});
    for (ci2=0;ci2<move.length;ci2++) { try { var delta = new Time(); delta.ticks = String(-move[ci2].shift); move[ci2].clip.move(delta); } catch(moveErr) { return __error("Move failed after mutation began; inspect timeline before retrying: "+moveErr.toString(),{mutationOutcome:"unknown",timelineChanged:true,mutationAttempted:true,verified:false}); } }
    // Build identity map once and verify once; never rescan all clips per mover.
    var byId={};
    for(tr=0;tr<tracks.length;tr++){t=tracks[tr];for(ci=0;ci<t.dom.clips.numItems;ci++){c=t.dom.clips[ci];byId[String(c.nodeId)]={clip:c,type:t.type,track:t.index};}}
    var verify=[];
    for(ci2=0;ci2<move.length;ci2++){var wanted=move[ci2], got=byId[wanted.id];if(!got)verify.push(wanted.id+" missing");else { var actualStart=parseFloat(got.clip.start.ticks), actualEnd=parseFloat(got.clip.end.ticks); if(Math.abs(actualStart-(wanted.start-wanted.shift))>tol)verify.push(wanted.id+" unexpected start"); if(Math.abs((actualEnd-actualStart)-(wanted.end-wanted.start))>tol)verify.push(wanted.id+" duration changed"); }}
    for(ci2=0;ci2<remove.length;ci2++)if(byId[remove[ci2].id])verify.push(remove[ci2].id+" was not removed");
    if(verify.length)return __error("Ripple ranges were applied, but readback could not verify every clip: "+verify.join(", "),{outcome:"committed_unverified",mutationOutcome:"unknown",timelineChanged:true,mutationAttempted:true,verified:false});
    // Relink pieces of one original link group that share a span, then read links back.
    var relinked=0, linkFailures=[];
    var linkedTo = function (clipObj, ids) {
      var items=null; try { items=clipObj.getLinkedItems(); } catch (linkedErr) { return false; }
      if(!items || items.numItems!==ids.length) return false;
      for (var lk=0; lk<items.numItems; lk++){ var found=false; for (var lj=0; lj<ids.length; lj++) if(String(items[lk].nodeId)===ids[lj]) found=true; if(!found) return false; }
      return true;
    };
    var deselectAll = function () {
      var groupsAll = [seq.videoTracks, seq.audioTracks];
      for (var ga = 0; ga < groupsAll.length; ga++) for (var gt = 0; gt < groupsAll[ga].numTracks; gt++) for (var gc = 0; gc < groupsAll[ga][gt].clips.numItems; gc++) { try { groupsAll[ga][gt].clips[gc].setSelected(false, true); } catch (deselectErr) {} }
    };
    for (var pk in linkPieces) {
      if(!linkPieces.hasOwnProperty(pk)) continue;
      var ids=linkPieces[pk]; if(ids.length<2) continue;
      var members=[], already=true;
      for (var mi=0; mi<ids.length; mi++){ var entry=byId[ids[mi]]; if(!entry){ already=false; members=null; break; } members.push(entry.clip); if(!linkedTo(entry.clip, ids)) already=false; }
      if(!members){ linkFailures.push(ids.join("+")+" missing"); continue; }
      if(already) continue;
      try {
        // linkSelection links every selected clip, so clear the whole sequence first.
        deselectAll();
        for (mi=0; mi<members.length; mi++) members[mi].setSelected(true, true);
        seq.linkSelection();
        for (mi=0; mi<members.length; mi++) members[mi].setSelected(false, true);
      } catch (linkErr) { linkFailures.push(ids.join("+")+": "+linkErr.toString()); continue; }
      var linkedNow=true; for (mi=0; mi<members.length; mi++) if(!linkedTo(members[mi], ids)) linkedNow=false;
      if(linkedNow) relinked++; else linkFailures.push(ids.join("+")+" did not read back linked");
    }
    summary.relinkedGroups=relinked;
    if(linkFailures.length) return __error("Ripple ranges were applied and verified, but some moved audio/video pieces could not be relinked: "+linkFailures.join("; ")+". Select each pair and link it in Premiere.",{outcome:"committed_unverified",mutationOutcome:"committed_unverified",timelineChanged:true,mutationAttempted:true,verified:false,clipsRemoved:remove.length,clipsShifted:move.length,relinkedGroups:relinked});
    summary.dryRun=false; summary.verified=true; summary.clipsRemoved=remove.length; summary.clipsShifted=move.length;
    var undoAfter = __readUndoIndex();
    if (undoBefore !== null && undoAfter !== null && undoAfter > undoBefore) { summary.undoSteps = undoAfter - undoBefore; summary.undoStackIndex = undoAfter; }
    if ("${phase}" === "finish") delete __rippleStore["${escapeForExtendScript(operationId)}"];
    return __result(summary);
  `);
}

export function getRippleRemoveRangesTools(bridgeOptions: BridgeOptions, dependencies: { capabilities?: CapabilityConfig } = {}) {
  const capabilities = dependencies.capabilities ?? resolveCapabilities();
  return {
    ripple_remove_timeline_ranges: {
      description: "Refuses attached transitions or unreadable transition collections before structural edits; inspect transitionsAffected and use remove_transition first. Preview or apply a single-pass ripple removal for up to 50 sorted, non-overlapping timeline ranges on all unlocked, sync-locked tracks. Requires a preview confirmation token to apply. Supports integer and fractional sequence frame rates (including 29.97) by snapping ranges to sequence frames. The preview returns per-track counts and at most 50 planned-clip samples; clips fully inside ranges are removed. Kept pieces cut from one linked audio/video clip are relinked and read back after the move. Large edits need allow_large_ripple: true.",
      parameters: { type: "object" as const, properties: {
        sequence_id: { type: "string", description: "Sequence name or ID; defaults to the active sequence. It must be the active sequence, because the edit runs through QE; another sequence is refused without changes." },
        ranges: { type: "array", minItems: 1, maxItems: 50, items: { type: "object", properties: { start: { type: "number", minimum: 0, description: "Range start in timeline seconds." }, end: { type: "number", exclusiveMinimum: 0, description: "Range end in timeline seconds." } }, required: ["start", "end"], additionalProperties: false }, description: "Sorted, non-overlapping timeline intervals to remove." },
        scope: { type: "string", enum: ["sync_locked"], description: "All participating tracks must be sync-locked and unlocked." },
        range_content: { type: "string", enum: ["delete"], description: "Delete clips fully inside each removed range." },
        dry_run: { type: "boolean", description: "Return bounded read-only counts and up to 50 plan samples; default true." },
        allow_large_ripple: { type: "boolean", description: "Required when more than 400 clips will move." },
        confirmation_token: { type: "string", description: "Single-use token from a successful dry run; required to apply." },
      }, required: ["ranges", "scope", "range_content"] },
      handler: async (args: Args) => {
        const invalid = validate(args); if (invalid) return { success: false, error: invalid };
        if (args.dry_run === false) {
          requireCapability(capabilities, "edit", "ripple_remove_timeline_ranges");
          const expectedFingerprint = consume(args.confirmation_token, args);
          if (!expectedFingerprint) return { success: false, error: "A valid, unexpired, single-use preview confirmation_token is required; preview again." };
          const preview = await sendCommand(rippleRemoveRangesScript(args, false), bridgeOptions);
          if (!preview.success) return preview;
          const counts = preview.data as { clipsShifted?: number } | undefined;
          const timeoutMs = Math.max(bridgeOptions.timeoutMs ?? 30000, Math.min(900000, 30000 + (counts?.clipsShifted ?? 0) * 400));
          const commandOptions = { ...bridgeOptions, timeoutMs, mutationOnTimeout: true };
          const operationId = randomBytes(16).toString("hex");
          let fingerprint = expectedFingerprint;
          let undoSteps = 0;
          // Do not keep an unbounded number of QE razors in one evalScript.
          // Stack-overrun is native and bypasses ExtendScript catch blocks.
          for (let batches = 0; batches < 1000; batches++) {
            const batch = await sendCommand(
              rippleRemoveRangesScript(args, true, fingerprint, "razor", operationId),
              commandOptions,
            );
            const batchData = batch.data as { complete?: boolean; undoSteps?: number } | undefined;
            undoSteps += batchData?.undoSteps ?? 0;
            if (!batch.success) {
              if (undoSteps > 0) batch.data = { ...(batchData ?? {}), undoSteps, timelineChanged: true };
              return batch;
            }
            if (batchData?.complete === true) break;
            fingerprint = "";
            if (batches === 999) return { success: false, error: "Ripple range removal exceeded its bounded razor batch limit; inspect the timeline before retrying.", data: { outcome: "committed_unverified", undoSteps, timelineChanged: undoSteps > 0 } };
          }
          const result = await sendCommand(rippleRemoveRangesScript(args, true, "", "finish", operationId), commandOptions);
          const resultData = result.data as { undoSteps?: number; [key: string]: unknown } | undefined;
          const totalUndoSteps = undoSteps + (resultData?.undoSteps ?? 0);
          if (totalUndoSteps > 0) result.data = { ...(resultData ?? {}), undoSteps: totalUndoSteps, timelineChanged: result.success ? resultData?.timelineChanged : true };
          return result;
        } else requireCapability(capabilities, "edit", "ripple_remove_timeline_ranges");
        const result = await sendCommand(rippleRemoveRangesScript(args, false), bridgeOptions);
        if (result.success) {
          const fingerprint = (result.data as { timelineFingerprint?: string } | undefined)?.timelineFingerprint;
          if (!fingerprint) return { success: false, error: "Premiere did not return a timeline fingerprint; no confirmation token was issued" };
          return { ...result, data: { ...(result.data as object), confirmationToken: issue(args, fingerprint), applied: false } };
        }
        return result;
      },
    },
  };
}
