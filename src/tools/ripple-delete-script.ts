/**
 * Script body for an explicit, verified ripple delete of one clip (plus its
 * linked partners) in the active sequence. Returns via __result/__error, so run
 * it as a whole tool script or inside its own function. `nodeId` must already be
 * escaped for ExtendScript.
 */
export function rippleDeleteScriptBody(options: {
  nodeId: string;
  scope: "sync_locked" | "own_track";
  rangeDelete: boolean;
  dryRun: boolean;
  /** Internal edit-plan reference to partners already checked against its token. */
  validatedPartnersExpression?: string;
}): string {
  const { nodeId, scope, rangeDelete, dryRun } = options;
  return `
          var result = __findClip("${nodeId}");
          if (!result) return __error("Clip not found: ${nodeId}");
          // The clip's own linked partners (its synced audio/video) are part of
          // the edit, exactly as in Premiere's ripple delete of a linked clip.
          var linkedPartnerIds = {};
          var linkedPartners = ${options.validatedPartnersExpression ?? "__linkedPartnerClips(result)"};
          for (var lpi = 0; lpi < linkedPartners.length; lpi++) linkedPartnerIds[String(linkedPartners[lpi].clip.nodeId)] = true;

          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var frameTicks = seq && seq.timebase ? parseFloat(seq.timebase) : NaN;
          if (!frameTicks || isNaN(frameTicks)) frameTicks = TICKS_PER_SECOND / 24;
          var tol = frameTicks;

          var target = result.clip;
          var targetName = target.name;
          var gapStartT = parseFloat(target.start.ticks);
          var gapEndT = parseFloat(target.end.ticks);
          var shiftT = gapEndT - gapStartT;
          if (!(shiftT > 0)) return __error("The target clip has no positive duration; nothing to ripple.");

          // Sync-lock state is only exposed through QE, not the public DOM.
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE); cannot read sync-lock state, so the set of tracks to shift cannot be determined safely.");

          function qeTrackFor(type, idx) {
            return type === "video" ? qeSeq.getVideoTrackAt(idx) : qeSeq.getAudioTrackAt(idx);
          }
          function domTrackFor(type, idx) {
            return type === "video" ? seq.videoTracks[idx] : seq.audioTracks[idx];
          }

          var parts = [];
          function addPart(type, idx, isTarget) {
            var dt = domTrackFor(type, idx);
            if (!dt) return;
            for (var ap = 0; ap < parts.length; ap++) if (parts[ap].type === type && parts[ap].index === idx) return;
            parts.push({ type: type, index: idx, domTrack: dt, isTarget: isTarget });
          }

          addPart(result.trackType, result.trackIndex, true);
          ${
            scope === "sync_locked"
              ? `
          var vN = seq.videoTracks.numTracks;
          var aN = seq.audioTracks.numTracks;
          var ti;
          for (ti = 0; ti < vN; ti++) {
            if (result.trackType === "video" && ti === result.trackIndex) continue;
            var slv = null;
            try {
              var qv = qeTrackFor("video", ti);
              if (qv && typeof qv.isSyncLocked === "function") slv = !!qv.isSyncLocked();
            } catch (e1) { slv = null; }
            if (slv === null) {
              return __error("Ripple delete refused; nothing was changed. Could not read isSyncLocked() on video track " + ti + ". Pass scope 'own_track' to shift only the clip's track (this will desync other tracks).");
            }
            if (slv) addPart("video", ti, false);
          }
          for (ti = 0; ti < aN; ti++) {
            if (result.trackType === "audio" && ti === result.trackIndex) continue;
            var sla = null;
            try {
              var qa = qeTrackFor("audio", ti);
              if (qa && typeof qa.isSyncLocked === "function") sla = !!qa.isSyncLocked();
            } catch (e2) { sla = null; }
            if (sla === null) {
              return __error("Ripple delete refused; nothing was changed. Could not read isSyncLocked() on audio track " + ti + ". Pass scope 'own_track' to shift only the clip's track (this will desync other tracks).");
            }
            if (sla) addPart("audio", ti, false);
          }
          // A linked partner is removed with the clip, as in Premiere, so its
          // track closes up too even when that track is not sync-locked.
          for (lpi = 0; lpi < linkedPartners.length; lpi++) addPart(linkedPartners[lpi].trackType, linkedPartners[lpi].trackIndex, false);
          `
              : `
          // own_track: only the clip's own track changes; linked partners stay.
          `
          }
          var linkedPartnersKept = [];
          ${scope === "own_track" ? `for (lpi = 0; lpi < linkedPartners.length; lpi++) linkedPartnersKept.push({ nodeId: String(linkedPartners[lpi].clip.nodeId), track: linkedPartners[lpi].trackType + " " + linkedPartners[lpi].trackIndex, name: linkedPartners[lpi].clip.name });` : ""}

          // A locked participating track cannot be edited; shifting the others
          // without it would silently desync, so refuse rather than half-ripple.
          // Unreadable lock state is the same risk as an unread sync lock.
          var lockedList = [];
          var pi;
          for (pi = 0; pi < parts.length; pi++) {
            var lk = null;
            try {
              if (typeof parts[pi].domTrack.isLocked === "function") lk = !!parts[pi].domTrack.isLocked();
            } catch (eDomLock) { lk = null; }
            if (lk === null) {
              try {
                var ql = qeTrackFor(parts[pi].type, parts[pi].index);
                if (ql && typeof ql.isLocked === "function") lk = !!ql.isLocked();
              } catch (e3) { lk = null; }
            }
            if (lk === null) {
              return __error("Ripple delete refused; nothing was changed. Could not read isLocked() on " + parts[pi].type + " track " + parts[pi].index + ". Unlock them or use scope 'own_track' (which will desync other tracks).");
            }
            if (lk) lockedList.push(parts[pi].type + " track " + parts[pi].index);
          }
          if (lockedList.length) {
            return __error("Ripple delete refused; nothing was changed. These tracks must shift but are locked: " + lockedList.join(", ") + ". Unlock them or use scope 'own_track' (which will desync other tracks).");
          }

          // Pre-flight every participating track BEFORE mutating anything.
          var plan = [];
          var problems = [];
          var insiders = [];
          for (pi = 0; pi < parts.length; pi++) {
            var t = parts[pi];
            var movers = [];
            for (var ci = 0; ci < t.domTrack.clips.numItems; ci++) {
              var c = t.domTrack.clips[ci];
              var cs = parseFloat(c.start.ticks);
              var ce = parseFloat(c.end.ticks);
              if (t.isTarget && String(c.nodeId) === "${nodeId}") continue;

              // Straddles the ripple point: shifting would slice through it.
              if (cs < gapEndT - tol && ce > gapEndT + tol) {
                problems.push("a clip on " + t.type + " track " + t.index + " (" + __ticksToSeconds(cs) + "-" + __ticksToSeconds(ce) + "s) spans the ripple point at " + __ticksToSeconds(gapEndT) + "s");
                continue;
              }
              // Overlaps the range being closed: later clips would land on top of it.
              if (ce > gapStartT + tol && cs < gapEndT - tol) {
                var fullyInside = (cs >= gapStartT - tol) && (ce <= gapEndT + tol);
                if (!fullyInside) {
                  // Crosses only one edge of the range -- closing the gap would
                  // require trimming it, which this tool will not do implicitly.
                  problems.push("a clip on " + t.type + " track " + t.index + " (" + __ticksToSeconds(cs) + "-" + __ticksToSeconds(ce) + "s) only partially overlaps the range being closed, so it would have to be trimmed rather than removed");
                } else if (${rangeDelete ? "true" : "false"} || linkedPartnerIds[String(c.nodeId)]) {
                  insiders.push({ domTrack: t.domTrack, nodeId: String(c.nodeId), label: t.type + " " + t.index, startSeconds: __ticksToSeconds(cs), endSeconds: __ticksToSeconds(ce), name: c.name, linkedPartner: !!linkedPartnerIds[String(c.nodeId)] });
                } else {
                  problems.push("a clip on " + t.type + " track " + t.index + " (" + __ticksToSeconds(cs) + "-" + __ticksToSeconds(ce) + "s) sits inside the range being closed, so shifting later clips earlier would overlap it (pass range_content 'delete' to remove it as part of the ripple)");
                }
                continue;
              }
              if (cs >= gapEndT - tol) movers.push({ nodeId: String(c.nodeId), start: cs, end: ce });
            }
            movers.sort(function (x, y) { return x.start - y.start; });
            plan.push({ type: t.type, index: t.index, domTrack: t.domTrack, movers: movers });
          }

          if (problems.length) {
            return __error("Ripple delete refused; nothing was changed. " + problems.join("; ") + ". Trim or move the offending clip(s) first, use range_content 'delete' to also remove clips that sit entirely inside the range, or use scope 'own_track' if desyncing other tracks is acceptable.");
          }

          var planSummary = [];
          for (pi = 0; pi < plan.length; pi++) {
            planSummary.push({ track: plan[pi].type + " " + plan[pi].index, clipsToShift: plan[pi].movers.length });
          }

          // Reportable view of the in-range clips: the entries themselves hold a
          // live track reference, which must not be serialised back to the caller.
          var insidersReport = [];
          for (var iri = 0; iri < insiders.length; iri++) {
            var ii = insiders[iri];
            insidersReport.push({ track: ii.label, name: ii.name, startSeconds: ii.startSeconds, endSeconds: ii.endSeconds });
          }

          ${
            dryRun
              ? `
          return __result({
            dryRun: true,
            rippled: false,
            clipName: targetName,
            gapStartSeconds: __ticksToSeconds(gapStartT),
            gapSeconds: __ticksToSeconds(shiftT),
            tracksAffected: planSummary,
            alsoRemoves: insidersReport,
            linkedPartnersKept: linkedPartnersKept,
            note: "Validation passed. Re-run without dry_run to remove the clip and close the gap." + (insiders.length ? " NOTE: " + insiders.length + " clip(s) on other tracks sit inside the range and WILL ALSO BE REMOVED (range_content: delete)." : "")
          });
          `
              : `
          var failuresEarly = [];
          try {
            target.remove(false, false);
          } catch (removeErr) {
            var removalReceipt = __removalThrowReceipt(["${nodeId}"], seq);
            return __error("Premiere threw while removing the target clip; no later clips were shifted: " + removeErr.toString() + (removalReceipt.timelineChanged === true ? " The timeline changed; inspect the timeline." : (removalReceipt.timelineChanged === null ? " Removal may have changed the timeline; readback is unavailable." : " The target remains on the timeline.")), removalReceipt);
          }
          if (__findClip("${nodeId}")) {
            return __error("Premiere did not remove the target clip, so nothing was shifted; the timeline is unchanged.");
          }

          // Remove clips that sit inside the range on other participating tracks
          // (range_content: delete). Without this the shifted clips would land
          // on top of them.
          var removedInRange = [];
          for (var ri = 0; ri < insiders.length; ri++) {
            var ins = insiders[ri];
            var victim = null;
            for (var xi = 0; xi < ins.domTrack.clips.numItems; xi++) {
              if (String(ins.domTrack.clips[xi].nodeId) === ins.nodeId) { victim = ins.domTrack.clips[xi]; break; }
            }
            if (!victim) {
              // Premiere may already have taken the clip out with the target
              // (linked audio). The range is being lifted either way, so an
              // insider that is already gone is the intended end state.
              removedInRange.push({ track: ins.label, name: ins.name, startSeconds: ins.startSeconds, endSeconds: ins.endSeconds, removedWithTarget: true });
              continue;
            }
            try {
              victim.remove(false, false);
              removedInRange.push({ track: ins.label, name: ins.name, startSeconds: ins.startSeconds, endSeconds: ins.endSeconds });
            } catch (delErr) {
              failuresEarly.push(ins.label + ": could not remove " + ins.nodeId + " -- " + delErr.toString());
            }
          }
          if (failuresEarly.length) {
            return __error("The target clip was removed but the in-range clips on other tracks could not all be removed, so nothing was shifted and the timeline is partially changed: " + failuresEarly.join("; ") + ".", {timelineChanged:true,mutationAttempted:true,mutationOutcome:"changed",verified:false});
          }

          // Shift in ascending start order so a moved clip never lands on its
          // left neighbour. Moving earlier means writing start before end, which
          // keeps start < end at every step (Premiere rejects a start write that
          // would push start past the clip's current end).
          var moved = 0;
          var failures = [];

          for (pi = 0; pi < plan.length; pi++) {
            var tp = plan[pi];
            for (var mi = 0; mi < tp.movers.length; mi++) {
              var want = tp.movers[mi];
              var found = null;
              for (var fi = 0; fi < tp.domTrack.clips.numItems; fi++) {
                if (String(tp.domTrack.clips[fi].nodeId) === want.nodeId) { found = tp.domTrack.clips[fi]; break; }
              }
              if (!found) { failures.push(tp.type + " " + tp.index + ": clip " + want.nodeId + " vanished before it could be shifted"); continue; }
              try {
                found.start = (want.start - shiftT).toString();
                found.end = (want.end - shiftT).toString();
                moved++;
              } catch (shiftErr) {
                failures.push(tp.type + " " + tp.index + ": " + want.nodeId + " -> " + shiftErr.toString());
              }
            }
          }

          // Verify every shifted clip landed where intended with its duration intact.
          var verifyProblems = [];
          for (pi = 0; pi < plan.length; pi++) {
            var tv = plan[pi];
            for (var vi = 0; vi < tv.movers.length; vi++) {
              var w = tv.movers[vi];
              var got = null;
              for (var gi = 0; gi < tv.domTrack.clips.numItems; gi++) {
                if (String(tv.domTrack.clips[gi].nodeId) === w.nodeId) { got = tv.domTrack.clips[gi]; break; }
              }
              if (!got) { verifyProblems.push(tv.type + " " + tv.index + ": " + w.nodeId + " not found after shifting"); continue; }
              var gs = parseFloat(got.start.ticks);
              var gd = parseFloat(got.end.ticks) - gs;
              if (Math.abs(gs - (w.start - shiftT)) > tol) {
                verifyProblems.push(tv.type + " " + tv.index + ": expected start " + __ticksToSeconds(w.start - shiftT) + "s, got " + __ticksToSeconds(gs) + "s");
              }
              if (Math.abs(gd - (w.end - w.start)) > tol) {
                verifyProblems.push(tv.type + " " + tv.index + ": duration changed from " + __ticksToSeconds(w.end - w.start) + "s to " + __ticksToSeconds(gd) + "s");
              }
            }
          }

          if (failures.length || verifyProblems.length) {
            return __error("The clip was removed but the gap was not closed cleanly, so the timeline is now in a partially-rippled state and needs checking. " + failures.concat(verifyProblems).join("; ") + ".", {timelineChanged:true,mutationAttempted:true,mutationOutcome:"changed",verified:false});
          }

          return __result({
            rippled: true,
            verified: true,
            clipName: targetName,
            gapStartSeconds: __ticksToSeconds(gapStartT),
            gapClosedSeconds: __ticksToSeconds(shiftT),
            clipsShifted: moved,
            tracksAffected: planSummary,
            alsoRemoved: removedInRange,
            linkedPartnersKept: linkedPartnersKept,
            scope: "${scope}",
            rangeContent: "${rangeDelete ? "delete" : "refuse"}"
          });
          `
          }
`;
}
