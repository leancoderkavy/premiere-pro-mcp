import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

function nonNegativeSecondsError(args: Record<string, unknown>, names: string[]): string | null {
  for (const name of names) {
    const value = args[name];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return `${name} must be a finite, non-negative number of seconds.`;
  }
  return null;
}

export function getPlayheadTools(bridgeOptions: BridgeOptions) {
  return {
    get_playhead_position: {
      description: "Get the current playhead (CTI) position in the active sequence",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __refuse("No active sequence");
          
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
            description: "Time position in seconds to move the playhead to (0 to the sequence end)",
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
          if (!seq) return __refuse("No active sequence");
          
          var requestedTicks = __secondsToTicks(${args.time_seconds});
          var endTicks = parseFloat(seq.end);
          if (!isFinite(endTicks) || endTicks < 0) return __refuse("Premiere did not expose a valid sequence end; the playhead was not moved.");
          var frameTicks = __sequenceFrameTicks(seq);
          if (!isFinite(frameTicks)) return __refuse("The active sequence frame grid could not be read; the playhead was not moved.");
          var snappedTicks = __snapSequenceTicks(seq, requestedTicks);
          var targetTicks = Math.min(snappedTicks, __snapSequenceTicks(seq, endTicks));
          seq.setPlayerPosition(String(Math.round(targetTicks)));
          var observed = null;
          try { observed = parseFloat(seq.getPlayerPosition().ticks); } catch (readError) {}
          if (observed === null || !isFinite(observed)) return __result({ outcome: "committed_unverified", requestedSeconds: ${args.time_seconds}, positionSeconds: null, warning: "The playhead was moved but its position could not be read back." });
          var verified = Math.abs(observed - targetTicks) <= frameTicks / 1000 && Math.abs(observed / frameTicks - Math.round(observed / frameTicks)) <= 0.001;
          var payload = { requestedSeconds: ${args.time_seconds}, positionSeconds: __ticksToSeconds(observed), clamped: targetTicks !== snappedTicks, verified: verified, outcome: verified ? "verified" : "committed_unverified" };
          var snapReceipt = __frameSnapReceipt(requestedTicks, snappedTicks, frameTicks, "requestedSeconds", "appliedSeconds");
          if (snapReceipt.requestedSeconds !== undefined) { payload.requestedSeconds = snapReceipt.requestedSeconds; payload.appliedSeconds = snapReceipt.appliedSeconds; }
          return __result(payload);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_work_area: {
      description: "Set and verify the work-area points, turning the bar on first through the public Sequence API when it is off. Fails when Premiere leaves the points unchanged (26.5.2 ignores these CEP writes; use the UXP set_work_area there) and turns the bar back off if this call turned it on. Unreadable or partial writes report committed_unverified.",
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
        const invalid = nonNegativeSecondsError(args, ["in_seconds", "out_seconds"]);
        if (invalid) return { success: false, error: invalid };
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __refuse("No active sequence");
          
          // Live hosts (25.2, 26.5.1) read and write work-area points in seconds,
          // not ticks. Write seconds, then read back: some builds ignore the write.
          var requestedInRaw = __secondsToTicks(${Number(args.in_seconds)});
          var requestedOutRaw = __secondsToTicks(${Number(args.out_seconds)});
          var frameTicks = __sequenceFrameTicks(seq);
          if (!isFinite(frameTicks)) return __refuse("The active sequence frame grid could not be read; no work-area points were changed.");
          var appliedInTicks = __snapSequenceTicks(seq, requestedInRaw);
          var appliedOutTicks = __snapSequenceTicks(seq, requestedOutRaw);
          var requestedIn = __ticksToSeconds(appliedInTicks);
          var requestedOut = __ticksToSeconds(appliedOutTicks);
          if (!(requestedOut > requestedIn)) return __refuse("out_seconds must be greater than in_seconds.");
          if (typeof seq.setWorkAreaInPoint !== "function" || typeof seq.setWorkAreaOutPoint !== "function" ||
              typeof seq.getWorkAreaInPoint !== "function" || typeof seq.getWorkAreaOutPoint !== "function") {
            return __error("Work-area point APIs are unavailable; no points were changed.", { outcome: "failed", verified: false });
          }
          var enabledBefore = __workAreaEnabled(seq);
          var enableAttempted = false;
          if (enabledBefore === null) return __error("Work-area enabled state could not be read. Turn on Work Area Bar in the Timeline panel menu and retry on a host with readable state.", { outcome: "failed", verified: false });
          if (!enabledBefore) {
            if (typeof seq.setWorkAreaEnabled !== "function") return __error("Work Area Bar is disabled and this host cannot enable it through the public API. Turn on Work Area Bar in the Timeline panel menu, then retry.", { outcome: "failed", verified: false, workAreaEnabled: false });
            enableAttempted = true;
            try { seq.setWorkAreaEnabled(true); } catch (enableError) {
              return __result({ outcome: "committed_unverified", verified: false, workAreaEnabled: __workAreaEnabled(seq), warning: "Enabling Work Area Bar threw; its state may have changed. No point writes were attempted. Inspect the bar before retrying." });
            }
            var enabledAfter = __workAreaEnabled(seq);
            if (enabledAfter !== true) {
              if (enabledAfter === null) return __result({ outcome: "committed_unverified", verified: false, workAreaEnabled: null, warning: "Work Area Bar enable was attempted but its state is unreadable. No point writes were attempted." });
              return __error("Work Area Bar remained disabled. Turn on Work Area Bar in the Timeline panel menu, then retry; no points were changed.", { outcome: "failed", verified: false, workAreaEnabled: false });
            }
          }
          var beforeIn = null, beforeOut = null;
          try { beforeIn = __workAreaSeconds(seq.getWorkAreaInPoint()); } catch (beforeInError) {}
          try { beforeOut = __workAreaSeconds(seq.getWorkAreaOutPoint()); } catch (beforeOutError) {}
          var observedIn = null, observedOut = null;
          var writeError = null;
          try {
            seq.setWorkAreaInPoint(requestedIn);
            seq.setWorkAreaOutPoint(requestedOut);
          } catch (pointWriteError) { writeError = String(pointWriteError); }
          try { observedIn = __workAreaSeconds(seq.getWorkAreaInPoint()); } catch (inReadError) {}
          try { observedOut = __workAreaSeconds(seq.getWorkAreaOutPoint()); } catch (outReadError) {}
          var enabledReadback = __workAreaEnabled(seq);
          var frameSeconds = __ticksToSeconds(frameTicks);
          var verified = !writeError && enabledReadback === true && observedIn !== null && observedOut !== null &&
            Math.abs(observedIn - requestedIn) <= frameSeconds / 1000 && Math.abs(observedOut - requestedOut) <= frameSeconds / 1000;
          var pointTolerance = frameSeconds / 1000;
          // Live 26.5.2: setWorkAreaInPoint/OutPoint return without error and change nothing,
          // even with the bar enabled. Unchanged readback is a definite failure, not an unknown.
          var ignored = !verified && !writeError && beforeIn !== null && beforeOut !== null &&
            observedIn !== null && observedOut !== null &&
            Math.abs(observedIn - beforeIn) <= pointTolerance && Math.abs(observedOut - beforeOut) <= pointTolerance;
          if (ignored) {
            var failure = { outcome: "failed", verified: false, workAreaIn: observedIn, workAreaOut: observedOut, enabledByTool: false };
            if (enableAttempted) {
              var restoreError = null;
              try { seq.setWorkAreaEnabled(false); } catch (disableError) { restoreError = String(disableError); }
              var restoredState = __workAreaEnabled(seq);
              failure.workAreaEnabled = restoredState;
              failure.barRestored = !restoreError && restoredState === false;
            } else {
              failure.workAreaEnabled = enabledReadback;
            }
            return __error("Premiere ignored the work-area point writes; the stored points are unchanged." +
              (enableAttempted ? (failure.barRestored ? " Work Area Bar was turned back off." : " Work Area Bar was turned on and could not be turned back off; turn it off in the Timeline panel menu if needed.") : "") +
              " Use set_work_area through the UXP bridge, or set_sequence_in_out_points for an export range.", failure);
          }
          var payload = { workAreaIn: observedIn, workAreaOut: observedOut, workAreaEnabled: enabledReadback,
            enabledByTool: enableAttempted && enabledReadback === true, verified: verified,
            outcome: verified ? "verified" : "committed_unverified" };
          if (!verified) payload.warning = "Premiere did not apply the work area with verified readback. Inspect the stored points before retrying; use set_sequence_in_out_points for an export range instead." + (writeError ? " " + writeError : "");
          var inSnap = __frameSnapReceipt(requestedInRaw, appliedInTicks, frameTicks, "requestedInSeconds", "appliedInSeconds");
          var outSnap = __frameSnapReceipt(requestedOutRaw, appliedOutTicks, frameTicks, "requestedOutSeconds", "appliedOutSeconds");
          if (inSnap.requestedInSeconds !== undefined) { payload.requestedInSeconds = inSnap.requestedInSeconds; payload.appliedInSeconds = inSnap.appliedInSeconds; }
          if (outSnap.requestedOutSeconds !== undefined) { payload.requestedOutSeconds = outSnap.requestedOutSeconds; payload.appliedOutSeconds = outSnap.appliedOutSeconds; }
          return __result(payload);
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
          if (!seq) return __refuse("No active sequence");
          var inPoint = null, outPoint = null;
          try { inPoint = seq.getWorkAreaInPoint(); } catch (inReadError) {}
          try { outPoint = seq.getWorkAreaOutPoint(); } catch (outReadError) {}
          var enabled = __workAreaEnabled(seq);
          return __result({
            inSeconds: __workAreaSeconds(inPoint),
            outSeconds: __workAreaSeconds(outPoint),
            rawIn: inPoint === null ? null : String(inPoint),
            rawOut: outPoint === null ? null : String(outPoint),
            enabled: enabled
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_sequence_in_out_points: {
      description: "Set the sequence in and out points (for an export range, etc.) and read them back. out_seconds must be after in_seconds and not past the sequence end.",
      parameters: {
        type: "object" as const,
        properties: {
          in_seconds: {
            type: "number",
            description: "In-point in seconds (0 or later)",
          },
          out_seconds: {
            type: "number",
            description: "Out-point in seconds; after in_seconds and not past the sequence end",
          },
        },
        required: ["in_seconds", "out_seconds"],
      },
      handler: async (args: { in_seconds: number; out_seconds: number }) => {
        const invalid = nonNegativeSecondsError(args, ["in_seconds", "out_seconds"]);
        if (invalid) return { success: false, error: invalid };
        // Live 25.2.3: an out-point before the in-point clears the in-point,
        // so refuse before writing anything.
        if (!(args.out_seconds > args.in_seconds)) return { success: false, error: "out_seconds must be after in_seconds. Nothing was changed." };
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __refuse("No active sequence");
          
          var frameTicks = __sequenceFrameTicks(seq);
          if (!isFinite(frameTicks)) return __refuse("The active sequence frame grid could not be read; no sequence in/out points were changed.");
          var frameSeconds = __ticksToSeconds(frameTicks);
          var requestedInTicks = __secondsToTicks(${args.in_seconds});
          var requestedOutTicks = __secondsToTicks(${args.out_seconds});
          var appliedInTicks = __snapSequenceTicks(seq, requestedInTicks);
          var appliedOutTicks = __snapSequenceTicks(seq, requestedOutTicks);
          var appliedInSeconds = __ticksToSeconds(appliedInTicks);
          var appliedOutSeconds = __ticksToSeconds(appliedOutTicks);
          if (!(appliedOutTicks > appliedInTicks)) return __refuse("The requested sequence marks collapse after frame-grid snapping; no points were changed.");
          var endSeconds = __ticksToSeconds(seq.end);
          if (isFinite(endSeconds) && appliedOutSeconds > endSeconds + frameSeconds / 2) {
            return __refuse("out_seconds ${args.out_seconds}s is past the sequence end at " + endSeconds + "s. Nothing was changed.");
          }
          var previousIn = __sequencePointSeconds(seq.getInPoint());
          var previousOut = __sequencePointSeconds(seq.getOutPoint());
          // Live 26.5.2: Premiere stores sequence marks floored to the audio
          // sample grid, and an In/Out export renders from the frame holding the
          // In up to the frame holding the Out. At 29.97 with 48 kHz audio, four
          // in five frame starts sit between samples, so marks written on a frame
          // were stored just before it and the export started and ended one frame
          // early. Write each mark on the first sample at or after its frame start.
          var sampleRate = null;
          try { sampleRate = __sampleRateHz(seq.getSettings().audioSampleRate); } catch (sampleRateError) {}
          var sampleSeconds = sampleRate ? 1 / sampleRate : 0;
          function onOrAfterSample(seconds) {
            return sampleRate ? (Math.ceil(seconds * sampleRate - 0.01) + 0.25) / sampleRate : seconds;
          }
          var inWriteSeconds = onOrAfterSample(appliedInSeconds);
          var outWriteSeconds = onOrAfterSample(appliedOutSeconds);
          seq.setInPoint(inWriteSeconds);
          seq.setOutPoint(outWriteSeconds);
          var observedIn = __sequencePointSeconds(seq.getInPoint());
          var observedOut = __sequencePointSeconds(seq.getOutPoint());
          var tolerance = frameSeconds / 1000 + sampleSeconds;
          if (observedIn === null || observedOut === null ||
              Math.abs(observedIn - appliedInSeconds) > tolerance ||
              Math.abs(observedOut - appliedOutSeconds) > tolerance) {
            return __jsonStringify({ success: false, error: "Premiere did not apply the requested sequence in/out points; they now read " + observedIn + " to " + observedOut + " seconds (unset reads as null).", data: { inSeconds: observedIn, outSeconds: observedOut, previousInSeconds: previousIn, previousOutSeconds: previousOut } });
          }
          var payload = { inSeconds: observedIn, outSeconds: observedOut, verified: true };
          var inSnap = __frameSnapReceipt(requestedInTicks, appliedInTicks, frameTicks, "requestedInSeconds", "appliedInSeconds");
          var outSnap = __frameSnapReceipt(requestedOutTicks, appliedOutTicks, frameTicks, "requestedOutSeconds", "appliedOutSeconds");
          if (inSnap.requestedInSeconds !== undefined) { payload.requestedInSeconds = inSnap.requestedInSeconds; payload.appliedInSeconds = inSnap.appliedInSeconds; }
          if (outSnap.requestedOutSeconds !== undefined) { payload.requestedOutSeconds = outSnap.requestedOutSeconds; payload.appliedOutSeconds = outSnap.appliedOutSeconds; }
          return __result(payload);
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
          if (!seq) return __refuse("No active sequence");
          
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
