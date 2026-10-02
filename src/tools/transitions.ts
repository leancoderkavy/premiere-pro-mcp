import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

// A native write may mutate before throwing; never present that as an untouched failure.
const TRANSITION_FAILURE_RECEIPT = `
  function __transitionReadbacks(track, beforeKeys) {
    var placements = [];
    for (var i = 0; i < track.transitions.numItems; i++) {
      var transition = track.transitions[i];
      if (beforeKeys[String(transition.start.ticks) + "-" + String(transition.end.ticks)]) continue;
      var start = parseFloat(transition.start.ticks);
      var end = parseFloat(transition.end.ticks);
      if (!isFinite(start) || !isFinite(end) || end <= start) throw new Error("Premiere returned an unreadable transition span");
      placements.push({ startSeconds: __ticksToSeconds(start), endSeconds: __ticksToSeconds(end), durationSeconds: __ticksToSeconds(end - start) });
    }
    return placements;
  }
  function __transitionAttemptFailure(track, before, message, extra) {
    var added = null;
    try { added = track.transitions.numItems - before; } catch (readError) {}
    var data = { outcome: "committed_unverified", verified: false, timelineChanged: added !== null && added !== 0 ? true : null, transitionsAdded: added };
    if (extra) for (var key in extra) if (extra.hasOwnProperty(key)) data[key] = extra[key];
    return __jsonStringify({ success: false, error: message + " A transition write was attempted and may have changed the timeline. Inspect the track before retrying.", data: data });
  }
`;

export function getTransitionsTools(bridgeOptions: BridgeOptions) {
  const validateTransitionRequest = (duration: number, trackIndex?: number) => {
    if (!Number.isFinite(duration) || duration <= 0 || duration > 60) {
      return { success: false, error: "duration_seconds must be finite, greater than 0, and no more than 60 seconds." };
    }
    if (trackIndex !== undefined && (!Number.isInteger(trackIndex) || trackIndex < 0)) {
      return { success: false, error: "track_index must be a non-negative integer." };
    }
    return null;
  };
  return {
    add_transition: {
      description: "EXPERIMENTAL (undocumented QE DOM): Add a video transition between two clips at a cut point. Reads the transition back from the sequence track.",
      parameters: {
        type: "object" as const,
        properties: {
          transition_name: {
            type: "string",
            description: "Name of the transition (e.g., 'Cross Dissolve', 'Dip to Black')",
          },
          track_index: {
            type: "number",
            description: "Video track index (0-based)",
          },
          cut_point_seconds: {
            type: "number",
            description: "Time position in seconds of the cut point where the transition should be placed",
          },
          duration_seconds: {
            type: "number",
            description: "Duration of the transition in seconds (default: 1.0)",
          },
        },
        required: ["transition_name", "track_index", "cut_point_seconds"],
      },
      handler: async (args: {
        transition_name: string;
        track_index: number;
        cut_point_seconds: number;
        duration_seconds?: number;
      }) => {
        const duration = args.duration_seconds ?? 1.0;
        if (!Number.isFinite(args.cut_point_seconds) || args.cut_point_seconds < 0) {
          return { success: false, error: "cut_point_seconds must be finite and non-negative timeline seconds." };
        }
        const invalid = validateTransitionRequest(duration, args.track_index);
        if (invalid) return invalid;
        const script = buildToolScript(`
          ${TRANSITION_FAILURE_RECEIPT}
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");

          var qeTrack = qeSeq.getVideoTrackAt(${args.track_index});
          if (!qeTrack) return __error("Track not found");

          var transitionName = "${escapeForExtendScript(args.transition_name)}";
          var transitionQE = null;

          // Resolution path 1: getVideoTransitionByName (works on PPro 2026 where
          // getVideoTransitionList() returns an empty list).
          try {
            if (qe.project.getVideoTransitionByName) {
              transitionQE = qe.project.getVideoTransitionByName(transitionName);
            }
          } catch(e1) {}

          // Resolution path 2: scan getVideoTransitionList (legacy).
          if (!transitionQE) {
            try {
              var transitions = __qeCatalogFrom(qe.project.getVideoTransitionList());
              for (var i = 0; i < transitions.numItems; i++) {
                if (transitions[i].name === transitionName) {
                  transitionQE = __qeTransitionObject("video", transitions[i]);
                  break;
                }
              }
            } catch(e2) {}
          }

          if (!transitionQE) return __error("Transition not found: " + transitionName);

          var domTrack = app.project.activeSequence.videoTracks[${args.track_index}];
          if (!domTrack) return __error("Track not found in the Premiere DOM");
          var cutTicks = __secondsToTicks(${args.cut_point_seconds});
          var outgoingClip = null;
          var incomingClip = null;
          for (var c = 0; c < domTrack.clips.numItems; c++) {
            var candidate = domTrack.clips[c];
            if (Math.abs(parseFloat(candidate.end.ticks) - cutTicks) < 1) { outgoingClip = candidate; break; }
          }
          for (var c2 = 0; c2 < domTrack.clips.numItems; c2++) {
            var candidate2 = domTrack.clips[c2];
            if (Math.abs(parseFloat(candidate2.start.ticks) - cutTicks) < 1) { incomingClip = candidate2; break; }
          }
          if (!incomingClip && !outgoingClip) return __error("No video clip edge exists at the requested cut point, so no transition was attempted.");
          // Premiere 26.3.2 confirms arg 2 is the clip edge: true=head,
          // false=tail. Prefer the incoming head and fall back to the outgoing tail.
          var targetClip = incomingClip || outgoingClip;
          var targetHead = !!incomingClip;
          var qeClip = __findQeClipByDomClip(qeTrack, targetClip);
          if (!qeClip || typeof qeClip.addTransition !== "function") {
            return __error("The target QE clip does not expose addTransition; no transition was attempted. The QE track itself is not the transition write surface.");
          }

          var seq = app.project.activeSequence;
          var frameTicks = parseFloat(seq.timebase);
          if (!frameTicks || isNaN(frameTicks)) return __error("The active sequence did not expose a valid timebase for transition duration.");
          var durationFrames = Math.max(1, Math.round(__secondsToTicks(${duration}) / frameTicks));
          if (__newTransitionCovers(domTrack, {}, cutTicks, frameTicks)) {
            return __error("A transition already covers the cut at ${args.cut_point_seconds}s on this track; no transition was attempted.");
          }
          var transitionKeysBefore = __transitionKeys(domTrack);
          var transitionCountBefore = domTrack.transitions.numItems;
          try {
            // QE transition writes belong to the clip. The legacy method takes
            // a clip edge, duration in sequence frames, offset, alignment, and
            // single-sided flags; DOM readback below decides whether it worked.
            qeClip.addTransition(transitionQE, targetHead, String(durationFrames), "0", 0.5, false, true);
          } catch (transitionError) {
            return __transitionAttemptFailure(domTrack, transitionCountBefore, "QE clip addTransition rejected the transition: " + transitionError.toString());
          }

          try {
          if (domTrack.transitions.numItems <= transitionCountBefore) {
            return __jsonStringify({ success: false, error: "QE clip addTransition returned without adding a transition to the track.", data: { outcome: "not_applied", verified: false, timelineChanged: false, transitionsAdded: 0 } });
          }
          if (domTrack.transitions.numItems !== transitionCountBefore + 1) {
            return __transitionAttemptFailure(domTrack, transitionCountBefore, "Premiere added an unexpected transition count.");
          }
          // Only a transition this call added counts; clips without handles can
          // push it entirely to one side of the cut, so covering is enough.
          if (!__newTransitionCovers(domTrack, transitionKeysBefore, cutTicks, frameTicks)) {
            return __jsonStringify({ success: false, error: "Premiere added a transition, but DOM readback did not find a new one at the requested cut point. Inspect the track or use Undo.", data: { outcome: "committed_unverified", verified: false, timelineChanged: true, transitionsAdded: domTrack.transitions.numItems - transitionCountBefore } });
          }

          return __result({
            added: true,
            verified: true,
            outcome: "verified",
            transition: transitionName,
            trackIndex: ${args.track_index},
            atSeconds: ${args.cut_point_seconds},
            requestedDurationSeconds: ${duration},
            durationSeconds: __transitionReadbacks(domTrack, transitionKeysBefore)[0].durationSeconds,
            placements: __transitionReadbacks(domTrack, transitionKeysBefore)
          });
          } catch (transitionReadbackError) {
            return __transitionAttemptFailure(domTrack, transitionCountBefore, "Transition readback failed: " + transitionReadbackError.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_transition_to_clip: {
      description: "EXPERIMENTAL (undocumented QE DOM): Add a transition to a specific video clip's start, end, or both edges, then read back the requested placement.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          transition_name: {
            type: "string",
            description: "Name of the transition",
          },
          position: {
            type: "string",
            enum: ["start", "end", "both"],
            description: "Where to apply the transition (default: end)",
          },
          duration_seconds: {
            type: "number",
            description: "Duration of the transition in seconds (default: 1.0)",
          },
        },
        required: ["node_id", "transition_name"],
      },
      handler: async (args: {
        node_id: string;
        transition_name: string;
        position?: string;
        duration_seconds?: number;
      }) => {
        const position = args.position ?? "end";
        const duration = args.duration_seconds ?? 1.0;
        if (position !== "start" && position !== "end" && position !== "both") {
          return { success: false, error: "position must be start, end, or both." };
        }
        const invalid = validateTransitionRequest(duration);
        if (invalid) return invalid;

        const script = buildToolScript(`
          ${TRANSITION_FAILURE_RECEIPT}
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Video transitions can only be added to a video clip; no transition was attempted.");
          
          var transitionName = "${escapeForExtendScript(args.transition_name)}";
          var transitionQE = null;
          try { if (qe.project.getVideoTransitionByName) transitionQE = qe.project.getVideoTransitionByName(transitionName); } catch(e1) {}
          if (!transitionQE) {
            try {
              var transitions = __qeCatalogFrom(qe.project.getVideoTransitionList());
              for (var i = 0; i < transitions.numItems; i++) {
                if (transitions[i].name === transitionName) { transitionQE = __qeTransitionObject("video", transitions[i]); break; }
              }
            } catch(e2) {}
          }
          if (!transitionQE) return __error("Transition not found: " + transitionName);

          var qeTrack = qeSeq.getVideoTrackAt(result.trackIndex);
          if (!qeTrack) return __error("QE video track not found");
          var domTrack = app.project.activeSequence.videoTracks[result.trackIndex];
          if (!domTrack) return __error("Video track not found in the Premiere DOM");
          var qeClip = __findQeClipByDomClip(qeTrack, result.clip);
          if (!qeClip || typeof qeClip.addTransition !== "function") {
            return __error("The target QE clip does not expose addTransition; no transition was attempted. The QE track itself is not the transition write surface.");
          }
          var seq = app.project.activeSequence;
          var frameTicks = parseFloat(seq.timebase);
          if (!frameTicks || isNaN(frameTicks)) return __error("The active sequence did not expose a valid timebase for transition duration.");
          var transitionCountBefore = domTrack.transitions.numItems;
          var transitionKeysBefore = __transitionKeys(domTrack);
          var durationFrames = Math.max(1, Math.round(__secondsToTicks(${duration}) / frameTicks));
          var clip = result.clip;
          var position = "${position}";
          var requestedCount = position === "both" ? 2 : 1;
          var requestedEdges = [];
          var clipStartTicks = parseFloat(clip.start.ticks);
          var clipEndTicks = parseFloat(clip.end.ticks);
          if ((position === "start" || position === "both") && __newTransitionCovers(domTrack, {}, clipStartTicks, frameTicks)) {
            return __error("A transition already covers the clip start; no transition was attempted.");
          }
          if ((position === "end" || position === "both") && __newTransitionCovers(domTrack, {}, clipEndTicks, frameTicks)) {
            return __error("A transition already covers the clip end; no transition was attempted.");
          }
          if (position === "start" || position === "both") requestedEdges.push({ edge: "start", ticks: clipStartTicks, seconds: __ticksToSeconds(clipStartTicks) });
          if (position === "end" || position === "both") requestedEdges.push({ edge: "end", ticks: clipEndTicks, seconds: __ticksToSeconds(clipEndTicks) });
          
          if (position === "start" || position === "both") {
            try {
              qeClip.addTransition(transitionQE, true, String(durationFrames), "0", 0.5, false, true);
            } catch (startTransitionError) {
              return __transitionAttemptFailure(domTrack, transitionCountBefore, "QE clip addTransition rejected the transition at the clip start: " + startTransitionError.toString(), { requestedEdges: requestedEdges });
            }
          }
          if (position === "end" || position === "both") {
            try {
              qeClip.addTransition(transitionQE, false, String(durationFrames), "0", 0.5, false, true);
            } catch (endTransitionError) {
              var completedEdges = [];
              try {
                if (__newTransitionCovers(domTrack, transitionKeysBefore, clipStartTicks, frameTicks)) completedEdges.push("start");
                if (__newTransitionCovers(domTrack, transitionKeysBefore, clipEndTicks, frameTicks)) completedEdges.push("end");
              } catch (edgeReadError) {}
              return __transitionAttemptFailure(domTrack, transitionCountBefore, "QE clip addTransition rejected the transition at the clip end: " + endTransitionError.toString(), { requestedCount: requestedCount, requestedEdges: requestedEdges, completedEdges: completedEdges });
            }
          }

          try {
          var verifiedCount = domTrack.transitions.numItems - transitionCountBefore;
          if (verifiedCount !== requestedCount) {
            if (verifiedCount > 0) return __jsonStringify({ success: false, error: "Premiere added " + verifiedCount + " of " + requestedCount + " requested transition(s). Inspect the clip or use Undo.", data: { outcome: "committed_unverified", verified: false, timelineChanged: true, transitionsAdded: verifiedCount, requestedCount: requestedCount, requestedEdges: requestedEdges } });
            return __jsonStringify({ success: false, error: "Premiere added none of the requested transitions.", data: { outcome: "not_applied", verified: false, timelineChanged: false, transitionsAdded: 0, requestedCount: requestedCount, requestedEdges: requestedEdges } });
          }
          var startVerified = (position !== "start" && position !== "both") || __newTransitionCovers(domTrack, transitionKeysBefore, clipStartTicks, frameTicks);
          var endVerified = (position !== "end" && position !== "both") || __newTransitionCovers(domTrack, transitionKeysBefore, clipEndTicks, frameTicks);
          if (!startVerified || !endVerified) return __jsonStringify({ success: false, error: "Premiere added transitions, but DOM readback did not find each requested clip edge. Inspect the clip or use Undo.", data: { outcome: "committed_unverified", verified: false, timelineChanged: true, transitionsAdded: verifiedCount, requestedCount: requestedCount, startVerified: startVerified, endVerified: endVerified } });
          
          return __result({
            added: true,
            verified: true,
            transition: transitionName,
            clipName: clip.name,
            position: position,
            requestedDurationSeconds: ${duration},
            placements: __transitionReadbacks(domTrack, transitionKeysBefore),
            outcome: "verified",
            transitionsAdded: verifiedCount,
            requestedEdges: requestedEdges
          });
          } catch (transitionReadbackError) {
            return __transitionAttemptFailure(domTrack, transitionCountBefore, "Transition readback failed: " + transitionReadbackError.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    batch_add_transitions: {
      description: "EXPERIMENTAL (undocumented QE DOM): Add the same video transition at each eligible cut point on a track and report per-cut readback.",
      parameters: {
        type: "object" as const,
        properties: {
          transition_name: {
            type: "string",
            description: "Name of the transition (e.g., 'Cross Dissolve')",
          },
          track_index: {
            type: "number",
            description: "Video track index (0-based, default: 0)",
          },
          duration_seconds: {
            type: "number",
            description: "Duration of each transition in seconds (default: 1.0)",
          },
        },
        required: ["transition_name"],
      },
      handler: async (args: {
        transition_name: string;
        track_index?: number;
        duration_seconds?: number;
      }) => {
        const trackIndex = args.track_index ?? 0;
        const duration = args.duration_seconds ?? 1.0;
        const invalid = validateTransitionRequest(duration, trackIndex);
        if (invalid) return invalid;

        const script = buildToolScript(`
          ${TRANSITION_FAILURE_RECEIPT}
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var transitionName = "${escapeForExtendScript(args.transition_name)}";
          var transitionQE = null;
          try { if (qe.project.getVideoTransitionByName) transitionQE = qe.project.getVideoTransitionByName(transitionName); } catch(e1) {}
          if (!transitionQE) {
            try {
              var transitions = __qeCatalogFrom(qe.project.getVideoTransitionList());
              for (var i = 0; i < transitions.numItems; i++) {
                if (transitions[i].name === transitionName) { transitionQE = __qeTransitionObject("video", transitions[i]); break; }
              }
            } catch(e2) {}
          }
          if (!transitionQE) return __error("Transition not found: " + transitionName);

          var track = seq.videoTracks[${trackIndex}];
          var qeTrack = qeSeq.getVideoTrackAt(${trackIndex});
          if (!track || !qeTrack) return __error("Video track not found");
          var frameTicks = parseFloat(seq.timebase);
          if (!frameTicks || isNaN(frameTicks)) return __error("The active sequence did not expose a valid timebase for transition duration.");
          var durationFrames = Math.max(1, Math.round(__secondsToTicks(${duration}) / frameTicks));
          var transitionCountBefore = track.transitions.numItems;
          var transitionKeysBefore = __transitionKeys(track);
          var requestedCount = 0;
          var requestedCuts = [];
          var failures = [];
          
          // A cut that already has a transition is left as it is: Premiere will
          // not stack a second one there, which used to make a batch after a
          // single add_transition_to_clip report "verified 3 of 4".
          function cutHasTransition(cutTicks) {
            for (var ti = 0; ti < track.transitions.numItems; ti++) {
              var existingStart = parseFloat(track.transitions[ti].start.ticks);
              var existingEnd = parseFloat(track.transitions[ti].end.ticks);
              if (!isNaN(existingStart) && !isNaN(existingEnd) && existingStart - (frameTicks / 2 + 1) <= cutTicks && cutTicks <= existingEnd + (frameTicks / 2 + 1)) return true;
            }
            return false;
          }
          var alreadyPresent = 0;

          // Add transition at each cut point (between consecutive clips)
          for (var c = 0; c < track.clips.numItems - 1; c++) {
            var outgoingClip = track.clips[c];
            var incomingClip = track.clips[c + 1];
            if (Math.abs(parseFloat(outgoingClip.end.ticks) - parseFloat(incomingClip.start.ticks)) >= 1) continue;
            if (cutHasTransition(parseFloat(incomingClip.start.ticks))) { alreadyPresent++; continue; }
            requestedCount++;
            requestedCuts.push({ index: c, ticks: parseFloat(incomingClip.start.ticks) });
            var qeClip = __findQeClipByDomClip(qeTrack, incomingClip);
            if (!qeClip || typeof qeClip.addTransition !== "function") {
              failures.push("cut " + c + ": target QE clip does not expose addTransition");
              continue;
            }
            try {
              qeClip.addTransition(transitionQE, true, String(durationFrames), "0", 0.5, false, true);
            } catch(e) { failures.push("cut " + c + ": " + e.toString()); }
          }

          try {
          var transitionCountAfter = track.transitions.numItems;
          var verifiedCount = transitionCountAfter - transitionCountBefore;
          if (requestedCount === 0) {
            if (alreadyPresent > 0) return __result({ added: 0, alreadyPresent: alreadyPresent, verified: true, outcome: "verified", transition: transitionName, trackIndex: ${trackIndex}, requestedDurationSeconds: ${duration}, message: "All adjacent cuts already have transitions; no changes were made." });
            return __jsonStringify({ success: false, error: "No adjacent video clips were found, so no transitions were attempted.", data: { outcome: "not_applied", verified: false, timelineChanged: false, added: 0, alreadyPresent: 0 } });
          }
          if (verifiedCount !== requestedCount) {
            var failedCuts = [];
            for (var fc = 0; fc < requestedCuts.length; fc++) if (!__newTransitionCovers(track, transitionKeysBefore, requestedCuts[fc].ticks, frameTicks)) failedCuts.push(requestedCuts[fc].index);
            return __jsonStringify({ success: false, error: "QE clip addTransition applied " + verifiedCount + " of " + requestedCount + " requested transitions" + (failures.length ? ": " + failures.join("; ") : ".") + (verifiedCount ? " Inspect the track or use Undo." : ""), data: { outcome: verifiedCount ? "committed_unverified" : "not_applied", verified: false, timelineChanged: verifiedCount > 0, added: verifiedCount, requestedCount: requestedCount, alreadyPresent: alreadyPresent, failedCuts: failedCuts } });
          }
          for (var rc = 0; rc < requestedCuts.length; rc++) {
            if (!__newTransitionCovers(track, transitionKeysBefore, requestedCuts[rc].ticks, frameTicks)) {
              return __jsonStringify({ success: false, error: "Premiere added transitions, but DOM readback did not find a new transition at cut " + requestedCuts[rc].index + ". Inspect the track or use Undo.", data: { outcome: "committed_unverified", verified: false, timelineChanged: true, added: verifiedCount, requestedCount: requestedCount, failedCut: requestedCuts[rc].index } });
            }
          }
          
          return __result({
            added: verifiedCount,
            alreadyPresent: alreadyPresent,
            verified: true,
            outcome: "verified",
            transition: transitionName,
            trackIndex: ${trackIndex},
            requestedDurationSeconds: ${duration},
            placements: __transitionReadbacks(track, transitionKeysBefore),
            cutCount: requestedCuts.length
          });
          } catch (transitionReadbackError) {
            return __transitionAttemptFailure(track, transitionCountBefore, "Transition readback failed: " + transitionReadbackError.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_available_transitions: {
      description: "EXPERIMENTAL (undocumented QE DOM): List video transitions. Returns a built-in hint set on PPro 2026 where the registry list is empty even though by-name lookup works; the hint set is not exhaustive.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.enableQE();
          var list = [];
          try {
            var transitions = __qeCatalogFrom(qe.project.getVideoTransitionList());
            for (var i = 0; i < transitions.numItems; i++) {
              list.push({ name: transitions[i].name, index: i });
            }
          } catch(e) {}

          // PPro 2026 fallback: the registry list is empty but by-name lookup
          // resolves these standard transitions. Probe each so callers see
          // something usable.
          if (list.length === 0 && qe.project.getVideoTransitionByName) {
            var names = ["Cross Dissolve","Dip to Black","Dip to White","Film Dissolve","Additive Dissolve","Morph Cut","Push","Slide","Wipe","Iris Round","Iris Box"];
            for (var n = 0; n < names.length; n++) {
              try {
                if (qe.project.getVideoTransitionByName(names[n])) {
                  list.push({ name: names[n], source: "byName" });
                }
              } catch(e2) {}
            }
          }
          if (list.length === 0) return __error("Premiere did not expose an enumerable video-transition catalog or resolve any built-in hint names through QE.");
          return __result(list);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_available_audio_transitions: {
      description: "EXPERIMENTAL (undocumented QE DOM): List audio transitions. Reports an unavailable or empty legacy catalog as an error rather than an assumed usable list.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.enableQE();
          var transitions = null;
          try { transitions = __qeCatalogFrom(qe.project.getAudioTransitionList()); } catch (catalogError) {
            return __error("Premiere did not expose an audio-transition catalog through QE: " + catalogError.toString());
          }
          if (!transitions || typeof transitions.numItems !== "number") {
            return __error("Premiere did not expose an enumerable audio-transition catalog through QE.");
          }
          var list = [];
          for (var i = 0; i < transitions.numItems; i++) {
            list.push({ name: transitions[i].name, index: i });
          }
          if (list.length === 0) {
            return __error("QE reported an empty audio-transition catalog. No supported by-name fallback is available, so no transition availability is claimed.");
          }
          return __result({ transitions: list, verified: true, source: "qe.catalog" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
