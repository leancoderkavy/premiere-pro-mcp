import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getAudioTools(bridgeOptions: BridgeOptions) {
  return {
    adjust_audio_levels: {
      description: "Adjust the audio level (volume) of a clip in dB",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the audio or video clip",
          },
          level_db: {
            type: "number",
            description: "Audio level in dB (0 = unity, negative = quieter, positive = louder)",
          },
        },
        required: ["node_id", "level_db"],
      },
      handler: async (args: { node_id: string; level_db: number }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          // Find the Volume component
          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            if (comp.displayName === "Volume" || comp.matchName === "audioVolume") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                if (comp.properties[p].displayName === "Level") {
                  comp.properties[p].setValue(${args.level_db}, true);
                  return __result({ adjusted: true, clipName: clip.name, levelDb: ${args.level_db} });
                }
              }
            }
          }
          
          return __error("Could not find Volume/Level property on clip");
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_audio_keyframes: {
      description: "Add audio level keyframes to create fades or level changes",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          keyframes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                time_seconds: { type: "number", description: "Time in seconds relative to clip start" },
                level_db: { type: "number", description: "Audio level in dB" },
              },
              required: ["time_seconds", "level_db"],
            },
            description: "Array of keyframe objects with time_seconds and level_db",
          },
        },
        required: ["node_id", "keyframes"],
      },
      handler: async (args: { node_id: string; keyframes: Array<{ time_seconds: number; level_db: number }> }) => {
        const keyframeCode = args.keyframes
          .map(
            (kf) => `
            var kfTime = __secondsToTicks(${kf.time_seconds}).toString();
            levelProp.addKeyframe(kfTime);
            levelProp.setValueAtKey(kfTime, ${kf.level_db});`
          )
          .join("\n");

        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          var levelProp = null;
          
          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            if (comp.displayName === "Volume" || comp.matchName === "audioVolume") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                if (comp.properties[p].displayName === "Level") {
                  levelProp = comp.properties[p];
                  break;
                }
              }
            }
          }
          
          if (!levelProp) return __error("Could not find audio Level property");
          
          levelProp.setTimeVarying(true);
          ${keyframeCode}
          
          return __result({ keyframesAdded: ${args.keyframes.length}, clipName: clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    mute_track: {
      description: "Mute or unmute an audio track",
      parameters: {
        type: "object" as const,
        properties: {
          track_index: {
            type: "number",
            description: "Audio track index (0-based)",
          },
          muted: {
            type: "boolean",
            description: "True to mute, false to unmute",
          },
        },
        required: ["track_index", "muted"],
      },
      handler: async (args: { track_index: number; muted: boolean }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          if (${args.track_index} >= seq.audioTracks.numTracks) return __error("Track index out of range");
          
          var track = seq.audioTracks[${args.track_index}];
          track.setMute(${args.muted ? 1 : 0});
          
          return __result({ trackIndex: ${args.track_index}, muted: ${args.muted}, trackName: track.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
