import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

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
