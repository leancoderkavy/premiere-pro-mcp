import { dirname } from "node:path";
import {
  buildToolScript,
  escapeForExtendScript,
} from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import { applyScratchDisks } from "./scratch-disks.js";

const PROJECT_PANEL_METADATA_MIN_CHARS = 256;
const PROJECT_PANEL_METADATA_MAX_CHARS = 200000;
const PROJECT_PANEL_METADATA_DEFAULT_CHARS = 20000;

export function getProjectTools(bridgeOptions: BridgeOptions) {
  return {
    save_project: {
      description:
        "Save the current Premiere Pro project to its existing path. Fails when the project has never been saved (use save_project_as) or when Premiere writes no non-empty file. Fresh disk metadata verifies a save; unchanged or unreadable metadata reports committed_unverified.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var project = app.project;
          if (!project) return __error("No project is open");
          var projectPath = String(project.path || "");
          if (!projectPath) {
            return __error("This project has no saved path; use save_project_as. Premiere was not asked to save.");
          }
          var outputFile = new File(projectPath);
          if (!outputFile.parent || !outputFile.parent.exists) {
            return __error("The project directory does not exist: " + outputFile.parent + "; Premiere was not asked to save.");
          }
          function saveFileEvidence(file) {
            try {
              var exists = !!file.exists;
              var length = file.length;
              var stamp = null;
              try {
                var modified = file.modified;
                var value = modified && typeof modified.valueOf === "function" ? modified.valueOf() : null;
                if (typeof value === "number" && isFinite(value)) stamp = value;
              } catch (eModified) {}
              return { exists: exists, length: typeof length === "number" && isFinite(length) ? length : null, modified: stamp };
            } catch (eEvidence) { return null; }
          }
          var beforeSave = saveFileEvidence(outputFile);
          var saveError = null;
          try { project.save(); } catch (eSave) { saveError = String(eSave); }
          outputFile = new File(projectPath);
          var afterSave = saveFileEvidence(outputFile);
          if (saveError && (!afterSave || afterSave.length === null)) return __error("Premiere save threw: " + saveError + "; disk evidence is unreadable. Inspect before retrying.", { mutationAttempted: true, mutationOutcome: "unknown", timelineChanged: null, verified: false });
          if (!afterSave || afterSave.length === null) return __result({ saved: null, saveRequested: true, verified: false, outcome: "committed_unverified", name: project.name, path: projectPath, warning: "Save was requested, but disk evidence is unreadable; inspect the project before retrying." });
          if (!afterSave.exists || !(afterSave.length > 0)) {
            return __error("Premiere did not write a non-empty project file at " + projectPath + "; inspect the project before retrying.", { mutationAttempted: true, mutationOutcome: "unknown", timelineChanged: null, verified: false });
          }
          var fresh = beforeSave && (!beforeSave.exists || (beforeSave.length !== null && afterSave.length !== beforeSave.length) || (beforeSave.modified !== null && afterSave.modified !== null && afterSave.modified > beforeSave.modified));
          if (saveError && !fresh) return __error("Premiere save threw: " + saveError + "; disk evidence cannot confirm a fresh write. Inspect before retrying.", { mutationAttempted: true, mutationOutcome: "unknown", timelineChanged: null, verified: false });
          return __result({ saved: fresh ? true : null, saveRequested: true, verified: !!fresh, outcome: fresh ? "verified" : "committed_unverified", name: project.name, path: projectPath, warning: fresh ? (saveError ? "Premiere save threw after a fresh disk write was observed: " + saveError : null) : "Save was requested, but the existing file does not prove a fresh write; inspect the project before retrying." });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    save_project_as: {
      description:
        "Save the current project to a new .prproj path. Premiere then has the NEW copy open and closes the original, so later edits go to the copy; the result reports both paths. Fails when Premiere writes no file or leaves a pre-existing path unchanged. Use open_project to return to the original.",
      parameters: {
        type: "object" as const,
        properties: {
          path: {
            type: "string",
            description:
              "Full file path to save the project to (e.g., '/Users/me/projects/MyProject.prproj')",
          },
        },
        required: ["path"],
      },
      handler: async (args: { path: string }) => {
        if (typeof args.path !== "string" || !/\.prproj$/i.test(args.path.trim())) {
          return { success: false, error: "path must be a .prproj file path" };
        }
        const target = escapeForExtendScript(args.path.trim());
        const script = buildToolScript(`
          var project = app.project;
          if (!project) return __error("No project is open");
          var previousPath = String(project.path || "");
          if (__normProjectPath(previousPath) === __normProjectPath("${target}")) {
            return __error("That is the current project's own path; use save_project instead.");
          }
          var outputFile = new File("${target}");
          if (!outputFile.parent || !outputFile.parent.exists) {
            return __error("The Save As directory does not exist: " + outputFile.parent);
          }
          var existedBefore = !!outputFile.exists;
          var lengthBefore = existedBefore ? Number(outputFile.length) : -1;
          if (existedBefore && !isFinite(lengthBefore)) return __error("Cannot read the existing output size; Save As was not attempted.");
          function readModified(file) {
            try {
              var modified = file.modified;
              var stamp = modified && typeof modified.valueOf === "function" ? modified.valueOf() : null;
              return typeof stamp === "number" && isFinite(stamp) ? stamp : null;
            } catch (eModified) { return null; }
          }
          var modifiedBefore = existedBefore ? readModified(outputFile) : null;
          project.saveAs("${target}");
          if (!outputFile.exists || !(outputFile.length > 0)) return __error("Premiere did not write a non-empty project file at ${target}; inspect the active project before retrying.");
          var modifiedAfter = readModified(outputFile);
          if (existedBefore && Number(outputFile.length) === lengthBefore) {
            if (modifiedBefore === null || modifiedAfter === null) {
              return __error("Cannot verify a new project file at ${target}: the size is unchanged and a modification timestamp is unreadable. Inspect the active project before retrying.");
            }
            if (modifiedAfter === modifiedBefore) {
              return __error("Premiere did not write a new project file at ${target} (the existing output was unchanged).");
            }
          }
          var activePath = app.project ? String(app.project.path || "") : "";
          var switched = __normProjectPath(activePath) === __normProjectPath("${target}");
          return __result({
            saved: true,
            verified: true,
            path: "${target}",
            activeProjectPath: activePath,
            previousProjectPath: previousPath,
            previousProjectStillOpen: !!__findOpenProject(previousPath),
            note: switched
              ? "Premiere now has the new copy open and active; later edits change the copy. Reopen the original with open_project to keep working there."
              : "The copy was written; the active project is unchanged."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    open_project: {
      description:
        "Open a Premiere Pro project file and make it the active project, verifying it is open. Other open projects stay open.",
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
        const target = escapeForExtendScript(args.path);
        const script = buildToolScript(`
          if (!(new File("${target}")).exists) return __error("Project file not found: ${target}");
          var existing = __findOpenProject("${target}");
          var alreadyOpen = !!existing;
          var opened = null;
          // Switching projects: the undo index read at the start belongs to the old project.
          __undoStart = null;
          var activatedVia = "openDocument";
          if (existing && __normProjectPath(app.project ? app.project.path : "") !== __normProjectPath("${target}")) {
            // openDocument returns false for a project that is already open and leaves
            // it in the background (live 25.2). Opening one of its sequences brings the
            // project to the front; prefer the sequence it already had active.
            var focusSequence = null;
            try { focusSequence = existing.activeSequence; } catch (eActive) {}
            if (!focusSequence && existing.sequences && existing.sequences.numSequences > 0) focusSequence = existing.sequences[0];
            if (!focusSequence) return __error("${target} is already open in the background and has no sequence to bring it to the front with; switch to it in Premiere.");
            opened = existing.openSequence(focusSequence.sequenceID);
            activatedVia = "openSequence:" + focusSequence.name;
            if (__normProjectPath(app.project ? app.project.path : "") !== __normProjectPath("${target}")) {
              // Opening the timeline that already has focus is a no-op (a new empty
              // project keeps the previous project's timeline focused), so open
              // another of its sequences first, then return to the intended one.
              for (var si = 0; si < existing.sequences.numSequences; si++) {
                var otherSeq = existing.sequences[si];
                if (String(otherSeq.sequenceID) !== String(focusSequence.sequenceID)) {
                  existing.openSequence(otherSeq.sequenceID);
                  opened = existing.openSequence(focusSequence.sequenceID);
                  activatedVia = "openSequence:" + otherSeq.name + ">" + focusSequence.name;
                  break;
                }
              }
            }
          } else if (!existing) {
            opened = app.openDocument("${target}");
          }
          var project = app.project;
          if (!project || __normProjectPath(project.path) !== __normProjectPath("${target}")) {
            return __error("Premiere did not open " + "${target}" + " as the active project" + (opened === false ? " (openDocument returned false)" : "") + "; the active project is " + (project ? project.path : "none") + ".");
          }
          var activeSeq = null;
          try { activeSeq = project.activeSequence ? project.activeSequence.name : null; } catch (eSeq) {}
          return __result({ opened: true, verified: true, alreadyOpen: alreadyOpen, activatedVia: activatedVia, name: project.name, path: project.path, activeSequence: activeSeq, openProjects: __openProjectPaths() });
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
          var active = __getCurrentActiveSequence();
          if (!active || String(active.sequenceID) !== String(seq.sequenceID)) {
            return __error("Premiere did not activate the requested sequence. Re-read the active sequence before making timeline edits.");
          }
          return __result({ active: true, verified: true, name: active.name, id: active.sequenceID });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    undo: {
      description:
        "EXPERIMENTAL (undocumented QE DOM: qe.project.undo / undoStackIndex). Undo the most recent Premiere project action(s) through QE, checked step by step against Premiere's undo-stack position (stackVerified; the timeline itself is not read back). Undo history is project-wide." +
        " Only actions Premiere records are undoable: QE edits such as razor, insert, lift and extract report undoSteps (and undoStackIndex) in their results; pass that undoSteps as count to reverse exactly that call. A marker receipt with undoTracked:false recorded no undo step: calling Undo for it would reverse an earlier action. Only CEP tool results carry undoSteps; UXP tools and workflows that send several commands are not counted. Always pass expected_undo_stack_index to check the stack position, but matching position alone does not prove which action is on top. Observed marker boundaries refuse the entire request before any step unless acknowledge_untracked_markers:true explicitly permits prior non-marker actions. The barrier persists through server/helper reloads while the CEP engine remains alive; it cannot account for marker writes before observation, after an engine reset, or through UXP, the manual UI, or other clients. Matching the QE index verifies stack position only.",
      parameters: {
        type: "object" as const,
        properties: {
          count: {
            type: "number",
            description: "Number of times to undo (default: 1)",
          },
          acknowledge_untracked_markers: {
            type: "boolean",
            description: "Explicitly acknowledge that QE steps reverse or restore prior non-marker actions, because marker reversal is not verified. Default false; marker boundaries refuse the entire request before any step.",
          },
          expected_undo_stack_index: {
            type: "number",
            description:
              "Required safety guard: the undoStackIndex a tool result reported right after the call you want to reverse. The step is refused, with nothing changed, when Premiere's undo-stack position differs from it. The guard compares the position only; matching position cannot prove which action is on top.",
          },
        },
        required: ["expected_undo_stack_index"],
      },
      handler: async (args: { count?: number; expected_undo_stack_index?: number; acknowledge_untracked_markers?: boolean }) => {
        const count = args.count ?? 1;
        if (!Number.isInteger(count) || count < 1 || count > 100) {
          return { success: false, error: "count must be an integer from 1 through 100" };
        }
        const guardArg = args.expected_undo_stack_index;
        if (!Number.isInteger(guardArg) || guardArg! < 0) {
          return { success: false, error: "expected_undo_stack_index is required and must be a non-negative integer; undo was not attempted" };
        }
        const guard = String(guardArg);
        const script = buildToolScript(`
          __undoStart = null;
          var expectedIndex = ${guard};
          if (expectedIndex !== null) {
            var currentIndex = __readUndoIndex();
            if (currentIndex === null || typeof currentIndex === "undefined" || isNaN(Number(currentIndex))) {
              return __jsonStringify({ success: false, error: "Premiere did not expose undoStackIndex; undo was not attempted", data: { expectedUndoStackIndex: expectedIndex } });
            }
            if (currentIndex !== expectedIndex) {
              return __jsonStringify({ success: false, error: "Premiere's undo stack is at " + currentIndex + ", not the expected " + expectedIndex + ": the undo-stack position changed since that call (actions were undone or recorded), so undo was not attempted.", data: { undoStackIndex: currentIndex, expectedUndoStackIndex: expectedIndex } });
            }
          }
          var outcome = __qeUndoSteps("undo", ${count}, ${args.acknowledge_untracked_markers === true ? "true" : "false"});
          return __undoStepsResult(outcome, "undone");
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    consolidate_duplicates: {
      description:
        "Consolidate duplicate project items and report success only when duplicate media groups decrease.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          function __duplicateMediaStats() {
            var pathMap = {};
            function scan(bin) {
              for (var i = 0; i < bin.children.numItems; i++) {
                var item = bin.children[i];
                try {
                  var mediaPath = item.getMediaPath();
                  var nodeId = String(item.nodeId || "");
                  if (mediaPath && nodeId) {
                    if (!pathMap[mediaPath]) pathMap[mediaPath] = { nodeIds: {}, count: 0 };
                    if (!pathMap[mediaPath].nodeIds[nodeId]) {
                      pathMap[mediaPath].nodeIds[nodeId] = true;
                      pathMap[mediaPath].count++;
                    }
                  }
                } catch (e) {}
                if (item.type === 2) scan(item);
              }
            }
            scan(app.project.rootItem);

            var duplicateGroupCount = 0;
            var duplicateItemCount = 0;
            for (var path in pathMap) {
              if (pathMap.hasOwnProperty(path) && pathMap[path].count > 1) {
                duplicateGroupCount++;
                duplicateItemCount += pathMap[path].count - 1;
              }
            }
            return {
              duplicateGroupCount: duplicateGroupCount,
              duplicateItemCount: duplicateItemCount
            };
          }

          var before = __duplicateMediaStats();
          if (before.duplicateGroupCount === 0) {
            return __result({
              consolidated: false,
              changed: false,
              reason: "No duplicate media groups were found before consolidation.",
              before: before,
              after: before
            });
          }
          if (typeof app.project.consolidateDuplicates !== "function") {
            return __error("This Premiere build does not expose project.consolidateDuplicates; no duplicate items were changed.");
          }

          try {
            app.project.consolidateDuplicates();
          } catch (e) {
            return __error("Premiere could not consolidate duplicate project items: " + e.toString());
          }

          var after = __duplicateMediaStats();
          if (after.duplicateGroupCount >= before.duplicateGroupCount && after.duplicateItemCount >= before.duplicateItemCount) {
            return __error("Premiere completed consolidateDuplicates but duplicate media groups did not decrease. No consolidation success is reported; inspect the project and use get_duplicate_media to review the unchanged groups.");
          }
          return __result({ consolidated: true, changed: true, verified: true, before: before, after: after });
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
        const requestedPath = args.path.trim();
        if (!/\.prproj$/i.test(requestedPath)) {
          return {
            success: false,
            error:
              "create_project path must be a full .prproj file path; Premiere cannot create a project from a directory path.",
          };
        }
        const script = buildToolScript(`
          var requestedPath = "${escapeForExtendScript(requestedPath)}";
          function __normalizedProjectPath(path) {
            return String(path || "").replace(/\\\\/g, "/").toLowerCase();
          }
          var beforePath = app.project ? String(app.project.path || "") : "";
          if (__normalizedProjectPath(beforePath) === __normalizedProjectPath(requestedPath)) {
            return __error("A project is already open at " + requestedPath + "; choose a new .prproj file path instead.");
          }
          // A new project has its own undo stack; do not report a count across it.
          __undoStart = null;
          app.newProject(requestedPath);
          var project = app.project;
          var actualPath = project ? String(project.path || "") : "";
          if (!project || !actualPath || __normalizedProjectPath(actualPath) !== __normalizedProjectPath(requestedPath)) {
            return __error(
              "Premiere did not create a project at " + requestedPath +
              "; the active project is still " + (actualPath || beforePath || "unavailable") +
              ". Check that the path is a new .prproj file and its parent directory exists."
            );
          }
          var active = __getCurrentActiveSequence();
          if (project.sequences.numSequences === 0 && active) {
            return __error(
              "Premiere retained an active sequence from the prior project after creating an empty project. " +
              "No timeline operation is reported as ready; reopen the project or create and activate a sequence before editing."
            );
          }
          return __result({ created: true, name: project.name, path: actualPath, activeSequence: active ? { name: active.name, id: active.sequenceID } : null });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    close_project: {
      description:
        "Close an open Premiere Pro project: the active one, or the open project at project_path. Verifies it is no longer open and reports which project is active afterwards.",
      parameters: {
        type: "object" as const,
        properties: {
          save_first: {
            type: "boolean",
            description: "Whether to save before closing (default: true)",
          },
          project_path: {
            type: "string",
            description: "Path of the open project to close (default: the active project)",
          },
        },
      },
      handler: async (args: { save_first?: boolean; project_path?: string }) => {
        const save = args.save_first !== false;
        const lookup = args.project_path
          ? `var project = __findOpenProject("${escapeForExtendScript(args.project_path)}"); if (!project) return __error("No open project at ${escapeForExtendScript(args.project_path)}; open projects: " + __openProjectPaths().join(", "));`
          : `var project = app.project; if (!project) return __error("No project is open");`;
        const script = buildToolScript(`
          ${lookup}
          var name = project.name;
          var path = String(project.path || "");
          // Closing leaves a different (or no) project active; no undo count applies.
          __undoStart = null;
          var closed = project.closeDocument(${save ? "1" : "0"}, 0);
          if (__findOpenProject(path)) {
            return __error("Premiere did not close " + path + (closed === false ? " (closeDocument returned false)" : "") + ".");
          }
          return __result({
            closed: true,
            verified: true,
            name: name,
            path: path,
            saved: ${save},
            activeProjectPath: app.project ? String(app.project.path || "") : null,
            openProjects: __openProjectPaths()
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    import_ae_comps: {
      description:
        "Import After Effects compositions from an .aep file, failing closed when the file does not exist or when the target bin gains no items.",
      parameters: {
        type: "object" as const,
        properties: {
          ae_project_path: {
            type: "string",
            description: "Full path to the .aep file",
          },
          comp_names: {
            type: "array",
            items: { type: "string" },
            description:
              "Array of composition names to import. If omitted, imports all comps.",
          },
          target_bin: {
            type: "string",
            description: "Target bin name or node ID (optional)",
          },
        },
        required: ["ae_project_path"],
      },
      handler: async (args: {
        ae_project_path: string;
        comp_names?: string[];
        target_bin?: string;
      }) => {
        if (typeof args.ae_project_path !== "string" || !args.ae_project_path.trim()) {
          return { success: false, error: "ae_project_path must be a non-empty path to an After Effects .aep file" };
        }
        const aePath = escapeForExtendScript(args.ae_project_path);
        const binLookup = args.target_bin
          ? `var targetBin = __findProjectItem("${escapeForExtendScript(args.target_bin)}"); if (!targetBin) return __error("Bin not found");`
          : `var targetBin = app.project.rootItem;`;
        // The After Effects import calls report nothing observable, so the file must
        // exist before the call and the target bin must actually gain items after it.
        const preflight = `
            ${binLookup}
            var aeFile = new File("${aePath}");
            if (!aeFile.exists) {
              return __error("After Effects project not found on disk: ${aePath}. No compositions were imported.");
            }
            if (!targetBin.children) {
              return __error("The target bin does not expose a children collection, so an After Effects import cannot be verified.");
            }
            var beforeItems = targetBin.children.numItems;
        `;
        const verify = (importedDescription: string) => `
            var afterItems = targetBin.children.numItems;
            var addedItems = afterItems - beforeItems;
            if (addedItems <= 0) {
              return __error("Premiere reported no error, but the target bin gained no items, so ${importedDescription} were not imported from ${aePath}.");
            }
        `;

        if (args.comp_names && args.comp_names.length > 0) {
          const comps = args.comp_names
            .map((c) => `"${escapeForExtendScript(c)}"`)
            .join(", ");
          const script = buildToolScript(`
            ${preflight}
            try {
              app.project.importAEComps("${aePath}", [${comps}], targetBin);
            } catch (importError) {
              return __error("Premiere could not import the requested After Effects compositions: " + importError.toString());
            }
            ${verify("the requested compositions")}
            return __result({
              imported: true,
              verified: true,
              comps: [${comps}],
              addedItems: addedItems,
              binItemsBefore: beforeItems,
              binItemsAfter: afterItems,
              verification: "Target-bin item-count increase only; composition identity and rendered content are not verified."
            });
          `);
          return sendCommand(script, bridgeOptions);
        } else {
          const script = buildToolScript(`
            ${preflight}
            try {
              app.project.importAllAEComps("${aePath}", targetBin);
            } catch (importError) {
              return __error("Premiere could not import the After Effects compositions: " + importError.toString());
            }
            ${verify("any compositions")}
            return __result({
              imported: true,
              verified: true,
              allComps: true,
              addedItems: addedItems,
              binItemsBefore: beforeItems,
              binItemsAfter: afterItems,
              verification: "Target-bin item-count increase only; composition identity and rendered content are not verified."
            });
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
          var nodeId = String(bin.nodeId);
          var name = bin.name;
          bin.deleteBin();
          if (__findProjectItem(nodeId)) {
            return __error("Premiere did not remove bin: " + name + ". The deletion is not reported as successful.");
          }
          return __result({ deleted: true, verified: true, name: name, nodeId: nodeId });
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
          if (String(bin.name) !== "${escapeForExtendScript(args.new_name)}") return __error("Premiere kept the bin name " + bin.name + ".");
          return __result({ renamed: true, verified: true, oldName: oldName, newName: bin.name });
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
      description:
        "Find project items whose media path contains the given search string",
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
                type: __projectItemKind(matches[i])
              });
            }
          }
          return __result({ count: items.length, items: items });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    start_batch_encode: {
      description:
        "Request Adobe Media Encoder to start the render queue; reports only accepted handoff, not queue progress or output-file creation.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          if (!app.encoder || typeof app.encoder.startBatch !== "function") return __error("Adobe Media Encoder is not available");
          try {
            var startResult = app.encoder.startBatch();
            // Premiere reports an accepted batch-start request as 1/true.
            if (startResult !== 1 && startResult !== true) return __error("Adobe Media Encoder did not accept the start request.");
          } catch (e) {
            return __error("Adobe Media Encoder rejected the start request: " + e.message);
          }
          return __result({
            requested: true,
            verified: false,
            outcome: "committed_unverified",
            verificationScope: "Premiere accepted a start request; queue presence, progress, and output-file creation are not verified by this tool."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_custom_metadata_field: {
      description:
        "Add a custom metadata field to the project's metadata schema. This creates a schema/column definition only; it does not set a per-item value. Use set_metadata field_name/value or complete Project Metadata XML with readback to update a value.",
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
            description:
              "Type of the field: 0 = Integer, 1 = Real, 2 = String, 3 = Boolean",
          },
        },
        required: ["field_name", "field_label", "field_type"],
      },
      handler: async (args: {
        field_name: string;
        field_label: string;
        field_type: number;
      }) => {
        const script = buildToolScript(`
          var accepted = app.project.addPropertyToProjectMetadataSchema("${escapeForExtendScript(args.field_name)}", "${escapeForExtendScript(args.field_label)}", ${args.field_type});
          if (accepted === false) return __error("Premiere rejected the custom metadata schema field");
          return __result({
            added: true,
            name: "${escapeForExtendScript(args.field_name)}",
            label: "${escapeForExtendScript(args.field_label)}",
            outcome: "committed_unverified",
            verificationBoundary: "Premiere does not expose a schema-field enumeration readback through the legacy CEP API",
            perItemValue: "Use set_metadata with field_name/value or complete Project Metadata XML and updated_fields."
          });
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
            items: { type: "string" },
            description:
              "Non-empty array of sequence IDs to import from the source project.",
          },
        },
        required: ["project_path", "sequence_ids"],
      },
      handler: async (args: {
        project_path: string;
        sequence_ids: string[];
      }) => {
        if (!Array.isArray(args.sequence_ids) || args.sequence_ids.length === 0
          || args.sequence_ids.some((id) => typeof id !== "string" || !id.trim())) {
          return { success: false, error: "sequence_ids must be a non-empty array of source sequence IDs." };
        }
        const ids = args.sequence_ids
          .map((id) => `"${escapeForExtendScript(id)}"`)
          .join(", ");
        const script = buildToolScript(`
          var sourceProject = new File("${escapeForExtendScript(args.project_path)}");
          if (!sourceProject.exists) return __error("Source Premiere project does not exist: " + sourceProject.fsName);
          var beforeIds = {};
          for (var beforeIndex = 0; beforeIndex < app.project.sequences.numSequences; beforeIndex++) {
            beforeIds[String(app.project.sequences[beforeIndex].sequenceID)] = true;
          }
          app.project.importSequences(sourceProject.fsName, [${ids}]);
          var imported = [];
          for (var afterIndex = 0; afterIndex < app.project.sequences.numSequences; afterIndex++) {
            var candidate = app.project.sequences[afterIndex];
            if (!beforeIds[String(candidate.sequenceID)]) {
              imported.push({ id: String(candidate.sequenceID), name: candidate.name });
            }
          }
          if (!imported.length) {
            return __error("Premiere did not add any of the requested sequences from the source project.");
          }
          return __result({ imported: true, requestedSequenceIds: [${ids}], sequences: imported, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    create_bars_and_tone: {
      description:
        "Create a Bars and Tone synthetic media item in the project (useful for leader/calibration). Returns the created item's name, nodeId, and treePath, found by reading the project back.",
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
            description:
              "Timebase as ticks-per-second string (default uses sequence timebase)",
          },
          pixel_aspect_numerator: {
            type: "number",
            description: "Pixel aspect ratio numerator (default: 1)",
          },
          pixel_aspect_denominator: {
            type: "number",
            description: "Pixel aspect ratio denominator (default: 1)",
          },
          audio_sample_rate: {
            type: "number",
            description: "Audio sample rate in Hz (default: 48000)",
          },
          name: {
            type: "string",
            description:
              "Name for the bars and tone item (default: 'Bars and Tone')",
          },
          bin_id: {
            type: "string",
            description:
              "Optional destination bin: node ID, slash-separated bin path from the project root, or bin name. The bin is resolved before anything is created; the item is moved there and its location read back.",
          },
        },
      },
      handler: async (args: {
        bin_id?: string;
        width?: number;
        height?: number;
        timebase?: string;
        pixel_aspect_numerator?: number;
        pixel_aspect_denominator?: number;
        audio_sample_rate?: number;
        name?: string;
      }) => {
        const w = args.width ?? 1920;
        const h = args.height ?? 1080;
        const parNum = args.pixel_aspect_numerator ?? 1;
        const parDen = args.pixel_aspect_denominator ?? 1;
        const audioSampleRate = args.audio_sample_rate ?? 48000;
        const name = args.name ?? "Bars and Tone";
        if (![w, h, parNum, parDen, audioSampleRate].every(Number.isFinite)
          || ![w, h, parNum, parDen, audioSampleRate].every(Number.isInteger)
          || w < 1 || h < 1 || parNum < 1 || parDen < 1 || audioSampleRate < 1) {
          return { success: false, error: "Bars and tone dimensions, pixel-aspect values, and audio_sample_rate must be positive integers." };
        }
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          var timebase = parseFloat(${args.timebase ? `"${escapeForExtendScript(args.timebase)}"` : `seq ? seq.timebase : "254016000000"`});
          if (!isFinite(timebase) || timebase <= 0) return __error("A positive sequence timebase is required to create bars and tone.");
          var requestedName = "${escapeForExtendScript(name)}";
          var targetBin = null;
          ${args.bin_id !== undefined ? `targetBin = __findBin("${escapeForExtendScript(String(args.bin_id))}");
          if (!targetBin) return __error("Bin not found: ${escapeForExtendScript(String(args.bin_id))}. Nothing was created.");` : ""}
          // newBarsAndTone does not reliably return a ProjectItem with name and
          // nodeId (issue #588), so diff the project tree to find what it made.
          var beforeIds = __collectNodeIds(app.project.rootItem, {});
          var returned = app.project.newBarsAndTone(
            ${w},
            ${h},
            timebase,
            ${parNum},
            ${parDen},
            ${audioSampleRate},
            requestedName
          );
          var item = null;
          var returnedId = returned ? __nodeIdOf(returned) : "";
          if (returnedId) item = __findProjectItemByNodeId(returnedId);
          if (!item) item = __findNewProjectItem(beforeIds, requestedName);
          if (!item) {
            return __error(returned
              ? "Premiere reported Bars and Tone creation, but readback found no new project item."
              : "Premiere did not create the Bars and Tone project item.");
          }
          var itemName = requestedName;
          try { itemName = item.name; } catch (eName) {}
          var binPlacement = null;
          if (targetBin) {
            try { item.moveBin(targetBin); } catch (eMove) {}
            var inBin = false;
            try { inBin = String(item.treePath).indexOf(String(targetBin.treePath) + "\\\\") === 0; } catch (eInBin) {}
            binPlacement = { bin: targetBin.name, moved: inBin };
          }
          var treePath = null;
          try { treePath = item.treePath; } catch (eTreePath) {}
          var placedOk = !binPlacement || binPlacement.moved;
          return __result({
            created: true,
            verified: placedOk,
            outcome: placedOk ? "verified" : "committed_unverified",
            bin: binPlacement,
            note: placedOk ? null : "The item was created but could not be confirmed in the requested bin; move it with move_item_to_bin.",
            name: itemName,
            nodeId: __nodeIdOf(item),
            treePath: treePath,
            width: ${w},
            height: ${h},
            pixelAspectRatio: "${parNum}:${parDen}",
            audioSampleRate: ${audioSampleRate}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    import_fcp_xml: {
      description:
        "Open a Final Cut Pro XML file as a new Premiere project. app.openFCPXML(path, projPath) requires a destination project path; it does not merge the XML into the currently open project. verified is true only when that destination exists as a file and Premiere has that exact path open.",
      parameters: {
        type: "object" as const,
        properties: {
          path: {
            type: "string",
            description: "Full path to the FCP XML file to read",
          },
          project_path: {
            type: "string",
            description:
              "Full path of the new .prproj file Premiere should create for the imported timeline. Required: app.openFCPXML takes both a source and a destination path.",
          },
        },
        required: ["path", "project_path"],
      },
      handler: async (args: { path: string; project_path: string }) => {
        if (typeof args.path !== "string" || !args.path.trim()) {
          return { success: false, error: "path must be a non-empty path to an FCP XML file" };
        }
        if (typeof args.project_path !== "string" || !args.project_path.trim()) {
          return {
            success: false,
            error:
              "project_path must be a non-empty destination .prproj path. app.openFCPXML(path, projPath) needs both arguments; passing only path fails with \"Not Enough Parameters\".",
          };
        }
        const xmlPath = escapeForExtendScript(args.path);
        const projectPath = escapeForExtendScript(args.project_path);
        const projectFolder = escapeForExtendScript(dirname(args.project_path));
        const script = buildToolScript(`
          var xmlFile = new File("${xmlPath}");
          if (!xmlFile.exists) return __error("FCP XML file not found on disk: ${xmlPath}");
          var destinationFile = new File("${projectPath}");
          if (__isDirectory("${projectPath}")) {
            return __error("project_path exists as a directory, not a .prproj file: ${projectPath}. Choose a destination file path that does not already exist as a folder.");
          }
          if (destinationFile.exists) {
            return __error("A project already exists at ${projectPath}. Choose a destination project_path that does not exist so an existing project is not overwritten.");
          }

          if (typeof app.openFCPXML !== "function") {
            return __error("This Premiere build does not expose app.openFCPXML, so FCP XML cannot be imported.");
          }
          var before = __openProjectPaths();
          // Projects already in the folders Premiere may import into. Only a
          // project that did not exist before this call can be treated as the
          // intermediate copy and deleted.
          var preexistingProjects = {};
          // Where Premiere may write the intermediate project. Live 25.2.3 (macOS):
          // Folder.temp is ".../T/TemporaryItems" but Premiere wrote ".../T/lv.prproj"
          // (the process temp dir, spelled /var rather than /private/var).
          var importRootPaths = [Folder.temp.fsName, "${projectFolder}"];
          try { if (Folder.temp.parent) importRootPaths.push(Folder.temp.parent.fsName); } catch (eParent) {}
          try { var tmpDir = $.getenv("TMPDIR"); if (tmpDir) importRootPaths.push(tmpDir); } catch (eEnv) {}
          // /private/var and /var are the same directory on macOS.
          var normImportPath = function (path) { return __normProjectPath(path).replace(/^\\/private\\//, "/").replace(/\\/+$/, ""); };
          var projectSearchRoots = [];
          for (var ir = 0; ir < importRootPaths.length; ir++) projectSearchRoots.push(new Folder(importRootPaths[ir]));
          for (var pr = 0; pr < projectSearchRoots.length; pr++) {
            var found = [];
            // Every entry, not a "*.prproj" mask: the mask can miss "CUT.PRPROJ".
            try { if (projectSearchRoots[pr].exists) found = projectSearchRoots[pr].getFiles() || []; } catch (eList) {}
            for (var pf = 0; pf < found.length; pf++) preexistingProjects[normImportPath(found[pf].fsName)] = true;
          }
          try {
            // The second argument behaves as a folder prefix (live 25.2: "<project_path>cut.1.prproj"),
            // so hand Premiere the destination folder and save the result to project_path below.
            app.openFCPXML("${xmlPath}", "${projectFolder}/");
          } catch (importError) {
            return __error("Premiere could not open the FCP XML file: " + importError.toString());
          }

          // Live 25.2: Premiere imports into a new project in the system temp folder
          // named after the XML, and creates an empty FOLDER at project_path. Find the
          // newly opened project and save it to the requested path.
          var imported = null;
          var opened = __openProjects();
          for (var i = 0; i < opened.length; i++) {
            var known = false;
            for (var j = 0; j < before.length; j++) if (__normProjectPath(before[j]) === __normProjectPath(opened[i].path)) known = true;
            if (!known) { imported = opened[i]; break; }
          }
          if (!imported) return __error("Premiere returned without an error but opened no new project for ${xmlPath}; nothing was imported.");
          var importedAt = String(imported.path);
          var intermediateRemoved = false;
          var intermediateKeptAt = null;
          if (__normProjectPath(importedAt) !== __normProjectPath("${projectPath}")) {
            if (__isDirectory("${projectPath}") && Folder("${projectPath}").getFiles().length === 0) Folder("${projectPath}").remove();
            try { imported.saveAs("${projectPath}"); } catch (saveError) {}
            // saveAs swaps the open project; look it up again rather than trusting the old object.
            imported = __findOpenProject("${projectPath}") || imported;
            // Only delete Premiere's intermediate copy when it sits where this call
            // told Premiere to write (the system temp folder or the destination
            // folder) and did not exist before the call; anything else is left on
            // disk and reported.
            var intermediateNorm = normImportPath(importedAt);
            var ownedRoots = [];
            for (var orp = 0; orp < importRootPaths.length; orp++) ownedRoots.push(normImportPath(importRootPaths[orp]));
            var intermediateOwned = false;
            if (/\\.prproj$/.test(intermediateNorm) && intermediateNorm.indexOf("/../") < 0 && !preexistingProjects[intermediateNorm]) {
              for (var ri = 0; ri < ownedRoots.length; ri++) {
                var ownedPrefix = ownedRoots[ri] ? ownedRoots[ri] + "/" : "";
                // Direct children only: the snapshot above lists each folder's own files.
                if (ownedPrefix && intermediateNorm.indexOf(ownedPrefix) === 0 && intermediateNorm.substring(ownedPrefix.length).indexOf("/") < 0) intermediateOwned = true;
              }
            }
            if (!intermediateOwned) {
              intermediateKeptAt = importedAt;
            } else if (!__findOpenProject(importedAt)) {
              var intermediate = new File(importedAt);
              if (intermediate.exists) intermediateRemoved = intermediate.remove();
            }
          }
          var saved = new File("${projectPath}");
          var savedIsFile = saved.exists && !__isDirectory("${projectPath}");
          if (!savedIsFile || !__findOpenProject("${projectPath}")) {
            return __jsonStringify({ success: false,
              error: "Premiere imported the XML into " + importedAt + " but it could not be saved to ${projectPath}.",
              data: { importedProjectPath: importedAt, openProjects: __openProjectPaths() } });
          }
          var sequences = [];
          for (var s = 0; s < imported.sequences.numSequences && s < 50; s++) {
            var seq = imported.sequences[s];
            var clipCount = 0;
            for (var v = 0; v < seq.videoTracks.numTracks; v++) clipCount += seq.videoTracks[v].clips.numItems;
            for (var a = 0; a < seq.audioTracks.numTracks; a++) clipCount += seq.audioTracks[a].clips.numItems;
            sequences.push({ name: seq.name, id: seq.sequenceID, clipCount: clipCount });
          }
          return __result({
            imported: true,
            verified: true,
            path: "${xmlPath}",
            projectPath: String(imported.path),
            premiereImportPath: importedAt,
            intermediateRemoved: intermediateRemoved,
            intermediateKeptAt: intermediateKeptAt,
            sequences: sequences,
            activeProjectPath: app.project ? String(app.project.path) : null,
            openProjects: __openProjectPaths(),
            note: "The XML opened as its own project; switch between projects with open_project. Timeline, media links and effects are not compared with the source."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_transcode_on_ingest: {
      description: "Request enabling or disabling project transcoding on ingest. Premiere exposes no getter for independent verification, so dispatch is reported as requested_unverified.",
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
          if (!app.project || typeof app.project.setEnableTranscodeOnIngest !== "function") {
            return __error("This Premiere build does not expose setEnableTranscodeOnIngest; no change was attempted.");
          }
          var hostReturn;
          try { hostReturn = app.project.setEnableTranscodeOnIngest(${args.enabled ? 1 : 0}); }
          catch (ingestError) {
            return __error("Premiere threw while requesting transcode on ingest: " + ingestError.toString(), { outcome: "failed", mutationOutcome: "unknown", verified: false, mutationAttempted: true, requestedEnabled: ${args.enabled}, note: "The setter may have changed project state before throwing. Inspect Project Settings before retrying." });
          }
          return __result({ requestedEnabled: ${args.enabled}, requestSent: true, hostReturn: hostReturn, outcome: "requested_unverified", verified: false, verificationScope: "Premiere exposes no ingest-transcode getter; check Project Settings to confirm the requested state." });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_insertion_bin: {
      description:
        "Get the current target bin for new imports (the bin that is currently focused in the Project panel)",
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
      description:
        "Get the current Project-panel column layout as XML. This is schema/layout configuration, not per-item Scene/Shot/Take values; use inspect_project_panel_metadata_uxp item_columns or get_metadata for those. Output is capped by max_chars (default 20000); when truncated is true the XML is incomplete and must not be passed to set_project_panel_metadata.",
      parameters: {
        type: "object" as const,
        properties: {
          max_chars: {
            type: "integer",
            minimum: PROJECT_PANEL_METADATA_MIN_CHARS,
            maximum: PROJECT_PANEL_METADATA_MAX_CHARS,
            description: `Maximum characters of metadata XML to return (${PROJECT_PANEL_METADATA_MIN_CHARS}-${PROJECT_PANEL_METADATA_MAX_CHARS}, default ${PROJECT_PANEL_METADATA_DEFAULT_CHARS}). Longer XML is cut at this length and reported with truncated: true and totalChars.`,
          },
        },
      },
      handler: async (args: { max_chars?: number } = {}) => {
        const maxChars = args?.max_chars ?? PROJECT_PANEL_METADATA_DEFAULT_CHARS;
        if (
          typeof maxChars !== "number" ||
          !Number.isInteger(maxChars) ||
          maxChars < PROJECT_PANEL_METADATA_MIN_CHARS ||
          maxChars > PROJECT_PANEL_METADATA_MAX_CHARS
        ) {
          return {
            success: false,
            error: `max_chars must be an integer between ${PROJECT_PANEL_METADATA_MIN_CHARS} and ${PROJECT_PANEL_METADATA_MAX_CHARS}`,
          };
        }
        const script = buildToolScript(`
          var meta = app.project.getProjectPanelMetadata();
          if (!meta) return __error("Could not retrieve project panel metadata");
          var text = String(meta);
          var maxChars = ${maxChars};
          var totalChars = text.length;
          if (totalChars > maxChars) {
            return __result({
              metadata: text.substring(0, maxChars),
              truncated: true,
              totalChars: totalChars,
              returnedChars: maxChars,
              maxChars: maxChars,
              note: "Metadata XML was truncated and is not well-formed. Raise max_chars (up to ${PROJECT_PANEL_METADATA_MAX_CHARS}) to read more; do not pass truncated XML to set_project_panel_metadata."
            });
          }
          return __result({ metadata: text, truncated: false, totalChars: totalChars, returnedChars: totalChars, maxChars: maxChars });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_project_panel_metadata: {
      description:
        "Set the project panel metadata/column configuration from XML and verify that Premiere reads back the exact XML",
      parameters: {
        type: "object" as const,
        properties: {
          metadata_xml: {
            type: "string",
            description:
              "XML string containing the project panel metadata configuration",
          },
        },
        required: ["metadata_xml"],
      },
      handler: async (args: { metadata_xml: string }) => {
        const script = buildToolScript(`
          var requestedMetadata = "${escapeForExtendScript(args.metadata_xml)}";
          var accepted = app.project.setProjectPanelMetadata(requestedMetadata);
          if (accepted === false) return __error("Premiere rejected the Project panel metadata update");
          var readback = app.project.getProjectPanelMetadata();
          if (String(readback) !== requestedMetadata) {
            return __error(
              "Premiere did not return the requested Project panel metadata XML after the write. " +
              "The update is not reported as successful; inspect get_project_panel_metadata before retrying."
            );
          }
          return __result({ set: true, verified: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_graphics_white_luminance: {
      description:
        "Get the graphics white luminance value (HDR setting) for the project",
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
      description:
        "Set the graphics white luminance value (HDR setting) for the project",
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
          var observed = null;
          try { observed = app.project.getGraphicsWhiteLuminance(); } catch (eRead) {}
          if (observed !== ${args.luminance}) return __error("Premiere's graphics white luminance reads " + observed + " instead of ${args.luminance}.");
          return __result({ set: true, verified: true, graphicsWhiteLuminance: observed });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_scratch_disk_path: {
      description:
        "Set one project scratch disk (captured media, previews, auto-save, CC Libraries or Motion Graphics template media) to an existing folder or \"SameAsProject\", using Premiere's ScratchDiskType constants.",
      parameters: {
        type: "object" as const,
        properties: {
          scratch_disk_type: {
            type: "string",
            enum: ["capturedVideo", "capturedAudio", "videoPreview", "audioPreview", "autoSave", "ccLibraries", "motionGraphicsTemplateMedia"],
            description: "Which scratch disk to set",
          },
          path: {
            type: "string",
            description: "Absolute path of an existing folder, or \"SameAsProject\"",
          },
          save_and_verify: {
            type: "boolean",
            description:
              "Save the project afterwards and confirm the saved scratch-disk settings (default: false). Premiere has no scratch-disk getter, so without this the result is unverified.",
          },
        },
        required: ["scratch_disk_type", "path"],
      },
      handler: async (args: { scratch_disk_type: string; path: string; save_and_verify?: boolean }) => {
        const key = ({ videoPreview: "videoPreviews", audioPreview: "audioPreviews" } as Record<string, string>)[args.scratch_disk_type] ?? args.scratch_disk_type;
        return applyScratchDisks(bridgeOptions, [{ key, path: args.path }], args.save_and_verify === true);
      },
    },
  };
}
