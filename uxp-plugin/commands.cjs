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
  function targetArgs(args) { return { videoTrackIndex: nonNegativeInt(args.videoTrackIndex, "videoTrackIndex"), clipIndex: nonNegativeInt(args.clipIndex, "clipIndex") }; }
  function optionalPosition(value) { const result = value == null ? "end" : value; if (result !== "start" && result !== "end") throw commandError("UXP_INVALID_ARGUMENT", "position must be start or end"); return result; }
  function assertObject(value) { if (!value || typeof value !== "object" || Array.isArray(value)) throw commandError("UXP_INVALID_ARGUMENT", "args must be an object"); }
  function assertOnlyKeys(value, allowed) { const unknown = Object.keys(value).filter((key) => !allowed.includes(key)); if (unknown.length) throw commandError("UXP_INVALID_ARGUMENT", "Unknown argument: " + unknown[0]); }
  function nonNegativeInt(value, name) { if (!Number.isInteger(value) || value < 0) throw commandError("UXP_INVALID_ARGUMENT", name + " must be a non-negative integer"); return value; }
  function positiveNumber(value, name) { const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw commandError("UXP_INVALID_ARGUMENT", name + " must be positive"); return number; }
  function positiveInt(value, fallback, name) { return Math.round(positiveNumber(value == null ? fallback : value, name)); }
  function requiredString(value, name) { if (typeof value !== "string" || !value.trim() || value.length > 4096) throw commandError("UXP_INVALID_ARGUMENT", name + " must be a non-empty string"); return value; }
  function validateOperationId(value) { if (value == null) return null; if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw commandError("UXP_INVALID_ARGUMENT", "operationId must be 1-128 safe characters"); return value; }
  function simpleRevision(value) { var hash = 2166136261; for (var i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); } return "uxp-" + (hash >>> 0).toString(16); }
  function commandError(code, message) { const error = new Error(message); error.code = code; return error; }
  return { createCommandRegistry, validateAddArgs, validateRemoveArgs, commandError };
});
