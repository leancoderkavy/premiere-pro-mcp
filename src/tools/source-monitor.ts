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
            description: "In point in seconds (optional)",
          },
          out_seconds: {
            type: "number",
            description: "Out point in seconds (optional)",
          },
        },
      },
      handler: async (args: { in_seconds?: number; out_seconds?: number }) => {
        const script = buildToolScript(`
          var item = app.sourceMonitor.getProjectItem();
          if (!item) return __error("No clip open in Source Monitor");

          ${args.in_seconds !== undefined ? `
          var inTime = new Time();
          inTime.seconds = ${args.in_seconds};
          item.setInPoint(inTime.ticks, 4);
          ` : ""}

          ${args.out_seconds !== undefined ? `
          var outTime = new Time();
          outTime.seconds = ${args.out_seconds};
          item.setOutPoint(outTime.ticks, 4);
          ` : ""}

          return __result({
            item: item.name,
            inSet: ${args.in_seconds !== undefined},
            outSet: ${args.out_seconds !== undefined}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    insert_from_source: {
      description: "Insert the clip from the Source Monitor at the playhead position (insert edit — shifts existing clips).",
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
          seq.insertClip(item, pos, ${vTrack}, ${aTrack});

          return __result({ inserted: true, item: item.name, atSeconds: __ticksToSeconds(pos) });
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
