import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getPlaybackTools(bridgeOptions: BridgeOptions) {
  return {
    play_timeline: {
      description: "Start playback of the active sequence timeline. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          speed: {
            type: "number",
            description: "Playback speed multiplier (1.0 = normal, 2.0 = 2x, -1.0 = reverse). Default: 1.0",
          },
        },
      },
      handler: async (args: { speed?: number }) => {
        const speed = args.speed ?? 1.0;
        const script = buildToolScript(`
          app.enableQE();
          qe.startPlayback();
          return __result({ playing: true, speed: ${speed} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    stop_playback: {
      description: "Stop playback of the active sequence timeline. Uses QE DOM.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.enableQE();
          qe.stopPlayback();
          return __result({ stopped: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    play_source_monitor: {
      description: "Start playback of the clip in the Source Monitor",
      parameters: {
        type: "object" as const,
        properties: {
          speed: {
            type: "number",
            description: "Playback speed (1.0 = normal, 2.0 = 2x, -1.0 = reverse). Default: 1.0",
          },
        },
      },
      handler: async (args: { speed?: number }) => {
        const speed = args.speed ?? 1.0;
        const script = buildToolScript(`
          app.sourceMonitor.play(${speed});
          return __result({ playing: true, speed: ${speed} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_source_monitor_position: {
      description: "Get the current time indicator position in the Source Monitor",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var pos = app.sourceMonitor.getPosition();
          if (!pos) return __error("No clip open in Source Monitor");
          return __result({ seconds: __ticksToSeconds(pos.ticks), ticks: pos.ticks });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
