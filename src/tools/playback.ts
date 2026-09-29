import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getPlaybackTools(bridgeOptions: BridgeOptions) {
  return {
    play_timeline: {
      description: "Request playback of the active sequence timeline through QE. The legacy API does not provide a same-call playhead readback, so movement is not reported as verified.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.enableQE();
          qe.startPlayback();
          return __result({
            playbackRequested: true,
            playbackVerified: false,
            verificationScope: "QE accepted the playback request only; poll get_playhead_position before treating timeline movement as confirmed."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    stop_playback: {
      description: "Request that active-sequence timeline playback stop through QE. The legacy API does not provide a same-call playhead readback, so stopped state is not reported as verified. Only the timeline can be stopped: Premiere's scripting APIs have no documented call that stops the Source Monitor alone, so target \"source\" returns an error instead of stopping the timeline.",
      parameters: {
        type: "object" as const,
        properties: {
          target: {
            type: "string",
            enum: ["timeline", "source"],
            description: "What to stop. Default \"timeline\". \"source\" is refused because no documented API stops only the Source Monitor.",
          },
        },
      },
      handler: async (args: { target?: string } = {}) => {
        const target = args?.target ?? "timeline";
        if (target === "source") {
          return {
            success: false,
            error: "Premiere's ExtendScript and UXP APIs have no documented call that stops only the Source Monitor, so nothing was stopped. Pause it in Premiere, or close the clip with close_source_monitor.",
          };
        }
        if (target !== "timeline") {
          return { success: false, error: "target must be \"timeline\" or \"source\"." };
        }
        const script = buildToolScript(`
          app.enableQE();
          qe.stopPlayback();
          return __result({
            stopRequested: true,
            playbackVerified: false,
            verificationScope: "QE accepted the stop request only; poll get_playhead_position across time before treating playback as stopped."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    play_source_monitor: {
      description: "Request playback of the clip in the Source Monitor. Fails when no clip is loaded. The legacy API does not provide a same-call position readback, so movement is not reported as verified.",
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
        if (typeof speed !== "number" || !Number.isFinite(speed) || speed === 0 || Math.abs(speed) > 64) {
          return { success: false, error: "speed must be a non-zero number from -64 to 64." };
        }
        const script = buildToolScript(`
          // Premiere accepts play() with nothing loaded and does nothing (#642).
          var loaded = null;
          try {
            if (typeof app.sourceMonitor.getProjectItem === "function") loaded = app.sourceMonitor.getProjectItem();
            else loaded = undefined;
          } catch (eLoaded) { loaded = undefined; }
          if (loaded === null) return __error("No clip is loaded in the Source Monitor. Open one with open_in_source first.");
          app.sourceMonitor.play(${speed});
          return __result({
            playbackRequested: true,
            playbackVerified: false,
            speed: ${speed},
            clip: loaded ? loaded.name : null,
            verificationScope: "Premiere accepted the source-monitor playback request only; poll get_source_monitor_position before treating movement as confirmed."
          });
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
