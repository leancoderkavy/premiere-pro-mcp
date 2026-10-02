import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getPlayheadTools(bridgeOptions: BridgeOptions) {
  return {
    get_playhead_position: {
      description: "Get the current playhead (CTI) position in the active sequence",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var ticks = seq.getPlayerPosition().ticks;
          return __result({
            seconds: __ticksToSeconds(ticks),
            ticks: ticks
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_playhead_position: {
      description: "Set the playhead (CTI) position, clamp it to the active sequence's end, and read the stored position back.",
      parameters: {
        type: "object" as const,
        properties: {
          time_seconds: {
            type: "number",
            description: "Time position in seconds to move the playhead to",
          },
        },
        required: ["time_seconds"],
      },
      handler: async (args: { time_seconds: number }) => {
        if (!Number.isFinite(args.time_seconds) || args.time_seconds < 0) {
          return { success: false as const, error: "time_seconds must be a finite, non-negative number of seconds" };
        }
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var requestedTicks = __secondsToTicks(${args.time_seconds});
          var endTicks = parseFloat(seq.end);
          if (!isFinite(endTicks) || endTicks < 0) return __error("Premiere did not expose a valid sequence end; the playhead was not moved.");
          var targetTicks = Math.min(requestedTicks, endTicks);
          seq.setPlayerPosition(String(Math.round(targetTicks)));
          var observed = null;
          try { observed = parseFloat(seq.getPlayerPosition().ticks); } catch (readError) {}
          if (observed === null || !isFinite(observed)) return __result({ outcome: "committed_unverified", requestedSeconds: ${args.time_seconds}, positionSeconds: null, warning: "The playhead was moved but its position could not be read back." });
          var frameTicks = parseFloat(seq.timebase);
          var verified = Math.abs(observed - targetTicks) <= (isFinite(frameTicks) && frameTicks > 0 ? frameTicks : 1);
          return __result({ requestedSeconds: ${args.time_seconds}, positionSeconds: __ticksToSeconds(observed), clamped: targetTicks !== requestedTicks, verified: verified, outcome: verified ? "verified" : "committed_unverified" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_work_area: {
      description: "Set the work area (bar) in and out points",
      parameters: {
        type: "object" as const,
        properties: {
          in_seconds: {
            type: "number",
            description: "Work area in-point in seconds",
          },
          out_seconds: {
            type: "number",
            description: "Work area out-point in seconds",
          },
        },
        required: ["in_seconds", "out_seconds"],
      },
      handler: async (args: { in_seconds: number; out_seconds: number }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          // Live hosts (25.2, 26.5.1) read and write work-area points in seconds,
          // not ticks. Write seconds, then read back: some builds ignore the write.
          var requestedIn = ${Number(args.in_seconds)};
          var requestedOut = ${Number(args.out_seconds)};
          if (!(requestedOut > requestedIn)) return __error("out_seconds must be greater than in_seconds.");
          seq.setWorkAreaInPoint(requestedIn);
          seq.setWorkAreaOutPoint(requestedOut);
          var observedIn = __workAreaSeconds(seq.getWorkAreaInPoint());
          var observedOut = __workAreaSeconds(seq.getWorkAreaOutPoint());
          var frameSeconds = seq.timebase ? __ticksToSeconds(seq.timebase) : 1 / 24;
          if (observedIn === null || observedOut === null ||
              Math.abs(observedIn - requestedIn) > frameSeconds || Math.abs(observedOut - requestedOut) > frameSeconds) {
            return __error("Premiere did not apply the work area (read back " + observedIn + " to " + observedOut + " s). Use set_sequence_in_out_points to mark an export range instead.");
          }
          return __result({ workAreaIn: observedIn, workAreaOut: observedOut, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_work_area: {
      description: "Get the current work area in and out points",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var inPoint = seq.getWorkAreaInPoint();
          var outPoint = seq.getWorkAreaOutPoint();
          var enabled = null;
          try { if (typeof seq.isWorkAreaEnabled === "function") enabled = !!seq.isWorkAreaEnabled(); } catch (enabledError) {}
          return __result({
            inSeconds: __workAreaSeconds(inPoint),
            outSeconds: __workAreaSeconds(outPoint),
            rawIn: String(inPoint),
            rawOut: String(outPoint),
            enabled: enabled
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_sequence_in_out_points: {
      description: "Set the sequence in and out points (for export range, etc.)",
      parameters: {
        type: "object" as const,
        properties: {
          in_seconds: {
            type: "number",
            description: "In-point in seconds",
          },
          out_seconds: {
            type: "number",
            description: "Out-point in seconds",
          },
        },
        required: ["in_seconds", "out_seconds"],
      },
      handler: async (args: { in_seconds: number; out_seconds: number }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          seq.setInPoint(${args.in_seconds});
          seq.setOutPoint(${args.out_seconds});
          var observedIn = Number(seq.getInPoint());
          var observedOut = Number(seq.getOutPoint());
          var tolerance = 0.001;
          if (!isFinite(observedIn) || !isFinite(observedOut) ||
              Math.abs(observedIn - ${args.in_seconds}) > tolerance ||
              Math.abs(observedOut - ${args.out_seconds}) > tolerance) {
            return __error("Premiere did not apply the requested sequence in/out points; observed " + observedIn + " to " + observedOut + " seconds");
          }
          return __result({ inSeconds: observedIn, outSeconds: observedOut, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_sequence_in_out_points: {
      description: "Get the current sequence in and out points",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var inSeconds = __sequencePointSeconds(seq.getInPoint());
          var outSeconds = __sequencePointSeconds(seq.getOutPoint());
          return __result({
            inSeconds: inSeconds,
            outSeconds: outSeconds,
            inSet: inSeconds !== null,
            outSet: outSeconds !== null
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
