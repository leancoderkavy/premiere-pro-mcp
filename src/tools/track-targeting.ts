import {
  buildToolScript,
  escapeForExtendScript,
} from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import { describePresetFolder } from "./encoder-formats.js";

/**
 * Premiere's audio `Volume > Level` property is NOT in decibels. It is a
 * normalised 0..1 value where 1.0 is the maximum boost of +15 dB, so unity
 * (0 dB) sits at 10^(-15/20) = 0.17782794.
 *
 * Passing decibels straight to setValue() silently clamps: any negative dB
 * becomes 0 (total silence) and any positive dB becomes 1.0 (+15 dB). Both
 * fail without an error, which makes the mistake very hard to spot - the
 * timeline just plays wrong.
 */
export const PREMIERE_MAX_LEVEL_DB = 15;

export function dbToPremiereLevel(db: number): number {
  if (!Number.isFinite(db)) return 0;
  const clamped = Math.min(db, PREMIERE_MAX_LEVEL_DB);
  return Math.pow(10, (clamped - PREMIERE_MAX_LEVEL_DB) / 20);
}

export function premiereLevelToDb(level: number): number | null {
  if (!Number.isFinite(level) || level <= 0) return null; // silence
  return 20 * Math.log10(level) + PREMIERE_MAX_LEVEL_DB;
}

/**
 * ES3 lookup of a clip parameter. The component is matched by its match name
 * (the same in every host language) or its English name; the property by its
 * English name. Then a write helper that reads the value back, because
 * setValue() returns true even when Premiere clamps the value (live 25.2.3:
 * Opacity 150 stores 100, Level 2.0 stores 1.0).
 */
function clipParamScript(componentMatch: string, componentName: string, propertyName: string): string {
  return `
          function __clipParam(clip) {
            for (var ci = 0; ci < clip.components.numItems; ci++) {
              var component = clip.components[ci];
              var match = "";
              try { match = String(component.matchName || ""); } catch (eMatch) {}
              if (match.indexOf("${componentMatch}") !== 0 && String(component.displayName) !== "${componentName}" && !("${componentMatch}" === "Internal Volume" && String(component.displayName) === "Volumen")) continue;
              for (var pi = 0; pi < component.properties.numItems; pi++) {
                var property = component.properties[pi];
                if ("${componentMatch}" === "Internal Volume") {
                  if (String(property.displayName) === "Level" || String(property.displayName) === "Nivel") return property;
                } else if (__videoIntrinsicPropertyMatches(property, "${propertyName}")) return property;
              }
            }
            return null;
          }
          function __setParamVerified(prop, value, tolerance) {
            var before = null;
            try { before = prop.getValue(); } catch (eBefore) {}
            try { prop.setValue(value, true); } catch (eWrite) {
              return { read: null, readable: false, changed: null, attemptedOnly: true, ok: false };
            }
            var read = null;
            try { read = prop.getValue(); } catch (eRead) {}
            var readable = typeof read === "number" && isFinite(read);
            return { read: readable ? read : null, readable: readable, changed: readable && typeof before === "number" && isFinite(before) ? Math.abs(read - before) > tolerance : null, ok: readable && Math.abs(read - value) <= tolerance };
          }`;
}

/** Refuse dB values Premiere's Level cannot hold instead of clamping them. */
function volumeDbError(name: string, db: unknown): string | null {
  if (typeof db !== "number" || !Number.isFinite(db) || db > PREMIERE_MAX_LEVEL_DB) {
    return `${name} must be a finite value at or below +${PREMIERE_MAX_LEVEL_DB} dB (Premiere's maximum clip level).`;
  }
  return null;
}

/**
 * ES3 helper that reads isTargeted() for every track in a collection.
 * states[i] is true/false, or null when the host threw while reading it.
 */
const TARGET_READBACK_SOURCE = `
          function __readTargetStates(tracks) {
            var out = { states: [], targeted: [], unreadable: [] };
            for (var i = 0; i < tracks.numTracks; i++) {
              var state = null;
              try { state = tracks[i].isTargeted() === true; } catch (readErr) { state = null; }
              out.states.push(state);
              if (state === true) out.targeted.push(i);
              else if (state === null) out.unreadable.push(i);
            }
            return out;
          }
`;

function validateTrackTargetArgs(args: {
  track_type: string;
  track_index: number;
  targeted: boolean;
}): string | null {
  if (args.track_type !== "video" && args.track_type !== "audio") {
    return "track_type must be video or audio";
  }
  if (!Number.isInteger(args.track_index) || args.track_index < 0) {
    return "track_index must be a non-negative integer";
  }
  if (typeof args.targeted !== "boolean") return "targeted must be a boolean";
  return null;
}

export function getTrackTargetingTools(bridgeOptions: BridgeOptions) {
  return {
    set_target_track: {
      description:
        "Target or untarget one video or audio track for source-patched insert/overwrite edits. Premiere allows several tracks of a type to be targeted at once, so by default (exclusive=true) targeting a track also untargets every other track of the same type. Reads back every track of that type and reports verified only when the readback matches the requested state; otherwise committed_unverified or an error.",
      parameters: {
        type: "object" as const,
        properties: {
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Track type",
          },
          track_index: {
            type: "number",
            description: "Track index (0-based)",
          },
          targeted: {
            type: "boolean",
            description:
              "Whether to target (true) or untarget (false) the track",
          },
          exclusive: {
            type: "boolean",
            description:
              "When targeting (targeted=true), also untarget every other track of the same type so only this track is targeted (default: true). Ignored when targeted=false.",
          },
        },
        required: ["track_type", "track_index", "targeted"],
      },
      handler: async (args: {
        track_type: string;
        track_index: number;
        targeted: boolean;
        exclusive?: boolean;
      }) => {
        const validationError = validateTrackTargetArgs(args);
        if (validationError) return { success: false, error: validationError };
        const isVideo = args.track_type === "video";
        const targeted = args.targeted === true;
        const exclusive = targeted && args.exclusive !== false;
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var tracks = ${isVideo ? "seq.videoTracks" : "seq.audioTracks"};
          var requestedIndex = ${args.track_index};
          if (requestedIndex >= tracks.numTracks) return __error("Track index out of range");

          var track = tracks[requestedIndex];
          var untargeted = [];
          try {
            track.setTargeted(${targeted}, true);
          } catch (e) {
            return __error("Premiere rejected the targeting change: " + e.message);
          }
          if (${exclusive}) {
            for (var t = 0; t < tracks.numTracks; t++) {
              if (t === requestedIndex) continue;
              try {
                if (tracks[t].isTargeted()) {
                  tracks[t].setTargeted(false, true);
                  untargeted.push(t);
                }
              } catch (e2) {}
            }
          }

          ${TARGET_READBACK_SOURCE}
          var readback = __readTargetStates(tracks);
          var requestedState = readback.states[requestedIndex];
          var unverifiedTracks = [];
          if (requestedState === null) {
            unverifiedTracks.push(requestedIndex);
          } else if (requestedState !== ${targeted}) {
            return __error("Readback shows track " + requestedIndex + " targeted=" + requestedState + " after requesting targeted=${targeted}");
          }
          if (${exclusive}) {
            for (var r = 0; r < readback.states.length; r++) {
              if (r === requestedIndex) continue;
              if (readback.states[r] === true) {
                return __error("Readback shows other ${isVideo ? "video" : "audio"} tracks still targeted after exclusive targeting: " + readback.targeted.join(", "));
              }
              if (readback.states[r] === null) unverifiedTracks.push(r);
            }
          }
          var verified = unverifiedTracks.length === 0;

          return __result({
            trackType: "${isVideo ? "video" : "audio"}",
            trackIndex: requestedIndex,
            trackName: track.name,
            targeted: ${targeted},
            exclusive: ${exclusive},
            untargetedTracks: untargeted,
            targetedTracks: readback.targeted,
            unreadableTracks: readback.unreadable,
            verified: verified,
            outcome: verified ? "verified" : "committed_unverified"
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_target_tracks: {
      description:
        "Get which tracks are currently targeted for editing. Premiere allows several video or audio tracks to be targeted at the same time; every targeted track is listed. Tracks whose state cannot be read are listed under unreadable.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          ${TARGET_READBACK_SOURCE}
          var video = __readTargetStates(seq.videoTracks);
          var audio = __readTargetStates(seq.audioTracks);
          var targets = { video: [], audio: [], unreadable: { video: video.unreadable, audio: audio.unreadable } };
          for (var v = 0; v < video.targeted.length; v++) {
            targets.video.push({ index: video.targeted[v], name: seq.videoTracks[video.targeted[v]].name });
          }
          for (var a = 0; a < audio.targeted.length; a++) {
            targets.audio.push({ index: audio.targeted[a], name: seq.audioTracks[audio.targeted[a]].name });
          }

          return __result(targets);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_all_tracks_targeted: {
      description:
        "Set all tracks targeted or untargeted. Useful before insert/overwrite edits. Reads back every affected track and reports verified only when all match the requested state.",
      parameters: {
        type: "object" as const,
        properties: {
          targeted: {
            type: "boolean",
            description:
              "Whether to target (true) or untarget (false) all tracks",
          },
          track_type: {
            type: "string",
            enum: ["video", "audio", "both"],
            description: "Which track type(s) to affect (default: both)",
          },
        },
        required: ["targeted"],
      },
      handler: async (args: { targeted: boolean; track_type?: string }) => {
        const trackType = args.track_type ?? "both";
        if (!["video", "audio", "both"].includes(trackType)) {
          return { success: false, error: "track_type must be video, audio, or both" };
        }
        const targeted = args.targeted === true;
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          ${TARGET_READBACK_SOURCE}
          var count = 0;
          var wrong = [];
          var unreadable = [];
          function __applyAll(tracks, label) {
            for (var t = 0; t < tracks.numTracks; t++) {
              try { tracks[t].setTargeted(${targeted}, true); count++; } catch(e) {}
            }
            var readback = __readTargetStates(tracks);
            for (var r = 0; r < readback.states.length; r++) {
              if (readback.states[r] === null) unreadable.push(label + r);
              else if (readback.states[r] !== ${targeted}) wrong.push(label + r);
            }
          }
          ${trackType !== "audio" ? '__applyAll(seq.videoTracks, "V");' : ""}
          ${trackType !== "video" ? '__applyAll(seq.audioTracks, "A");' : ""}
          if (wrong.length > 0) return __error("Readback shows tracks not ${targeted ? "targeted" : "untargeted"}: " + wrong.join(", "));
          var verified = unreadable.length === 0;

          return __result({
            tracksAffected: count,
            targeted: ${targeted},
            unreadableTracks: unreadable,
            verified: verified,
            outcome: verified ? "verified" : "committed_unverified"
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    rename_track: {
      description: "Rename a video or audio track.",
      parameters: {
        type: "object" as const,
        properties: {
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Track type",
          },
          track_index: {
            type: "number",
            description: "Track index (0-based)",
          },
          name: {
            type: "string",
            description: "New track name",
          },
        },
        required: ["track_type", "track_index", "name"],
      },
      handler: async (args: {
        track_type: string;
        track_index: number;
        name: string;
      }) => {
        if (!Number.isSafeInteger(args.track_index) || args.track_index < 0) return { success: false, error: "track_index must be a non-negative integer." };
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var tracks = ${args.track_type === "video" ? "seq.videoTracks" : "seq.audioTracks"};
          if (${args.track_index} >= tracks.numTracks) return __error("Track index out of range");

          var track = tracks[${args.track_index}];
          var oldName = track.name;
          track.name = "${escapeForExtendScript(args.name)}";
          if (String(track.name) !== "${escapeForExtendScript(args.name)}") {
            return __error("Premiere kept the track name " + track.name + " instead of the requested name.");
          }

          return __result({ oldName: oldName, newName: track.name, trackType: "${args.track_type}", trackIndex: ${args.track_index}, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_track_info: {
      description:
        "Get detailed information about a specific track: name, clip count, muted, locked, targeted, and list of all clips.",
      parameters: {
        type: "object" as const,
        properties: {
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Track type",
          },
          track_index: {
            type: "number",
            description: "Track index (0-based)",
          },
        },
        required: ["track_type", "track_index"],
      },
      handler: async (args: { track_type: string; track_index: number }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var tracks = ${args.track_type === "video" ? "seq.videoTracks" : "seq.audioTracks"};
          if (${args.track_index} >= tracks.numTracks) return __error("Track index out of range");

          var track = tracks[${args.track_index}];
          var info = {
            name: track.name,
            trackType: "${args.track_type}",
            trackIndex: ${args.track_index},
            clipCount: track.clips.numItems,
            isMuted: track.isMuted(),
            isLocked: track.isLocked()
          };
          try { info.isTargeted = track.isTargeted(); } catch(e) {}

          info.clips = [];
          for (var c = 0; c < track.clips.numItems; c++) {
            var clip = track.clips[c];
            var ci = {
              index: c,
              nodeId: clip.nodeId,
              name: clip.name,
              startSeconds: __ticksToSeconds(clip.start.ticks),
              endSeconds: __ticksToSeconds(clip.end.ticks),
              durationSeconds: __ticksToSeconds(clip.duration.ticks)
            };
            try { ci.enabled = !__isClipDisabled(clip); } catch(e) { ci.enabled = true; }
            try { ci.speed = clip.getSpeed(); } catch(e) {}
            info.clips.push(ci);
          }

          info.transitions = [];
          try {
            for (var t = 0; t < track.transitions.numItems; t++) {
              info.transitions.push({
                index: t,
                startSeconds: __ticksToSeconds(track.transitions[t].start.ticks),
                endSeconds: __ticksToSeconds(track.transitions[t].end.ticks)
              });
            }
          } catch(e) {}

          return __result(info);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    razor_all_tracks: {
      description:
        "Razor (split) all clips at the playhead position across all tracks, or at a specific time.",
      parameters: {
        type: "object" as const,
        properties: {
          time_seconds: {
            type: "number",
            description:
              "Time to razor at in seconds (uses playhead position if omitted)",
          },
          track_type: {
            type: "string",
            enum: ["video", "audio", "both"],
            description: "Which track types to razor (default: both)",
          },
        },
      },
      handler: async (args: { time_seconds?: number; track_type?: string }) => {
        const trackType = args.track_type || "both";
        const script = buildToolScript(`
          app.enableQE();
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var qeSeq = qe.project.getActiveSequence();
          ${
            args.time_seconds !== undefined
              ? `var ticks = __secondsToTicks(${args.time_seconds}).toString();`
              : `var ticks = seq.getPlayerPosition().ticks;`
          }

          // A razor only has to produce a new clip on tracks where some clip
          // strictly spans the cut point. Tracks that are empty there are a
          // legitimate no-op, so they must not count as failures.
          function __spansPoint(domTrack, tickValue) {
            var v = parseFloat(tickValue);
            for (var c = 0; c < domTrack.clips.numItems; c++) {
              var s = parseFloat(domTrack.clips[c].start.ticks);
              var e = parseFloat(domTrack.clips[c].end.ticks);
              if (v > s && v < e) return true;
            }
            return false;
          }

          var razored = 0;
          var eligible = 0;
          var failures = [];
          var linkGroups = __captureLinkGroupsAt(seq, ticks);

          // QE razor() expects a timecode string, not ticks. See timeline.ts.
          var __razorFrameTicks = seq && seq.timebase ? parseFloat(seq.timebase) : NaN;
          if (!__razorFrameTicks || isNaN(__razorFrameTicks)) __razorFrameTicks = 254016000000 / 24;
          var __razorFps = Math.round(254016000000 / __razorFrameTicks);
          if (!__razorFps || !isFinite(__razorFps) || __razorFps < 1) __razorFps = 30;
          var __razorFrames = Math.round(parseFloat(ticks) / __razorFrameTicks);
          function __pad2(n) { return n < 10 ? "0" + n : "" + n; }
          var __razorTc = __pad2(Math.floor(__razorFrames / (__razorFps * 3600))) + ":" +
                          __pad2(Math.floor((__razorFrames % (__razorFps * 3600)) / (__razorFps * 60))) + ":" +
                          __pad2(Math.floor((__razorFrames % (__razorFps * 60)) / __razorFps)) + ":" +
                          __pad2(__razorFrames % __razorFps);

          if ("${trackType}" !== "audio") {
            for (var t = 0; t < seq.videoTracks.numTracks; t++) {
              var domTrack = seq.videoTracks[t];
              var wasEligible = __spansPoint(domTrack, ticks);
              if (wasEligible) eligible++;
              var before = domTrack.clips.numItems;
              try {
                qeSeq.getVideoTrackAt(t).razor(__razorTc);
              } catch(e) {
                if (wasEligible) failures.push("V" + (t + 1) + ": " + e.toString());
                continue;
              }
              if (domTrack.clips.numItems > before) razored++;
            }
          }
          if ("${trackType}" !== "video") {
            for (var t = 0; t < seq.audioTracks.numTracks; t++) {
              var domTrack = seq.audioTracks[t];
              var wasEligible = __spansPoint(domTrack, ticks);
              if (wasEligible) eligible++;
              var before = domTrack.clips.numItems;
              try {
                qeSeq.getAudioTrackAt(t).razor(__razorTc);
              } catch(e) {
                if (wasEligible) failures.push("A" + (t + 1) + ": " + e.toString());
                continue;
              }
              if (domTrack.clips.numItems > before) razored++;
            }
          }

          // Previously this counted attempts, so it reported one "razor" per
          // track even when every call silently did nothing.
          if (eligible > 0 && razored < eligible) {
            return __error("Premiere razored only " + razored + " of " + eligible + " eligible track(s)" + (failures.length ? " (" + failures.join("; ") + ")" : "") + ". The operation was only partially applied, so it is not reported as verified. Structural QE edits are known to no-op on some Premiere Pro 26.x installations (confirmed on 26.2.2).");
          }

          var relink = __relinkRazoredPieces(seq, ticks, linkGroups);
          if (relink.failures.length) {
            return __error("Premiere razored " + razored + " track(s) but did not keep " + relink.failures.length + " linked video/audio group(s) linked after the cut (" + relink.failures.join("; ") + "). Relink them with link_selection before further edits, or use Undo.");
          }
          return __result({
            razored: razored,
            eligibleTracks: eligible,
            verified: true,
            failures: failures,
            relinkedGroups: relink.relinked,
            atSeconds: __ticksToSeconds(ticks)
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_start_time: {
      description:
        "Set the start time (timecode offset) of a project item. This shifts where timecode begins for the source media.",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          start_seconds: {
            type: "number",
            description: "New start time in seconds",
          },
        },
        required: ["item_id", "start_seconds"],
      },
      handler: async (args: { item_id: string; start_seconds: number }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");

          var t = new Time();
          t.seconds = ${args.start_seconds};
          item.setStartTime(t.ticks);
          var observedStart = NaN;
          try { observedStart = Number(item.startTime().seconds); } catch (startReadError) {}
          if (!isFinite(observedStart) || Math.abs(observedStart - ${args.start_seconds}) > 0.001) {
            return __error("Premiere did not apply the start time; read back " + observedStart + " s.");
          }
          return __result({ item: item.name, startSeconds: observedStart, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    clear_item_in_out: {
      description:
        "Clear in and/or out points on a project item (reset to full duration).",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          clear_in: {
            type: "boolean",
            description: "Clear the in point (default: true)",
          },
          clear_out: {
            type: "boolean",
            description: "Clear the out point (default: true)",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: {
        item_id: string;
        clear_in?: boolean;
        clear_out?: boolean;
      }) => {
        const clearIn = args.clear_in !== false;
        const clearOut = args.clear_out !== false;
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");

          // A cleared In reads 0 and a cleared Out reads the full media
          // length (live 25.2.3), so the Out can only grow.
          function __markSeconds(time) { return time && typeof time.seconds === "number" && isFinite(time.seconds) ? time.seconds : NaN; }
          var outBefore = __markSeconds(item.getOutPoint(4));
          var inAfter = NaN, outAfter = NaN;
          try {
            ${clearIn ? `item.clearInPoint();` : ""}
            ${clearOut ? `item.clearOutPoint();` : ""}
            inAfter = __markSeconds(item.getInPoint(4));
            outAfter = __markSeconds(item.getOutPoint(4));
          } catch (markError) {
            return __error("Mark clearing was attempted but the result could not be read. Inspect the marks before retrying.", { outcome: "committed_unverified", verified: false, marksChanged: null });
          }
          ${clearIn ? `if (!(Math.abs(inAfter) < 0.0005)) return __error("Premiere kept the In point at " + inAfter + "s after clearing it.");` : ""}
          ${clearOut ? `if (!(outAfter >= outBefore - 0.0005)) return __error("Premiere moved the Out point from " + outBefore + "s to " + outAfter + "s instead of clearing it.");` : ""}

          ${clearOut ? `return __error("Out point clearing was attempted, but its stored value does not independently prove the full media duration. Inspect the marks before retrying.", { item: item.name, clearedIn: ${clearIn}, clearedOut: false, inSeconds: inAfter, outSeconds: outAfter, outcome: "committed_unverified", verified: false, marksChanged: null });` : `return __result({ item: item.name, clearedIn: ${clearIn}, clearedOut: false, inSeconds: inAfter, outSeconds: outAfter, verified: true });`}
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_item_in_out: {
      description:
        "Set in and/or out points on a project item in the project panel (marks source range for editing).",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          in_seconds: {
            type: "number",
            description: "In point in seconds",
          },
          out_seconds: {
            type: "number",
            description: "Out point in seconds",
          },
          media_type: {
            type: "number",
            description: "Media type: 1=video, 2=audio, 4=all (default: 4)",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: {
        item_id: string;
        in_seconds?: number;
        out_seconds?: number;
        media_type?: number;
      }) => {
        if (args.in_seconds === undefined && args.out_seconds === undefined) {
          return { success: false, error: "Provide in_seconds, out_seconds, or both." };
        }
        if ((args.in_seconds !== undefined && (!Number.isFinite(args.in_seconds) || args.in_seconds < 0))
          || (args.out_seconds !== undefined && (!Number.isFinite(args.out_seconds) || args.out_seconds < 0))) {
          return { success: false, error: "in_seconds and out_seconds must be finite, non-negative numbers." };
        }
        const mediaType = args.media_type ?? 4;
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");

          var originalIn = item.getInPoint(${mediaType});
          var originalOut = item.getOutPoint(${mediaType});
          var hadOriginalIn = !!originalIn;
          var hadOriginalOut = !!originalOut;
          var originalInSeconds = hadOriginalIn ? Number(originalIn.seconds) : 0;
          var originalOutSeconds = hadOriginalOut ? Number(originalOut.seconds) : 0;
          var originalInTicks = hadOriginalIn ? String(originalIn.ticks) : "";
          var originalOutTicks = hadOriginalOut ? String(originalOut.ticks) : "";

          function restoreOriginalMarks() {
            try {
              if (hadOriginalIn) item.setInPoint(originalInSeconds, ${mediaType});
              if (hadOriginalOut) item.setOutPoint(originalOutSeconds, ${mediaType});
            } catch (restoreErr) {}
          }

          function marksRestored() {
            var restoredIn = item.getInPoint(${mediaType});
            var restoredOut = item.getOutPoint(${mediaType});
            return (!hadOriginalIn || (restoredIn && String(restoredIn.ticks) === originalInTicks))
              && (!hadOriginalOut || (restoredOut && String(restoredOut.ticks) === originalOutTicks));
          }

          function failAfterMarkUpdate(message) {
            restoreOriginalMarks();
            if (marksRestored()) {
              return __error(message + " Original marks were restored.");
            }
            return __error(message + " Marks may be in a partial state; use Undo instead of retrying.");
          }

          ${
            args.in_seconds !== undefined
              ? `
          var inTime = new Time();
          inTime.seconds = ${args.in_seconds};
          try {
            item.setInPoint(inTime.seconds, ${mediaType});
          } catch (setInErr) {
            return failAfterMarkUpdate("Premiere rejected the requested project-item in point (" + setInErr.toString() + ").");
          }
          var observedIn = item.getInPoint(${mediaType});
          if (!observedIn || String(observedIn.ticks) !== String(inTime.ticks)) {
            return failAfterMarkUpdate("Premiere did not apply the requested project-item in point.");
          }
          `
              : ""
          }

          ${
            args.out_seconds !== undefined
              ? `
          var outTime = new Time();
          outTime.seconds = ${args.out_seconds};
          try {
            item.setOutPoint(outTime.seconds, ${mediaType});
          } catch (setOutErr) {
            return failAfterMarkUpdate("Premiere rejected the requested project-item out point (" + setOutErr.toString() + ").");
          }
          var observedOut = item.getOutPoint(${mediaType});
          if (!observedOut || String(observedOut.ticks) !== String(outTime.ticks)) {
            return failAfterMarkUpdate("Premiere did not apply the requested project-item out point.");
          }
          `
              : ""
          }

          return __result({
            item: item.name,
            inSet: ${args.in_seconds !== undefined},
            outSet: ${args.out_seconds !== undefined},
            verified: true
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    import_image_sequence: {
      description: "Import a numbered image sequence as a single video clip.",
      parameters: {
        type: "object" as const,
        properties: {
          first_file_path: {
            type: "string",
            description:
              "Full path to the first image in the sequence (e.g., /path/to/frame_001.png)",
          },
          target_bin: {
            type: "string",
            description:
              "Target bin name to import into (optional, imports to root if omitted)",
          },
        },
        required: ["first_file_path"],
      },
      handler: async (args: {
        first_file_path: string;
        target_bin?: string;
      }) => {
        const script = buildToolScript(`
          var sourceFile = new File("${escapeForExtendScript(args.first_file_path)}");
          if (!sourceFile.exists) return __error("The first image file does not exist: " + sourceFile.fsName);
          var targetBin = app.project.rootItem;
          ${
            args.target_bin
              ? `
          var found = __findProjectItem("${escapeForExtendScript(args.target_bin)}");
          if (found && found.type === 2) targetBin = found;
          `
              : ""
          }

          var beforeCount = targetBin.children.numItems;
          var imported = app.project.importFiles([sourceFile.fsName], true, targetBin, true);
          if (!imported) return __error("Premiere did not import the numbered image sequence.");
          var importedItem = null;
          for (var i = 0; i < targetBin.children.numItems; i++) {
            var candidate = targetBin.children[i];
            try {
              if (candidate.getMediaPath && String(candidate.getMediaPath()) === String(sourceFile.fsName)) {
                importedItem = candidate;
                break;
              }
            } catch (e) {}
          }
          if (!importedItem && targetBin.children.numItems <= beforeCount) {
            return __error("Premiere accepted the image-sequence import but no project item was added.");
          }

          return __result({
            imported: true,
            file: sourceFile.fsName,
            asImageSequence: true,
            verified: true,
            projectItem: importedItem ? { name: importedItem.name, nodeId: importedItem.nodeId } : null
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_position: {
      description:
        "Set the Position property on a video clip's Motion effect using English or measured Spanish built-in names, then read it back. Values are in pixels.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          x: {
            type: "number",
            description: "X position in sequence pixels (converted to Premiere's normalized Position when the host stores it that way)",
          },
          y: {
            type: "number",
            description: "Y position in sequence pixels (converted to Premiere's normalized Position when the host stores it that way)",
          },
        },
        required: ["node_id", "x", "y"],
      },
      handler: async (args: { node_id: string; x: number; y: number }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var set = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].matchName === "AE.ADBE Motion" || clip.components[i].displayName === "Motion") {
              for (var p = 0; p < clip.components[i].properties.numItems; p++) {
                if (__videoIntrinsicPropertyMatches(clip.components[i].properties[p], "Position")) {
                  var pointProp = clip.components[i].properties[p];
                  var pointScale = __motionPointScale(pointProp, __sequenceFrameSize(app.project.activeSequence));
                  if (!pointScale) return __error("The sequence frame size is unreadable, so pixels cannot be converted to Premiere's normalized position; nothing was changed.");
                  var written = [${args.x} * pointScale.x, ${args.y} * pointScale.y];
                  pointProp.setValue(written, true);
                  var readBack = pointProp.getValue();
                  if (!readBack || readBack.length < 2 || Math.abs(readBack[0] - written[0]) > 1e-4 * (pointScale.normalized ? 1 : 1000) || Math.abs(readBack[1] - written[1]) > 1e-4 * (pointScale.normalized ? 1 : 1000)) {
                    return __error("Premiere did not apply the requested position; read back " + readBack + ".");
                  }
                  set = { normalized: pointScale.normalized, value: [readBack[0], readBack[1]] };
                  break;
                }
              }
              break;
            }
          }
          if (!set) return __error("Could not set position");
          return __result({ x: ${args.x}, y: ${args.y}, clip: clip.name, verified: true, hostValue: set.value, hostNormalized: set.normalized });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_scale: {
      description: "Scale a video clip evenly through its Motion effect using English or measured Spanish built-in names, and read the result back. With Uniform Scale off, both Scale (height) and Scale Width are set, so the picture is not stretched; use set_scale_width_height for different values.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          scale: {
            type: "number",
            description:
              "Scale value (100 = original size, 200 = 2x, 50 = half)",
          },
        },
        required: ["node_id", "scale"],
      },
      handler: async (args: { node_id: string; scale: number }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var motion = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            var candidate = clip.components[i];
            if (candidate.matchName === "AE.ADBE Motion" || candidate.displayName === "Motion") { motion = candidate; break; }
          }
          if (!motion) return __error("The clip has no Motion component; nothing was changed.");
          var scaled = __setMotionScale(motion, ${args.scale});
          if (!scaled.ok) return __error(scaled.error);
          return __result({ scale: ${args.scale}, clip: clip.name, uniformScale: scaled.uniform, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_rotation: {
      description: "Set the Rotation property on a video clip's Motion effect using English or measured Spanish built-in names, then read it back.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          degrees: {
            type: "number",
            description:
              "Rotation in degrees (0-360, can exceed for multiple rotations)",
          },
        },
        required: ["node_id", "degrees"],
      },
      handler: async (args: { node_id: string; degrees: number }) => {
        if (typeof args.degrees !== "number" || !Number.isFinite(args.degrees)) return { success: false, error: "degrees must be a finite number." };
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          ${clipParamScript("AE.ADBE Motion", "Motion", "Rotation")}

          var clip = result.clip;
          var prop = __clipParam(clip);
          if (!prop) return __error("This clip has no Motion > Rotation property; nothing was changed.");
          var write = __setParamVerified(prop, ${args.degrees}, 0.001);
          if (!write.ok) {
            return __jsonStringify({ success: false, error: "Premiere stored Rotation " + write.read + " instead of ${args.degrees}.", data: { degrees: write.read, requestedDegrees: ${args.degrees}, timelineChanged: write.changed, outcome: write.attemptedOnly ? "failed" : (write.changed === false ? "not_applied" : "committed_unverified"), mutationAttempted: true, mutationOutcome: write.attemptedOnly ? "unknown" : undefined, verified: false } });
          }
          return __result({ degrees: write.read, clip: clip.name, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_anchor_point: {
      description:
        "Set the Anchor Point property on a video clip's Motion effect.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          x: {
            type: "number",
            description: "Anchor point X in pixels",
          },
          y: {
            type: "number",
            description: "Anchor point Y in pixels",
          },
        },
        required: ["node_id", "x", "y"],
      },
      handler: async (args: { node_id: string; x: number; y: number }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var set = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Motion") {
              for (var p = 0; p < clip.components[i].properties.numItems; p++) {
                if (clip.components[i].properties[p].displayName === "Anchor Point") {
                  var pointProp = clip.components[i].properties[p];
                  var pointScale = __motionPointScale(pointProp, __clipSourceFrameSize(clip, app.project.activeSequence));
                  if (!pointScale) return __error("The source frame size is unreadable, so pixels cannot be converted to Premiere's normalized anchor point; nothing was changed.");
                  var written = [${args.x} * pointScale.x, ${args.y} * pointScale.y];
                  pointProp.setValue(written, true);
                  var readBack = pointProp.getValue();
                  if (!readBack || readBack.length < 2 || Math.abs(readBack[0] - written[0]) > 1e-4 * (pointScale.normalized ? 1 : 1000) || Math.abs(readBack[1] - written[1]) > 1e-4 * (pointScale.normalized ? 1 : 1000)) {
                    return __error("Premiere did not apply the requested anchor point; read back " + readBack + ".");
                  }
                  set = { normalized: pointScale.normalized, value: [readBack[0], readBack[1]] };
                  break;
                }
              }
              break;
            }
          }
          if (!set) return __error("Could not set anchor point");
          return __result({ x: ${args.x}, y: ${args.y}, clip: clip.name, verified: true, hostValue: set.value, hostNormalized: set.normalized });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_opacity: {
      description: "Set the opacity of a video clip (0-100) using English or measured Spanish built-in names, then read it back.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          opacity: {
            type: "number",
            description: "Opacity value (0 = transparent, 100 = fully opaque)",
          },
        },
        required: ["node_id", "opacity"],
      },
      handler: async (args: { node_id: string; opacity: number }) => {
        // Premiere clamps silently (live 25.2.3: 150 stores 100, -10 stores 0).
        if (typeof args.opacity !== "number" || !Number.isFinite(args.opacity) || args.opacity < 0 || args.opacity > 100) {
          return { success: false, error: "opacity must be a number from 0 to 100." };
        }
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          ${clipParamScript("AE.ADBE Opacity", "Opacity", "Opacity")}

          var clip = result.clip;
          var prop = __clipParam(clip);
          if (!prop) return __error("This clip has no Opacity property; nothing was changed.");
          var write = __setParamVerified(prop, ${args.opacity}, 0.001);
          if (!write.ok) {
            return __jsonStringify({ success: false, error: "Premiere stored Opacity " + write.read + " instead of ${args.opacity}.", data: { opacity: write.read, requestedOpacity: ${args.opacity}, timelineChanged: write.changed, outcome: write.attemptedOnly ? "failed" : (write.changed === false ? "not_applied" : "committed_unverified"), mutationAttempted: true, mutationOutcome: write.attemptedOnly ? "unknown" : undefined, verified: false } });
          }
          return __result({ opacity: write.read, clip: clip.name, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_volume: {
      description: "Set an audio clip's Volume > Level in dB. Does not read or change Essential Sound Amplify automation.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the audio clip",
          },
          volume_db: {
            type: "number",
            description:
              "Volume in dB (0 = unity, negative = quieter, positive = louder)",
          },
        },
        required: ["node_id", "volume_db"],
      },
      handler: async (args: { node_id: string; volume_db: number }) => {
        const level = dbToPremiereLevel(args.volume_db);
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var set = false;
          var appliedLevel = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            var __cm = String(clip.components[i].matchName || "");
            if (clip.components[i].displayName === "Volume" || clip.components[i].displayName === "Volumen" || __cm.indexOf("Internal Volume") === 0) {
              for (var p = 0; p < clip.components[i].properties.numItems; p++) {
                var __pn2 = String(clip.components[i].properties[p].displayName);
                  if (__pn2 === "Level" || __pn2 === "Nivel") {
                  // Capture the old value to distinguish silent no-ops from partial writes.
                  var beforeLevel = null;
                  try {
                    var oldLevel = clip.components[i].properties[p].getValue();
                    if (typeof oldLevel === "number" || (typeof oldLevel === "string" && oldLevel.replace(/\\s/g, "") !== "")) beforeLevel = Number(oldLevel);
                  } catch (beforeReadError) {}
                  if (beforeLevel === null || !isFinite(beforeLevel) || beforeLevel < 0) return __jsonStringify({ success: false, error: "Volume level could not be read before the write; nothing was changed.", data: { outcome: "not_applied", verified: false, timelineChanged: false } });
                  // normalised 0..1, NOT dB - see dbToPremiereLevel()
                  var writeError = null;
                  try { clip.components[i].properties[p].setValue(${level}, true); } catch (volumeWriteError) { writeError = volumeWriteError.toString(); }
                  try {
                    var storedLevel = clip.components[i].properties[p].getValue();
                    if (typeof storedLevel === "number" || (typeof storedLevel === "string" && storedLevel.replace(/\\s/g, "") !== "")) appliedLevel = Number(storedLevel);
                  } catch (readError) {}
                  set = true;
                  break;
                }
              }
              break;
            }
          }
          if (!set) return __error("Could not set volume - is this an audio clip?");
          if (writeError) {
            var readableWriteLevel = appliedLevel !== null && isFinite(appliedLevel) && appliedLevel >= 0;
            var unchangedAfterThrow = readableWriteLevel && Math.abs(appliedLevel - beforeLevel) <= Math.max(1e-12, Math.abs(beforeLevel) * 1e-6);
            return __jsonStringify({ success: false, error: unchangedAfterThrow ? "Volume setter threw without changing the stored level: " + writeError : "Volume write threw and may have changed the clip: " + writeError + ". Inspect before retrying.", data: { outcome: unchangedAfterThrow ? "not_applied" : "committed_unverified", verified: false, timelineChanged: unchangedAfterThrow ? false : (readableWriteLevel ? true : null), requestedVolumeDb: ${args.volume_db}, level: appliedLevel } });
          }
          if (appliedLevel === null || !isFinite(appliedLevel) || appliedLevel < 0) {
            return __result({ outcome: "committed_unverified", verified: false, requestedVolumeDb: ${args.volume_db}, volumeDb: null, level: null, clip: clip.name, warning: "Premiere accepted the volume write but its stored level could not be read; inspect the clip before retrying." });
          }
          var appliedDb = appliedLevel > 0 ? (20 * (Math.log(appliedLevel) / Math.LN10) + ${PREMIERE_MAX_LEVEL_DB}) : null;
          if (Math.abs(appliedLevel - ${level}) > Math.max(1e-12, Math.abs(${level}) * 1e-6)) {
            var unchanged = Math.abs(appliedLevel - beforeLevel) <= Math.max(1e-12, Math.abs(beforeLevel) * 1e-6);
            return __jsonStringify({ success: false, error: unchanged ? "Premiere did not apply the requested volume level; the stored level is unchanged." : "Premiere stored a different volume level; inspect the clip before retrying.", data: { outcome: unchanged ? "not_applied" : "committed_unverified", verified: false, timelineChanged: !unchanged, requestedVolumeDb: ${args.volume_db}, volumeDb: appliedDb, level: appliedLevel } });
          }
          return __result({ outcome: "verified", verified: true, requestedVolumeDb: ${args.volume_db}, volumeDb: appliedDb, level: appliedLevel, clamped: appliedDb === null || Math.abs(appliedDb - ${args.volume_db}) > 0.001, clip: clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_clip_volume: {
      description:
        "Read an audio clip's Volume > Level in dB. Use this to verify a level actually applied - setValue() clamps silently. Does not report Essential Sound Amplify automation.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the audio clip",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var level = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            var __cm = String(clip.components[i].matchName || "");
            if (clip.components[i].displayName === "Volume" || clip.components[i].displayName === "Volumen" || __cm.indexOf("Internal Volume") === 0) {
              for (var p = 0; p < clip.components[i].properties.numItems; p++) {
                var __pn2 = String(clip.components[i].properties[p].displayName);
                  if (__pn2 === "Level" || __pn2 === "Nivel") {
                  level = clip.components[i].properties[p].getValue();
                  break;
                }
              }
              break;
            }
          }
          if (level === null) return __error("No volume component - is this an audio clip?");
          var db = (level > 0) ? (20 * (Math.log(level) / Math.LN10) + ${PREMIERE_MAX_LEVEL_DB}) : null;
          return __result({ clip: clip.name, level: level, volumeDb: db });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clips_volume: {
      description:
        "Set the volume (in dB) on every audio clip of a track, or on a list of clip indices. One round trip instead of one call per clip - essential for sequences with dozens of clips.",
      parameters: {
        type: "object" as const,
        properties: {
          track_index: {
            type: "number",
            description: "Audio track index (0-based)",
          },
          volume_db: {
            type: "number",
            description:
              "Volume in dB applied to every selected clip (0 = unity, max +15)",
          },
          clip_indices: {
            type: "array",
            items: { type: "number" },
            description:
              "Optional clip indices on that track. Omit to apply to all clips.",
          },
        },
        required: ["track_index", "volume_db"],
      },
      handler: async (args: {
        track_index: number;
        volume_db: number;
        clip_indices?: number[];
      }) => {
        const invalid = volumeDbError("volume_db", args.volume_db);
        if (invalid) return { success: false, error: invalid };
        if (!Number.isSafeInteger(args.track_index) || args.track_index < 0) return { success: false, error: "track_index must be a non-negative integer." };
        if (args.clip_indices !== undefined && (!Array.isArray(args.clip_indices) || args.clip_indices.some((index) => !Number.isSafeInteger(index) || index < 0))) {
          return { success: false, error: "clip_indices must be non-negative integers." };
        }
        const level = dbToPremiereLevel(args.volume_db);
        const only = Array.isArray(args.clip_indices)
          ? JSON.stringify(args.clip_indices)
          : "null";
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          if (${args.track_index} >= seq.audioTracks.numTracks)
            return __error("Track index out of range");
          ${clipParamScript("Internal Volume", "Volume", "Level")}

          var track = seq.audioTracks[${args.track_index}];
          var only = ${only};
          var wanted = {};
          if (only) {
            for (var w = 0; w < only.length; w++) {
              if (only[w] >= track.clips.numItems) return __error("Clip index " + only[w] + " is out of range: the track has " + track.clips.numItems + " clip(s). Nothing was changed.");
              wanted[only[w]] = true;
            }
          }

          var applied = 0, skipped = 0, mismatched = [];
          for (var c = 0; c < track.clips.numItems; c++) {
            if (only && !wanted[c]) continue;
            var clip = track.clips[c];
            var prop = __clipParam(clip);
            if (!prop) { skipped++; continue; }
            var write = __setParamVerified(prop, ${level}, ${level} * 0.0001 + 1e-9);
            if (write.ok) applied++; else mismatched.push({ clipIndex: c, clip: clip.name, level: write.read });
          }
          var data = {
            trackIndex: ${args.track_index},
            volumeDb: ${args.volume_db},
            level: ${level},
            applied: applied,
            skipped: skipped,
            mismatched: mismatched,
            verified: mismatched.length === 0
          };
          if (mismatched.length) {
            data.timelineChanged = applied > 0 ? true : null;
            data.outcome = "committed_unverified";
            return __jsonStringify({ success: false, error: mismatched.length + " clip(s) did not read back the requested level.", data: data });
          }
          return __result(data);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_pan: {
      description: "Set and read back the pan (left/right balance) on an audio clip, including Channel Volume layouts.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the audio clip",
          },
          pan: {
            type: "number",
            description:
              "Pan value (-100 = full left, 0 = center, 100 = full right)",
          },
        },
        required: ["node_id", "pan"],
      },
      handler: async (args: { node_id: string; pan: number }) => {
        if (!Number.isFinite(args.pan) || args.pan < -100 || args.pan > 100) {
          return { success: false, error: "pan must be a finite value from -100 through 100" };
        }
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "audio") return __error("Clip is not on an audio track");

          var clip = result.clip;
          var panProperty = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            var component = clip.components[i];
            for (var p = 0; p < component.properties.numItems; p++) {
              var property = component.properties[p];
              if (property.displayName === "Balance" || property.displayName === "Pan") {
                panProperty = property;
                break;
              }
            }
            if (panProperty) break;
          }
          if (!panProperty) return __error("Audio clip does not expose a writable Balance or Pan property (checked Panner, Channel Volume, and other audio components).");
          var writeResult = panProperty.setValue(${args.pan}, true);
          var appliedPan = Number(panProperty.getValue());
          if (isNaN(appliedPan) || Math.abs(appliedPan - ${args.pan}) > 0.0001) {
            return __error("Premiere did not apply the requested pan: expected ${args.pan}, got " + appliedPan);
          }
          return __result({ pan: appliedPan, verified: true, writeResult: writeResult, clip: clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    batch_rename_clips: {
      description:
        "Rename multiple clips on the timeline using a pattern. Supports sequential numbering.",
      parameters: {
        type: "object" as const,
        properties: {
          pattern: {
            type: "string",
            description:
              "Name pattern. Use {n} for a sequential number, ## for a zero-padded two-digit sequence number, and {name} for the original name (e.g., 'Scene_##', '{name}_v2')",
          },
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Track type to rename clips on",
          },
          track_index: {
            type: "number",
            description: "Track index (0-based)",
          },
          selected_only: {
            type: "boolean",
            description:
              "Only rename selected clips (default: false, renames all on track)",
          },
          start_number: {
            type: "number",
            description: "Starting number for {n} placeholder (default: 1)",
          },
        },
        required: ["pattern", "track_type", "track_index"],
      },
      handler: async (args: {
        pattern: string;
        track_type: string;
        track_index: number;
        selected_only?: boolean;
        start_number?: number;
      }) => {
        const startNum = args.start_number ?? 1;
        if (!Number.isInteger(startNum) || startNum < 1 || startNum > 1_000_000) {
          return { success: false, error: "start_number must be an integer from 1 through 1000000" };
        }
        const script = buildToolScript(`
          app.enableQE();
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var tracks = ${args.track_type === "video" ? "seq.videoTracks" : "seq.audioTracks"};
          if (${args.track_index} >= tracks.numTracks) return __error("Track index out of range");

          var qeSeq = qe.project.getActiveSequence();
          var qeTrack = ${
            args.track_type === "video"
              ? `qeSeq.getVideoTrackAt(${args.track_index})`
              : `qeSeq.getAudioTrackAt(${args.track_index})`
          };

          var track = tracks[${args.track_index}];
          var renamed = 0;
          var failed = [];
          var num = ${startNum};
          var pattern = "${escapeForExtendScript(args.pattern)}";

          // QE track items include gaps, so the DOM clip index is not a QE
          // index. Match every target by timeline start before renaming any.
          if (!qeTrack) return __error("QE track not found; nothing was changed.");
          var targets = [];
          for (var c = 0; c < track.clips.numItems; c++) {
            var clip = track.clips[c];
            ${args.selected_only ? `if (!clip.isSelected()) continue;` : ""}
            var matchedQeClip = __findQeClipByDomClip(qeTrack, clip);
            if (!matchedQeClip) return __error("Could not match the QE clip for " + clip.name + " by timeline start; nothing was changed.");
            targets.push({ clip: clip, qeClip: matchedQeClip });
          }

          for (var t = 0; t < targets.length; t++) {
            var clip = targets[t].clip;

            var sequenceNumber = "" + num;
            var paddedSequenceNumber = sequenceNumber;
            while (paddedSequenceNumber.length < 2) paddedSequenceNumber = "0" + paddedSequenceNumber;
            var newName = pattern.split("{n}").join(sequenceNumber).split("##").join(paddedSequenceNumber).split("{name}").join(clip.name);
            try { targets[t].qeClip.setName(newName); } catch(e) {}
            if (String(clip.name) === newName) renamed++;
            else failed.push({ clip: clip.name, wanted: newName });
            num++;
          }

          if (failed.length) {
            return __jsonStringify({ success: false, error: failed.length + " clip(s) did not take the new name.", data: { renamed: renamed, failed: failed, pattern: pattern, timelineChanged: renamed > 0 } });
          }
          return __result({ renamed: renamed, pattern: pattern, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    batch_enable_disable: {
      description:
        "Enable or disable multiple clips at once (selected, track, or all).",
      parameters: {
        type: "object" as const,
        properties: {
          enabled: {
            type: "boolean",
            description: "true to enable, false to disable",
          },
          target: {
            type: "string",
            enum: ["selected", "track", "all"],
            description: "Which clips to affect",
          },
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Track type (required when target is 'track')",
          },
          track_index: {
            type: "number",
            description: "Track index (required when target is 'track')",
          },
        },
        required: ["enabled", "target"],
      },
      handler: async (args: {
        enabled: boolean;
        target: string;
        track_type?: string;
        track_index?: number;
      }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var count = 0;
          var disabled = ${!args.enabled};
          var candidates = 0;
          var failures = [];

          function setOnTrack(track) {
            for (var c = 0; c < track.clips.numItems; c++) {
              try {
                if ("${args.target}" === "selected" && !track.clips[c].isSelected()) continue;
                candidates++;
                track.clips[c].disabled = disabled;
                if (Boolean(track.clips[c].disabled) !== disabled) {
                  failures.push(track.clips[c].name || ("clip #" + c));
                  continue;
                }
                count++;
              } catch(e) { failures.push("clip #" + c + ": " + e.toString()); }
            }
          }

          if ("${args.target}" === "track") {
            var tracks = ${(args.track_type || "video") === "video" ? "seq.videoTracks" : "seq.audioTracks"};
            if (${args.track_index ?? 0} >= tracks.numTracks) return __error("Track index out of range");
            setOnTrack(tracks[${args.track_index ?? 0}]);
          } else {
            for (var t = 0; t < seq.videoTracks.numTracks; t++) setOnTrack(seq.videoTracks[t]);
            for (var t = 0; t < seq.audioTracks.numTracks; t++) setOnTrack(seq.audioTracks[t]);
          }

          if (candidates === 0) return __error("No clips matched target '${args.target}'. Select clips first or choose target 'track' or 'all'.");
          if (failures.length) return __error("Premiere did not apply the requested enabled state to " + failures.length + " clip(s): " + failures.join("; "));
          return __result({ affected: count, enabled: ${args.enabled}, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_selected_clips: {
      description: "Remove all currently selected clips from the timeline.",
      parameters: {
        type: "object" as const,
        properties: {
          ripple: {
            type: "boolean",
            description:
              "If true, close the gap after removing (ripple delete). Default: false",
          },
        },
      },
      handler: async (args: { ripple?: boolean }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var removed = 0;
          var toRemove = [];

          function collect(tracks) {
            for (var t = 0; t < tracks.numTracks; t++) {
              for (var c = tracks[t].clips.numItems - 1; c >= 0; c--) {
                if (tracks[t].clips[c].isSelected()) {
                  toRemove.push(tracks[t].clips[c]);
                }
              }
            }
          }
          collect(seq.videoTracks);
          collect(seq.audioTracks);

          if (!toRemove.length) return __error("No clips are selected; nothing was removed.");
          var ids = [];
          for (var n = 0; n < toRemove.length; n++) ids.push(String(toRemove[n].nodeId));
          for (var i = 0; i < toRemove.length; i++) {
            try { toRemove[i].remove(${args.ripple ? "true" : "false"}, true); } catch(e) {}
          }
          var remaining = [];
          for (var r = 0; r < ids.length; r++) {
            if (__findClip(ids[r])) remaining.push(ids[r]); else removed++;
          }
          if (remaining.length) {
            return __jsonStringify({ success: false, error: remaining.length + " selected clip(s) are still on the timeline.", data: { removed: removed, remainingNodeIds: remaining, timelineChanged: removed > 0 } });
          }

          return __result({ removed: removed, ripple: ${args.ripple ? "true" : "false"}, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    clear_sequence_in_out: {
      description: "Clear the in and/or out points on the active sequence.",
      parameters: {
        type: "object" as const,
        properties: {
          clear_in: {
            type: "boolean",
            description: "Clear in point (default: true)",
          },
          clear_out: {
            type: "boolean",
            description: "Clear out point (default: true)",
          },
        },
      },
      handler: async (args: { clear_in?: boolean; clear_out?: boolean }) => {
        const clearIn = args.clear_in !== false;
        const clearOut = args.clear_out !== false;
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var zeroSeconds = __ticksToSeconds(seq.zeroPoint);
          var endSeconds = __ticksToSeconds(seq.end);
          ${clearIn ? `seq.setInPoint(zeroSeconds);` : ""}
          ${clearOut ? `seq.setOutPoint(endSeconds);` : ""}
          ${clearIn ? `if (Math.abs(Number(seq.getInPoint()) - zeroSeconds) > 0.000001) return __error("Premiere did not clear the sequence in point.");` : ""}
          ${clearOut ? `if (Math.abs(Number(seq.getOutPoint()) - endSeconds) > 0.000001) return __error("Premiere did not clear the sequence out point.");` : ""}

          return __result({ clearedIn: ${clearIn}, clearedOut: ${clearOut}, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_encoder_presets: {
      description:
        "List available Adobe Media Encoder export presets, with the .epr path of each so it can be " +
        "passed to export_sequence or encode_project_item. Presets are discovered by scanning the .epr " +
        "files Adobe ships on disk (Premiere's ExtendScript API exposes no preset enumeration).",
      parameters: {
        type: "object" as const,
        properties: {
          format: {
            type: "string",
            description:
              "Filter by container/format (e.g. 'H.264', 'mp4', 'QuickTime', 'WAV') or preset name (e.g. 'ProRes', 'Proxy'). Presets whose format matches come first. Omit to list all.",
          },
        },
      },
      handler: async (args: { format?: string }) => {
        const script = buildToolScript(`
          var presets = __collectAllPresets();
          if (!presets.length) {
            return __error("No .epr presets found. Is Adobe Media Encoder installed alongside Premiere Pro?");
          }
          return __result({ presets: presets });
        `);
        const result = await sendCommand(script, bridgeOptions);
        if (!result.success) return result;
        const raw = ((result.data as { presets?: Array<{ name: string; path: string; format: string }> })?.presets) ?? [];
        const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
        let presets = raw.map((preset) => ({ ...preset, ...describePresetFolder(preset.format) }));
        if (args.format) {
          const needle = normalize(args.format);
          const byFormat = presets.filter((p) => normalize(`${p.formatLabel} ${p.formatCode ?? ""} ${p.extension ?? ""}`).includes(needle));
          const byName = presets.filter((p) => !byFormat.includes(p) && normalize(`${p.name} ${p.format}`).includes(needle));
          // Presets whose container format matches come first; name-only matches
          // (e.g. "H264 ..." presets that write QuickTime) follow.
          presets = [...byFormat, ...byName];
        }
        return { success: true, data: { count: presets.length, presets } };
      },
    },

    get_qe_clip_info: {
      description:
        "Get QE DOM information about a clip, including properties not available through the standard API.",
      parameters: {
        type: "object" as const,
        properties: {
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Track type",
          },
          track_index: {
            type: "number",
            description: "Track index (0-based)",
          },
          clip_index: {
            type: "number",
            description: "Clip index on the track (0-based)",
          },
        },
        required: ["track_type", "track_index", "clip_index"],
      },
      handler: async (args: {
        track_type: string;
        track_index: number;
        clip_index: number;
      }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence");

          var qeTrack = ${
            args.track_type === "video"
              ? `qeSeq.getVideoTrackAt(${args.track_index})`
              : `qeSeq.getAudioTrackAt(${args.track_index})`
          };
          if (!qeTrack) return __error("Track not found");

          // clip_index addresses the DOM clip list; QE track items also include
          // gaps, so resolve the DOM clip and match its QE item by start time.
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var domTracks = ${args.track_type === "video" ? "seq.videoTracks" : "seq.audioTracks"};
          if (${args.track_index} >= domTracks.numTracks) return __error("Track not found");
          var domClips = domTracks[${args.track_index}].clips;
          if (${args.clip_index} >= domClips.numItems) return __error("Clip not found at index ${args.clip_index}");
          var qeClip = __findQeClipByDomClip(qeTrack, domClips[${args.clip_index}]);
          if (!qeClip) return __error("Could not match the QE clip for clip index ${args.clip_index} by timeline start");

          var info = { trackType: "${args.track_type}", trackIndex: ${args.track_index}, clipIndex: ${args.clip_index} };

          // Try to read all QE clip properties
          var props = ["name", "type", "mediaType", "duration", "start", "end", "inPoint", "outPoint",
                       "speed", "audioChannelType", "numAudioChannels"];
          for (var i = 0; i < props.length; i++) {
            try { info[props[i]] = qeClip[props[i]]; } catch(e) {}
          }

          // Enumerate any additional properties
          var extra = [];
          try {
            for (var key in qeClip) {
              if (typeof qeClip[key] !== "function") {
                extra.push(key);
              }
            }
          } catch(e) {}
          info.availableProperties = extra;

          // Enumerate methods
          var methods = [];
          try {
            for (var key in qeClip) {
              if (typeof qeClip[key] === "function") {
                methods.push(key);
              }
            }
          } catch(e) {}
          info.availableMethods = methods;

          return __result(info);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    redo: {
      description:
        "EXPERIMENTAL (undocumented QE DOM: qe.project.redo / undoStackIndex). Redo the most recently undone Premiere project action(s) through QE, checked step by step against Premiere's undo-stack position (stackVerified; the timeline itself is not read back). To restore a tool call undone with undo, pass the same count. Observed marker boundaries refuse before any step; acknowledge_untracked_markers:true permits prior non-marker actions, without proving marker reversal.",
      parameters: {
        type: "object" as const,
        properties: {
          count: {
            type: "number",
            description: "Number of redo steps (default: 1)",
          },
          acknowledge_untracked_markers: {
            type: "boolean",
            description: "Explicitly acknowledge that QE steps reverse or restore prior non-marker actions, because marker reversal is not verified. Default false; marker boundaries refuse the entire request before any step.",
          },
          expected_undo_stack_index: {
            type: "number",
            description:
              "Required safety guard: the undoStackIndexAfter reported by the undo you want to redo. The step is refused, with nothing changed, when Premiere's undo-stack position differs from it. The guard compares the position only; matching position cannot prove which action is on top.",
          },
        },
        required: ["expected_undo_stack_index"],
      },
      handler: async (args: { count?: number; expected_undo_stack_index?: number; acknowledge_untracked_markers?: boolean } = {}) => {
        const count = args.count ?? 1;
        if (!Number.isInteger(count) || count < 1 || count > 100) {
          return { success: false, error: "count must be an integer from 1 through 100" };
        }
        const guardArg = args.expected_undo_stack_index;
        if (!Number.isInteger(guardArg) || guardArg! < 0) {
          return { success: false, error: "expected_undo_stack_index is required and must be a non-negative integer; redo was not attempted" };
        }
        const guard = String(guardArg);
        const script = buildToolScript(`
          __undoStart = null;
          var expectedIndex = ${guard};
          if (expectedIndex !== null) {
            var currentIndex = __readUndoIndex();
            if (currentIndex === null || typeof currentIndex === "undefined" || isNaN(Number(currentIndex))) {
              return __jsonStringify({ success: false, error: "Premiere did not expose undoStackIndex; redo was not attempted", data: { expectedUndoStackIndex: expectedIndex } });
            }
            if (currentIndex !== expectedIndex) {
              return __jsonStringify({ success: false, error: "Premiere's undo stack is at " + currentIndex + ", not the expected " + expectedIndex + ": the undo-stack position changed since that call (actions were undone or recorded), so redo was not attempted.", data: { undoStackIndex: currentIndex, expectedUndoStackIndex: expectedIndex } });
            }
          }
          var outcome = __qeUndoSteps("redo", ${count}, ${args.acknowledge_untracked_markers === true ? "true" : "false"});
          return __undoStepsResult(outcome, "redone");
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    multiple_undo: {
      description: "EXPERIMENTAL (undocumented QE DOM: qe.project.undo / undoStackIndex). Undo several Premiere project actions through QE, checking each step against Premiere's undo-stack position (stackVerified; the timeline itself is not read back) and reporting how many were undone." +
        " Only actions Premiere records are undoable: QE edits such as razor, insert, lift and extract report undoSteps (and undoStackIndex) in their results; pass that undoSteps as count to reverse exactly that call. A marker receipt with undoTracked:false recorded no undo step: calling Undo for it would reverse an earlier action. Only CEP tool results carry undoSteps; UXP tools and workflows that send several commands are not counted. Always pass expected_undo_stack_index to check the stack position, but matching position alone does not prove which action is on top. Observed marker boundaries refuse the entire request before any step unless acknowledge_untracked_markers:true explicitly permits prior non-marker actions. The barrier persists through server/helper reloads while the CEP engine remains alive; it cannot account for marker writes before observation, after an engine reset, or through UXP, the manual UI, or other clients. Matching the QE index verifies stack position only.",
      parameters: {
        type: "object" as const,
        properties: {
          count: {
            type: "number",
            description: "Number of undo steps (default: 1)",
          },
          acknowledge_untracked_markers: {
            type: "boolean",
            description: "Explicitly acknowledge that QE steps reverse or restore prior non-marker actions, because marker reversal is not verified. Default false; marker boundaries refuse the entire request before any step.",
          },
          expected_undo_stack_index: {
            type: "number",
            description:
              "Required safety guard: the undoStackIndex a tool result reported right after the call you want to reverse. The step is refused, with nothing changed, when Premiere's undo-stack position differs from it. The guard compares the position only; matching position cannot prove which action is on top.",
          },
        },
        required: ["expected_undo_stack_index"],
      },
      handler: async (args: { count?: number; expected_undo_stack_index?: number; acknowledge_untracked_markers?: boolean }) => {
        const count = args.count ?? 1;
        if (!Number.isInteger(count) || count < 1 || count > 100) {
          return { success: false, error: "count must be an integer from 1 through 100" };
        }
        const guardArg = args.expected_undo_stack_index;
        if (!Number.isInteger(guardArg) || guardArg! < 0) {
          return { success: false, error: "expected_undo_stack_index is required and must be a non-negative integer; undo was not attempted" };
        }
        const guard = String(guardArg);
        const script = buildToolScript(`
          __undoStart = null;
          var expectedIndex = ${guard};
          if (expectedIndex !== null) {
            var currentIndex = __readUndoIndex();
            if (currentIndex === null || typeof currentIndex === "undefined" || isNaN(Number(currentIndex))) {
              return __jsonStringify({ success: false, error: "Premiere did not expose undoStackIndex; undo was not attempted", data: { expectedUndoStackIndex: expectedIndex } });
            }
            if (currentIndex !== expectedIndex) {
              return __jsonStringify({ success: false, error: "Premiere's undo stack is at " + currentIndex + ", not the expected " + expectedIndex + ": the undo-stack position changed since that call (actions were undone or recorded), so undo was not attempted.", data: { undoStackIndex: currentIndex, expectedUndoStackIndex: expectedIndex } });
            }
          }
          var outcome = __qeUndoSteps("undo", ${count}, ${args.acknowledge_untracked_markers === true ? "true" : "false"});
          return __undoStepsResult(outcome, "undone");
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_poster_frame: {
      description:
        "Unavailable: Premiere's scripting API cannot set a project item's poster frame. Fails without changing the item; set it in the Project panel (Shift+P).",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          time_seconds: {
            type: "number",
            description: "Time in seconds for the poster frame",
          },
        },
        required: ["item_id", "time_seconds"],
      },
      handler: async (args: { item_id: string; time_seconds: number }) => {
        void args;
        // The previous implementation set nothing, called setOverrideFrameRate(0)
        // as an "internal update" (which reset the item's frame-rate
        // interpretation to ~0 fps on Premiere 25.2), and reported success.
        return {
          success: false,
          error:
            "Premiere's scripting API has no poster-frame setter (ProjectItem.setPosterFrame does not exist on this host). Nothing was changed. Set the poster frame in the Project panel (hover-scrub the clip and press Shift+P).",
        };
      },
    },

    get_version_info: {
      description: "Get Premiere Pro version and build information.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var info = {
            version: app.version,
            buildNumber: app.build
          };
          try { info.isDocumentOpen = app.isDocumentOpen(); } catch(e) {}
          try { info.path = app.path; } catch(e) {}
          return __result(info);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    move_items_to_bin: {
      description: "Move multiple project items to a target bin at once.",
      parameters: {
        type: "object" as const,
        properties: {
          item_ids: {
            type: "array",
            items: { type: "string" },
            description: "Array of node IDs or names of items to move",
          },
          target_bin: {
            type: "string",
            description: "Name or node ID of the target bin",
          },
        },
        required: ["item_ids", "target_bin"],
      },
      handler: async (args: { item_ids: string[]; target_bin: string }) => {
        const idsJson = JSON.stringify(args.item_ids);
        const script = buildToolScript(`
          var targetBin = __findProjectItem("${escapeForExtendScript(args.target_bin)}");
          if (!targetBin || targetBin.type !== 2) return __error("Target bin not found: ${escapeForExtendScript(args.target_bin)}");

          var ids = ${idsJson};
          var items = [];
          var missing = [];
          for (var i = 0; i < ids.length; i++) {
            var found = __findProjectItem(ids[i]);
            if (found) items.push(found); else missing.push(ids[i]);
          }
          if (missing.length) return __error("Project item(s) not found: " + missing.join(", ") + ". Nothing was moved.");

          // treePath names the containing bin (live 25.2.3: "\\Project.prproj\\Bin\\item").
          var moved = 0;
          var notMoved = [];
          for (var m = 0; m < items.length; m++) {
            try { items[m].moveBin(targetBin); } catch(e) {}
            if (String(items[m].treePath) === String(targetBin.treePath) + "\\\\" + items[m].name) moved++;
            else notMoved.push(items[m].name);
          }
          if (notMoved.length) {
            return __jsonStringify({ success: false, error: notMoved.length + " item(s) did not move to " + targetBin.name + ": " + notMoved.join(", ") + ".", data: { moved: moved, notMoved: notMoved, total: ids.length } });
          }

          return __result({ moved: moved, total: ids.length, targetBin: targetBin.name, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_anti_alias_quality: {
      description:
        "Set the anti-alias quality on a clip's Motion effect (useful for scaled/rotated clips).",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          enabled: {
            type: "boolean",
            description: "Enable (true) or disable (false) anti-aliasing",
          },
        },
        required: ["node_id", "enabled"],
      },
      handler: async (args: { node_id: string; enabled: boolean }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var antiFlicker = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Motion") {
              for (var p = 0; p < clip.components[i].properties.numItems; p++) {
                var pName = clip.components[i].properties[p].displayName;
                if (pName === "Anti-flicker Filter") {
                  antiFlicker = clip.components[i].properties[p];
                  break;
                }
              }
              break;
            }
          }

          if (!antiFlicker) return __error("The clip Motion component does not expose an Anti-flicker Filter parameter.");
          var requestedValue = ${args.enabled ? 1 : 0};
          antiFlicker.setValue(requestedValue, 1);
          var observedValue = Number(antiFlicker.getValue());
          if (Math.abs(observedValue - requestedValue) > 0.000001) {
            return __error("Premiere did not apply the requested Anti-flicker Filter value.");
          }
          return __result({
            clip: clip.name,
            antiAlias: ${args.enabled},
            antiFlickerValue: observedValue,
            verified: true
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_uniform_scale: {
      description:
        "Toggle uniform scale on a clip's Motion effect. When enabled, Scale Width and Scale Height are linked.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          uniform: {
            type: "boolean",
            description:
              "true for uniform (linked), false for non-uniform (independent width/height)",
          },
        },
        required: ["node_id", "uniform"],
      },
      handler: async (args: { node_id: string; uniform: boolean }) => {
        if (typeof args.uniform !== "boolean") return { success: false, error: "uniform must be true or false." };
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          ${clipParamScript("AE.ADBE Motion", "Motion", "Uniform Scale")}

          var clip = result.clip;
          var prop = __clipParam(clip);
          if (!prop) return __error("Uniform Scale property not found");
          prop.setValue(${args.uniform}, true);
          var read = null;
          try { read = prop.getValue(); } catch (eRead) {}
          if (typeof read !== "boolean") return __error("Uniform Scale was written but the stored checkbox state is unreadable. Inspect before retrying.", { outcome: "committed_unverified", verified: false, timelineChanged: null });
          if (read !== ${args.uniform}) return __error("Premiere kept Uniform Scale at " + read + ".");
          return __result({ clip: clip.name, uniformScale: read, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_scale_width_height: {
      description:
        "Set independent width and height scale on a clip. Turns Uniform Scale off, writes Motion > Scale Width (width) and Motion > Scale (which Premiere uses as the height once Uniform Scale is off), then reads all three back. Fails when a value does not read back.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          scale_width: {
            type: "number",
            description: "Scale width percentage (0-10000)",
          },
          scale_height: {
            type: "number",
            description: "Scale height percentage (0-10000). Written to Motion > Scale, which is the height when Uniform Scale is off.",
          },
        },
        required: ["node_id", "scale_width", "scale_height"],
      },
      handler: async (args: {
        node_id: string;
        scale_width: number;
        scale_height: number;
      }) => {
        for (const [name, value] of [["scale_width", args.scale_width], ["scale_height", args.scale_height]] as const) {
          if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10000) {
            return { success: false, error: `${name} must be a number from 0 to 10000.` };
          }
        }
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var motion = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Motion") { motion = clip.components[i]; break; }
          }
          if (!motion) return __error("Motion component not found");

          // With Uniform Scale off, Premiere keeps the height in "Scale" and the
          // width in "Scale Width"; there is no separate "Scale Height" (#642).
          var uniform = null, height = null, width = null;
          for (var p = 0; p < motion.properties.numItems; p++) {
            var prop = motion.properties[p];
            if (prop.displayName === "Uniform Scale") uniform = prop;
            else if (prop.displayName === "Scale Width") width = prop;
            else if (prop.displayName === "Scale Height" || (prop.displayName === "Scale" && !height)) height = prop;
          }
          if (!uniform || !width || !height) {
            return __error("Motion is missing Uniform Scale, Scale Width, or Scale on this Premiere build. Nothing was changed.");
          }

          var readNumber = function (target) {
            try { var v = Number(target.getValue()); return isFinite(v) ? v : null; } catch (eRead) { return null; }
          };
          var before = { uniformScale: null, scaleWidth: readNumber(width), scaleHeight: readNumber(height) };
          try { before.uniformScale = !!uniform.getValue(); } catch (eUniform) {}

          try {
            uniform.setValue(false, true);
            width.setValue(${args.scale_width}, true);
            height.setValue(${args.scale_height}, true);
          } catch (eSet) {
            return __error("Premiere rejected the scale update: " + eSet.toString() + ". The clip may be partly changed; check it or use Undo.");
          }

          var uniformAfter = null;
          try { uniformAfter = !!uniform.getValue(); } catch (eUniformAfter) {}
          var after = { uniformScale: uniformAfter, scaleWidth: readNumber(width), scaleHeight: readNumber(height) };
          var widthOk = after.scaleWidth !== null && Math.abs(after.scaleWidth - ${args.scale_width}) <= 0.01;
          var heightOk = after.scaleHeight !== null && Math.abs(after.scaleHeight - ${args.scale_height}) <= 0.01;
          if (after.uniformScale !== false || !widthOk || !heightOk) {
            return __error("The scale update did not read back: Uniform Scale " + after.uniformScale + ", width " + after.scaleWidth + " (wanted ${args.scale_width}), height " + after.scaleHeight + " (wanted ${args.scale_height}). The clip may be partly changed; check it or use Undo.");
          }
          return __result({
            clip: clip.name,
            scaleWidth: after.scaleWidth,
            scaleHeight: after.scaleHeight,
            uniformScale: false,
            before: before,
            verified: true,
            outcome: "verified"
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
