import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getTextTools(bridgeOptions: BridgeOptions) {
  return {
    add_text_overlay: {
      description:
        "Add a subtitle-style text overlay to the active sequence. " +
        "Note: Premiere's ExtendScript API does not expose Essential-Graphics title creation, " +
        "so this routes through the Captions/Subtitle API. Text appears on a caption track at " +
        "the platform-default subtitle position. For freeform titles, render a PNG and import_media it instead.",
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
        const startSeconds = args.start_seconds ?? 0;
        const durationSeconds = args.duration_seconds ?? 5;
        const formatMap: Record<string, number> = {
          // Premiere Caption format constants (Sequence.captionFormat)
          subtitle: 3,
          "608": 1,
          "708": 2,
          teletext: 4,
        };
        const formatNum = formatMap[args.caption_format ?? "subtitle"] ?? 3;

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var startTicks = __secondsToTicks(${startSeconds});
          var endTicks = __secondsToTicks(${startSeconds + durationSeconds});
          var textContent = "${escapeForExtendScript(args.text)}";

          // createCaptionTrack(captionFormat:Number) -> Track. Reuse first
          // matching track if it exists; otherwise create one.
          var captionTrack = null;
          try {
            captionTrack = seq.createCaptionTrack(${formatNum});
          } catch(eCT) {
            return __error("createCaptionTrack failed: " + eCT.toString());
          }
          if (!captionTrack) return __error("Could not create caption track");

          var newCap = null;
          try {
            // Modern signature: addCaption(startTime:Time, endTime:Time)
            newCap = captionTrack.addCaption(startTicks, endTicks);
            if (newCap) {
              try { newCap.text = textContent; } catch(eT) {}
            }
          } catch(eAdd) {
            return __error("addCaption failed: " + eAdd.toString());
          }

          return __result({
            added: true,
            text: textContent,
            captionFormat: ${formatNum},
            startSeconds: ${startSeconds},
            durationSeconds: ${durationSeconds}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    import_mogrt: {
      description: "Import a Motion Graphics Template (.mogrt) file and add it to the timeline",
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
        },
        required: ["mogrt_path"],
      },
      handler: async (args: {
        mogrt_path: string;
        track_index?: number;
        start_seconds?: number;
        duration_seconds?: number;
      }) => {
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
          
          return __result({
            imported: true,
            mogrtPath: mogrtPath,
            trackIndex: ${trackIndex},
            startSeconds: ${startSeconds},
            durationSeconds: ${durationSeconds}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    import_mogrt_from_library: {
      description: "Import a MOGRT from an Adobe Library by name",
      parameters: {
        type: "object" as const,
        properties: {
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
        required: ["mogrt_name"],
      },
      handler: async (args: { mogrt_name: string; track_index?: number; start_seconds?: number }) => {
        const trackIndex = args.track_index ?? 0;
        const startSeconds = args.start_seconds ?? 0;

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var mogrtName = "${escapeForExtendScript(args.mogrt_name)}";
          var startTicks = __secondsToTicks(${startSeconds}).toString();
          
          var success = seq.importMGTFromLibrary(mogrtName, startTicks, ${trackIndex}, ${trackIndex});
          if (!success) return __error("Failed to import MOGRT from library: " + mogrtName);
          
          return __result({ imported: true, mogrtName: mogrtName, trackIndex: ${trackIndex} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
