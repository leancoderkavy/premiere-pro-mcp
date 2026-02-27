import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getProjectTools(bridgeOptions: BridgeOptions) {
  return {
    save_project: {
      description: "Save the current Premiere Pro project",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var project = app.project;
          if (!project) return __error("No project is open");
          project.save();
          return __result({ saved: true, name: project.name, path: project.path });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    save_project_as: {
      description: "Save the current project to a new location",
      parameters: {
        type: "object" as const,
        properties: {
          path: {
            type: "string",
            description: "Full file path to save the project to (e.g., '/Users/me/projects/MyProject.prproj')",
          },
        },
        required: ["path"],
      },
      handler: async (args: { path: string }) => {
        const script = buildToolScript(`
          var project = app.project;
          if (!project) return __error("No project is open");
          project.saveAs("${escapeForExtendScript(args.path)}");
          return __result({ saved: true, path: "${escapeForExtendScript(args.path)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    open_project: {
      description: "Open a Premiere Pro project file",
      parameters: {
        type: "object" as const,
        properties: {
          path: {
            type: "string",
            description: "Full file path to the .prproj file",
          },
        },
        required: ["path"],
      },
      handler: async (args: { path: string }) => {
        const script = buildToolScript(`
          app.openDocument("${escapeForExtendScript(args.path)}");
          var project = app.project;
          return __result({ opened: true, name: project.name, path: project.path });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_active_sequence: {
      description: "Set the active sequence by name or ID",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence name or ID to make active",
          },
        },
        required: ["sequence_id"],
      },
      handler: async (args: { sequence_id: string }) => {
        const script = buildToolScript(`
          var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}");
          if (!seq) return __error("Sequence not found: ${escapeForExtendScript(args.sequence_id)}");
          app.project.activeSequence = seq;
          return __result({ active: true, name: seq.name, id: seq.sequenceID });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    undo: {
      description: "Undo the last action in Premiere Pro",
      parameters: {
        type: "object" as const,
        properties: {
          count: {
            type: "number",
            description: "Number of times to undo (default: 1)",
          },
        },
      },
      handler: async (args: { count?: number }) => {
        const count = args.count || 1;
        const script = buildToolScript(`
          for (var i = 0; i < ${count}; i++) {
            app.project.undo();
          }
          return __result({ undone: ${count} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    consolidate_duplicates: {
      description: "Consolidate duplicate project items",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.project.consolidateDuplicates();
          return __result({ consolidated: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    create_project: {
      description: "Create a new Premiere Pro project at the specified path",
      parameters: {
        type: "object" as const,
        properties: {
          path: {
            type: "string",
            description: "Full file path for the new .prproj file",
          },
        },
        required: ["path"],
      },
      handler: async (args: { path: string }) => {
        const script = buildToolScript(`
          app.newProject("${escapeForExtendScript(args.path)}");
          var project = app.project;
          if (!project) return __error("Failed to create project");
          return __result({ created: true, name: project.name, path: project.path });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    close_project: {
      description: "Close the current Premiere Pro project",
      parameters: {
        type: "object" as const,
        properties: {
          save_first: {
            type: "boolean",
            description: "Whether to save before closing (default: true)",
          },
        },
      },
      handler: async (args: { save_first?: boolean }) => {
        const save = args.save_first !== false;
        const script = buildToolScript(`
          var project = app.project;
          if (!project) return __error("No project is open");
          var name = project.name;
          project.closeDocument(${save ? "1" : "0"}, ${save ? "0" : "0"});
          return __result({ closed: true, name: name, saved: ${save} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    import_ae_comps: {
      description: "Import After Effects compositions from an .aep file",
      parameters: {
        type: "object" as const,
        properties: {
          ae_project_path: {
            type: "string",
            description: "Full path to the .aep file",
          },
          comp_names: {
            type: "array",
            description: "Array of composition names to import. If omitted, imports all comps.",
          },
          target_bin: {
            type: "string",
            description: "Target bin name or node ID (optional)",
          },
        },
        required: ["ae_project_path"],
      },
      handler: async (args: { ae_project_path: string; comp_names?: string[]; target_bin?: string }) => {
        const binLookup = args.target_bin
          ? `var targetBin = __findProjectItem("${escapeForExtendScript(args.target_bin)}"); if (!targetBin) return __error("Bin not found");`
          : `var targetBin = app.project.rootItem;`;

        if (args.comp_names && args.comp_names.length > 0) {
          const comps = args.comp_names.map(c => `"${escapeForExtendScript(c)}"`).join(", ");
          const script = buildToolScript(`
            ${binLookup}
            app.project.importAEComps("${escapeForExtendScript(args.ae_project_path)}", [${comps}], targetBin);
            return __result({ imported: true, comps: [${comps}] });
          `);
          return sendCommand(script, bridgeOptions);
        } else {
          const script = buildToolScript(`
            ${binLookup}
            app.project.importAllAEComps("${escapeForExtendScript(args.ae_project_path)}", targetBin);
            return __result({ imported: true, allComps: true });
          `);
          return sendCommand(script, bridgeOptions);
        }
      },
    },

    delete_bin: {
      description: "Delete a bin (folder) from the project panel",
      parameters: {
        type: "object" as const,
        properties: {
          bin_id: {
            type: "string",
            description: "Name or node ID of the bin to delete",
          },
        },
        required: ["bin_id"],
      },
      handler: async (args: { bin_id: string }) => {
        const script = buildToolScript(`
          var bin = __findProjectItem("${escapeForExtendScript(args.bin_id)}");
          if (!bin) return __error("Bin not found: ${escapeForExtendScript(args.bin_id)}");
          if (bin.type !== 2) return __error("Item is not a bin");
          var name = bin.name;
          bin.deleteBin();
          return __result({ deleted: true, name: name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    rename_bin: {
      description: "Rename a bin (folder) in the project panel",
      parameters: {
        type: "object" as const,
        properties: {
          bin_id: {
            type: "string",
            description: "Name or node ID of the bin to rename",
          },
          new_name: {
            type: "string",
            description: "New name for the bin",
          },
        },
        required: ["bin_id", "new_name"],
      },
      handler: async (args: { bin_id: string; new_name: string }) => {
        const script = buildToolScript(`
          var bin = __findProjectItem("${escapeForExtendScript(args.bin_id)}");
          if (!bin) return __error("Bin not found: ${escapeForExtendScript(args.bin_id)}");
          if (bin.type !== 2) return __error("Item is not a bin");
          var oldName = bin.name;
          bin.renameBin("${escapeForExtendScript(args.new_name)}");
          return __result({ renamed: true, oldName: oldName, newName: "${escapeForExtendScript(args.new_name)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    create_smart_bin: {
      description: "Create a smart bin (search bin) in the project panel",
      parameters: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Name for the smart bin",
          },
          query: {
            type: "string",
            description: "Search query for the smart bin",
          },
        },
        required: ["name", "query"],
      },
      handler: async (args: { name: string; query: string }) => {
        const script = buildToolScript(`
          app.project.rootItem.createSmartBin("${escapeForExtendScript(args.name)}", "${escapeForExtendScript(args.query)}");
          return __result({ created: true, name: "${escapeForExtendScript(args.name)}", query: "${escapeForExtendScript(args.query)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    find_items_by_media_path: {
      description: "Find project items whose media path contains the given search string",
      parameters: {
        type: "object" as const,
        properties: {
          path_search: {
            type: "string",
            description: "Partial file path to search for",
          },
        },
        required: ["path_search"],
      },
      handler: async (args: { path_search: string }) => {
        const script = buildToolScript(`
          var root = app.project.rootItem;
          var matches = root.findItemsMatchingMediaPath("${escapeForExtendScript(args.path_search)}");
          var items = [];
          if (matches) {
            for (var i = 0; i < matches.length; i++) {
              items.push({
                nodeId: matches[i].nodeId,
                name: matches[i].name,
                type: matches[i].type === 1 ? "clip" : matches[i].type === 2 ? "bin" : "sequence"
              });
            }
          }
          return __result({ count: items.length, items: items });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    open_in_source_monitor: {
      description: "Open a project item in the Source Monitor",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item to open",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found: ${escapeForExtendScript(args.item_id)}");
          app.sourceMonitor.openProjectItem(item);
          return __result({ opened: true, item: item.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    start_batch_encode: {
      description: "Start encoding all items in the Adobe Media Encoder render queue",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.encoder.startBatch();
          return __result({ started: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_custom_metadata_field: {
      description: "Add a custom metadata field to the project's metadata schema",
      parameters: {
        type: "object" as const,
        properties: {
          field_name: {
            type: "string",
            description: "Internal name for the metadata field",
          },
          field_label: {
            type: "string",
            description: "Display label for the field",
          },
          field_type: {
            type: "number",
            description: "Type of the field: 0 = Integer, 1 = Real, 2 = String, 3 = Boolean",
          },
        },
        required: ["field_name", "field_label", "field_type"],
      },
      handler: async (args: { field_name: string; field_label: string; field_type: number }) => {
        const script = buildToolScript(`
          app.project.addPropertyToProjectMetadataSchema("${escapeForExtendScript(args.field_name)}", "${escapeForExtendScript(args.field_label)}", ${args.field_type});
          return __result({ added: true, name: "${escapeForExtendScript(args.field_name)}", label: "${escapeForExtendScript(args.field_label)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
    import_sequences: {
      description: "Import sequences from another Premiere Pro project file",
      parameters: {
        type: "object" as const,
        properties: {
          project_path: {
            type: "string",
            description: "Full path to the source .prproj file",
          },
          sequence_ids: {
            type: "array",
            description: "Array of sequence IDs to import from the source project. If omitted, all sequences are imported.",
          },
        },
        required: ["project_path"],
      },
      handler: async (args: { project_path: string; sequence_ids?: string[] }) => {
        if (args.sequence_ids && args.sequence_ids.length > 0) {
          const ids = args.sequence_ids.map(id => `"${escapeForExtendScript(id)}"`).join(", ");
          const script = buildToolScript(`
            app.project.importSequences("${escapeForExtendScript(args.project_path)}", [${ids}]);
            return __result({ imported: true, sequenceIds: [${ids}] });
          `);
          return sendCommand(script, bridgeOptions);
        } else {
          const script = buildToolScript(`
            app.project.importSequences("${escapeForExtendScript(args.project_path)}");
            return __result({ imported: true, allSequences: true });
          `);
          return sendCommand(script, bridgeOptions);
        }
      },
    },

    create_bars_and_tone: {
      description: "Create a Bars and Tone synthetic media item in the project (useful for leader/calibration)",
      parameters: {
        type: "object" as const,
        properties: {
          width: {
            type: "number",
            description: "Frame width in pixels (default: 1920)",
          },
          height: {
            type: "number",
            description: "Frame height in pixels (default: 1080)",
          },
          timebase: {
            type: "string",
            description: "Timebase as ticks-per-second string (default uses sequence timebase)",
          },
          name: {
            type: "string",
            description: "Name for the bars and tone item (default: 'Bars and Tone')",
          },
        },
      },
      handler: async (args: { width?: number; height?: number; timebase?: string; name?: string }) => {
        const w = args.width ?? 1920;
        const h = args.height ?? 1080;
        const name = args.name ?? "Bars and Tone";
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          var timebase = ${args.timebase ? `"${escapeForExtendScript(args.timebase)}"` : `seq ? seq.timebase : "254016000000"`};
          app.project.newBarsAndTone(${w}, ${h}, timebase, "${escapeForExtendScript(name)}");
          return __result({ created: true, name: "${escapeForExtendScript(name)}", width: ${w}, height: ${h} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    import_fcp_xml: {
      description: "Import a Final Cut Pro XML file into the current project",
      parameters: {
        type: "object" as const,
        properties: {
          path: {
            type: "string",
            description: "Full path to the FCP XML file",
          },
        },
        required: ["path"],
      },
      handler: async (args: { path: string }) => {
        const script = buildToolScript(`
          app.openFCPXML("${escapeForExtendScript(args.path)}");
          return __result({ imported: true, path: "${escapeForExtendScript(args.path)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_transcode_on_ingest: {
      description: "Enable or disable transcoding on ingest for the project",
      parameters: {
        type: "object" as const,
        properties: {
          enabled: {
            type: "boolean",
            description: "True to enable transcode on ingest, false to disable",
          },
        },
        required: ["enabled"],
      },
      handler: async (args: { enabled: boolean }) => {
        const script = buildToolScript(`
          app.project.setEnableTranscodeOnIngest(${args.enabled ? 1 : 0});
          return __result({ set: true, transcodeOnIngest: ${args.enabled} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_insertion_bin: {
      description: "Get the current target bin for new imports (the bin that is currently focused in the Project panel)",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var bin = app.project.getInsertionBin();
          if (!bin) return __error("No insertion bin found");
          return __result({ name: bin.name, nodeId: bin.nodeId, treePath: bin.treePath });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_project_panel_metadata: {
      description: "Get the current project panel metadata/column configuration as XML",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var meta = app.project.getProjectPanelMetadata();
          if (!meta) return __error("Could not retrieve project panel metadata");
          return __result({ metadata: meta });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_project_panel_metadata: {
      description: "Set the project panel metadata/column configuration from XML",
      parameters: {
        type: "object" as const,
        properties: {
          metadata_xml: {
            type: "string",
            description: "XML string containing the project panel metadata configuration",
          },
        },
        required: ["metadata_xml"],
      },
      handler: async (args: { metadata_xml: string }) => {
        const script = buildToolScript(`
          app.project.setProjectPanelMetadata("${escapeForExtendScript(args.metadata_xml)}");
          return __result({ set: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_graphics_white_luminance: {
      description: "Get the graphics white luminance value (HDR setting) for the project",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var val = app.project.getGraphicsWhiteLuminance();
          return __result({ graphicsWhiteLuminance: val });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_graphics_white_luminance: {
      description: "Set the graphics white luminance value (HDR setting) for the project",
      parameters: {
        type: "object" as const,
        properties: {
          luminance: {
            type: "number",
            description: "White luminance value in nits",
          },
        },
        required: ["luminance"],
      },
      handler: async (args: { luminance: number }) => {
        const script = buildToolScript(`
          app.project.setGraphicsWhiteLuminance(${args.luminance});
          return __result({ set: true, graphicsWhiteLuminance: ${args.luminance} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_scratch_disk_path: {
      description: "Set the scratch disk path for a specific media type",
      parameters: {
        type: "object" as const,
        properties: {
          scratch_disk_type: {
            type: "string",
            description: "Type: 'capturedVideo', 'capturedAudio', 'videoPreview', 'audioPreview', 'autoSave', 'ccLibraries'",
          },
          path: {
            type: "string",
            description: "Full directory path for the scratch disk",
          },
        },
        required: ["scratch_disk_type", "path"],
      },
      handler: async (args: { scratch_disk_type: string; path: string }) => {
        const script = buildToolScript(`
          app.setScratchDiskPath("${escapeForExtendScript(args.path)}", "${escapeForExtendScript(args.scratch_disk_type)}");
          return __result({ set: true, type: "${escapeForExtendScript(args.scratch_disk_type)}", path: "${escapeForExtendScript(args.path)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
