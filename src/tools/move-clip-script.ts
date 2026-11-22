import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { expectedUnlinkedClip } from "../bridge/project-guard.js";

export interface MoveClipArgs {
  node_id: string;
  new_start_seconds: number;
  new_track_index?: number;
  include_linked?: boolean;
}

export function moveClipScript(args: MoveClipArgs): string {
  const nodeId = escapeForExtendScript(args.node_id);
  return buildToolScript(`
    var target = __findClip("${nodeId}");
    if (!target) return __refuse("Clip not found: ${nodeId}");
    var seq = app.project.activeSequence;
    var frameTicks = __sequenceFrameTicks(seq);
    if (!isFinite(frameTicks)) return __refuse("The active sequence frame grid is unreadable.");
    var projectId = String(app.project.documentID), sequenceId = String(seq.sequenceID);
    var includeLinked = ${args.include_linked !== false};
    var destinationTrack = ${args.new_track_index ?? "target.trackIndex"};
    var changesTrack = destinationTrack !== target.trackIndex;
    var scope = "Timeline track, start/end ticks and source in/out ticks";
    var members = [], ids = [], memberIds = {}, written = [], targets = [], attempted = false;

    function trackAt(type, index) {
      return (type === "video" ? seq.videoTracks : seq.audioTracks)[index];
    }
    function countOf(collection, field) {
      var count = collection && collection[field];
      if (typeof count !== "number" || count < 0 || count !== Math.floor(count) || count > 100000) throw new Error("Timeline collection is unreadable");
      return count;
    }
    function isExactTick(value) {
      return isFinite(value) && Math.abs(value) <= 9007199254740991 && Math.floor(value) === value;
    }
    function readTick(value) {
      var raw = String(value.ticks), tick = Number(raw);
      if (!/^-?\\d+$/.test(raw) || !isExactTick(tick)) throw new Error("Timeline ticks cannot be read exactly");
      return tick;
    }
    function readRange(located) {
      var item = located.clip;
      var sourceIn = String(item.inPoint.ticks), sourceOut = String(item.outPoint.ticks);
      if (!/^-?\\d+$/.test(sourceIn) || !/^-?\\d+$/.test(sourceOut)) throw new Error("Source ticks are unreadable");
      return { clip: item, type: located.trackType, index: located.trackIndex, start: readTick(item.start), end: readTick(item.end),
        sourceId: item.projectItem ? String(item.projectItem.nodeId) : null, sourceIn: sourceIn, sourceOut: sourceOut };
    }
    // Resolve live node identities globally, including duplicates on other
    // tracks. Link collections may contain host wrappers rather than the
    // live writable items. Every member must describe the same group.
    function resolveGroup() {
      if (!app.project || !app.project.activeSequence || String(app.project.documentID) !== projectId || String(app.project.activeSequence.sequenceID) !== sequenceId) throw new Error("The active project or sequence changed");
      var found = {}, types = ["video", "audio"];
      for (var ti = 0; ti < types.length; ti++) {
        var type = types[ti], tracks = type === "video" ? seq.videoTracks : seq.audioTracks;
        var nTracks = countOf(tracks, "numTracks");
        for (var index = 0; index < nTracks; index++) {
          var clips = tracks[index].clips, nClips = countOf(clips, "numItems");
          for (var ci = 0; ci < nClips; ci++) {
            var item = clips[ci], key = "$" + String(item.nodeId);
            if (!memberIds[key]) continue;
            if (found[key]) throw new Error("Duplicate live linked clip identity");
            found[key] = readRange({ clip: item, trackType: type, trackIndex: index });
          }
        }
      }
      var group = [];
      for (var i = 0; i < ids.length; i++) {
        var member = found["$" + ids[i]];
        if (!member) throw new Error("A linked clip could not be located");
        var peers = __linkedClipIds(member.clip);
        if (peers.length !== ids.length - 1) throw new Error("Linked membership is inconsistent");
        for (var p = 0; p < peers.length; p++) {
          if (!memberIds["$" + peers[p]]) throw new Error("Linked membership is inconsistent");
        }
        group.push(member);
      }
      return group;
    }
    function span(type, index, start, end) { return { type: type, index: index, start: start, end: end }; }
    function requireVacant(where, ignored) {
      var track = trackAt(where.type, where.index);
      if (!track) throw new Error("Destination track is out of range");
      // Missing CEP lock access is supported by the legacy path. A known
      // lock or a throwing lock accessor must stop the edit.
      if (typeof track.isLocked === "function" && track.isLocked()) throw new Error("A move track is locked");
      var clips = track.clips, count = countOf(clips, "numItems");
      for (var i = 0; i < count; i++) {
        var item = clips[i];
        if (ignored["$" + String(item.nodeId)]) continue;
        var start = readTick(item.start), end = readTick(item.end);
        if (end <= start) throw new Error("A destination clip range is invalid");
        if (start < where.end && end > where.start) throw new Error("A clip occupies the destination range on " + where.type + " track " + where.index);
      }
    }
    function sameSource(current, before) {
      return current && current.type === before.type && current.sourceId === before.sourceId && current.sourceIn === before.sourceIn && current.sourceOut === before.sourceOut;
    }
    function matches(current, before, where) {
      return sameSource(current, before) && current.index === where.index && current.start === where.start && current.end === where.end;
    }
    function evidence(current, member) {
      return { nodeId: member.id, trackType: current.type, trackIndex: current.index, startTicks: String(current.start), endTicks: String(current.end),
        inPointTicks: current.sourceIn, outPointTicks: current.sourceOut };
    }
    function failMove(message, rollback) {
      if (rollback) {
        for (var i = written.length - 1; i >= 0; i--) {
          try {
            var index = written[i], member = members[index], before = member.before, current = resolveGroup()[index];
            if (matches(current, before, before) || !sameSource(current, before) || current.index !== before.index) continue;
            // Limit compensation to a range our writes could have produced.
            // Leave host-moved partners and unexpected ranges for inspection.
            if ((current.start !== before.start && current.start !== member.dest.start) ||
                (current.end !== before.end && current.end !== member.dest.end)) continue;
            var onlySelf = {};
            onlySelf["$" + member.id] = true;
            requireVacant(before, onlySelf);
            if (__transitionEditGuard(seq, [before, current])) continue;
            __writeClipSpan(current.clip, before.start, before.end);
          } catch (rollbackError) {}
        }
      }
      var changed = false, unreadable = false, observed = [];
      try {
        var states = resolveGroup();
        for (var j = 0; j < members.length; j++) {
          var item = members[j], state = states[j];
          observed.push(evidence(state, item));
          if (!matches(state, item.before, item.before)) changed = true;
        }
      } catch (groupError) { unreadable = true; }
      var undoNow = __undoStart === null ? null : __readUndoIndex();
      var restored = !changed && !unreadable;
      var unchanged = restored && (__undoStart === null || (undoNow !== null && undoNow <= __undoStart));
      var outcome = changed ? "committed_unverified" : unchanged ? "not_applied" : "unknown";
      var failure = { verified: false, outcome: outcome, mutationOutcome: outcome,
        timelineChanged: changed ? true : unchanged ? false : null, mutationAttempted: attempted,
        rollbackVerified: rollback && written.length > 0 && restored, verificationScope: scope, affectedTargets: observed };
      if (!includeLinked && ids.length > 1 && unreadable) failure.warning = "A linked partner's state could not be verified after the target-only move.";
      return __error(message, failure);
    }

    var requestedTicks = __secondsToTicks(${args.new_start_seconds}), newStartTicks, delta, primary, clipName;
    try {
      ids = ["${nodeId}"].concat(__linkedClipIds(target.clip));
      ${expectedUnlinkedClip() ? 'if (ids.length > 1) return __refuse("Compound move requires a live unlinked clip; inspect and preview again.");' : ""}
      if (changesTrack && ids.length > 1) return __refuse("Linked clip track changes are unsupported; move the group in Premiere.");
      for (var i = 0; i < ids.length; i++) memberIds["$" + ids[i]] = true;
      if (ids.length > 1) scope += includeLinked ? " for every linked group member" : " for the target and stationary linked partners";
      var initial = resolveGroup();
      primary = initial[0];
      clipName = primary.clip.name;
      var trackCount = countOf(primary.type === "video" ? seq.videoTracks : seq.audioTracks, "numTracks");
      if (destinationTrack >= trackCount) return __refuse("Destination track index is out of range for this sequence.");
      if (!isExactTick(requestedTicks)) return __refuse("The requested start cannot be represented in exact timeline ticks.");
      // A linked audio anchor can start between frames. Quantize the
      // displacement so every member keeps its own offset and duration.
      newStartTicks = ids.length > 1 ? primary.start + __snapSequenceTicks(seq, requestedTicks - primary.start) : __snapSequenceTicks(seq, requestedTicks);
      delta = newStartTicks - primary.start;
      var scopes = [], trackOrder = {};
      for (var m = 0; m < initial.length; m++) {
        var before = initial[m], index = m === 0 ? destinationTrack : before.index;
        var dest = span(before.type, index, before.start + delta, before.end + delta);
        if (before.start < 0 || before.end <= before.start || dest.start < 0 || !isExactTick(dest.start) || !isExactTick(dest.end)) {
          return __refuse("An original or destination clip range is invalid or outside exact timeline ticks.");
        }
        // Keep the legacy singleton grid check and require video on-grid in
        // a group. Audio members retain their exact subframe offsets.
        if (initial.length === 1 || before.type === "video") {
          if (Math.abs(before.start / frameTicks - Math.round(before.start / frameTicks)) > 0.001 ||
              Math.abs(before.end / frameTicks - Math.round(before.end / frameTicks)) > 0.001 ||
              Math.abs((before.end - before.start) / frameTicks - Math.round((before.end - before.start) / frameTicks)) > 0.001) {
            return __refuse("An existing clip range is off the active sequence frame grid.");
          }
        }
        var origin = trackAt(before.type, before.index);
        if (typeof origin.isLocked === "function" && origin.isLocked()) return __refuse("A move track is locked.");
        var trackKey = before.type + ":" + before.index;
        if (trackOrder[trackKey] === undefined) trackOrder[trackKey] = m;
        scopes.push(before, dest);
        members.push({ id: ids[m], before: before, dest: dest, trackOrder: trackOrder[trackKey] });
      }
      // QE changes track at the old time before the separate time move.
      if (changesTrack) scopes.push(span(primary.type, destinationTrack, primary.start, primary.end));
      var transitionFailure = __transitionEditGuard(seq, scopes);
      if (transitionFailure) return transitionFailure;
      var primaryOnly = {};
      primaryOnly["$" + ids[0]] = true;
      for (var d = 0; d < members.length; d++) requireVacant(members[d].dest, !includeLinked && d === 0 ? primaryOnly : memberIds);
      if (changesTrack) requireVacant(scopes[scopes.length - 1], memberIds);
    } catch (preflightError) {
      return __refuse("Move preflight failed: " + String(preflightError));
    }

    try {
      ${args.new_track_index === undefined ? "" : `
      if (changesTrack) {
        app.enableQE();
        var qeSeq = qe.project.getActiveSequence();
        var qeTrack = qeSeq && (primary.type === "video" ? qeSeq.getVideoTrackAt(primary.index) : qeSeq.getAudioTrackAt(primary.index));
        var qeClip = __findQeClipByDomClip(qeTrack, primary.clip);
        if (!qeClip) return __refuse("Could not locate the clip among the QE track's items; cannot change track.");
        var trackDelta = destinationTrack - primary.index;
        var videoDelta = primary.type === "video" ? trackDelta : 0;
        var audioDelta = primary.type === "audio" ? trackDelta : 0;
        attempted = true;
        qeClip.moveToTrack(videoDelta, audioDelta, "0", false);
        var afterTrack = resolveGroup()[0];
        if (!sameSource(afterTrack, primary) || afterTrack.index !== destinationTrack) throw new Error("Premiere did not produce a verified track move.");
        // Some QE hosts change the end during a track move. Restore the
        // original span on the new track before applying the requested delta.
        if (afterTrack.start !== primary.start || afterTrack.end !== primary.end) {
          __writeClipSpan(afterTrack.clip, primary.start, primary.end);
          afterTrack = resolveGroup()[0];
        }
        if (!matches(afterTrack, primary, scopes[scopes.length - 1])) throw new Error("Premiere did not preserve the clip range during the track move.");
      }
      `}
      var writeCount = includeLinked ? members.length : 1;
      var writeOrder = [];
      for (var order = 0; order < writeCount; order++) writeOrder.push(order);
      // Within each track, start at the edge that moves into free space.
      // One member's destination may be another member's original range.
      writeOrder.sort(function (left, right) {
        var a = members[left], b = members[right];
        return a.trackOrder - b.trackOrder || (delta > 0 ? b.before.start - a.before.start : a.before.start - b.before.start) || left - right;
      });
      var live = resolveGroup();
      for (var w = 0; w < writeOrder.length; w++) {
        var movingIndex = writeOrder[w], moving = members[movingIndex], current = live[movingIndex];
        if (matches(current, moving.before, moving.dest)) continue;
        var from = changesTrack ? scopes[scopes.length - 1] : moving.before;
        if (!matches(current, moving.before, from)) throw new Error("Clip " + moving.id + " changed before its move and does not match its destination.");
        written.push(movingIndex);
        attempted = true;
        __writeClipSpan(current.clip, moving.dest.start, moving.dest.end);
        live = resolveGroup();
        if (!matches(live[movingIndex], moving.before, moving.dest)) throw new Error("Premiere did not move clip " + moving.id + " to the requested range with its source range intact.");
      }

      // Check all members again after the last write, including partners
      // Premiere moved itself and partners the caller asked to leave alone.
      var finalGroup = live, changedPartners = [];
      for (var f = 0; f < members.length; f++) {
        var member = members[f], after = finalGroup[f];
        if (!matches(after, member.before, f < writeCount ? member.dest : member.before)) {
          if (f < writeCount) throw new Error("Final readback differs from the requested range for clip " + member.id + ".");
          changedPartners.push(member.id);
        }
        targets.push(evidence(after, member));
      }
      var verified = !changedPartners.length;
      var payload = { transitionsAffected: [], moved: changesTrack || delta !== 0, verified: verified, outcome: verified ? "verified" : "committed_unverified",
        timelineChanged: changesTrack || delta !== 0 || !verified, clipName: clipName, newStart: __ticksToSeconds(finalGroup[0].start),
        newEnd: __ticksToSeconds(finalGroup[0].end), durationSeconds: __ticksToSeconds(finalGroup[0].end - finalGroup[0].start),
        trackIndex: finalGroup[0].index, affectedTargets: targets, verificationScope: scope };
      if (!verified) {
        payload.changedPartnerIds = changedPartners;
        payload.warning = "Premiere changed a linked partner despite include_linked:false. Inspect the affected clips.";
      }
      var snap = __frameSnapReceipt(requestedTicks, newStartTicks, frameTicks, "requestedStartSeconds", "appliedStartSeconds");
      if (snap.requestedStartSeconds !== undefined) {
        payload.requestedStartSeconds = snap.requestedStartSeconds;
        payload.appliedStartSeconds = snap.appliedStartSeconds;
      }
      return __result(payload);
    } catch (moveError) {
      if (!attempted) return __refuse("Move could not be started: " + String(moveError));
      return failMove("Premiere did not apply a verified move. " + String(moveError), !changesTrack);
    }
  `);
}
