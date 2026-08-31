import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getTransitionsTools(bridgeOptions: BridgeOptions) {
  return {
    add_transition: {
      description: "Add a video transition between two clips at a cut point. Uses QE DOM.",
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
        const script = buildToolScript(`
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
              var transitions = qe.project.getVideoTransitionList();
              for (var i = 0; i < transitions.numItems; i++) {
                if (transitions[i].name === transitionName) {
                  transitionQE = transitions[i];
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
          for (var c = 0; c < domTrack.clips.numItems; c++) {
            var candidate = domTrack.clips[c];
            if (Math.abs(parseFloat(candidate.end.ticks) - cutTicks) < 1) { outgoingClip = candidate; break; }
          }
          if (!outgoingClip) return __error("No video clip ends at the requested cut point, so no transition was attempted.");
          var qeClip = __findQeClipByDomClip(qeTrack, outgoingClip);
          if (!qeClip || typeof qeClip.addTransition !== "function") {
            return __error("The target QE clip does not expose addTransition; no transition was attempted. The QE track itself is not the transition write surface.");
          }

          var seq = app.project.activeSequence;
          var frameTicks = parseFloat(seq.timebase);
          if (!frameTicks || isNaN(frameTicks)) return __error("The active sequence did not expose a valid timebase for transition duration.");
          var durationFrames = Math.max(1, Math.round(__secondsToTicks(${duration}) / frameTicks));
          var transitionCountBefore = domTrack.transitions.numItems;
          try {
            // QE transition writes belong to the clip. The legacy method takes
            // a clip edge, duration in sequence frames, offset, alignment, and
            // single-sided flags; DOM readback below decides whether it worked.
            qeClip.addTransition(transitionQE, true, String(durationFrames), "0", 0.5, false, true);
          } catch (transitionError) {
            return __error("QE clip addTransition rejected the transition: " + transitionError.toString());
          }

          if (domTrack.transitions.numItems <= transitionCountBefore) {
            return __error("QE clip addTransition returned without adding a transition to the track.");
          }

          return __result({
            added: true,
            verified: true,
            transition: transitionName,
            trackIndex: ${args.track_index},
            atSeconds: ${args.cut_point_seconds},
            durationSeconds: ${duration}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_transition_to_clip: {
      description: "Add a transition to a specific clip's start or end",
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
        const position = args.position || "end";
        const duration = args.duration_seconds ?? 1.0;

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var transitionName = "${escapeForExtendScript(args.transition_name)}";
          var transitionQE = null;
          try { if (qe.project.getVideoTransitionByName) transitionQE = qe.project.getVideoTransitionByName(transitionName); } catch(e1) {}
          if (!transitionQE) {
            try {
              var transitions = qe.project.getVideoTransitionList();
              for (var i = 0; i < transitions.numItems; i++) {
                if (transitions[i].name === transitionName) { transitionQE = transitions[i]; break; }
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
          var durationFrames = Math.max(1, Math.round(__secondsToTicks(${duration}) / frameTicks));
          var clip = result.clip;
          var position = "${position}";
          var requestedCount = position === "both" ? 2 : 1;
          
          if (position === "start" || position === "both") {
            try {
              qeClip.addTransition(transitionQE, false, String(durationFrames), "0", 0.5, true, true);
            } catch (startTransitionError) {
              return __error("QE clip addTransition rejected the transition at the clip start: " + startTransitionError.toString());
            }
          }
          if (position === "end" || position === "both") {
            try {
              qeClip.addTransition(transitionQE, true, String(durationFrames), "0", 0.5, true, true);
            } catch (endTransitionError) {
              return __error("QE clip addTransition rejected the transition at the clip end: " + endTransitionError.toString());
            }
          }

          var verifiedCount = domTrack.transitions.numItems - transitionCountBefore;
          if (verifiedCount < requestedCount) {
            return __error("QE clip addTransition returned, but Premiere added " + verifiedCount + " of " + requestedCount + " requested transition(s) to the track.");
          }
          
          return __result({
            added: true,
            verified: true,
            transition: transitionName,
            clipName: clip.name,
            position: position,
            durationSeconds: ${duration}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    batch_add_transitions: {
      description: "Add the same transition to all cut points on a track",
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

        const script = buildToolScript(`
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
              var transitions = qe.project.getVideoTransitionList();
              for (var i = 0; i < transitions.numItems; i++) {
                if (transitions[i].name === transitionName) { transitionQE = transitions[i]; break; }
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
          var requestedCount = 0;
          var failures = [];
          
          // Add transition at each cut point (between consecutive clips)
          for (var c = 0; c < track.clips.numItems - 1; c++) {
            var outgoingClip = track.clips[c];
            var incomingClip = track.clips[c + 1];
            if (Math.abs(parseFloat(outgoingClip.end.ticks) - parseFloat(incomingClip.start.ticks)) >= 1) continue;
            requestedCount++;
            var qeClip = __findQeClipByDomClip(qeTrack, outgoingClip);
            if (!qeClip || typeof qeClip.addTransition !== "function") {
              failures.push("cut " + c + ": target QE clip does not expose addTransition");
              continue;
            }
            try {
              qeClip.addTransition(transitionQE, true, String(durationFrames), "0", 0.5, false, true);
            } catch(e) { failures.push("cut " + c + ": " + e.toString()); }
          }

          var transitionCountAfter = track.transitions.numItems;
          var verifiedCount = transitionCountAfter - transitionCountBefore;
          if (requestedCount === 0) return __error("No adjacent video clips were found, so no transitions were attempted.");
          if (verifiedCount !== requestedCount) {
            return __error("QE clip addTransition verified " + verifiedCount + " of " + requestedCount + " requested transitions" + (failures.length ? ": " + failures.join("; ") : "."));
          }
          
          return __result({
            added: verifiedCount,
            verified: true,
            transition: transitionName,
            trackIndex: ${trackIndex},
            durationSeconds: ${duration}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_available_transitions: {
      description: "List all available video transitions. Uses QE DOM. Returns a hint set on PPro 2026 where the transition registry list is empty even though by-name lookup works.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.enableQE();
          var list = [];
          try {
            var transitions = qe.project.getVideoTransitionList();
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
          return __result(list);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_available_audio_transitions: {
      description: "List all available audio transitions. Uses QE DOM and reports an unavailable or empty legacy catalog as an error rather than an assumed usable list.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.enableQE();
          var transitions = null;
          try { transitions = qe.project.getAudioTransitionList(); } catch (catalogError) {
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
