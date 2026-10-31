import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getProjectManagerTools(bridgeOptions: BridgeOptions) {
  return {
    consolidate_and_transfer: {
      description:
        "Collect (copy) or transcode project media into a new project with Premiere's Project Manager. Premiere writes a Copied_<project> folder inside destination_path (created if missing); success is reported only after that folder holds the copied .prproj, with the copied files listed.",
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
            description: "Must be true (the default): Premiere's scripted Project Manager always collects media into the destination.",
          },
          exclude_unused: {
            type: "boolean",
            description: "Exclude unused clips (default: true)",
          },
          transcode: {
            type: "boolean",
            description: "Transcode media to match the sequence instead of copying it (default: false)",
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
        if (args.copy_to_new_location === false) {
          return { success: false, error: "copy_to_new_location false is not supported: Premiere's scripted Project Manager always collects media into destination_path." };
        }
        const destination = escapeForExtendScript(destinationPath.replace(/\/+$/, ""));
        // Live 25.2: the settings live on projectManager.options (setting them on
        // projectManager itself is ignored), the destination must already exist,
        // process() returns 0 on success, and the copy lands in Copied_<project>.
        const script = buildToolScript(`
          var pm = app.projectManager;
          if (!pm || !pm.options) return __refuse("Project Manager not available");
          var project = app.project;
          if (!project) return __refuse("No project is open");
          ${args.include_all_sequences === false ? `if (!project.activeSequence) return __error("include_all_sequences is false but there is no active sequence");` : ""}

          var destination = new Folder("${destination}");
          if (destination.exists && !__isDirectory("${destination}")) return __error("destination_path ${destination} is a file, not a folder");
          if (!destination.exists && !destination.create()) return __error("Could not create destination_path ${destination}");
          var outputName = "Copied_" + String(project.name).replace(/\\.prproj$/i, "");
          var output = new Folder("${destination}/" + outputName);
          if (output.exists) {
            return __error("${destination}/" + outputName + " already exists; choose another destination_path so the new copy can be verified.");
          }

          var o = pm.options;
          o.clipTransferOption = ${args.transcode ? "o.CLIP_TRANSFER_TRANSCODE" : "o.CLIP_TRANSFER_COPY"};
          ${args.transcode ? "o.clipTranscoderOption = o.CLIP_TRANSCODE_MATCH_SEQUENCE;" : ""}
          o.includeAllSequences = ${args.include_all_sequences !== false};
          ${args.include_all_sequences === false ? "o.affectedSequences = [project.activeSequence];" : ""}
          o.excludeUnused = ${args.exclude_unused !== false};
          o.includePreviews = ${args.include_preview_files === true};
          o.renameMedia = ${args.rename_media === true};
          o.convertImageSequencesToClips = ${args.convert_image_sequences === true};
          o.convertAECompsToClips = ${args.convert_ae_comps === true};
          o.convertSyntheticsToClips = ${args.convert_synthetic === true};
          o.destinationPath = "${destination}/";

          var status = pm.process(project);
          var errors = [];
          try { for (var e = 0; e < pm.errors.length; e++) errors.push(String(pm.errors[e])); } catch (eErrors) {}
          if (!output.exists) {
            return __jsonStringify({ success: false, error: "Project Manager did not create " + outputName + " in the destination (process returned " + status + ").", data: { errors: errors } });
          }
          var projects = output.getFiles("*.prproj");
          if (!projects || projects.length < 1) {
            return __jsonStringify({ success: false, error: outputName + " was created but holds no copied .prproj (process returned " + status + ").", data: { errors: errors } });
          }
          var files = [];
          var totalBytes = 0;
          var walk = function (folder, prefix) {
            var entries = folder.getFiles();
            for (var f = 0; f < entries.length && files.length < 500; f++) {
              if (entries[f] instanceof Folder) walk(entries[f], prefix + entries[f].name + "/");
              else { files.push(prefix + decodeURI(entries[f].name)); totalBytes += entries[f].length; }
            }
          };
          walk(output, "");
          return __result({
            completed: true,
            verified: true,
            destination: "${destination}",
            outputFolder: output.fsName,
            copiedProject: projects[0].fsName,
            scope: ${args.include_all_sequences === false ? "\"active sequence: \" + project.activeSequence.name" : "\"all sequences\""},
            transferMode: "${args.transcode ? "transcode (match sequence)" : "copy"}",
            fileCount: files.length,
            totalBytes: totalBytes,
            files: files,
            errors: errors
          });
        `);
        return sendCommand(script, { ...bridgeOptions, timeoutMs: 300000 }); // 5 min timeout
      },
    },
  };
}
