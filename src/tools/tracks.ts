import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getTrackTools(bridgeOptions: BridgeOptions) {
  return {
    add_track: {
      description: "Add a new video or audio track to the active sequence",
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
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var before = ${args.track_type === "video" ? "seq.videoTracks.numTracks" : "seq.audioTracks.numTracks"};
          
          ${args.track_type === "video"
            ? `seq.insertVideoTrackAt(before, ${count});`
            : `seq.insertAudioTrackAt(before, ${count});`
          }
          
          var after = ${args.track_type === "video" ? "seq.videoTracks.numTracks" : "seq.audioTracks.numTracks"};
          
          return __result({
            added: after - before,
            trackType: "${args.track_type}",
            totalTracks: after
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    delete_track: {
      description: "Delete a video or audio track from the active sequence",
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
        },
        required: ["track_type", "track_index"],
      },
      handler: async (args: { track_type: string; track_index: number }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          ${args.track_type === "video"
            ? `if (${args.track_index} >= seq.videoTracks.numTracks) return __error("Track index out of range");
               seq.deleteVideoTrackAt(${args.track_index});`
            : `if (${args.track_index} >= seq.audioTracks.numTracks) return __error("Track index out of range");
               seq.deleteAudioTrackAt(${args.track_index});`
          }
          
          return __result({ deleted: true, trackType: "${args.track_type}", trackIndex: ${args.track_index} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    lock_track: {
      description: "Lock or unlock a video track",
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
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          if (${args.track_index} >= seq.videoTracks.numTracks) return __error("Track index out of range");
          
          var track = seq.videoTracks[${args.track_index}];
          track.setLocked(${args.locked ? 1 : 0});
          
          return __result({ trackIndex: ${args.track_index}, locked: ${args.locked}, trackName: track.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    toggle_track_visibility: {
      description: "Toggle a video track's visibility (eye icon)",
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
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          if (${args.track_index} >= seq.videoTracks.numTracks) return __error("Track index out of range");
          
          var track = seq.videoTracks[${args.track_index}];
          track.setMute(${args.visible ? 0 : 1});
          
          return __result({ trackIndex: ${args.track_index}, visible: ${args.visible}, trackName: track.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
