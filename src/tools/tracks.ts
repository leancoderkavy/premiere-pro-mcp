import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function getTrackTools(bridgeOptions: BridgeOptions) {
  return {
    add_track: {
      description:
        "Add verified video or audio tracks to the active sequence. Returns an error if Premiere cannot add the exact requested count.",
      parameters: {
        type: "object" as const,
        properties: {
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Type of track to add",
          },
          count: {
            type: "number",
            description: "Number of tracks to add (default: 1)",
          },
        },
        required: ["track_type"],
      },
      handler: async (args: { track_type: string; count?: number }) => {
        const count = args.count ?? 1;
        if (args.track_type !== "video" && args.track_type !== "audio") {
          return { success: false, error: "track_type must be either video or audio" };
        }
        if (!isPositiveInteger(count)) {
          return { success: false, error: "count must be a positive integer" };
        }

        const isVideo = args.track_type === "video";
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var before = ${isVideo ? "seq.videoTracks.numTracks" : "seq.audioTracks.numTracks"};
          var expected = before + ${count};
          var method = "public DOM";
          var publicFailure = "";

          // Premiere 26.x can expose this public Sequence API but reject the
          // call. Do not report the request as successful until the DOM count
          // proves it happened. If the public call made no change, QE is a
          // bounded fallback; a partially applied public call is never retried.
          try {
            if (typeof seq.${isVideo ? "insertVideoTrackAt" : "insertAudioTrackAt"} !== "function") {
              publicFailure = "Sequence.${isVideo ? "insertVideoTrackAt" : "insertAudioTrackAt"} is unavailable";
            } else {
              ${isVideo
                ? `seq.insertVideoTrackAt(before, ${count});`
                : `seq.insertAudioTrackAt(before, ${count});`}
            }
          } catch (publicError) {
            publicFailure = publicError.toString();
          }

          var afterPublic = ${isVideo ? "seq.videoTracks.numTracks" : "seq.audioTracks.numTracks"};
          if (afterPublic !== expected && afterPublic !== before) {
            return __error("Track add partially applied through the public DOM: requested ${count} ${args.track_type} track(s), had " + before + ", now has " + afterPublic + ". It was not retried.");
          }

          if (afterPublic !== expected) {
            method = "QE fallback";
            if (typeof app.enableQE !== "function") {
              return __error("Could not add ${args.track_type} track(s): " + publicFailure + ". QE fallback is unavailable on this Premiere build.");
            }
            app.enableQE();
            if (typeof qe === "undefined" || !qe.project || typeof qe.project.getActiveSequence !== "function") {
              return __error("Could not add ${args.track_type} track(s): " + publicFailure + ". QE active-sequence access is unavailable on this Premiere build.");
            }
            var qeSeq = qe.project.getActiveSequence();
            if (!qeSeq || typeof qeSeq.addTracks !== "function") {
              return __error("Could not add ${args.track_type} track(s): " + publicFailure + ". QE addTracks is unavailable on this Premiere build.");
            }
            try {
              // addTracks(videoCount, videoInsertIndex, audioCount, audioType, audioInsertIndex, submixCount, submixType); append stereo audio.
              qeSeq.addTracks(${isVideo ? count : 0}, seq.videoTracks.numTracks, ${isVideo ? 0 : count}, 1, seq.audioTracks.numTracks, 0, 0);
            } catch (qeError) {
              return __error("Could not add ${args.track_type} track(s): public DOM failed (" + publicFailure + ") and QE addTracks failed (" + qeError.toString() + ").");
            }
          }

          var after = ${isVideo ? "seq.videoTracks.numTracks" : "seq.audioTracks.numTracks"};
          if (after !== expected) {
            return __error("Premiere did not add the requested ${args.track_type} tracks: requested ${count}, had " + before + ", now has " + after + " (" + method + ").");
          }

          return __result({
            added: ${count},
            trackType: "${args.track_type}",
            totalTracks: after,
            method: method,
            verified: true
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    delete_track: {
      description:
        "EXPERIMENTAL (undocumented QE DOM: removeVideoTrack/removeAudioTrack). Delete a video or audio track from the active sequence through QE and verify that exactly that track was removed (the remaining tracks keep their clips, custom names and lock/mute state in order). Refuses a track that still holds clips unless force is true.",
      parameters: {
        type: "object" as const,
        properties: {
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Type of track to delete",
          },
          track_index: {
            type: "number",
            description: "Index of the track to delete (0-based)",
          },
          force: {
            type: "boolean",
            description: "Also delete a track that holds clips, removing those clips (default: false)",
          },
        },
        required: ["track_type", "track_index"],
      },
      handler: async (args: { track_type: string; track_index: number; force?: boolean }) => {
        if (args.track_type !== "video" && args.track_type !== "audio") {
          return { success: false, error: "track_type must be either video or audio" };
        }
        if (!Number.isInteger(args.track_index) || args.track_index < 0) {
          return { success: false, error: "track_index must be a non-negative integer" };
        }
        const video = args.track_type === "video";
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var tracks = ${video ? "seq.videoTracks" : "seq.audioTracks"};
          var before = tracks.numTracks;
          if (${args.track_index} >= before) return __error("Track index out of range");
          if (before <= 1) return __error("A sequence keeps at least one ${args.track_type} track");
          // Identity of every track before the delete: clip IDs, custom name and
          // lock/mute state. Premiere's default names are a prefix plus the track's
          // position ("Video 3", "Vidéo 3") and renumber when a track goes. The
          // prefix is learned from the tracks whose number matches their position
          // before the delete, then that prefix is ignored at any number, before
          // and after, so a custom name such as "Cam 4" is compared the same way
          // on both sides even when its track moves.
          var numberedName = function (name) {
            var match = /^(.*[^0-9\\s])\\s*([0-9]+)$/.exec(name);
            return match ? { prefix: match[1], number: Number(match[2]) } : null;
          };
          var defaultPrefixes = {};
          for (var dp = 0; dp < tracks.numTracks; dp++) {
            var learned = numberedName(String(tracks[dp].name || ""));
            if (learned && learned.number === dp + 1) defaultPrefixes[learned.prefix] = true;
          }
          var trackSignature = function (track) {
            var ids = [];
            for (var c = 0; c < track.clips.numItems; c++) ids.push(String(track.clips[c].nodeId));
            var name = String(track.name || "");
            var numbered = numberedName(name);
            if (numbered && defaultPrefixes[numbered.prefix]) name = "";
            var locked = null, muted = null;
            try { locked = !!track.isLocked(); } catch (eLocked) {}
            try { muted = !!track.isMuted(); } catch (eMuted) {}
            return ids.join(",") + "|" + name + "|" + locked + "|" + muted;
          };
          var signaturesOf = function (list) {
            var out = [];
            for (var t = 0; t < list.numTracks; t++) out.push(trackSignature(list[t]));
            return out;
          };
          var beforeSignatures = signaturesOf(tracks);
          var deletedName = String(tracks[${args.track_index}].name || "");
          var clipCount = tracks[${args.track_index}].clips.numItems;
          if (clipCount > 0 && ${args.force === true ? "false" : "true"}) {
            return __error("${video ? "V" : "A"}${args.track_index + 1} holds " + clipCount + " clip(s); pass force: true to delete the track and those clips.");
          }
          // Sequence.deleteVideoTrackAt does not exist (live 25.2); QE removes tracks.
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("QE could not resolve the active sequence");
          qeSeq.${video ? "removeVideoTrack" : "removeAudioTrack"}(${args.track_index});
          var after = (${video ? "seq.videoTracks" : "seq.audioTracks"}).numTracks;
          if (after !== before - 1) return __error("Premiere did not remove the track (" + before + " -> " + after + " ${args.track_type} tracks)");
          var expected = beforeSignatures.slice(0, ${args.track_index}).concat(beforeSignatures.slice(${args.track_index + 1}));
          var afterSignatures = signaturesOf(${video ? "seq.videoTracks" : "seq.audioTracks"});
          if (afterSignatures.join(";") !== expected.join(";")) {
            var removedIndex = -1;
            for (var r = 0; r < before; r++) {
              var candidate = beforeSignatures.slice(0, r).concat(beforeSignatures.slice(r + 1));
              if (candidate.join(";") === afterSignatures.join(";")) { removedIndex = r; break; }
            }
            return __jsonStringify({ success: false, error: "The timeline changed: Premiere removed a ${args.track_type} track, but not ${video ? "V" : "A"}${args.track_index + 1}" + (removedIndex >= 0 ? " (it removed ${video ? "V" : "A"}" + (removedIndex + 1) + " instead)" : " (the remaining tracks do not match any single-track removal)") + ". Inspect the sequence.", data: { timelineChanged: true, requestedTrackIndex: ${args.track_index}, removedTrackIndex: removedIndex >= 0 ? removedIndex : null } });
          }
          return __result({ deleted: true, verified: true, trackType: "${args.track_type}", trackIndex: ${args.track_index}, trackName: deletedName, clipsRemoved: clipCount, remainingTracks: after,
            verification: "the remaining tracks match the track list before the delete with this track taken out (clip IDs, custom names, lock and mute state)" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    lock_track: {
      description: "Set a video track's lock state and read it back to verify the change.",
      parameters: {
        type: "object" as const,
        properties: {
          track_index: {
            type: "number",
            description: "Video track index (0-based)",
          },
          locked: {
            type: "boolean",
            description: "True to lock, false to unlock",
          },
        },
        required: ["track_index", "locked"],
      },
      handler: async (args: { track_index: number; locked: boolean }) => {
        if (!Number.isInteger(args.track_index) || args.track_index < 0) return { success: false, error: "track_index must be a non-negative integer." };
        if (typeof args.locked !== "boolean") return { success: false, error: "locked must be a boolean." };
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          if (${args.track_index} >= seq.videoTracks.numTracks) return __error("Track index out of range");
          
          var track = seq.videoTracks[${args.track_index}];
          if (!track || typeof track.isLocked !== "function" || typeof track.setLocked !== "function") return __error("Track lock state cannot be read or set on this Premiere host; nothing was changed.");
          var beforeLocked;
          try { beforeLocked = track.isLocked(); } catch (beforeLockError) { return __error("Track lock state could not be read before mutation; nothing was changed: " + beforeLockError.toString()); }
          if (typeof beforeLocked !== "boolean") return __error("Track lock state was not boolean before mutation; nothing was changed.");
          var writeError = null;
          try { track.setLocked(${args.locked ? 1 : 0}); } catch (lockError) { writeError = lockError.toString(); }
          var actualLocked = null;
          try { actualLocked = track.isLocked(); } catch (readError) {}
          if (typeof actualLocked !== "boolean") return __jsonStringify({ success: false, error: "Track lock write was attempted, but Premiere did not return a boolean lock state. Inspect the track before retrying.", data: { outcome: "committed_unverified", verified: false, timelineChanged: true, trackIndex: ${args.track_index}, requestedLocked: ${args.locked}, actualLocked: null } });
          if (actualLocked !== ${args.locked ? "true" : "false"}) return __jsonStringify({ success: false, error: "Premiere did not verify the requested track lock state" + (writeError ? ": " + writeError : "") + ". Inspect the track before retrying.", data: { outcome: beforeLocked !== actualLocked ? "committed_unverified" : "not_applied", verified: false, timelineChanged: beforeLocked !== actualLocked, trackIndex: ${args.track_index}, requestedLocked: ${args.locked}, actualLocked: actualLocked } });
          return __result({ trackIndex: ${args.track_index}, locked: actualLocked, trackName: track.name, verified: true, outcome: "verified", timelineChanged: beforeLocked !== actualLocked });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    toggle_track_visibility: {
      description: "Set video track visibility using Premiere's track mute state (eye icon) and read the mute state back. Premiere's scripting API exposes mute, not a separate video visibility setter.",
      parameters: {
        type: "object" as const,
        properties: {
          track_index: {
            type: "number",
            description: "Video track index (0-based)",
          },
          visible: {
            type: "boolean",
            description: "True to show, false to hide",
          },
        },
        required: ["track_index", "visible"],
      },
      handler: async (args: { track_index: number; visible: boolean }) => {
        if (!Number.isInteger(args.track_index) || args.track_index < 0) return { success: false, error: "track_index must be a non-negative integer." };
        if (typeof args.visible !== "boolean") return { success: false, error: "visible must be a boolean." };
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          if (${args.track_index} >= seq.videoTracks.numTracks) return __error("Track index out of range");
          
          var track = seq.videoTracks[${args.track_index}];
          if (!track || typeof track.isMuted !== "function" || typeof track.setMute !== "function") return __error("Track mute/visibility state cannot be read or set on this Premiere host; nothing was changed.");
          var beforeMuted;
          try { beforeMuted = track.isMuted(); } catch (beforeMuteError) { return __error("Track mute state could not be read before mutation; nothing was changed: " + beforeMuteError.toString()); }
          if (typeof beforeMuted !== "boolean") return __error("Track mute state was not boolean before mutation; nothing was changed.");
          var writeError = null;
          try { track.setMute(${args.visible ? "0" : "1"}); } catch (muteError) { writeError = muteError.toString(); }
          var actualMuted = null;
          try { actualMuted = track.isMuted(); } catch (readError) {}
          if (typeof actualMuted !== "boolean") return __jsonStringify({ success: false, error: "Track mute write was attempted, but Premiere did not return a boolean mute state. Inspect the track before retrying.", data: { outcome: "committed_unverified", verified: false, timelineChanged: true, trackIndex: ${args.track_index}, requestedVisible: ${args.visible}, actualMuted: null } });
          var wantedMuted = ${args.visible ? "false" : "true"};
          if (actualMuted !== wantedMuted) return __jsonStringify({ success: false, error: "Premiere did not verify the requested track visibility" + (writeError ? ": " + writeError : "") + ". Inspect the track before retrying.", data: { outcome: beforeMuted !== actualMuted ? "committed_unverified" : "not_applied", verified: false, timelineChanged: beforeMuted !== actualMuted, trackIndex: ${args.track_index}, requestedVisible: ${args.visible}, actualMuted: actualMuted } });
          return __result({ trackIndex: ${args.track_index}, visible: !actualMuted, muted: actualMuted, trackName: track.name, verified: true, outcome: "verified", timelineChanged: beforeMuted !== actualMuted });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
