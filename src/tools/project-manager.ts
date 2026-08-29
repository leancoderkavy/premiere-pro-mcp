import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getProjectManagerTools(bridgeOptions: BridgeOptions) {
  return {
    consolidate_and_transfer: {
      description:
        "Consolidate, copy, or transcode project media using the Project Manager. Reports success only after a new destination folder contains a copied Premiere project.",
      parameters: {
        type: "object" as const,
        properties: {
          destination_path: {
            type: "string",
            description: "Destination folder path for the consolidated project",
          },
          include_all_sequences: {
            type: "boolean",
            description: "Include all sequences (default: true). If false, only active sequence is used.",
          },
          copy_to_new_location: {
            type: "boolean",
            description: "Copy media to a new location (default: true)",
          },
          exclude_unused: {
            type: "boolean",
            description: "Exclude unused clips (default: true)",
          },
          transcode: {
            type: "boolean",
            description: "Transcode media during copy (default: false)",
          },
          include_preview_files: {
            type: "boolean",
            description: "Include preview/render files (default: false)",
          },
          rename_media: {
            type: "boolean",
            description: "Rename media to match clip names (default: false)",
          },
          convert_image_sequences: {
            type: "boolean",
            description: "Convert image sequences to clips (default: false)",
          },
          convert_ae_comps: {
            type: "boolean",
            description: "Convert After Effects compositions (default: false)",
          },
          convert_synthetic: {
            type: "boolean",
            description: "Convert synthetic importer items (default: false)",
          },
        },
        required: ["destination_path"],
      },
      handler: async (args: {
        destination_path: string;
        include_all_sequences?: boolean;
        copy_to_new_location?: boolean;
        exclude_unused?: boolean;
        transcode?: boolean;
        include_preview_files?: boolean;
        rename_media?: boolean;
        convert_image_sequences?: boolean;
        convert_ae_comps?: boolean;
        convert_synthetic?: boolean;
      }) => {
        const destinationPath = args.destination_path.trim();
        if (!destinationPath) {
          return { success: false, error: "destination_path must not be empty" };
        }
        const script = buildToolScript(`
          var pm = app.projectManager;
          if (!pm) return __error("Project Manager not available");

          var destination = new Folder("${escapeForExtendScript(destinationPath)}");
          if (destination.exists) {
            return __error("destination_path must be a new, empty folder so the Project Manager output can be verified: ${escapeForExtendScript(destinationPath)}");
          }
          pm.destinationPath = "${escapeForExtendScript(destinationPath)}";
          pm.includeAllSequences = ${args.include_all_sequences !== false ? 1 : 0};
          pm.copyToNewLocation = ${args.copy_to_new_location !== false ? 1 : 0};
          pm.excludeUnused = ${args.exclude_unused !== false ? 1 : 0};
          pm.transcodeMedia = ${args.transcode ? 1 : 0};
          pm.includePreviewFiles = ${args.include_preview_files ? 1 : 0};
          pm.renameMedia = ${args.rename_media ? 1 : 0};
          pm.convertImageSequences = ${args.convert_image_sequences ? 1 : 0};
          pm.convertAEComps = ${args.convert_ae_comps ? 1 : 0};
          pm.convertSyntheticMedia = ${args.convert_synthetic ? 1 : 0};
          
          var accepted = pm.process(app.project);
          if (accepted === false) return __error("Premiere rejected the Project Manager request");
          if (!destination.exists) {
            return __error("Premiere accepted the Project Manager request but did not create the destination folder. No successful transfer is reported.");
          }
          var outputFiles = destination.getFiles("*.prproj");
          if (!outputFiles || outputFiles.length < 1) {
            return __error("Premiere created the destination folder but no copied .prproj file was found. No successful transfer is reported.");
          }
          return __result({
            completed: true,
            verified: true,
            destination: "${escapeForExtendScript(destinationPath)}",
            copiedProjectCount: outputFiles.length
          });
        `);
        return sendCommand(script, { ...bridgeOptions, timeoutMs: 300000 }); // 5 min timeout
      },
    },
  };
}
