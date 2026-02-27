import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getTextTools(bridgeOptions: BridgeOptions) {
  return {
    add_text_overlay: {
      description: "Add a text overlay (title) to the active sequence",
      parameters: {
        type: "object" as const,
        properties: {
          text: {
            type: "string",
            description: "Text content to display",
          },
          track_index: {
            type: "number",
            description: "Video track index to place the text on (default: topmost track)",
          },
          start_seconds: {
            type: "number",
            description: "Start time in seconds (default: 0)",
          },
          duration_seconds: {
            type: "number",
            description: "Duration in seconds (default: 5)",
          },
          font_size: {
            type: "number",
            description: "Font size (default: 60)",
          },
        },
        required: ["text"],
      },
      handler: async (args: {
        text: string;
        track_index?: number;
        start_seconds?: number;
        duration_seconds?: number;
        font_size?: number;
      }) => {
        const startSeconds = args.start_seconds ?? 0;
        const durationSeconds = args.duration_seconds ?? 5;

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var trackIndex = ${args.track_index !== undefined ? args.track_index : "seq.videoTracks.numTracks - 1"};
          
          // Create a graphics clip using the captions API approach
          var project = app.project;
          
          // Use QE DOM to insert text
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          
          // Add a caption track if needed, then add text
          // Note: Direct text creation requires MOGRT or Graphics workspace
          // For basic text, we use the Graphics approach
          var startTicks = __secondsToTicks(${startSeconds}).toString();
          var endTicks = __secondsToTicks(${startSeconds + durationSeconds}).toString();
          
          // Create text via project item
          var textContent = "${escapeForExtendScript(args.text)}";
          project.activeSequence.createCaptionTrack(textContent, startTicks, "Subtitle");
          
          return __result({
            added: true,
            text: textContent,
            trackIndex: trackIndex,
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
