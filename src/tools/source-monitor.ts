import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getSourceMonitorTools(bridgeOptions: BridgeOptions) {
  return {
    open_in_source: {
      description: "Open a project item in the Source Monitor for preview and trimming.",
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
          return __result({ opened: true, item: item.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    close_source_monitor: {
      description: "Close the clip currently open in the Source Monitor.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.sourceMonitor.closeClip();
          return __result({ closed: true });
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
          return __result({ closed: true });
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
        "Insert the clip from the Source Monitor at the playhead (insert edit). Sequence.insertClip only ripples the named tracks; by default this then razors and shifts every QE sync-locked track so they stay in sync, and verifies the result. Pass scope 'target_tracks' to ripple only the named pair (this will desync other tracks).",
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
          if (!outcome.ok) return __error(outcome.error);
          return __result(outcome.data);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    overwrite_from_source: {
      description: "Overwrite the clip from the Source Monitor at the playhead position (overwrite edit — replaces existing clips).",
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
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var item = app.sourceMonitor.getProjectItem();
          if (!item) return __error("No clip open in Source Monitor");

          var pos = seq.getPlayerPosition().ticks;
          seq.overwriteClip(item, pos, ${vTrack}, ${aTrack});

          return __result({ overwritten: true, item: item.name, atSeconds: __ticksToSeconds(pos) });
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
