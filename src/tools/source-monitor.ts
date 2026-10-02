import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getSourceMonitorTools(bridgeOptions: BridgeOptions) {
  return {
    open_in_source: {
      description: "Open a project item in the Source Monitor for preview and trimming, and confirm it is the clip now showing.",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item to open",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Project item not found");
          app.sourceMonitor.openProjectItem(item);
          var showing = null;
          try { showing = app.sourceMonitor.getProjectItem(); } catch (eShowing) {
            return __error("Source Monitor changed but its current clip could not be read. Do not retry without inspecting it.", { outcome: "committed_unverified", verified: false, sourceMonitorChanged: null });
          }
          if (!showing || String(showing.nodeId) !== String(item.nodeId)) {
            return __error("Premiere did not show " + item.name + " in the Source Monitor" + (showing ? "; it shows " + showing.name : "") + ".");
          }
          return __result({ opened: true, verified: true, item: item.name, nodeId: String(item.nodeId) });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    close_source_monitor: {
      description: "Close the clip currently showing in the Source Monitor. Premiere then shows the previously opened clip, if any; the result names it.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var before = null;
          try { before = app.sourceMonitor.getProjectItem(); } catch (eBefore) { return __error("Cannot read the Source Monitor before closing; no close was attempted."); }
          if (!before) return __error("No clip open in Source Monitor");
          var closedName = before.name;
          app.sourceMonitor.closeClip();
          var after = null;
          try { after = app.sourceMonitor.getProjectItem(); } catch (eAfter) {
            return __error("Source Monitor close was attempted but its current clip could not be read. Do not retry without inspecting it.", { outcome: "committed_unverified", verified: false, sourceMonitorChanged: null });
          }
          if (after !== null && (!after || typeof after !== "object" || !after.nodeId)) return __error("Source Monitor close was attempted but the stored clip state is invalid. Inspect before retrying.", { outcome: "committed_unverified", verified: false, sourceMonitorChanged: null });
          // Premiere shows the previously opened clip after a close (live 25.2.3).
          if (after && String(after.nodeId) === String(before.nodeId)) {
            return __error("Premiere still shows " + closedName + " in the Source Monitor after closing it.");
          }
          return __result({ closed: true, verified: true, item: closedName, nowShowing: after ? after.name : null });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    close_all_source_clips: {
      description: "Close all clips in the Source Monitor.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.sourceMonitor.closeAllClips();
          var after = null;
          try { after = app.sourceMonitor.getProjectItem(); } catch (eAfter) {
            return __error("Source Monitor close was attempted but its current clip could not be read. Do not retry without inspecting it.", { outcome: "committed_unverified", verified: false, sourceMonitorChanged: null });
          }
          if (after !== null && (!after || typeof after !== "object" || !after.nodeId)) return __error("Source Monitor close was attempted but the stored clip state is invalid. Inspect before retrying.", { outcome: "committed_unverified", verified: false, sourceMonitorChanged: null });
          if (after) return __error("Premiere still shows " + after.name + " in the Source Monitor after closing all clips.");
          return __result({ closed: true, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_source_in_out: {
      description: "Set in and/or out points on the clip currently open in the Source Monitor.",
      parameters: {
        type: "object" as const,
        properties: {
          in_seconds: {
            type: "number",
            minimum: 0,
            description: "In point in seconds. Provide this, out_seconds, or both.",
          },
          out_seconds: {
            type: "number",
            minimum: 0,
            description: "Out point in seconds. Provide this, in_seconds, or both.",
          },
        },
        anyOf: [
          { required: ["in_seconds"] },
          { required: ["out_seconds"] },
        ],
      },
      handler: async (args: { in_seconds?: number; out_seconds?: number }) => {
        if (args.in_seconds === undefined && args.out_seconds === undefined) {
          return { success: false, error: "Provide in_seconds, out_seconds, or both." };
        }
        if ((args.in_seconds !== undefined && (!Number.isFinite(args.in_seconds) || args.in_seconds < 0))
          || (args.out_seconds !== undefined && (!Number.isFinite(args.out_seconds) || args.out_seconds < 0))) {
          return { success: false, error: "in_seconds and out_seconds must be finite, non-negative numbers." };
        }
        const script = buildToolScript(`
          var item = app.sourceMonitor.getProjectItem();
          if (!item) return __error("No clip open in Source Monitor");

          var originalIn = item.getInPoint(4);
          var originalOut = item.getOutPoint(4);
          var hadOriginalIn = !!originalIn;
          var hadOriginalOut = !!originalOut;
          var originalInSeconds = hadOriginalIn ? Number(originalIn.seconds) : 0;
          var originalOutSeconds = hadOriginalOut ? Number(originalOut.seconds) : 0;
          var originalInTicks = hadOriginalIn ? String(originalIn.ticks) : "";
          var originalOutTicks = hadOriginalOut ? String(originalOut.ticks) : "";

          function restoreOriginalMarks() {
            try {
              if (hadOriginalIn) item.setInPoint(originalInSeconds, 4);
              if (hadOriginalOut) item.setOutPoint(originalOutSeconds, 4);
            } catch (restoreErr) {}
          }

          function marksRestored() {
            var restoredIn = item.getInPoint(4);
            var restoredOut = item.getOutPoint(4);
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

          ${args.in_seconds !== undefined ? `
          var inTime = new Time();
          inTime.seconds = ${args.in_seconds};
          try {
            item.setInPoint(inTime.seconds, 4);
          } catch (setInErr) {
            return failAfterMarkUpdate("Premiere rejected the requested Source Monitor in point (" + setInErr.toString() + ").");
          }
          var observedIn = item.getInPoint(4);
          if (!observedIn || String(observedIn.ticks) !== String(inTime.ticks)) {
            return failAfterMarkUpdate("Premiere did not apply the requested Source Monitor in point.");
          }
          ` : ""}

          ${args.out_seconds !== undefined ? `
          var outTime = new Time();
          outTime.seconds = ${args.out_seconds};
          try {
            item.setOutPoint(outTime.seconds, 4);
          } catch (setOutErr) {
            return failAfterMarkUpdate("Premiere rejected the requested Source Monitor out point (" + setOutErr.toString() + ").");
          }
          var observedOut = item.getOutPoint(4);
          if (!observedOut || String(observedOut.ticks) !== String(outTime.ticks)) {
            return failAfterMarkUpdate("Premiere did not apply the requested Source Monitor out point.");
          }
          ` : ""}

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

    insert_from_source: {
      description:
        "Insert the clip from the Source Monitor at the playhead (insert edit). Experimental: a target clip spanning the playhead is QE-razored before insertion to attempt to preserve its split tail. By default the tool also razors and shifts every QE sync-locked track, then reads the placement and target tails back; a displaced tail is reported as committed_unverified. Pass scope 'target_tracks' to ripple only the named pair (this will desync other tracks).",
      parameters: {
        type: "object" as const,
        properties: {
          video_track_index: {
            type: "number",
            description: "Target video track index (default: 0)",
          },
          audio_track_index: {
            type: "number",
            description: "Target audio track index (default: 0)",
          },
          scope: {
            type: "string",
            enum: ["sync_locked", "target_tracks"],
            description:
              "Which tracks shift: 'sync_locked' (default) matches Premiere's insert and keeps sync-locked tracks in sync; 'target_tracks' ripples only the named pair and WILL desync other tracks.",
          },
        },
      },
      handler: async (args: {
        video_track_index?: number;
        audio_track_index?: number;
        scope?: "sync_locked" | "target_tracks";
      }) => {
        const vTrack = args.video_track_index ?? 0;
        const aTrack = args.audio_track_index ?? 0;
        const scope = args.scope === "target_tracks" ? "target_tracks" : "sync_locked";
        if (!Number.isInteger(vTrack) || vTrack < 0 || !Number.isInteger(aTrack) || aTrack < 0) {
          return {
            success: false,
            error: "video_track_index and audio_track_index must be non-negative integers.",
          };
        }
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var item = app.sourceMonitor.getProjectItem();
          if (!item) return __error("No clip open in Source Monitor");

          var pos = seq.getPlayerPosition().ticks;
          var outcome = __insertClipHonoringSyncLock(seq, item, pos, ${vTrack}, ${aTrack}, "${scope}");
          if (!outcome.ok) return __error(outcome.error, outcome.changed ? { timelineChanged: true, outcome: "committed_unverified", verified: false, displacedTails: outcome.displacedTails, placedOn: outcome.placedOn } : null);
          return __result(outcome.data);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    overwrite_from_source: {
      description: "Overwrite the clip from the Source Monitor at the playhead position (overwrite edit — replaces existing clips) and verify a new placement on the requested tracks.",
      parameters: {
        type: "object" as const,
        properties: {
          video_track_index: {
            type: "number",
            description: "Target video track index (default: 0)",
          },
          audio_track_index: {
            type: "number",
            description: "Target audio track index (default: 0)",
          },
        },
      },
      handler: async (args: { video_track_index?: number; audio_track_index?: number }) => {
        const vTrack = args.video_track_index ?? 0;
        const aTrack = args.audio_track_index ?? 0;
        if (!Number.isSafeInteger(vTrack) || vTrack < 0 || !Number.isSafeInteger(aTrack) || aTrack < 0) {
          return { success: false, error: "video_track_index and audio_track_index must be non-negative integers." };
        }
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          if (${vTrack} >= seq.videoTracks.numTracks) {
            return __error("Video track index ${vTrack} is out of range: the sequence has " + seq.videoTracks.numTracks + " video track(s).");
          }
          if (${aTrack} >= seq.audioTracks.numTracks) {
            return __error("Audio track index ${aTrack} is out of range: the sequence has " + seq.audioTracks.numTracks + " audio track(s).");
          }

          var item = app.sourceMonitor.getProjectItem();
          if (!item) return __error("No clip open in Source Monitor");

          var pos = seq.getPlayerPosition().ticks;
          var wantedItemId = String(item.nodeId);
          var wantedStartTicks = parseFloat(pos);
          var frameTicks = seq.timebase ? parseFloat(seq.timebase) : NaN;
          if (!frameTicks || isNaN(frameTicks)) frameTicks = TICKS_PER_SECOND / 24;
          function __placementState(track) {
            var matches = [];
            for (var clipIndex = 0; clipIndex < track.clips.numItems; clipIndex++) {
              var clip = track.clips[clipIndex];
              var sourceId = "";
              sourceId = clip.projectItem ? String(clip.projectItem.nodeId) : "";
              if (sourceId !== wantedItemId) continue;
              var actualStartTicks = NaN;
              actualStartTicks = parseFloat(clip.start.ticks);
              if (!isFinite(actualStartTicks)) throw new Error("Invalid placement start readback");
              if (!isNaN(actualStartTicks) && Math.abs(actualStartTicks - wantedStartTicks) <= frameTicks) {
                if (!clip.nodeId) throw new Error("Invalid placement identity readback");
                var endTicks = parseFloat(clip.end.ticks);
                var inTicks = parseFloat(clip.inPoint.ticks);
                var outTicks = parseFloat(clip.outPoint.ticks);
                if (!isFinite(endTicks) || !isFinite(inTicks) || !isFinite(outTicks)) throw new Error("Invalid placement timing readback");
                var parts = [sourceId, String(actualStartTicks), String(clip.nodeId), String(endTicks), String(inTicks), String(outTicks)];
                matches.push(parts.join("|"));
              }
            }
            return matches.sort().join(";");
          }
          var videoBefore = __placementState(seq.videoTracks[${vTrack}]);
          var audioBefore = __placementState(seq.audioTracks[${aTrack}]);
          try {
            seq.overwriteClip(item, pos, ${vTrack}, ${aTrack});
          } catch (overwriteError) {
            return __error("Sequence.overwriteClip threw after the edit was attempted: " + overwriteError.toString() + ". Inspect the timeline before retrying.", { outcome: "failed", mutationAttempted: true, mutationOutcome: "unknown", verified: false, timelineChanged: null });
          }
          var videoAfter = null, audioAfter = null;
          try {
            videoAfter = __placementState(seq.videoTracks[${vTrack}]);
            audioAfter = __placementState(seq.audioTracks[${aTrack}]);
          } catch (placementReadError) {
            return __error("Overwrite was accepted but placement state could not be read. Inspect the timeline before retrying.", { outcome: "committed_unverified", verified: false, timelineChanged: null });
          }
          var videoPlaced = videoAfter !== "";
          var audioPlaced = audioAfter !== "";
          if ((!videoPlaced || videoAfter === videoBefore) && (!audioPlaced || audioAfter === audioBefore)) {
            return __error("overwrite_from_source produced no verifiable new placement of " + item.name + " at " + __ticksToSeconds(pos) + "s on the requested tracks.");
          }

          return __result({
            overwritten: true,
            verified: true,
            item: item.name,
            atSeconds: __ticksToSeconds(pos),
            placedOnVideoTrack: videoPlaced,
            placedOnAudioTrack: audioPlaced
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_source_monitor_info: {
      description: "Get information about the clip currently loaded in the Source Monitor.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var item = app.sourceMonitor.getProjectItem();
          if (!item) return __result({ loaded: false });

          var info = {
            loaded: true,
            nodeId: item.nodeId,
            name: item.name
          };
          try { info.mediaPath = item.getMediaPath(); } catch(e) {}
          try { info.inPoint = __ticksToSeconds(item.getInPoint().ticks); } catch(e) {}
          try { info.outPoint = __ticksToSeconds(item.getOutPoint().ticks); } catch(e) {}

          return __result(info);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
