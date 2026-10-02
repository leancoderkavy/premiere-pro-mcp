import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import { buildMogrtTextWriteScript, compareMogrtText, MOGRT_TEXT_WRITE_HELPER, summarizeMogrtText, validateMogrtTextMap } from "./mogrt-text.js";

/**
 * ES3 helper: trim an imported MOGRT clip to a duration by moving only its end,
 * then read the end back. importMGT always inserts the template's own default
 * length, so a requested duration has to be applied afterwards. Refuses to run
 * into the next clip on the same track instead of overwriting it.
 */
export const MOGRT_DURATION_HELPER = `
    function __mogrtSetDuration(clip, trackIndex, durationSeconds) {
      var check = { status: "committed_unverified", requestedSeconds: durationSeconds, actualSeconds: null };
      var startTicks = NaN;
      var endTicks = NaN;
      try { startTicks = parseFloat(clip.start.ticks); endTicks = parseFloat(clip.end.ticks); } catch (rangeError) {}
      if (!isFinite(startTicks) || !isFinite(endTicks)) { check.error = "the imported clip exposes no readable timeline range"; return check; }
      var seq = app.project.activeSequence;
      var frameTicks = seq && seq.timebase ? parseFloat(seq.timebase) : NaN;
      if (!frameTicks || isNaN(frameTicks)) frameTicks = TICKS_PER_SECOND / 24;
      var targetEndTicks = startTicks + __secondsToTicks(durationSeconds);
      if (Math.abs(targetEndTicks - endTicks) <= frameTicks) {
        check.status = "verified";
        check.actualSeconds = __ticksToSeconds(endTicks - startTicks);
        return check;
      }
      var track = seq && seq.videoTracks ? seq.videoTracks[trackIndex] : null;
      if (track && track.clips) {
        for (var ci = 0; ci < track.clips.numItems; ci++) {
          var other = track.clips[ci];
          var otherStart = parseFloat(other.start.ticks);
          if (isFinite(otherStart) && otherStart >= endTicks - 1 && otherStart < targetEndTicks - 1) {
            check.status = "blocked";
            check.actualSeconds = __ticksToSeconds(endTicks - startTicks);
            check.error = "extending to " + durationSeconds + "s would overlap '" + other.name + "' on video track " + trackIndex + "; the template's default length was kept";
            return check;
          }
        }
      }
      var writeErrors = [];
      try {
        var newEnd = new Time();
        newEnd.ticks = String(targetEndTicks);
        clip.end = newEnd;
      } catch (timeWriteError) {
        writeErrors.push(String(timeWriteError));
        try { clip.end = String(targetEndTicks); } catch (tickWriteError) { writeErrors.push(String(tickWriteError)); }
      }
      var afterEnd = NaN;
      try { afterEnd = parseFloat(clip.end.ticks); } catch (readError) {}
      if (!isFinite(afterEnd)) { check.error = "the clip end could not be read back"; return check; }
      check.actualSeconds = __ticksToSeconds(afterEnd - startTicks);
      check.status = Math.abs(afterEnd - targetEndTicks) <= frameTicks ? "verified" : "mismatch";
      if (check.status !== "verified" && writeErrors.length) check.error = writeErrors.join("; ");
      return check;
    }
`;

export function getTextTools(bridgeOptions: BridgeOptions) {
  return {
    add_text_overlay: {
      description:
        "Unavailable: Premiere does not expose a supported scripting API to create caption clips directly from raw text. " +
        "For on-screen titles from plain text use add_title; for captions import an .srt/.vtt and use create_caption_track.",
      parameters: {
        type: "object" as const,
        properties: {
          text: {
            type: "string",
            description: "Text content to display",
          },
          start_seconds: {
            type: "number",
            description: "Start time in seconds (default: 0)",
          },
          duration_seconds: {
            type: "number",
            description: "Duration in seconds (default: 5)",
          },
          caption_format: {
            type: "string",
            enum: ["subtitle", "608", "708", "teletext"],
            description: "Caption format (default: subtitle)",
          },
        },
        required: ["text"],
      },
      handler: async (args: {
        text: string;
        start_seconds?: number;
        duration_seconds?: number;
        caption_format?: string;
      }) => {
        void args;
        return {
          success: false,
          error:
            "Premiere does not expose a supported scripting API to create a caption clip from raw text. No mutation was attempted. For an on-screen title from plain text use add_title; for captions import an .srt or .vtt first, then use create_caption_track.",
        };
      },
    },

    import_mogrt: {
      description:
        "Import a Motion Graphics Template (.mogrt) file and add it to the timeline. Pass text_values (for example { \"Headline\": \"...\" }) to write each text control explicitly after insertion and verify it by readback, so a template default or stale value is never left in place silently.",
      parameters: {
        type: "object" as const,
        properties: {
          mogrt_path: {
            type: "string",
            description: "Full path to the .mogrt file",
          },
          track_index: {
            type: "number",
            description: "Video track index (default: 0)",
          },
          start_seconds: {
            type: "number",
            description: "Start time in seconds (default: 0)",
          },
          duration_seconds: {
            type: "number",
            description: "Duration in seconds (default: 5). Applied after import by moving the graphic's end and read back; a duration that would overlap the next clip on the track is not applied.",
          },
          text_values: {
            type: "object",
            description:
              "Optional map of MOGRT text parameter display names to the exact text to write (for example { \"Headline\": \"Chapter 3\" }). Each value is written explicitly after import and read back; the result reports verified, mismatch, missing_property, or committed_unverified per field.",
            additionalProperties: { type: "string" },
          },
        },
        required: ["mogrt_path"],
      },
      handler: async (args: {
        mogrt_path: string;
        track_index?: number;
        start_seconds?: number;
        duration_seconds?: number;
        text_values?: Record<string, string>;
      }) => {
        const textValues = validateMogrtTextMap(args.text_values, "text_values");
        const trackIndex = args.track_index ?? 0;
        const startSeconds = args.start_seconds ?? 0;
        const durationSeconds = args.duration_seconds ?? 5;
        if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 3600) {
          return { success: false, error: "duration_seconds must be a finite number greater than 0 and at most 3600." };
        }

        const script = buildToolScript(`
          ${MOGRT_DURATION_HELPER}
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var mogrtPath = "${escapeForExtendScript(args.mogrt_path)}";
          var startTicks = __secondsToTicks(${startSeconds}).toString();

          var success = seq.importMGT(
            mogrtPath,
            startTicks,
            ${trackIndex},
            ${trackIndex}  // audio track index
          );
          
          if (!success) return __error("Failed to import MOGRT");
          ${textValues ? MOGRT_TEXT_WRITE_HELPER : ""}
          var textReadback = null;
          var textWriteError = null;
          ${textValues ? `
          textReadback = [];
          var mgtComp = null;
          try { mgtComp = success.getMGTComponent ? success.getMGTComponent() : null; } catch (mgtError) { mgtComp = null; }
          if (!mgtComp) {
            textReadback = null;
            textWriteError = "Imported clip exposes no MGT component; text values were not written";
          } else {
            ${buildMogrtTextWriteScript("mgtComp", "textReadback", textValues)}
          }
          ` : ""}
          var durationCheck = __mogrtSetDuration(success, ${trackIndex}, ${durationSeconds});

          return __result({
            imported: true,
            textReadback: textReadback,
            textWriteError: textWriteError,
            mogrtPath: mogrtPath,
            trackIndex: ${trackIndex},
            startSeconds: ${startSeconds},
            durationSeconds: ${durationSeconds},
            duration: durationCheck
          });
        `);
        const result = await sendCommand(script, bridgeOptions);
        if (!result.success) return result;
        const durationStatus = ((result.data as Record<string, unknown> | undefined)?.duration as { status?: string; error?: string } | undefined);
        const durationWarning = durationStatus && durationStatus.status !== "verified"
          ? [`Requested duration was not verified (${durationStatus.status ?? "committed_unverified"})${durationStatus.error ? `: ${durationStatus.error}` : ""}.`]
          : [];
        if (!textValues) {
          return durationWarning.length ? { ...result, data: { ...(result.data as object), warnings: durationWarning } } : result;
        }
        const { textReadback, textWriteError, ...data } = (result.data ?? {}) as Record<string, unknown>;
        if (!Array.isArray(textReadback)) {
          return {
            ...result,
            data: {
              ...data,
              textVerification: "committed_unverified",
              warnings: [String(textWriteError ?? "MOGRT text values could not be written or read back"), ...durationWarning],
            },
          };
        }
        const checks = compareMogrtText(textValues, textReadback as Array<Record<string, unknown>>);
        const status = summarizeMogrtText(checks);
        const warnings = [
          ...(status === "verified" ? [] : ["One or more MOGRT text values did not read back as written; inspect textChecks before delivery."]),
          ...durationWarning,
        ];
        return {
          ...result,
          data: {
            ...data,
            textVerification: status,
            textChecks: checks,
            ...(warnings.length ? { warnings } : {}),
          },
        };
      },
    },

    import_mogrt_from_library: {
      description: "Request importing a MOGRT from a named Adobe Creative Cloud Library. Library contents cannot be enumerated through CEP; host acceptance is committed_unverified, and rendered appearance must be checked in Premiere.",
      parameters: {
        type: "object" as const,
        properties: {
          library_name: {
            type: "string",
            description: "Name of the Adobe Creative Cloud Library that contains the MOGRT",
          },
          mogrt_name: {
            type: "string",
            description: "Name of the MOGRT in the library",
          },
          track_index: {
            type: "number",
            description: "Video track index (default: 0)",
          },
          start_seconds: {
            type: "number",
            description: "Start time in seconds (default: 0)",
          },
        },
        required: ["library_name", "mogrt_name"],
      },
      handler: async (args: {
        library_name: string;
        mogrt_name: string;
        track_index?: number;
        start_seconds?: number;
      }) => {
        const trackIndex = args.track_index ?? 0;
        const startSeconds = args.start_seconds ?? 0;

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var libraryName = "${escapeForExtendScript(args.library_name)}";
          var mogrtName = "${escapeForExtendScript(args.mogrt_name)}";
          var startTicks = __secondsToTicks(${startSeconds}).toString();
          
          if (typeof seq.importMGTFromLibrary !== "function") return __error("This Premiere build does not expose importMGTFromLibrary; no import was attempted.");
          var hostResult;
          try { hostResult = seq.importMGTFromLibrary(
            libraryName,
            mogrtName,
            startTicks,
            ${trackIndex},
            ${trackIndex}
          ); } catch (libraryError) {
            return __error("Premiere could not import MOGRT '" + mogrtName + "' from library '" + libraryName + "': " + libraryError.toString() + ". Verify the library/template names, Creative Cloud sign-in and sync, and template compatibility. CEP cannot enumerate Library contents.", { outcome: "failed", mutationOutcome: "unknown", verified: false, mutationAttempted: true, renderVerified: false, note: "Premiere may have changed the sequence before throwing. Inspect the target track before retrying." });
          }
          if (!hostResult) return __error("Premiere did not confirm importing MOGRT '" + mogrtName + "' from library '" + libraryName + "'. Verify the library/template names, Creative Cloud sign-in and sync, and template compatibility; CEP cannot enumerate Library contents.", { outcome: "failed", mutationOutcome: "unknown", verified: false, mutationAttempted: true, renderVerified: false });
          
          return __result({
            importRequested: true,
            hostAccepted: true,
            outcome: "committed_unverified",
            verified: false,
            renderVerified: false,
            verificationScope: "Premiere returned a truthy import result. Library contents, inserted clip identity, and rendered appearance are not independently verified; inspect the target track before retrying.",
            libraryName: libraryName,
            mogrtName: mogrtName,
            trackIndex: ${trackIndex},
            startSeconds: ${startSeconds}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
