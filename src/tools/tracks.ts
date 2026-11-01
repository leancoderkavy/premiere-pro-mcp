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
          if (!seq) return __refuse("No active sequence");

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
        "EXPERIMENTAL (undocumented QE DOM: removeVideoTrack/removeAudioTrack). Delete a video or audio track from the active sequence through QE and verify that exactly that track was removed (the remaining tracks keep their clips, custom names and lock/mute state in order). Refuses a track that still holds clips unless force is true. Caption tracks cannot be deleted (no host API); a caption track_type is refused with the manual route.",
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
        if (args.track_type === "caption" || args.track_type === "captions") {
          return {
            success: false,
            error:
              "Caption tracks cannot be deleted through this bridge: QE removeVideoTrack/removeAudioTrack only remove video and audio tracks, and Premiere's UXP caption track API has no delete. Nothing was changed. Delete it in Premiere (right-click the caption track header > Delete Track); inspect_caption_tracks_uxp lists caption tracks.",
            data: { code: "CAPTION_TRACK_DELETE_UNSUPPORTED", applied: false },
          };
        }
        if (args.track_type !== "video" && args.track_type !== "audio") {
          return { success: false, error: "track_type must be either video or audio" };
        }
        if (!Number.isInteger(args.track_index) || args.track_index < 0) {
          return { success: false, error: "track_index must be a non-negative integer" };
        }
        const video = args.track_type === "video";
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __refuse("No active sequence");
          var tracks = ${video ? "seq.videoTracks" : "seq.audioTracks"};
          var before = tracks.numTracks;
          if (${args.track_index} >= before) return __refuse("Track index out of range");
          if (before <= 1) return __refuse("A sequence keeps at least one ${args.track_type} track");
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
          if (!seq) return __refuse("No active sequence");
          
          if (${args.track_index} >= seq.videoTracks.numTracks) return __refuse("Track index out of range");
          
          var track = seq.videoTracks[${args.track_index}];
          if (!track || typeof track.isLocked !== "function" || typeof track.setLocked !== "function") return __refuse("Track lock state cannot be read or set on this Premiere host; nothing was changed.");
          var beforeLocked;
          try { beforeLocked = track.isLocked(); } catch (beforeLockError) { return __error("Track lock state could not be read before mutation; nothing was changed: " + beforeLockError.toString()); }
          if (typeof beforeLocked !== "boolean") return __error("Track lock state was not boolean before mutation; nothing was changed.");
          var writeError = null;
          try { track.setLocked(${args.locked ? 1 : 0}); } catch (lockError) { writeError = lockError.toString(); }
          var actualLocked = null;
          try { actualLocked = track.isLocked(); } catch (readError) {}
          if (typeof actualLocked !== "boolean") return __jsonStringify({ success: false, error: "Track lock write was attempted, but Premiere did not return a boolean lock state. Inspect the track before retrying.", data: { outcome: "committed_unverified", verified: false, timelineChanged: null, trackIndex: ${args.track_index}, requestedLocked: ${args.locked}, actualLocked: null } });
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
          if (!seq) return __refuse("No active sequence");
          
          if (${args.track_index} >= seq.videoTracks.numTracks) return __refuse("Track index out of range");
          
          var track = seq.videoTracks[${args.track_index}];
          if (!track || typeof track.isMuted !== "function" || typeof track.setMute !== "function") return __refuse("Track mute/visibility state cannot be read or set on this Premiere host; nothing was changed.");
          var beforeMuted;
          try { beforeMuted = track.isMuted(); } catch (beforeMuteError) { return __error("Track mute state could not be read before mutation; nothing was changed: " + beforeMuteError.toString()); }
          if (typeof beforeMuted !== "boolean") return __error("Track mute state was not boolean before mutation; nothing was changed.");
          var writeError = null;
          try { track.setMute(${args.visible ? "0" : "1"}); } catch (muteError) { writeError = muteError.toString(); }
          var actualMuted = null;
          try { actualMuted = track.isMuted(); } catch (readError) {}
          if (typeof actualMuted !== "boolean") return __jsonStringify({ success: false, error: "Track mute write was attempted, but Premiere did not return a boolean mute state. Inspect the track before retrying.", data: { outcome: "committed_unverified", verified: false, timelineChanged: null, trackIndex: ${args.track_index}, requestedVisible: ${args.visible}, actualMuted: null } });
          var wantedMuted = ${args.visible ? "false" : "true"};
          if (actualMuted !== wantedMuted) return __jsonStringify({ success: false, error: "Premiere did not verify the requested track visibility" + (writeError ? ": " + writeError : "") + ". Inspect the track before retrying.", data: { outcome: beforeMuted !== actualMuted ? "committed_unverified" : "not_applied", verified: false, timelineChanged: beforeMuted !== actualMuted, trackIndex: ${args.track_index}, requestedVisible: ${args.visible}, actualMuted: actualMuted } });
          return __result({ trackIndex: ${args.track_index}, visible: !actualMuted, muted: actualMuted, trackName: track.name, verified: true, outcome: "verified", timelineChanged: beforeMuted !== actualMuted });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
    set_track_states: {
      description:
        "Set mute, solo and lock on several video or audio tracks of the active sequence in one host command, with per-track readback. Every requested track is read first; if any target is out of range, unreadable or asks for a state this host cannot read and write (solo has no public ExtendScript API and is probed on the QE track), nothing is changed. snapshot: true returns the pre-write state of the same tracks as a restore payload this tool accepts unchanged; with no state fields at all it is a read-only capture.",
      parameters: {
        type: "object" as const,
        properties: {
          tracks: {
            type: "array",
            description: "Tracks to read or change. Omit a state field to leave it as it is.",
            minItems: 1,
            maxItems: 64,
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["video", "audio"], description: "Track type" },
                index: { type: "number", description: "Track index within that type (0-based)" },
                muted: { type: "boolean", description: "Desired mute state (video: hidden when true)" },
                solo: { type: "boolean", description: "Desired solo state; refused before mutation when the host exposes no solo API" },
                locked: { type: "boolean", description: "Desired lock state" },
              },
              required: ["type", "index"],
            },
          },
          snapshot: {
            type: "boolean",
            description: "True to return data.restore, the pre-write state of every requested track in the shape of the tracks argument (default: false).",
          },
        },
        required: ["tracks"],
      },
      handler: async (args: {
        tracks: Array<{ type: string; index: number; muted?: boolean; solo?: boolean; locked?: boolean }>;
        snapshot?: boolean;
      }) => {
        if (!Array.isArray(args.tracks) || args.tracks.length === 0) return { success: false, error: "tracks must be a non-empty array." };
        if (args.tracks.length > 64) return { success: false, error: "tracks accepts at most 64 entries per call." };
        if (args.snapshot !== undefined && typeof args.snapshot !== "boolean") return { success: false, error: "snapshot must be a boolean." };
        const seen = new Set<string>();
        const requests: Array<{ type: "video" | "audio"; index: number; muted?: boolean; solo?: boolean; locked?: boolean }> = [];
        for (let i = 0; i < args.tracks.length; i++) {
          const entry = args.tracks[i];
          if (!entry || typeof entry !== "object") return { success: false, error: `tracks[${i}] must be an object.` };
          if (entry.type !== "video" && entry.type !== "audio") return { success: false, error: `tracks[${i}].type must be video or audio.` };
          if (!Number.isInteger(entry.index) || entry.index < 0) return { success: false, error: `tracks[${i}].index must be a non-negative integer.` };
          for (const field of ["muted", "solo", "locked"] as const) {
            if (entry[field] !== undefined && typeof entry[field] !== "boolean") return { success: false, error: `tracks[${i}].${field} must be a boolean when present.` };
          }
          const key = `${entry.type}:${entry.index}`;
          if (seen.has(key)) return { success: false, error: `tracks lists ${entry.type} track ${entry.index} more than once.` };
          seen.add(key);
          const request: (typeof requests)[number] = { type: entry.type, index: entry.index };
          if (entry.muted !== undefined) request.muted = entry.muted;
          if (entry.solo !== undefined) request.solo = entry.solo;
          if (entry.locked !== undefined) request.locked = entry.locked;
          requests.push(request);
        }
        const snapshot = args.snapshot === true;
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var requests = ${JSON.stringify(requests)};
          var snapshot = ${snapshot ? "true" : "false"};
          var fields = ["muted", "solo", "locked"];
          var needsSolo = false;
          for (var n = 0; n < requests.length; n++) if (typeof requests[n].solo === "boolean") needsSolo = true;
          var qeSeq = null;
          try { app.enableQE(); qeSeq = qe.project.getActiveSequence(); } catch (qeError) { qeSeq = null; }
          // Refusals before any write carry a not_applied outcome so the receipt never reads as unknown.
          var __refuse = function (message, code, req, field) {
            return __jsonStringify({ success: false, error: message, data: { code: code, field: field || null, trackType: req.type, trackIndex: req.index, applied: false, outcome: "not_applied", mutationOutcome: "not_applied", timelineChanged: false } });
          };
          var readBool = function (fn, owner) {
            if (typeof fn !== "function") return null;
            var value = fn.call(owner);
            if (value === true || value === 1) return true;
            if (value === false || value === 0) return false;
            return null;
          };
          // One function per track so each reader and writer closes over its own
          // track (ExtendScript var is function-scoped, so inline closures in a
          // loop would all see the last track).
          var accessorsFor = function (track, qeTrack) {
            // Solo has no public DOM accessor; the DOM track and then the QE track are probed for isSolo/isSoloed plus setSolo.
            var soloRead = null, soloWrite = null, soloOwner = null;
            var candidates = [track, qeTrack];
            for (var c = 0; c < candidates.length && !soloRead; c++) {
              var owner = candidates[c];
              if (!owner) continue;
              var readName = typeof owner.isSolo === "function" ? "isSolo" : (typeof owner.isSoloed === "function" ? "isSoloed" : null);
              if (readName && typeof owner.setSolo === "function") { soloRead = owner[readName]; soloWrite = owner.setSolo; soloOwner = owner; }
            }
            return {
              support: {
                muted: typeof track.isMuted === "function" && typeof track.setMute === "function",
                solo: !!soloRead,
                locked: typeof track.isLocked === "function" && typeof track.setLocked === "function"
              },
              reader: {
                muted: function () { return readBool(track.isMuted, track); },
                solo: function () { return soloRead ? readBool(soloRead, soloOwner) : null; },
                locked: function () { return readBool(track.isLocked, track); }
              },
              writer: {
                muted: function (v) { track.setMute(v ? 1 : 0); },
                solo: function (v) { soloWrite.call(soloOwner, v ? 1 : 0); },
                locked: function (v) { track.setLocked(v ? 1 : 0); }
              }
            };
          };
          var resolved = [];
          for (var r = 0; r < requests.length; r++) {
            var req = requests[r];
            var list = req.type === "video" ? seq.videoTracks : seq.audioTracks;
            if (!list || req.index >= list.numTracks) return __refuse(req.type + " track " + req.index + " is out of range (" + (list ? list.numTracks : 0) + " " + req.type + " tracks); nothing was changed.", "TRACK_OUT_OF_RANGE", req);
            var track = list[req.index];
            if (!track) return __refuse(req.type + " track " + req.index + " could not be resolved; nothing was changed.", "TRACK_UNRESOLVED", req);
            var qeTrack = null;
            if (qeSeq) { try { qeTrack = req.type === "video" ? qeSeq.getVideoTrackAt(req.index) : qeSeq.getAudioTrackAt(req.index); } catch (qeTrackError) { qeTrack = null; } }
            var accessors = accessorsFor(track, qeTrack);
            var support = accessors.support, reader = accessors.reader;
            var before = {};
            for (var f = 0; f < fields.length; f++) {
              var field = fields[f];
              var wanted = typeof req[field] === "boolean";
              if (!support[field]) {
                if (wanted) return __jsonStringify({ success: false, error: req.type + " track " + req.index + " cannot read and set " + field + " on this Premiere host; nothing was changed.", data: { code: "TRACK_STATE_UNSUPPORTED", field: field, trackType: req.type, trackIndex: req.index, applied: false, outcome: "not_applied", mutationOutcome: "not_applied", timelineChanged: false, support: support } });
                before[field] = null;
                continue;
              }
              var value = null;
              try { value = reader[field](); } catch (readError) { value = null; }
              if (value === null) {
                if (wanted) return __refuse(req.type + " track " + req.index + " " + field + " state could not be read before mutation; nothing was changed.", "TRACK_STATE_UNREADABLE", req, field);
                before[field] = null;
                continue;
              }
              before[field] = value;
            }
            resolved.push({ req: req, before: before, support: support, reader: reader, writer: accessors.writer, name: String(track.name || "") });
          }
          var restore = [];
          for (var s = 0; s < resolved.length; s++) {
            var snap = { type: resolved[s].req.type, index: resolved[s].req.index };
            for (var sf = 0; sf < fields.length; sf++) if (resolved[s].before[fields[sf]] !== null) snap[fields[sf]] = resolved[s].before[fields[sf]];
            restore.push(snap);
          }
          var results = [];
          var writeErrors = [];
          var changed = 0, mismatches = 0, unreadable = 0, writes = 0;
          for (var w = 0; w < resolved.length; w++) {
            var item = resolved[w];
            var out = { trackType: item.req.type, trackIndex: item.req.index, trackName: item.name, before: item.before, requested: {}, after: {}, verified: true };
            for (var wf = 0; wf < fields.length; wf++) {
              var wField = fields[wf];
              if (typeof item.req[wField] !== "boolean") continue;
              out.requested[wField] = item.req[wField];
              if (item.before[wField] === item.req[wField]) continue;
              writes++;
              try { item.writer[wField](item.req[wField]); } catch (writeError) { writeErrors.push(item.req.type + " " + item.req.index + " " + wField + ": " + writeError.toString()); }
            }
            results.push(out);
          }
          for (var a = 0; a < resolved.length; a++) {
            var ritem = resolved[a];
            var rout = results[a];
            for (var af = 0; af < fields.length; af++) {
              var aField = fields[af];
              if (!ritem.support[aField]) { rout.after[aField] = null; continue; }
              var afterValue = null;
              try { afterValue = ritem.reader[aField](); } catch (afterError) { afterValue = null; }
              rout.after[aField] = afterValue;
              if (afterValue !== null && ritem.before[aField] !== null && afterValue !== ritem.before[aField]) changed++;
              if (typeof ritem.req[aField] !== "boolean") continue;
              if (afterValue === null) { unreadable++; rout.verified = false; }
              else if (afterValue !== ritem.req[aField]) { mismatches++; rout.verified = false; }
            }
          }
          var data = { tracks: results, trackCount: results.length, writes: writes, changed: changed, verified: mismatches === 0 && unreadable === 0, outcome: "verified", timelineChanged: changed > 0, snapshot: snapshot };
          if (snapshot) data.restore = { tracks: restore };
          if (unreadable > 0) {
            data.outcome = "committed_unverified"; data.verified = false; data.timelineChanged = changed > 0 ? true : null;
            return __jsonStringify({ success: false, error: "Track state writes were attempted, but " + unreadable + " state(s) did not read back as boolean. Inspect the tracks before retrying." + (writeErrors.length ? " " + writeErrors.join("; ") : ""), data: data });
          }
          if (mismatches > 0) {
            data.outcome = changed > 0 ? "committed_unverified" : "not_applied"; data.verified = false;
            return __jsonStringify({ success: false, error: "Premiere did not verify " + mismatches + " requested track state(s)" + (writeErrors.length ? ": " + writeErrors.join("; ") : "") + ". Inspect the tracks before retrying.", data: data });
          }
          return __result(data);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

  };
}
