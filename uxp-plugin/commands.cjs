(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpCommands = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createCommandRegistry(deps) {
    const ppro = deps.ppro, fs = deps.fs, Protocol = deps.Protocol;
    const Transcript = deps.Transcript, host = deps.host;
    const definitions = {
      "capabilities.get": { readOnly: true, handler: capabilities },
      "state.get": { readOnly: true, handler: stateSnapshot },
      "frame.export": { probe: canExportFrame, handler: exportFrame },
      "transition.video.list": { readOnly: true, minHostVersion: "25.6.0", probe: canListTransitions, handler: listTransitions },
      "transition.video.add": { destructive: true, undoable: true, minHostVersion: "25.6.0", probe: canMutateTransitions, handler: addTransition },
      "transition.video.remove": { destructive: true, undoable: true, minHostVersion: "25.6.0", probe: canMutateTransitions, handler: removeTransition },
      "transcript.export": { readOnly: true, minHostVersion: "25.6.0", probe: canUseTranscripts, handler: exportTranscript },
      "transcript.search": { readOnly: true, minHostVersion: "25.6.0", probe: canUseTranscripts, handler: searchTranscript },
      "transcript.has": { readOnly: true, minHostVersion: "25.6.0", probe: canUseTranscripts, handler: hasTranscript },
      "transcript.import": { destructive: true, undoable: true, minHostVersion: "25.6.0", probe: canImportTranscript, handler: importTranscript },
      "captions.inspect": { readOnly: true, minHostVersion: "25.6.0", probe: supportedTranscriptHost, handler: inspectCaptions }
    };

    async function dispatch(command, args) {
      const definition = definitions[command];
      if (!definition) throw commandError("UXP_UNSUPPORTED_COMMAND", "Unsupported UXP command: " + command);
      if (definition.probe && !definition.probe()) throw commandError("UXP_COMMAND_UNAVAILABLE", command + " is not supported by this Premiere build");
      return definition.handler(args || {});
    }
    async function capabilities() {
      let project = null, sequence = null;
      try { project = await ppro.Project.getActiveProject(); sequence = project && await project.getActiveSequence(); } catch (_) {}
      const commands = {};
      Object.keys(definitions).forEach((name) => {
        const definition = definitions[name], supported = !definition.probe || definition.probe();
        commands[name] = { supported, readOnly: !!definition.readOnly, destructive: !!definition.destructive, undoable: !!definition.undoable };
        if (definition.minHostVersion) commands[name].minHostVersion = definition.minHostVersion;
        if (!supported) commands[name].reason = "Required Premiere UXP API is unavailable in this host";
      });
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
      let exists = false;
      try { await fs.lstat(path); exists = true; } catch (_) {}
      if (!exists) throw commandError("UXP_VERIFICATION_FAILED", "Exporter returned " + JSON.stringify(returned) + " but no frame exists at " + path);
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
      executeUndoable(context.project, "Add video transition", () => target.createAddVideoTransitionAction(transition, options));
      return { applied: true, verified: "transaction", matchName: input.matchName, videoTrackIndex: input.videoTrackIndex, clipIndex: input.clipIndex, position: input.position };
    }
    async function removeTransition(args) {
      const input = validateRemoveArgs(args), context = await activeContext(true);
      const target = await videoClipAt(context.sequence, input.videoTrackIndex, input.clipIndex);
      const positions = ppro.Constants && ppro.Constants.TransitionPosition;
      const position = positions && positions[input.position.toUpperCase()];
      if (position == null) throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere transition position constants are unavailable");
      executeUndoable(context.project, "Remove video transition", () => target.createRemoveVideoTransitionAction(position));
      return { removed: true, verified: "transaction", videoTrackIndex: input.videoTrackIndex, clipIndex: input.clipIndex, position: input.position };
    }
    function castClipProjectItem(item) {
      try {
        const clip = ppro.ClipProjectItem.cast(item);
        if (clip) return clip;
      } catch (_) {}
      throw commandError("UXP_TARGET_NOT_FOUND", "The resolved project item is not a media clip");
    }
    async function selectedClipProjectItem(project) {
      if (!ppro.ProjectUtils || typeof ppro.ProjectUtils.getSelection !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Project panel selection is unavailable; pass projectItemId or projectItemName");
      }
      const selection = await ppro.ProjectUtils.getSelection(project);
      const items = selection && await selection.getItems();
      if (!items || items.length !== 1) throw commandError("UXP_TARGET_NOT_FOUND", "Select exactly one media project item, or pass projectItemId/projectItemName");
      return castClipProjectItem(items[0]);
    }
    async function findProjectItem(project, args) {
      const wantedId = args && args.projectItemId != null ? String(args.projectItemId) : "";
      const wantedName = args && args.projectItemName != null ? String(args.projectItemName) : "";
      if (!wantedId && !wantedName) return selectedClipProjectItem(project);
      const queue = [await project.getRootItem()];
      while (queue.length) {
        const folder = queue.shift(), children = await folder.getItems();
        for (let i = 0; i < children.length; i += 1) {
          const item = children[i], itemId = typeof item.getId === "function" ? String(item.getId()) : "";
          const candidate = Transcript.matchingClipCandidate(item, itemId, wantedId, wantedName, castClipProjectItem);
          if (candidate.clip) return candidate.clip;
          try { const childFolder = ppro.FolderItem.cast(item); if (childFolder) queue.push(childFolder); } catch (_) {}
        }
      }
      throw commandError("UXP_TARGET_NOT_FOUND", "Project item not found");
    }
    async function transcriptContext(args) {
      const project = await ppro.Project.getActiveProject();
      if (!project) throw commandError("UXP_NO_ACTIVE_PROJECT", "No active project");
      const clip = await findProjectItem(project, args || {});
      const projectItem = ppro.ProjectItem.cast(clip);
      return { project, clip, projectItemId: String(projectItem.getId()), projectItemName: clip.name };
    }
    async function exportTranscript(args) {
      const context = await transcriptContext(args);
      const json = await ppro.Transcript.exportToJSON(context.clip);
      if (typeof json !== "string" || !json) throw commandError("UXP_TARGET_NOT_FOUND", "The selected clip has no transcript");
      Transcript.parseTranscriptJSON(json);
      return { projectItemId: context.projectItemId, projectItemName: context.projectItemName, json };
    }
    async function searchTranscript(args) {
      const exported = await exportTranscript(args);
      const result = Transcript.searchTranscriptJSON(exported.json, args.query, {
        caseSensitive: args.caseSensitive, maxResults: args.maxResults
      });
      return { projectItemId: exported.projectItemId, projectItemName: exported.projectItemName, ...result };
    }
    async function hasTranscript(args) {
      const context = await transcriptContext(args);
      if (typeof ppro.Transcript.hasTranscript === "function") {
        return { projectItemId: context.projectItemId, projectItemName: context.projectItemName, hasTranscript: !!ppro.Transcript.hasTranscript(context.clip), method: "native" };
      }
      const present = await Transcript.probeTranscriptExport(() => ppro.Transcript.exportToJSON(context.clip));
      return { projectItemId: context.projectItemId, projectItemName: context.projectItemName, hasTranscript: present, method: "export-probe" };
    }
    async function importTranscript(args) {
      if (!args || typeof args.json !== "string") throw commandError("UXP_INVALID_ARGUMENT", "json is required");
      Transcript.parseTranscriptJSON(args.json);
      const context = await transcriptContext(args);
      const textSegments = ppro.Transcript.importFromJSON(args.json);
      let committed = false;
      context.project.lockedAccess(() => {
        committed = context.project.executeTransaction((compoundAction) => {
          compoundAction.addAction(ppro.Transcript.createImportTextSegmentsAction(textSegments, context.clip));
        }, "Import transcript");
      });
      if (!committed) throw commandError("UXP_TRANSACTION_FAILED", "Premiere rejected the transcript import transaction");
      return { imported: true, projectItemId: context.projectItemId, projectItemName: context.projectItemName, undoable: true };
    }
    async function inspectCaptions() {
      const context = await activeContext(false);
      const count = await context.sequence.getCaptionTrackCount(), tracks = [];
      for (let i = 0; i < count; i += 1) {
        const track = await context.sequence.getCaptionTrack(i);
        const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
        tracks.push({ id: track.id, index: await track.getIndex(), name: track.name, muted: await track.isMuted(), itemCount: items ? items.length : 0 });
      }
      return { sequenceId: String(context.sequence.guid), sequenceName: context.sequence.name, trackCount: count, tracks };
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
    function executeUndoable(project, label, createAction) {
      let committed = false;
      project.lockedAccess(() => {
        committed = project.executeTransaction((compoundAction) => {
          const action = createAction();
          if (!action || compoundAction.addAction(action) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the transition action");
        }, label);
      });
      if (!committed) throw commandError("UXP_TRANSACTION_FAILED", "Premiere did not commit the transition transaction");
    }
    function canExportFrame() { return !!(ppro.Exporter && typeof ppro.Exporter.exportSequenceFrame === "function"); }
    function canListTransitions() { return !!(ppro.TransitionFactory && typeof ppro.TransitionFactory.getVideoTransitionMatchNames === "function"); }
    function canMutateTransitions() {
      return canListTransitions() && typeof ppro.TransitionFactory.createVideoTransition === "function" &&
        typeof ppro.AddTransitionOptions === "function" && !!(ppro.Constants && ppro.Constants.TrackItemType && ppro.Constants.TransitionPosition);
    }
    function supportedTranscriptHost() { return !!(Transcript && Transcript.versionAtLeast(host && host.version, "25.6.0")); }
    function canUseTranscripts() {
      return supportedTranscriptHost() && !!(ppro.Transcript && typeof ppro.Transcript.exportToJSON === "function" && typeof ppro.Transcript.importFromJSON === "function");
    }
    function canImportTranscript() { return canUseTranscripts() && typeof ppro.Transcript.createImportTextSegmentsAction === "function"; }
    return { definitions, dispatch, capabilities, stateSnapshot };
  }

  function validateAddArgs(args) {
    assertObject(args);
    assertOnlyKeys(args, ["videoTrackIndex", "clipIndex", "matchName", "position", "durationSeconds", "forceSingleSided", "transitionAlignment"]);
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
    assertObject(args); assertOnlyKeys(args, ["videoTrackIndex", "clipIndex", "position"]);
    const result = targetArgs(args); result.position = optionalPosition(args.position); return result;
  }
  function targetArgs(args) { return { videoTrackIndex: nonNegativeInt(args.videoTrackIndex, "videoTrackIndex"), clipIndex: nonNegativeInt(args.clipIndex, "clipIndex") }; }
  function optionalPosition(value) { const result = value == null ? "end" : value; if (result !== "start" && result !== "end") throw commandError("UXP_INVALID_ARGUMENT", "position must be start or end"); return result; }
  function assertObject(value) { if (!value || typeof value !== "object" || Array.isArray(value)) throw commandError("UXP_INVALID_ARGUMENT", "args must be an object"); }
  function assertOnlyKeys(value, allowed) { const unknown = Object.keys(value).filter((key) => !allowed.includes(key)); if (unknown.length) throw commandError("UXP_INVALID_ARGUMENT", "Unknown argument: " + unknown[0]); }
  function nonNegativeInt(value, name) { if (!Number.isInteger(value) || value < 0) throw commandError("UXP_INVALID_ARGUMENT", name + " must be a non-negative integer"); return value; }
  function positiveNumber(value, name) { const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw commandError("UXP_INVALID_ARGUMENT", name + " must be positive"); return number; }
  function positiveInt(value, fallback, name) { return Math.round(positiveNumber(value == null ? fallback : value, name)); }
  function commandError(code, message) { const error = new Error(message); error.code = code; return error; }
  return { createCommandRegistry, validateAddArgs, validateRemoveArgs, commandError };
});
