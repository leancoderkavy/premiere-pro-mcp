import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import { buildMogrtTextWriteScript, compareMogrtText, MOGRT_TEXT_WRITE_HELPER, summarizeMogrtText, validateMogrtTextMap } from "./mogrt-text.js";

export function getTextTools(bridgeOptions: BridgeOptions) {
  return {
    add_text_overlay: {
      description:
        "Unavailable: Premiere does not expose a supported scripting API to create caption clips directly from raw text. " +
        "Import an .srt/.vtt and use create_caption_track, or use a MOGRT/PNG overlay for title graphics.",
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
            "Premiere does not expose a supported scripting API to create a caption clip from raw text. No mutation was attempted. Import an .srt or .vtt first, then use create_caption_track; use a MOGRT or pre-rendered PNG overlay for title graphics.",
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
            description: "Duration in seconds (default: 5)",
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

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var mogrtPath = "${escapeForExtendScript(args.mogrt_path)}";
          var startTicks = __secondsToTicks(${startSeconds}).toString();
          var durationTicks = __secondsToTicks(${durationSeconds}).toString();
          
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

          return __result({
            imported: true,
            textReadback: textReadback,
            textWriteError: textWriteError,
            mogrtPath: mogrtPath,
            trackIndex: ${trackIndex},
            startSeconds: ${startSeconds},
            durationSeconds: ${durationSeconds}
          });
        `);
        const result = await sendCommand(script, bridgeOptions);
        if (!textValues || !result.success) return result;
        const { textReadback, textWriteError, ...data } = (result.data ?? {}) as Record<string, unknown>;
        if (!Array.isArray(textReadback)) {
          return {
            ...result,
            data: {
              ...data,
              textVerification: "committed_unverified",
              warnings: [String(textWriteError ?? "MOGRT text values could not be written or read back")],
            },
          };
        }
        const checks = compareMogrtText(textValues, textReadback as Array<Record<string, unknown>>);
        const status = summarizeMogrtText(checks);
        return {
          ...result,
          data: {
            ...data,
            textVerification: status,
            textChecks: checks,
            ...(status === "verified"
              ? {}
              : { warnings: ["One or more MOGRT text values did not read back as written; inspect textChecks before delivery."] }),
          },
        };
      },
    },

    import_mogrt_from_library: {
      description: "Import a MOGRT from a named Adobe Creative Cloud Library.",
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
          
          var success = seq.importMGTFromLibrary(
            libraryName,
            mogrtName,
            startTicks,
            ${trackIndex},
            ${trackIndex}
          );
          if (!success) return __error("Failed to import MOGRT from library: " + mogrtName);
          
          return __result({
            imported: true,
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
