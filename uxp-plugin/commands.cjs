(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpCommands = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createCommandRegistry(deps) {
    const ppro = deps.ppro, Protocol = deps.Protocol;
    const completedOperations = new Map();
    const definitions = {
      "capabilities.get": { readOnly: true, handler: capabilities },
      "state.get": { readOnly: true, handler: stateSnapshot },
      "project.snapshot": { readOnly: true, minHostVersion: "25.6.0", probe: canInspectProject, handler: projectSnapshot },
      "project.save": { idempotent: true, minHostVersion: "25.6.0", probe: canSaveProject, handler: saveProject },
      "sequence.createPreset": { destructive: true, undoable: false, minHostVersion: "26.3.0", probe: canCreatePresetSequence, handler: createPresetSequence },
      "interchange.export": { minHostVersion: "26.2.0", probe: canExportInterchange, handler: exportInterchange },
      "interchange.aaf.export": { destructive: true, undoable: false, idempotent: true, minHostVersion: "26.3.0", probe: canExportAaf, handler: exportAaf },
      "track.rename": { destructive: true, undoable: true, idempotent: true, minHostVersion: "26.3.0", probe: canRenameTracks, handler: renameTrack },
      "subclip.create": { destructive: true, undoable: true, minHostVersion: "26.3.0", probe: canCreateSubclips, handler: createSubclip },
      "marker.list": { readOnly: true, minHostVersion: "26.3.0", probe: canListMarkers, handler: listMarkers },
      "sourceMonitor.position.set": { idempotent: true, minHostVersion: "26.3.0", probe: canSetSourceMonitorPosition, handler: setSourceMonitorPosition },
      "transcript.languages": { readOnly: true, minHostVersion: "26.3.0", probe: canQueryTranscriptLanguages, handler: transcriptLanguages },
      "objectMask.has": { readOnly: true, minHostVersion: "26.3.0", probe: canInspectObjectMasks, handler: hasObjectMask },
      "encoder.configure": { minHostVersion: "26.3.0", probe: canConfigureEncoder, handler: configureEncoder },
      "frame.export": { minHostVersion: "25.6.0", probe: canExportFrame, handler: exportFrame },
      "transition.video.list": { readOnly: true, minHostVersion: "25.6.0", probe: canListTransitions, handler: listTransitions },
      "transition.video.add": { destructive: true, undoable: true, minHostVersion: "25.6.0", probe: canMutateTransitions, handler: addTransition },
      "transition.video.remove": { destructive: true, undoable: true, minHostVersion: "25.6.0", probe: canMutateTransitions, handler: removeTransition }
    };

    async function dispatch(command, args) {
      const definition = definitions[command];
      if (!definition) throw commandError("UXP_UNSUPPORTED_COMMAND", "Unsupported UXP command: " + command);
      if (definition.probe && !await definition.probe()) throw commandError("UXP_COMMAND_UNAVAILABLE", command + " is not supported by this Premiere build");
      const input = args || {};
      const operationId = validateOperationId(input.operationId);
      const operationKey = operationId ? command + ":" + operationId : null;
      if (!definition.readOnly && operationKey && completedOperations.has(operationKey)) {
        return { ...completedOperations.get(operationKey), replayed: true };
      }
      const result = await definition.handler(input);
      const envelope = definition.readOnly ? result : {
        operationId: operationId || null,
        outcome: result && result.outcome ? result.outcome : "verified",
        ...result
      };
      if (!definition.readOnly && operationKey) {
        completedOperations.set(operationKey, envelope);
        if (completedOperations.size > 256) completedOperations.delete(completedOperations.keys().next().value);
      }
      return envelope;
    }
    async function capabilities() {
      let project = null, sequence = null;
      try { project = await ppro.Project.getActiveProject(); sequence = project && await project.getActiveSequence(); } catch (_) {}
      const commands = {};
      for (const name of Object.keys(definitions)) {
        const definition = definitions[name], supported = !definition.probe || await definition.probe();
        commands[name] = {
          supported, backend: "uxp", documented: true,
          readOnly: !!definition.readOnly, destructive: !!definition.destructive,
          undoable: !!definition.undoable, idempotent: !!definition.idempotent
        };
        if (definition.minHostVersion) commands[name].minHostVersion = definition.minHostVersion;
        if (!supported) commands[name].reason = "Required Premiere UXP API is unavailable in this host";
      }
      return {
        backend: "uxp", protocolVersion: Protocol.PROTOCOL_VERSION, hostMinVersion: "25.6.0",
        activeProject: !!project, activeSequence: !!sequence, commands,
        fallback: { backend: "cep", reason: "Use CEP/QE only when a command is absent or reports unsupported; never silently retry a failed UXP mutation." }
      };
    }
    async function stateSnapshot() {
      const project = await ppro.Project.getActiveProject();
      const sequence = project && await project.getActiveSequence();
      const position = sequence && await sequence.getPlayerPosition();
      return { projectOpen: !!project, sequenceOpen: !!sequence, playheadSeconds: position ? position.seconds : null };
    }
    async function projectSnapshot() {
      const project = await ppro.Project.getActiveProject();
      if (!project) return { revision: "no-project", project: null, sequences: [] };
      const sequences = Array.from(await project.getSequences() || []).map((sequence) => ({
        guid: String(sequence.guid || ""), name: String(sequence.name || "")
      }));
      const active = await project.getActiveSequence();
      const revision = simpleRevision([project.guid, project.name, project.path, active && active.guid, sequences.map((item) => item.guid).join(",")].join("|"));
      return {
        revision,
        project: { guid: String(project.guid || ""), name: String(project.name || ""), path: String(project.path || "") },
        activeSequenceGuid: active ? String(active.guid || "") : null,
        sequences
      };
    }
    async function saveProject() {
      const project = await ppro.Project.getActiveProject();
      if (!project) throw commandError("UXP_NO_ACTIVE_PROJECT", "No active project");
      const saved = await project.save();
      if (!saved) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not confirm the project save");
      return { saved: true, outcome: "verified", projectGuid: String(project.guid || "") };
    }
    async function createPresetSequence(args) {
      assertOnlyKeys(args, ["name", "presetPath", "operationId"]);
      const name = requiredString(args.name, "name"), presetPath = requiredString(args.presetPath, "presetPath");
      const project = await ppro.Project.getActiveProject();
      if (!project) throw commandError("UXP_NO_ACTIVE_PROJECT", "No active project");
      const sequence = await project.createSequenceWithPresetPath(name, presetPath);
      if (!sequence) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not return the created sequence");
      const verified = Array.from(await project.getSequences() || []).some((item) => String(item.guid || "") === String(sequence.guid || ""));
      if (!verified) throw commandError("UXP_VERIFICATION_FAILED", "Created sequence was not present in the project");
      return { created: true, outcome: "verified", sequence: { guid: String(sequence.guid || ""), name: String(sequence.name || name) } };
    }
    async function exportInterchange(args) {
      assertOnlyKeys(args, ["format", "outputFilePath", "suppressUI", "operationId"]);
      const format = requiredString(args.format, "format"), outputFilePath = requiredString(args.outputFilePath, "outputFilePath");
      if (format !== "otio" && format !== "fcpxml") throw commandError("UXP_INVALID_ARGUMENT", "format must be otio or fcpxml");
      const context = await activeContext(false);
      const method = format === "otio" ? "exportAsOpenTimelineIO" : "exportAsFinalCutProXML";
      const exported = await ppro.ProjectConverter[method](context.sequence, outputFilePath, args.suppressUI !== false);
      if (!exported) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not confirm the interchange export");
      return { exported: true, outcome: "verified", format, outputFilePath };
    }
    async function exportAaf(args) {
      const input = validateAafArgs(args);
      const context = await activeContext(false);
      const options = buildAafExportOptions(ppro, input.options);
      const exported = await ppro.ProjectConverter.exportAAF(context.sequence, input.outputFilePath, options);
      if (!exported) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not confirm the AAF export");
      // ProjectConverter confirms the export request, but UXP cannot reliably stat arbitrary
      // native paths after Premiere returns. Keep that evidence boundary explicit.
      return {
        exported: true, outcome: "committed_unverified", format: "aaf", outputFilePath: input.outputFilePath,
        options: input.options, outputVerified: false, verificationBoundary: "projectConverter_exportAAF_return",
        operation: operationSemantics({
          mutatesProject: false, verificationStatus: "not_verified", verificationBoundary: "projectConverter_exportAAF_return",
          verificationEvidence: [{ type: "host_return", value: true }], cancellationSupported: true
        })
      };
    }
    async function renameTrack(args) {
      const input = validateRenameTrackArgs(args), context = await activeContext(true);
      const track = await trackAt(context.sequence, input.trackType, input.trackIndex);
      if (typeof track.createSetNameAction !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "This " + input.trackType + " track cannot be renamed by this Premiere build");
      let committed = false;
      context.project.lockedAccess(() => {
        const action = track.createSetNameAction(input.name);
        committed = context.project.executeTransaction((compoundAction) => {
          if (!action || compoundAction.addAction(action) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the track rename action");
        }, "Rename " + trackLabel(input.trackType));
      });
      assertTransactionCommitted(committed, "track rename");
      const verifiedTrack = await trackAt(context.sequence, input.trackType, input.trackIndex);
      if (String(verifiedTrack.name || "") !== input.name) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not retain the requested track name");
      return {
        renamed: true, outcome: "verified", trackType: input.trackType, trackIndex: input.trackIndex,
        name: String(verifiedTrack.name || ""), verified: "track_name_readback",
        operation: operationSemantics({
          mutatesProject: true, verificationStatus: "verified", verificationBoundary: "track_name_readback",
          verificationEvidence: [{ type: "track", trackType: input.trackType, trackIndex: input.trackIndex, name: input.name }],
          undoSupported: true, undoLabel: "Rename " + trackLabel(input.trackType), transactionActionGroup: true, cancellationSupported: true
        })
      };
    }
    async function createSubclip(args) {
      const input = validateSubclipArgs(args);
      const context = await activeContext(true);
      const clip = await resolveClipProjectItem(context.project, input);
      if (typeof clip.createSubClipAction !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build cannot create subclips through UXP");
      const before = await projectItemInventory(context.project);
      const startTime = await tickTime(input.startSeconds, "startSeconds"), endTime = await tickTime(input.endSeconds, "endSeconds");
      let committed = false;
      context.project.lockedAccess(() => {
        const action = clip.createSubClipAction(
          input.name, startTime, endTime, input.hasHardBoundaries,
          { takeVideo: input.takeVideo, takeAudio: input.takeAudio }
        );
        committed = context.project.executeTransaction((compoundAction) => {
          if (!action || compoundAction.addAction(action) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the subclip creation action");
        }, "Create subclip");
      });
      assertTransactionCommitted(committed, "subclip creation");
      const created = await findCreatedSubclip(context.project, before, input.name);
      if (!created) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not expose the created subclip in the project inventory");
      return {
        created: true, outcome: "verified", subclip: created,
        sourceProjectItemId: await projectItemIdentifier(clip), sourceProjectItemName: String(clip.name || ""),
        startSeconds: input.startSeconds, endSeconds: input.endSeconds,
        hasHardBoundaries: input.hasHardBoundaries, takeVideo: input.takeVideo, takeAudio: input.takeAudio,
        verified: "new_project_item_readback",
        operation: operationSemantics({
          mutatesProject: true, verificationStatus: "verified", verificationBoundary: "new_project_item_readback",
          verificationEvidence: [{ type: "project_item", id: created.projectItemId, name: created.name }],
          undoSupported: true, undoLabel: "Create subclip", transactionActionGroup: true, cancellationSupported: true
        })
      };
    }
    async function listMarkers(args) {
      const input = validateMarkerListArgs(args);
      const project = await ppro.Project.getActiveProject();
      if (!project) throw commandError("UXP_NO_ACTIVE_PROJECT", "No active project");
      const owner = input.scope === "sequence"
        ? await activeSequence(project)
        : await resolveClipProjectItem(project, input);
      if (!ppro.Markers || typeof ppro.Markers.getMarkers !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build does not expose documented marker APIs");
      const collection = await ppro.Markers.getMarkers(owner);
      if (!collection || typeof collection.getMarkers !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere did not return a marker collection");
      const source = Array.from(await collection.getMarkers(input.filters) || []);
      const markers = [];
      for (let i = 0; i < source.length; i += 1) markers.push(await markerSnapshot(source[i]));
      return {
        scope: input.scope, ownerGuid: input.scope === "sequence" ? stringifyGuid(owner.guid) : null,
        ownerProjectItemId: input.scope === "projectItem" ? await projectItemIdentifier(owner) : null,
        filters: input.filters, count: markers.length, markers
      };
    }
    async function setSourceMonitorPosition(args) {
      assertOnlyKeys(args, ["seconds", "operationId"]);
      const seconds = nonNegativeNumber(args.seconds, "seconds");
      const position = await tickTime(seconds, "seconds");
      const sourceMonitor = ppro.SourceMonitor;
      if (!sourceMonitor || typeof sourceMonitor.setPosition !== "function" || typeof sourceMonitor.getPosition !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build does not expose Source Monitor positioning");
      }
      const set = await sourceMonitor.setPosition(position);
      if (!set) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not confirm the Source Monitor position update");
      const readback = await sourceMonitor.getPosition();
      const readbackSeconds = tickSeconds(readback);
      if (readbackSeconds == null || Math.abs(readbackSeconds - seconds) > 0.000001) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not retain the requested Source Monitor position");
      }
      return {
        positioned: true, outcome: "verified", seconds: readbackSeconds, verified: "source_monitor_position_readback",
        operation: operationSemantics({
          mutatesProject: false, verificationStatus: "verified", verificationBoundary: "source_monitor_position_readback",
          verificationEvidence: [{ type: "source_monitor_position", seconds: readbackSeconds }], cancellationSupported: true
        })
      };
    }
    async function transcriptLanguages() {
      const languages = Array.from(await ppro.Transcript.querySupportedLanguages() || []);
      return { languages, count: languages.length };
    }
    async function hasObjectMask(args) {
      assertOnlyKeys(args, ["scope"]);
      const scope = args.scope == null ? "sequence" : args.scope;
      if (scope !== "sequence" && scope !== "project") throw commandError("UXP_INVALID_ARGUMENT", "scope must be sequence or project");
      const project = await ppro.Project.getActiveProject();
      if (!project) throw commandError("UXP_NO_ACTIVE_PROJECT", "No active project");
      const target = scope === "project" ? project : await project.getActiveSequence();
      if (!target) throw commandError("UXP_NO_ACTIVE_SEQUENCE", "No active sequence");
      return { scope, hasObjectMask: !!ppro.ObjectMaskUtils.hasObjectMask(target) };
    }
    async function configureEncoder(args) {
      assertOnlyKeys(args, ["launch", "embeddedXmp", "sidecarXmp", "startBatch", "operationId"]);
      const performed = [];
      if (args.launch) { if (!await ppro.EncoderManager.launchEncoder()) throw commandError("UXP_VERIFICATION_FAILED", "AME did not launch"); performed.push("launch"); }
      if (args.embeddedXmp != null) { await ppro.EncoderManager.setEmbeddedXMPEnabled(!!args.embeddedXmp); performed.push("embeddedXmp"); }
      if (args.sidecarXmp != null) { await ppro.EncoderManager.setSidecarXMPEnabled(!!args.sidecarXmp); performed.push("sidecarXmp"); }
      if (args.startBatch) { if (!await ppro.EncoderManager.startBatchEncode()) throw commandError("UXP_VERIFICATION_FAILED", "AME batch queue did not start"); performed.push("startBatch"); }
      if (!performed.length) throw commandError("UXP_INVALID_ARGUMENT", "At least one encoder operation is required");
      return { configured: true, outcome: "committed_unverified", performed };
    }
    async function tickTime(seconds, name) {
      const value = Number(seconds);
      if (!Number.isFinite(value) || value < 0) throw commandError("UXP_INVALID_ARGUMENT", name + " must be a non-negative number");
      if (ppro.TickTime && typeof ppro.TickTime.createWithSeconds === "function") return ppro.TickTime.createWithSeconds(value);
      throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build cannot create TickTime");
    }
    async function activeContext(requireMutationApis) {
      const project = await ppro.Project.getActiveProject();
      if (!project) throw commandError("UXP_NO_ACTIVE_PROJECT", "No active project");
      const sequence = await project.getActiveSequence();
      if (!sequence) throw commandError("UXP_NO_ACTIVE_SEQUENCE", "No active sequence");
      if (requireMutationApis && (typeof project.lockedAccess !== "function" || typeof project.executeTransaction !== "function")) {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build does not expose locked undoable transactions");
      }
      return { project, sequence };
    }
    async function exportFrame(args) {
      const context = await activeContext(false);
      if (!args.outputDirectory) throw commandError("UXP_INVALID_ARGUMENT", "outputDirectory is required");
      const filename = Protocol.safeFilename(args.filename);
      const position = args.seconds == null ? await context.sequence.getPlayerPosition() : await tickTime(args.seconds, "seconds");
      const size = await context.sequence.getFrameSize();
      const width = positiveInt(args.width, size.width, "width"), height = positiveInt(args.height, size.height, "height");
      const returned = await ppro.Exporter.exportSequenceFrame(context.sequence, position, filename, args.outputDirectory, width, height);
      const path = Protocol.joinPath(args.outputDirectory, filename);
      return { path, width, height, seconds: position.seconds, exporterResult: returned };
    }
    async function listTransitions() {
      const matchNames = Array.from(await ppro.TransitionFactory.getVideoTransitionMatchNames() || []);
      return { matchNames, count: matchNames.length };
    }
    async function addTransition(args) {
      const input = validateAddArgs(args), context = await activeContext(true);
      const target = await videoClipAt(context.sequence, input.videoTrackIndex, input.clipIndex);
      const available = Array.from(await ppro.TransitionFactory.getVideoTransitionMatchNames() || []);
      if (!available.includes(input.matchName)) throw commandError("UXP_TRANSITION_NOT_FOUND", "Unknown video transition matchName: " + input.matchName);
      const transition = await ppro.TransitionFactory.createVideoTransition(input.matchName);
      if (!transition) throw commandError("UXP_TRANSITION_NOT_FOUND", "Premiere could not create video transition: " + input.matchName);
      const options = ppro.AddTransitionOptions();
      options.setApplyToStart(input.position === "start");
      if (input.durationSeconds != null) options.setDuration(await tickTime(input.durationSeconds, "durationSeconds"));
      if (input.forceSingleSided != null) options.setForceSingleSided(input.forceSingleSided);
      if (input.transitionAlignment != null) options.setTransitionAlignment(input.transitionAlignment);
      let committed = false;
      context.project.lockedAccess(() => {
        const action = target.createAddVideoTransitionAction(transition, options);
        committed = context.project.executeTransaction((compoundAction) => {
          if (!action || compoundAction.addAction(action) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the transition action");
        }, "Add video transition");
      });
      assertTransactionCommitted(committed, "transition addition");
      return { applied: true, verified: "transaction", matchName: input.matchName, videoTrackIndex: input.videoTrackIndex, clipIndex: input.clipIndex, position: input.position };
    }
    async function removeTransition(args) {
      const input = validateRemoveArgs(args), context = await activeContext(true);
      const target = await videoClipAt(context.sequence, input.videoTrackIndex, input.clipIndex);
      const positions = ppro.Constants && ppro.Constants.TransitionPosition;
      const position = positions && positions[input.position.toUpperCase()];
      if (position == null) throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere transition position constants are unavailable");
      let committed = false;
      context.project.lockedAccess(() => {
        const action = target.createRemoveVideoTransitionAction(position);
        committed = context.project.executeTransaction((compoundAction) => {
          if (!action || compoundAction.addAction(action) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the transition action");
        }, "Remove video transition");
      });
      assertTransactionCommitted(committed, "transition removal");
      return { removed: true, verified: "transaction", videoTrackIndex: input.videoTrackIndex, clipIndex: input.clipIndex, position: input.position };
    }
    async function activeSequence(project) {
      const sequence = await project.getActiveSequence();
      if (!sequence) throw commandError("UXP_NO_ACTIVE_SEQUENCE", "No active sequence");
      return sequence;
    }
    async function trackAt(sequence, trackType, trackIndex) {
      const title = trackLabel(trackType), countMethod = "get" + title + "Count", itemMethod = "get" + title;
      if (typeof sequence[countMethod] !== "function" || typeof sequence[itemMethod] !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build does not expose " + title + " APIs");
      }
      const count = await sequence[countMethod]();
      if (trackIndex >= count) throw commandError("UXP_TARGET_NOT_FOUND", trackType + " trackIndex " + trackIndex + " is out of range");
      const track = await sequence[itemMethod](trackIndex);
      if (!track) throw commandError("UXP_TARGET_NOT_FOUND", trackType + " trackIndex " + trackIndex + " was not found");
      return track;
    }
    function trackLabel(trackType) {
      return trackType === "audio" ? "AudioTrack" : trackType === "video" ? "VideoTrack" : "CaptionTrack";
    }
    async function resolveClipProjectItem(project, input) {
      const wantedId = input.projectItemId || "", wantedName = input.projectItemName || "";
      if (!wantedId && !wantedName) return selectedClipProjectItem(project);
      if (typeof project.getRootItem !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build cannot enumerate project items");
      const root = await project.getRootItem();
      const queue = root ? [root] : [], nameMatches = [];
      while (queue.length) {
        const folder = queue.shift();
        if (!folder || typeof folder.getItems !== "function") continue;
        const children = Array.from(await folder.getItems() || []);
        for (let i = 0; i < children.length; i += 1) {
          const item = children[i], itemId = await projectItemIdentifier(item);
          if (wantedId && itemId === wantedId) return castClipProjectItem(item);
          if (!wantedId && wantedName && String(item.name || "") === wantedName) {
            try { nameMatches.push(castClipProjectItem(item)); } catch (_) {}
          }
          if (isFolderItem(item)) queue.push(item);
        }
      }
      if (wantedId) throw commandError("UXP_TARGET_NOT_FOUND", "projectItemId was not found or is not a media clip");
      if (nameMatches.length > 1) throw commandError("UXP_AMBIGUOUS_TARGET", "projectItemName matched multiple media clips; use projectItemId");
      if (nameMatches.length === 1) return nameMatches[0];
      throw commandError("UXP_TARGET_NOT_FOUND", "projectItemName was not found or is not a media clip");
    }
    async function selectedClipProjectItem(project) {
      if (!ppro.ProjectUtils || typeof ppro.ProjectUtils.getSelection !== "function") {
        throw commandError("UXP_INVALID_ARGUMENT", "Pass projectItemId or projectItemName because Project panel selection is unavailable");
      }
      const selection = await ppro.ProjectUtils.getSelection(project);
      const items = selection && await selection.getItems();
      if (!items || items.length !== 1) {
        throw commandError("UXP_INVALID_ARGUMENT", "Select exactly one media project item, or pass projectItemId/projectItemName");
      }
      return castClipProjectItem(items[0]);
    }
    function castClipProjectItem(item) {
      if (!ppro.ClipProjectItem || typeof ppro.ClipProjectItem.cast !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build cannot cast project items to media clips");
      }
      try {
        const clip = ppro.ClipProjectItem.cast(item);
        if (clip) return clip;
      } catch (_) {}
      throw commandError("UXP_TARGET_NOT_FOUND", "Resolved project item is not a media clip");
    }
    function isFolderItem(item) {
      if (!ppro.FolderItem || typeof ppro.FolderItem.cast !== "function") return false;
      try { return !!ppro.FolderItem.cast(item); } catch (_) { return false; }
    }
    async function projectItemIdentifier(item) {
      let projectItem = item;
      if (ppro.ProjectItem && typeof ppro.ProjectItem.cast === "function") {
        try { projectItem = ppro.ProjectItem.cast(item) || item; } catch (_) {}
      }
      if (!projectItem || typeof projectItem.getId !== "function") return "";
      const id = await projectItem.getId();
      return id == null ? "" : String(id);
    }
    async function projectItemInventory(project) {
      if (typeof project.getRootItem !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build cannot enumerate project items for subclip verification");
      const root = await project.getRootItem(), queue = root ? [root] : [], items = [];
      while (queue.length) {
        const folder = queue.shift();
        if (!folder || typeof folder.getItems !== "function") continue;
        const children = Array.from(await folder.getItems() || []);
        for (let i = 0; i < children.length; i += 1) {
          const item = children[i];
          items.push({ id: await projectItemIdentifier(item), name: String(item.name || ""), item });
          if (isFolderItem(item)) queue.push(item);
        }
      }
      return items;
    }
    async function findCreatedSubclip(project, before, name) {
      const known = new Set(before.map((item) => item.id).filter(Boolean));
      const after = await projectItemInventory(project);
      for (let i = 0; i < after.length; i += 1) {
        const item = after[i];
        if (item.name !== name || !item.id || known.has(item.id)) continue;
        try {
          const clip = castClipProjectItem(item.item);
          return { projectItemId: item.id, name: String(clip.name || item.name) };
        } catch (_) {}
      }
      return null;
    }
    async function markerSnapshot(marker) {
      const start = await marker.getStart(), duration = await marker.getDuration();
      return {
        guid: stringifyGuid(marker.guid), name: String(await marker.getName() || ""),
        comments: String(await marker.getComments() || ""), type: String(await marker.getType() || ""),
        colorIndex: await marker.getColorIndex(), startSeconds: tickSeconds(start), durationSeconds: tickSeconds(duration)
      };
    }
    function stringifyGuid(value) {
      if (value == null) return "";
      try { return String(typeof value.toString === "function" ? value.toString() : value); } catch (_) { return ""; }
    }
    function tickSeconds(value) {
      const seconds = value && Number(value.seconds);
      return Number.isFinite(seconds) ? seconds : null;
    }
    async function videoClipAt(sequence, trackIndex, clipIndex) {
      const trackCount = await sequence.getVideoTrackCount();
      if (trackIndex >= trackCount) throw commandError("UXP_TARGET_NOT_FOUND", "videoTrackIndex " + trackIndex + " is out of range");
      const track = await sequence.getVideoTrack(trackIndex), types = ppro.Constants && ppro.Constants.TrackItemType;
      if (!track || !types || types.CLIP == null) throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere video track APIs are unavailable");
      const clips = await track.getTrackItems(types.CLIP, false);
      if (!clips || !clips[clipIndex]) throw commandError("UXP_TARGET_NOT_FOUND", "clipIndex " + clipIndex + " is out of range on video track " + trackIndex);
      return clips[clipIndex];
    }
    function assertTransactionCommitted(committed, operation) {
      if (!committed) throw commandError("UXP_TRANSACTION_FAILED", "Premiere did not commit the " + operation + " transaction");
    }
    function operationSemantics(options) {
      return Protocol && typeof Protocol.operationSemantics === "function" ? Protocol.operationSemantics(options) : undefined;
    }
    function canExportFrame() { return !!(ppro.Exporter && typeof ppro.Exporter.exportSequenceFrame === "function"); }
    function canInspectProject() { return !!(ppro.Project && typeof ppro.Project.getActiveProject === "function"); }
    async function activeProjectHas(name) {
      if (!canInspectProject()) return false;
      const project = await ppro.Project.getActiveProject();
      return !project || typeof project[name] === "function";
    }
    function canSaveProject() { return activeProjectHas("save"); }
    function canCreatePresetSequence() { return activeProjectHas("createSequenceWithPresetPath"); }
    function canExportInterchange() {
      return !!(ppro.ProjectConverter && typeof ppro.ProjectConverter.exportAsOpenTimelineIO === "function" &&
        typeof ppro.ProjectConverter.exportAsFinalCutProXML === "function");
    }
    function canExportAaf() {
      return !!(ppro.ProjectConverter && typeof ppro.ProjectConverter.exportAAF === "function" &&
        typeof ppro.AAFExportOptions === "function");
    }
    async function activeSequenceHas(methods) {
      if (!canInspectProject()) return false;
      const project = await ppro.Project.getActiveProject();
      if (!project) return true;
      const sequence = await project.getActiveSequence();
      return !sequence || methods.every((method) => typeof sequence[method] === "function");
    }
    function canRenameTracks() {
      return activeSequenceHas(["getAudioTrackCount", "getAudioTrack", "getVideoTrackCount", "getVideoTrack", "getCaptionTrackCount", "getCaptionTrack"]);
    }
    function canCreateSubclips() {
      return canInspectProject() && !!(ppro.ClipProjectItem && typeof ppro.ClipProjectItem.cast === "function");
    }
    function canListMarkers() { return !!(ppro.Markers && typeof ppro.Markers.getMarkers === "function"); }
    function canSetSourceMonitorPosition() {
      return !!(ppro.SourceMonitor && typeof ppro.SourceMonitor.setPosition === "function" && typeof ppro.SourceMonitor.getPosition === "function" &&
        ppro.TickTime && typeof ppro.TickTime.createWithSeconds === "function");
    }
    function canQueryTranscriptLanguages() { return !!(ppro.Transcript && typeof ppro.Transcript.querySupportedLanguages === "function"); }
    function canInspectObjectMasks() { return !!(ppro.ObjectMaskUtils && typeof ppro.ObjectMaskUtils.hasObjectMask === "function"); }
    function canConfigureEncoder() {
      return !!(ppro.EncoderManager && typeof ppro.EncoderManager.launchEncoder === "function" &&
        typeof ppro.EncoderManager.startBatchEncode === "function");
    }
    function canListTransitions() { return !!(ppro.TransitionFactory && typeof ppro.TransitionFactory.getVideoTransitionMatchNames === "function"); }
    function canMutateTransitions() {
      return canListTransitions() && typeof ppro.TransitionFactory.createVideoTransition === "function" &&
        typeof ppro.AddTransitionOptions === "function" && !!(ppro.Constants && ppro.Constants.TrackItemType && ppro.Constants.TransitionPosition);
    }
    return { definitions, dispatch, capabilities, stateSnapshot };
  }

  function validateAddArgs(args) {
    assertObject(args);
    assertOnlyKeys(args, ["videoTrackIndex", "clipIndex", "matchName", "position", "durationSeconds", "forceSingleSided", "transitionAlignment", "operationId"]);
    const result = targetArgs(args);
    if (typeof args.matchName !== "string" || !args.matchName.trim() || args.matchName.length > 256) throw commandError("UXP_INVALID_ARGUMENT", "matchName must be a non-empty string of at most 256 characters");
    result.matchName = args.matchName; result.position = optionalPosition(args.position);
    if (args.durationSeconds != null) result.durationSeconds = positiveNumber(args.durationSeconds, "durationSeconds");
    if (args.forceSingleSided != null) {
      if (typeof args.forceSingleSided !== "boolean") throw commandError("UXP_INVALID_ARGUMENT", "forceSingleSided must be a boolean");
      result.forceSingleSided = args.forceSingleSided;
    }
    if (args.transitionAlignment != null) {
      if (!Number.isInteger(args.transitionAlignment)) throw commandError("UXP_INVALID_ARGUMENT", "transitionAlignment must be an integer");
      result.transitionAlignment = args.transitionAlignment;
    }
    return result;
  }
  function validateRemoveArgs(args) {
    assertObject(args); assertOnlyKeys(args, ["videoTrackIndex", "clipIndex", "position", "operationId"]);
    const result = targetArgs(args); result.position = optionalPosition(args.position); return result;
  }
  function validateRenameTrackArgs(args) {
    assertObject(args); assertOnlyKeys(args, ["trackType", "trackIndex", "name", "operationId"]);
    const trackType = args.trackType;
    if (trackType !== "audio" && trackType !== "video" && trackType !== "caption") {
      throw commandError("UXP_INVALID_ARGUMENT", "trackType must be audio, video, or caption");
    }
    return { trackType, trackIndex: nonNegativeInt(args.trackIndex, "trackIndex"), name: boundedString(args.name, "name", 255) };
  }
  function validateSubclipArgs(args) {
    assertObject(args);
    assertOnlyKeys(args, ["projectItemId", "projectItemName", "name", "startSeconds", "endSeconds", "hasHardBoundaries", "takeVideo", "takeAudio", "operationId"]);
    const target = validateProjectItemTarget(args);
    const startSeconds = nonNegativeNumber(args.startSeconds, "startSeconds"), endSeconds = nonNegativeNumber(args.endSeconds, "endSeconds");
    if (endSeconds <= startSeconds) throw commandError("UXP_INVALID_ARGUMENT", "endSeconds must be greater than startSeconds");
    const hasHardBoundaries = optionalBoolean(args.hasHardBoundaries, false, "hasHardBoundaries");
    const takeVideo = optionalBoolean(args.takeVideo, true, "takeVideo"), takeAudio = optionalBoolean(args.takeAudio, true, "takeAudio");
    if (!takeVideo && !takeAudio) throw commandError("UXP_INVALID_ARGUMENT", "At least one of takeVideo or takeAudio must be true");
    return Object.assign(target, {
      name: boundedString(args.name, "name", 255), startSeconds, endSeconds, hasHardBoundaries, takeVideo, takeAudio
    });
  }
  function validateMarkerListArgs(args) {
    assertObject(args); assertOnlyKeys(args, ["scope", "projectItemId", "projectItemName", "filters"]);
    const scope = args.scope == null ? "sequence" : args.scope;
    if (scope !== "sequence" && scope !== "projectItem") throw commandError("UXP_INVALID_ARGUMENT", "scope must be sequence or projectItem");
    if (scope === "sequence" && (args.projectItemId != null || args.projectItemName != null)) {
      throw commandError("UXP_INVALID_ARGUMENT", "project item targeting is only valid for projectItem scope");
    }
    const target = scope === "projectItem" ? validateProjectItemTarget(args) : {};
    let filters = [];
    if (args.filters != null) {
      if (!Array.isArray(args.filters) || args.filters.length > 16) throw commandError("UXP_INVALID_ARGUMENT", "filters must contain at most 16 marker types");
      filters = args.filters.map((value, index) => boundedString(value, "filters[" + index + "]", 64));
    }
    return Object.assign({ scope, filters }, target);
  }
  function validateProjectItemTarget(args) {
    const hasId = args.projectItemId != null, hasName = args.projectItemName != null;
    if (hasId && hasName) throw commandError("UXP_INVALID_ARGUMENT", "Pass either projectItemId or projectItemName, not both");
    const result = {};
    if (hasId) result.projectItemId = boundedString(args.projectItemId, "projectItemId", 512);
    if (hasName) result.projectItemName = boundedString(args.projectItemName, "projectItemName", 255);
    return result;
  }
  function validateAafArgs(args) {
    assertObject(args); assertOnlyKeys(args, ["outputFilePath", "options", "operationId"]);
    const result = { outputFilePath: requiredString(args.outputFilePath, "outputFilePath"), options: {} };
    if (result.outputFilePath.length > 4096) throw commandError("UXP_INVALID_ARGUMENT", "outputFilePath must be at most 4096 characters");
    if (args.options == null) return result;
    assertObject(args.options);
    const value = args.options;
    assertOnlyKeys(value, [
      "mixdownVideo", "explodeToMono", "sampleRate", "bitsPerSample", "embedAudio", "audioFileFormat",
      "trimSources", "handleFrames", "videoMixdownPresetPath", "renderAudioEffects", "interleaveWithoutEffects", "preserveParentFolder"
    ]);
    const booleans = ["mixdownVideo", "explodeToMono", "embedAudio", "trimSources", "renderAudioEffects", "interleaveWithoutEffects", "preserveParentFolder"];
    for (let i = 0; i < booleans.length; i += 1) {
      const key = booleans[i];
      if (value[key] != null) result.options[key] = requiredBoolean(value[key], key);
    }
    if (value.sampleRate != null) result.options.sampleRate = oneOfInt(value.sampleRate, "sampleRate", [32000, 44100, 48000, 88200, 96000]);
    if (value.bitsPerSample != null) result.options.bitsPerSample = oneOfInt(value.bitsPerSample, "bitsPerSample", [16, 24, 32]);
    if (value.audioFileFormat != null) {
      if (value.audioFileFormat !== "aiff" && value.audioFileFormat !== "wav") throw commandError("UXP_INVALID_ARGUMENT", "audioFileFormat must be aiff or wav");
      result.options.audioFileFormat = value.audioFileFormat;
    }
    if (value.handleFrames != null) {
      const frames = nonNegativeInt(value.handleFrames, "handleFrames");
      if (frames > 10000) throw commandError("UXP_INVALID_ARGUMENT", "handleFrames must be at most 10000");
      result.options.handleFrames = frames;
    }
    if (value.videoMixdownPresetPath != null) result.options.videoMixdownPresetPath = boundedString(value.videoMixdownPresetPath, "videoMixdownPresetPath", 4096);
    return result;
  }
  function buildAafExportOptions(ppro, options) {
    if (!ppro.AAFExportOptions || typeof ppro.AAFExportOptions !== "function") {
      throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build does not expose AAFExportOptions");
    }
    const aaf = ppro.AAFExportOptions();
    const setters = {
      mixdownVideo: "setMixdownVideo", explodeToMono: "setExplodeToMono", sampleRate: "setSampleRate",
      bitsPerSample: "setBitsPerSample", embedAudio: "setEmbedAudio", trimSources: "setTrimSources",
      handleFrames: "setHandleFrames", videoMixdownPresetPath: "setVideoMixdownPresetPath",
      renderAudioEffects: "setRenderAudioEffects", interleaveWithoutEffects: "setInterleaveWithoutEffects",
      preserveParentFolder: "setPreserveParentFolder"
    };
    Object.keys(setters).forEach((key) => {
      if (options[key] == null) return;
      const setter = setters[key];
      if (typeof aaf[setter] !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "AAF option " + key + " is unavailable in this Premiere build");
      aaf[setter](options[key]);
    });
    if (options.audioFileFormat != null) {
      const formats = ppro.Constants && ppro.Constants.AAFExportAudioFormat;
      const format = formats && formats[options.audioFileFormat === "aiff" ? "AIFF" : "WAV"];
      if (format == null || typeof aaf.setAudioFileFormat !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "AAF audio file format options are unavailable in this Premiere build");
      aaf.setAudioFileFormat(format);
    }
    return aaf;
  }
  function targetArgs(args) { return { videoTrackIndex: nonNegativeInt(args.videoTrackIndex, "videoTrackIndex"), clipIndex: nonNegativeInt(args.clipIndex, "clipIndex") }; }
  function optionalPosition(value) { const result = value == null ? "end" : value; if (result !== "start" && result !== "end") throw commandError("UXP_INVALID_ARGUMENT", "position must be start or end"); return result; }
  function assertObject(value) { if (!value || typeof value !== "object" || Array.isArray(value)) throw commandError("UXP_INVALID_ARGUMENT", "args must be an object"); }
  function assertOnlyKeys(value, allowed) { const unknown = Object.keys(value).filter((key) => !allowed.includes(key)); if (unknown.length) throw commandError("UXP_INVALID_ARGUMENT", "Unknown argument: " + unknown[0]); }
  function nonNegativeInt(value, name) { if (!Number.isInteger(value) || value < 0) throw commandError("UXP_INVALID_ARGUMENT", name + " must be a non-negative integer"); return value; }
  function nonNegativeNumber(value, name) { const number = Number(value); if (!Number.isFinite(number) || number < 0) throw commandError("UXP_INVALID_ARGUMENT", name + " must be a non-negative number"); return number; }
  function positiveNumber(value, name) { const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw commandError("UXP_INVALID_ARGUMENT", name + " must be positive"); return number; }
  function positiveInt(value, fallback, name) { return Math.round(positiveNumber(value == null ? fallback : value, name)); }
  function requiredString(value, name) { if (typeof value !== "string" || !value.trim() || value.length > 4096) throw commandError("UXP_INVALID_ARGUMENT", name + " must be a non-empty string"); return value; }
  function boundedString(value, name, maximum) { if (typeof value !== "string" || !value.trim() || value.length > maximum) throw commandError("UXP_INVALID_ARGUMENT", name + " must be a non-empty string of at most " + maximum + " characters"); return value; }
  function requiredBoolean(value, name) { if (typeof value !== "boolean") throw commandError("UXP_INVALID_ARGUMENT", name + " must be a boolean"); return value; }
  function optionalBoolean(value, fallback, name) { return value == null ? fallback : requiredBoolean(value, name); }
  function oneOfInt(value, name, allowed) { if (!Number.isInteger(value) || !allowed.includes(value)) throw commandError("UXP_INVALID_ARGUMENT", name + " must be one of " + allowed.join(", ")); return value; }
  function validateOperationId(value) { if (value == null) return null; if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw commandError("UXP_INVALID_ARGUMENT", "operationId must be 1-128 safe characters"); return value; }
  function simpleRevision(value) { var hash = 2166136261; for (var i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); } return "uxp-" + (hash >>> 0).toString(16); }
  function commandError(code, message) { const error = new Error(message); error.code = code; return error; }
  return { createCommandRegistry, validateAddArgs, validateRemoveArgs, commandError };
});
