import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getMediaTools(bridgeOptions: BridgeOptions) {
  return {
    import_media: {
      description: "Import media files into the project",
      parameters: {
        type: "object" as const,
        properties: {
          file_paths: {
            type: "array",
            items: { type: "string" },
            description: "Array of file paths to import",
          },
          target_bin: {
            type: "string",
            description: "Optional bin name or node ID to import into. Imports to root if omitted.",
          },
          suppress_ui: {
            type: "boolean",
            description: "Suppress import dialogs (default: true)",
          },
        },
        required: ["file_paths"],
      },
      handler: async (args: { file_paths: string[]; target_bin?: string; suppress_ui?: boolean }) => {
        const paths = args.file_paths.map((p) => `"${escapeForExtendScript(p)}"`).join(", ");
        const suppress = args.suppress_ui !== false ? "true" : "false";
        const binLookup = args.target_bin
          ? `var targetBin = __findProjectItem("${escapeForExtendScript(args.target_bin)}");
             if (!targetBin) return __error("Bin not found: ${escapeForExtendScript(args.target_bin)}");`
          : `var targetBin = app.project.rootItem;`;

        const script = buildToolScript(`
          ${binLookup}
          var filePaths = [${paths}];
          var importSuccess = app.project.importFiles(filePaths, ${suppress}, targetBin, false);
          if (!importSuccess) return __error("Import failed");
          return __result({ imported: filePaths.length, files: filePaths });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    import_folder: {
      description: "Import an entire folder of media into the project",
      parameters: {
        type: "object" as const,
        properties: {
          folder_path: {
            type: "string",
            description: "Path to the folder to import",
          },
        },
        required: ["folder_path"],
      },
      handler: async (args: { folder_path: string }) => {
        const script = buildToolScript(`
          var folder = new Folder("${escapeForExtendScript(args.folder_path)}");
          if (!folder.exists) return __error("Folder not found: ${escapeForExtendScript(args.folder_path)}");
          
          var files = folder.getFiles();
          var filePaths = [];
          for (var i = 0; i < files.length; i++) {
            if (files[i] instanceof File) {
              filePaths.push(files[i].fsName);
            }
          }
          
          if (filePaths.length === 0) return __error("No files found in folder");
          
          var importSuccess = app.project.importFiles(filePaths, true, app.project.rootItem, false);
          if (!importSuccess) return __error("Import failed");
          return __result({ imported: filePaths.length, folder: "${escapeForExtendScript(args.folder_path)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    create_bin: {
      description:
        "Create a new bin (folder) in the project panel, optionally nested inside an existing bin. Reads the project back: verified is true only when the new bin is a direct child of the requested parent; otherwise the result reports outcome committed_unverified.",
      parameters: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Name of the new bin",
          },
          parent_bin_id: {
            type: "string",
            description: "Optional node ID of the existing parent bin (searched recursively through nested bins). Creates in the project root if both parent_bin_id and parent_bin are omitted.",
          },
          parent_bin: {
            type: "string",
            description: "Optional parent bin node ID, slash-separated bin path, or exact bin name. Alias of parent_bin_id that also accepts a path or name.",
          },
        },
        required: ["name"],
      },
      handler: async (args: { name: string; parent_bin?: string; parent_bin_id?: string }) => {
        if (typeof args.name !== "string" || !args.name.trim()) {
          return { success: false, error: "name must be a non-empty bin name" };
        }
        const parentId = typeof args.parent_bin_id === "string" && args.parent_bin_id.trim() ? args.parent_bin_id : undefined;
        const parentRef = typeof args.parent_bin === "string" && args.parent_bin.trim() ? args.parent_bin : undefined;
        if (parentId && parentRef && parentId !== parentRef) {
          return { success: false, error: "parent_bin_id and parent_bin name different parents; pass only one." };
        }
        const name = escapeForExtendScript(args.name);
        let parentLookup = `var parent = app.project.rootItem; var parentIsRoot = true;`;
        if (parentId) {
          const id = escapeForExtendScript(parentId);
          parentLookup = `
          var parentIsRoot = false;
          var parent = __findProjectItemByNodeId("${id}");
          if (!parent) return __error("Parent bin not found: no project item has node ID ${id}. Use list_project_items or get_bin_contents to find the bin node ID.");
          if (!__isBinItem(parent)) return __error("Parent ${id} is not a bin; pass the node ID of a bin.");`;
        } else if (parentRef) {
          const ref = escapeForExtendScript(parentRef);
          parentLookup = `
          var parentIsRoot = false;
          var parent = __findBin("${ref}");
          if (!parent) {
            if (__findProjectItemByNodeId("${ref}")) return __error("Parent ${ref} is not a bin; pass the node ID, path, or name of a bin.");
            return __error("Parent bin not found: ${ref}. Pass a bin node ID, slash-separated bin path, or exact bin name.");
          }`;
        }

        const script = buildToolScript(`
          if (!app.project || !app.project.rootItem) return __error("No project is open");
          ${parentLookup}
          var parentNodeId = parentIsRoot ? __nodeIdOf(app.project.rootItem) : __nodeIdOf(parent);
          var parentPath = null;
          try { parentPath = parent.treePath; } catch (eParentPath) {}
          var requestedName = "${name}";

          // Snapshot the parent's and the root's direct children so a created
          // bin can be found even when createBin returns no usable item.
          var searchBins = parentIsRoot ? [parent] : [parent, app.project.rootItem];
          var before = {};
          for (var s = 0; s < searchBins.length; s++) {
            var beforeCount = __childCount(searchBins[s]);
            for (var b = 0; b < beforeCount; b++) {
              var existing = __childAt(searchBins[s], b);
              if (existing) before[__nodeIdOf(existing)] = true;
            }
          }

          var newBin = parent.createBin(requestedName);
          var newBinId = newBin ? __nodeIdOf(newBin) : "";

          // Readback: locate the created bin in the live project tree.
          var created = null;
          if (newBinId) created = __findProjectItemByNodeId(newBinId);
          for (var s2 = 0; !created && s2 < searchBins.length; s2++) {
            var afterCount = __childCount(searchBins[s2]);
            for (var a = 0; a < afterCount; a++) {
              var candidate = __childAt(searchBins[s2], a);
              if (candidate && !before[__nodeIdOf(candidate)] && __isBinItem(candidate) && candidate.name === requestedName) {
                created = candidate;
                break;
              }
            }
          }
          if (!created) return __error("Premiere did not create bin " + requestedName + " under the requested parent; nothing is reported as created.");

          var createdId = __nodeIdOf(created);
          var inParent = __isDirectChild(parent, created);
          if (!inParent && !parentIsRoot) {
            // Premiere placed the bin elsewhere (e.g. the project root). Move it
            // into the requested parent, then read back again.
            try { created.moveBin(parent); } catch (eMove) {}
            var relocated = __findProjectItemByNodeId(createdId);
            if (relocated) created = relocated;
            inParent = __isDirectChild(parent, created);
          }
          var treePath = null;
          try { treePath = created.treePath; } catch (eTreePath) {}
          var createdName = requestedName;
          try { createdName = created.name; } catch (eName) {}

          if (!inParent) {
            return __result({
              created: true,
              verified: false,
              outcome: "committed_unverified",
              name: createdName,
              nodeId: createdId,
              treePath: treePath,
              requestedParentNodeId: parentNodeId,
              requestedParentPath: parentPath,
              warning: "Premiere created the bin, but readback did not find it inside the requested parent bin. Check treePath before using it."
            });
          }
          return __result({
            created: true,
            verified: true,
            outcome: "verified",
            name: createdName,
            nodeId: createdId,
            treePath: treePath,
            parentNodeId: parentNodeId,
            parentPath: parentPath,
            parentIsRoot: parentIsRoot
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    move_item_to_bin: {
      description: "Move a project item to a different bin",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the item to move",
          },
          target_bin: {
            type: "string",
            description: "Name or node ID of the target bin",
          },
        },
        required: ["item_id", "target_bin"],
      },
      handler: async (args: { item_id: string; target_bin: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found: ${escapeForExtendScript(args.item_id)}");
          
          var targetBin = __findProjectItem("${escapeForExtendScript(args.target_bin)}");
          if (!targetBin) return __error("Target bin not found: ${escapeForExtendScript(args.target_bin)}");
          
          item.moveBin(targetBin);
          return __result({ moved: true, item: item.name, toBin: targetBin.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    relink_media: {
      description: "Relink an offline media item to a new file path",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the item to relink",
          },
          new_path: {
            type: "string",
            description: "New file path for the media",
          },
        },
        required: ["item_id", "new_path"],
      },
      handler: async (args: { item_id: string; new_path: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found: ${escapeForExtendScript(args.item_id)}");
          
          var success = item.changeMediaPath("${escapeForExtendScript(args.new_path)}", true);
          return __result({ relinked: success, item: item.name, newPath: "${escapeForExtendScript(args.new_path)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    refresh_media: {
      description: "Refresh a project item to pick up changes to the source file",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the item to refresh",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found: ${escapeForExtendScript(args.item_id)}");
          item.refreshMedia();
          return __result({ refreshed: true, item: item.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    check_offline_media: {
      description: "Check for offline (missing) media in the project",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var offlineItems = [];
          
          function checkItem(item) {
            if (item.type === 1) {
              try {
                if (item.isOffline && item.isOffline()) {
                  offlineItems.push({
                    nodeId: item.nodeId,
                    name: item.name,
                    mediaPath: item.getMediaPath ? item.getMediaPath() : ""
                  });
                }
              } catch(e) {}
            }
            if (item.type === 2 && item.children) {
              for (var i = 0; i < item.children.numItems; i++) {
                checkItem(item.children[i]);
              }
            }
          }
          
          var root = app.project.rootItem;
          for (var i = 0; i < root.children.numItems; i++) {
            checkItem(root.children[i]);
          }
          
          return __result({ offlineCount: offlineItems.length, items: offlineItems });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
    set_offline: {
      description: "Set a project item offline, or ask Premiere to refresh it back online when offline is false.",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          offline: {
            type: "boolean",
            description: "true to take media offline (default); false to refresh an existing offline item",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string; offline?: boolean }) => {
        const offline = args.offline !== false;
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found: ${escapeForExtendScript(args.item_id)}");
          ${offline
            ? `item.setOffline();`
            : `item.refreshMedia();`
          }
          var observedOffline = !!item.isOffline();
          if (observedOffline !== ${offline}) {
            return __error(${offline
              ? `"Premiere did not take the project item offline."`
              : `"Premiere could not refresh this item online. Use relink_media with the known media path if the source has moved."`
            });
          }
          return __result({ offline: observedOffline, item: item.name, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    has_proxy: {
      description: "Check if a project item has a proxy attached",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");
          
          var info = { item: item.name };
          try { info.hasProxy = item.hasProxy(); } catch(e) { info.hasProxy = false; }
          try { info.canProxy = item.canProxy(); } catch(e) { info.canProxy = false; }
          try { info.proxyPath = item.getProxyPath(); } catch(e) {}
          
          return __result(info);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    detach_proxy: {
      description: "Detach/remove the proxy from a project item",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");
          item.detachProxy();
          return __result({ detached: true, item: item.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_override_frame_rate: {
      description: "Override the frame rate of a project item (useful for image sequences or misinterpreted media)",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          frame_rate: {
            type: "number",
            description: "Frame rate to set (e.g., 23.976, 24, 29.97, 30, 60)",
          },
        },
        required: ["item_id", "frame_rate"],
      },
      handler: async (args: { item_id: string; frame_rate: number }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");
          item.setOverrideFrameRate(${args.frame_rate});
          return __result({ set: true, item: item.name, frameRate: ${args.frame_rate} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_override_pixel_aspect_ratio: {
      description: "Override the pixel aspect ratio of a project item",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          numerator: {
            type: "number",
            description: "PAR numerator (e.g., 1 for square pixels)",
          },
          denominator: {
            type: "number",
            description: "PAR denominator (e.g., 1 for square pixels)",
          },
        },
        required: ["item_id", "numerator", "denominator"],
      },
      handler: async (args: { item_id: string; numerator: number; denominator: number }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");
          item.setOverridePixelAspectRatio(${args.numerator}, ${args.denominator});
          return __result({ set: true, item: item.name, par: "${args.numerator}:${args.denominator}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_scale_to_frame_size: {
      description: "Enable 'Scale to Frame Size' on a project item so it fills the sequence frame",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");
          item.setScaleToFrameSize();
          return __result({ set: true, item: item.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_item_info: {
      description: "Get detailed type info about a project item (is it a sequence, multicam, merged clip, etc.)",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");
          
          var info = {
            name: item.name,
            nodeId: item.nodeId,
            type: item.type === 1 ? "clip" : item.type === 2 ? "bin" : item.type === 3 ? "sequence" : "unknown",
            treePath: item.treePath
          };
          try { info.isSequence = item.isSequence(); } catch(e) {}
          try { info.isMulticamClip = item.isMulticamClip(); } catch(e) {}
          try { info.isMergedClip = item.isMergedClip(); } catch(e) {}
          try { info.isOffline = item.isOffline(); } catch(e) {}
          try { info.mediaPath = item.getMediaPath(); } catch(e) {}
          try { info.hasProxy = item.hasProxy(); } catch(e) {}
          try { info.canProxy = item.canProxy(); } catch(e) {}
          
          return __result(info);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    select_item: {
      description: "Select a project item in the Project panel",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item to select",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");
          item.select();
          return __result({ selected: true, item: item.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_start_time: {
      description: "Set the start time (timecode offset) for a project item",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          start_seconds: {
            type: "number",
            description: "Start time in seconds",
          },
        },
        required: ["item_id", "start_seconds"],
      },
      handler: async (args: { item_id: string; start_seconds: number }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");
          
          var ticks = __secondsToTicks(${args.start_seconds}).toString();
          item.setStartTime(ticks);
          return __result({ set: true, item: item.name, startSeconds: ${args.start_seconds} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
