(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpCommands = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createCommandRegistry(deps) {
    const ppro = deps.ppro, Protocol = deps.Protocol, workspace = deps.workspace;
    const completedOperations = new Map();
    const inFlightOperations = new Map();
    const sequenceRangeUpdateTails = new Map();
    const transitionUpdateTails = new Map();
    const sequencePlayheadSetTails = new Map();
    const appPreferenceSetTails = new Map();
    const listedVideoTransitionMatchNames = new Set();
    const APP_PREFERENCE_KEYS = Object.freeze({
      auto_peak_generation: "KEY_AUTO_PEAK_GENERATION",
      import_workspace: "KEY_IMPORT_WORKSPACE",
      show_quickstart_dialog: "KEY_SHOW_QUICKSTART_DIALOG"
    });
    const MAX_APP_PREFERENCE_VALUE_CHARS = 1024;
    // Adobe's current Sequence Settings reference caps a sequence at 10,240 x
    // 8,192 pixels. These bounds make the read-only bridge reject malformed
    // host data instead of serializing an implausible frame size.
    const MAX_SEQUENCE_FRAME_WIDTH = 10240;
    const MAX_SEQUENCE_FRAME_HEIGHT = 8192;
    // Preserve the native decimal ticks value as a string. Eighteen digits is a
    // generous bounded protocol representation while avoiding an unbounded
    // value from the host.
    const MAX_SEQUENCE_TIMEBASE_DIGITS = 18;
    const definitions = {
      "capabilities.get": { readOnly: true, handler: capabilities },
      "state.get": { readOnly: true, handler: stateSnapshot },
      "project.snapshot": { readOnly: true, minHostVersion: "25.6.0", probe: canInspectProject, handler: projectSnapshot },
      "project.insertionBin.inspect": { readOnly: true, minHostVersion: "25.6.0", probe: canInspectProjectInsertionBin, handler: inspectProjectInsertionBin },
      "project.save": { idempotent: true, minHostVersion: "25.6.0", probe: canSaveProject, handler: saveProject },
      "sequence.createPreset": { destructive: true, undoable: false, requiresWorkspace: true, minHostVersion: "26.3.0", probe: canCreatePresetSequence, handler: createPresetSequence },
      "sequence.range.inspect": { readOnly: true, minHostVersion: "25.6.0", probe: canInspectSequenceRange, handler: inspectSequenceRange },
      "sequence.range.update": { destructive: true, undoable: true, idempotent: true, minHostVersion: "25.6.0", probe: canUpdateSequenceRange, handler: updateSequenceRange },
      "sequence.playhead.inspect": { readOnly: true, minHostVersion: "25.6.0", probe: canInspectSequencePlayhead, handler: inspectSequencePlayhead },
      "sequence.playhead.set": { idempotent: true, minHostVersion: "25.6.0", probe: canSetSequencePlayhead, handler: setSequencePlayhead },
      "sequence.timing.inspect": { readOnly: true, minHostVersion: "25.6.0", probe: canInspectSequenceTiming, handler: inspectSequenceTiming },
      "sequence.timingByGuid.inspect": { readOnly: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canInspectSequenceTimingByGuid, handler: inspectSequenceTimingByGuid },
      "preferences.inspect": { readOnly: true, minHostVersion: "25.6.0", probe: canInspectAppPreferences, handler: inspectAppPreferences },
      "preferences.set": { idempotent: true, minHostVersion: "25.6.0", probe: canSetAppPreferences, handler: setAppPreference },
      "interchange.export": { requiresWorkspace: true, minHostVersion: "26.2.0", probe: canExportInterchange, handler: exportInterchange },
      "interchange.aaf.export": { destructive: true, undoable: false, idempotent: true, requiresWorkspace: true, minHostVersion: "26.3.0", probe: canExportAaf, handler: exportAaf },
      "track.rename": { destructive: true, undoable: true, idempotent: true, minHostVersion: "26.3.0", probe: canRenameTracks, handler: renameTrack },
      "subclip.create": { destructive: true, undoable: true, minHostVersion: "26.3.0", probe: canCreateSubclips, handler: createSubclip },
      "marker.list": { readOnly: true, minHostVersion: "26.3.0", probe: canListMarkers, handler: listMarkers },
      "sourceMonitor.position.set": { idempotent: true, minHostVersion: "26.3.0", probe: canSetSourceMonitorPosition, handler: setSourceMonitorPosition },
      "transcript.languages": { readOnly: true, minHostVersion: "26.3.0", probe: canQueryTranscriptLanguages, handler: transcriptLanguages },
      "objectMask.has": { readOnly: true, minHostVersion: "26.3.0", probe: canInspectObjectMasks, handler: hasObjectMask },
      "encoder.configure": { minHostVersion: "26.3.0", probe: canConfigureEncoder, handler: configureEncoder },
      "frame.export": { requiresWorkspace: true, minHostVersion: "25.6.0", probe: canExportFrame, handler: exportFrame },
      "timeline.selection.lift": { destructive: true, undoable: true, minHostVersion: "25.6.0", probe: canLiftSelection, handler: liftSelection },
      "transition.video.list": { readOnly: true, minHostVersion: "25.6.0", probe: canListTransitions, handler: listTransitions },
      "transition.video.inspect": { readOnly: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canInspectTransitions, handler: inspectTransition },
      "transition.video.add": { destructive: true, undoable: true, idempotent: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canMutateTransitions, handler: addTransition },
      "transition.video.remove": { destructive: true, undoable: true, idempotent: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canMutateTransitions, handler: removeTransition }
    };
    let workflowApi = deps.Workflows || (typeof globalThis !== "undefined" && globalThis.PremiereMcpWorkflows);
    if (!workflowApi && typeof require === "function") workflowApi = require("./workflows.cjs");
    if (workflowApi && typeof workflowApi.createWorkflowDefinitions === "function") {
      Object.assign(definitions, workflowApi.createWorkflowDefinitions({ ppro, Protocol, workspace }));
    }
    let projectItemColorLabelLocksApi = deps.ProjectItemColorLabelLocks || (typeof globalThis !== "undefined" && globalThis.PremiereMcpProjectItemColorLabelLocks);
    if (!projectItemColorLabelLocksApi && typeof require === "function") projectItemColorLabelLocksApi = require("./project-item-color-label-locks.cjs");
    const projectItemColorLabelLocks = projectItemColorLabelLocksApi && typeof projectItemColorLabelLocksApi.createProjectItemColorLabelLocks === "function"
      ? projectItemColorLabelLocksApi.createProjectItemColorLabelLocks()
      : null;
    let advancedWorkflowApi = deps.AdvancedWorkflows || (typeof globalThis !== "undefined" && globalThis.PremiereMcpAdvancedWorkflows);
    if (!advancedWorkflowApi && typeof require === "function") advancedWorkflowApi = require("./advanced-workflows.cjs");
    if (advancedWorkflowApi && typeof advancedWorkflowApi.createAdvancedWorkflowDefinitions === "function") {
      Object.assign(definitions, advancedWorkflowApi.createAdvancedWorkflowDefinitions({
        ppro, Protocol, workspace, events: deps.events, colorLabelLocks: projectItemColorLabelLocks
      }));
    }
    let timelineSourceLabelWorkflowApi = deps.TimelineSourceLabelWorkflows || (typeof globalThis !== "undefined" && globalThis.PremiereMcpTimelineSourceLabelWorkflows);
    if (!timelineSourceLabelWorkflowApi && typeof require === "function") timelineSourceLabelWorkflowApi = require("./timeline-source-label-workflows.cjs");
    if (timelineSourceLabelWorkflowApi && typeof timelineSourceLabelWorkflowApi.createTimelineSourceLabelWorkflowDefinitions === "function") {
      Object.assign(definitions, timelineSourceLabelWorkflowApi.createTimelineSourceLabelWorkflowDefinitions({
        ppro, colorLabelLocks: projectItemColorLabelLocks
      }));
    }
    let trackItemLocksApi = deps.TrackItemMutationLocks || (typeof globalThis !== "undefined" && globalThis.PremiereMcpTrackItemMutationLocks);
    if (!trackItemLocksApi && typeof require === "function") trackItemLocksApi = require("./track-item-mutation-locks.cjs");
    const trackItemLocks = trackItemLocksApi && typeof trackItemLocksApi.createTrackItemMutationLocks === "function"
      ? trackItemLocksApi.createTrackItemMutationLocks()
      : null;
    let slipWorkflowApi = deps.SlipWorkflows || (typeof globalThis !== "undefined" && globalThis.PremiereMcpSlipWorkflows);
    if (!slipWorkflowApi && typeof require === "function") slipWorkflowApi = require("./slip-workflows.cjs");
    if (slipWorkflowApi && typeof slipWorkflowApi.createSlipWorkflowDefinitions === "function") {
      Object.assign(definitions, slipWorkflowApi.createSlipWorkflowDefinitions({ ppro, locks: trackItemLocks }));
    }
    let slideWorkflowApi = deps.SlideWorkflows || (typeof globalThis !== "undefined" && globalThis.PremiereMcpSlideWorkflows);
    if (!slideWorkflowApi && typeof require === "function") slideWorkflowApi = require("./slide-workflows.cjs");
    if (slideWorkflowApi && typeof slideWorkflowApi.createSlideWorkflowDefinitions === "function") {
      Object.assign(definitions, slideWorkflowApi.createSlideWorkflowDefinitions({ ppro, locks: trackItemLocks }));
    }
    let cloneWorkflowApi = deps.CloneWorkflows || (typeof globalThis !== "undefined" && globalThis.PremiereMcpCloneWorkflows);
    if (!cloneWorkflowApi && typeof require === "function") cloneWorkflowApi = require("./clone-workflows.cjs");
    if (cloneWorkflowApi && typeof cloneWorkflowApi.createCloneWorkflowDefinitions === "function") {
      Object.assign(definitions, cloneWorkflowApi.createCloneWorkflowDefinitions({ ppro, locks: trackItemLocks }));
    }
    let rippleDeleteWorkflowApi = deps.RippleDeleteWorkflows || (typeof globalThis !== "undefined" && globalThis.PremiereMcpRippleDeleteWorkflows);
    if (!rippleDeleteWorkflowApi && typeof require === "function") rippleDeleteWorkflowApi = require("./ripple-delete-workflows.cjs");
    if (rippleDeleteWorkflowApi && typeof rippleDeleteWorkflowApi.createRippleDeleteWorkflowDefinitions === "function") {
      Object.assign(definitions, rippleDeleteWorkflowApi.createRippleDeleteWorkflowDefinitions({ ppro, locks: trackItemLocks }));
    }
    let nextWorkflowApi = deps.NextWorkflows || (typeof globalThis !== "undefined" && globalThis.PremiereMcpNextWorkflows);
    if (!nextWorkflowApi && typeof require === "function") nextWorkflowApi = require("./next-workflows.cjs");
    let nextWorkflowRuntime = null;
    if (nextWorkflowApi && typeof nextWorkflowApi.createNextWorkflowRuntime === "function") {
      nextWorkflowRuntime = nextWorkflowApi.createNextWorkflowRuntime({
        ppro, Protocol, workspace, events: deps.events, storage: deps.storage,
        now: deps.now, sleep: deps.sleep, setTimer: deps.setTimer, clearTimer: deps.clearTimer
      });
      Object.assign(definitions, nextWorkflowRuntime.definitions);
    } else if (nextWorkflowApi && typeof nextWorkflowApi.createNextWorkflowDefinitions === "function") {
      Object.assign(definitions, nextWorkflowApi.createNextWorkflowDefinitions({
        ppro, Protocol, workspace, events: deps.events
      }));
    }
    if (typeof deps.transcriptImportHandler === "function") {
      definitions["transcript.import"] = {
        destructive: true,
        undoable: true,
        idempotent: true,
        targetCapabilityProbe: true,
        minHostVersion: "26.3.0",
        probe: typeof deps.transcriptImportProbe === "function" ? deps.transcriptImportProbe : null,
        handler: deps.transcriptImportHandler
      };
    }

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
      if (!definition.readOnly && operationKey && inFlightOperations.has(operationKey)) {
        return { ...await inFlightOperations.get(operationKey), replayed: true };
      }
      const execute = async () => {
        const result = await definition.handler(input);
        return definition.readOnly ? result : {
          operationId: operationId || null,
          outcome: result && result.outcome ? result.outcome : "verified",
          ...result
        };
      };
      if (definition.readOnly || !operationKey) return execute();

      // Reserve the idempotency key before the handler starts so concurrent
      // WebSocket dispatches share one host mutation instead of racing it.
      const pending = Promise.resolve().then(execute);
      inFlightOperations.set(operationKey, pending);
      try {
        const envelope = await pending;
        completedOperations.set(operationKey, envelope);
        if (completedOperations.size > 256) completedOperations.delete(completedOperations.keys().next().value);
        return envelope;
      } finally {
        if (inFlightOperations.get(operationKey) === pending) inFlightOperations.delete(operationKey);
      }
    }
    async function capabilities() {
      let project = null, sequence = null;
      try { project = await ppro.Project.getActiveProject(); sequence = project && await project.getActiveSequence(); } catch (_) {}
      const workspaceState = workspace && typeof workspace.status === "function" ? workspace.status() : {
        configured: false, accessMode: "unavailable", rootName: null, persistent: false,
        pathDisclosure: "redacted", canonicalPathValidation: "unavailable"
      };
      const commands = {};
      for (const name of Object.keys(definitions)) {
        const definition = definitions[name], apiSupported = !definition.probe || await definition.probe();
        const pathValidationSupported = !definition.requiresWorkspace || workspaceState.canonicalPathValidation === "available";
        const supported = apiSupported && pathValidationSupported;
        commands[name] = {
          supported, backend: "uxp", documented: true,
          readOnly: !!definition.readOnly, destructive: !!definition.destructive,
          undoable: !!definition.undoable, idempotent: !!definition.idempotent
        };
        if (definition.minHostVersion) commands[name].minHostVersion = definition.minHostVersion;
        if (definition.requiresWorkspace) commands[name].workspaceRequired = true;
        if (definition.conditionalWorkspace) commands[name].workspaceRequired = "path_variant_only";
        if (definition.targetCapabilityProbe) commands[name].targetCapabilityProbe = "invocation";
        if (!apiSupported) commands[name].reason = "Required Premiere UXP API is unavailable in this host";
        else if (!pathValidationSupported) commands[name].reason = "This UXP host cannot canonically validate native paths; use the CEP fallback for path-based workflows";
      }
      return {
        backend: "uxp", protocolVersion: Protocol.PROTOCOL_VERSION, hostMinVersion: "25.6.0",
        activeProject: !!project, activeSequence: !!sequence, workspace: workspaceState, commands,
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
    async function inspectProjectInsertionBin(args) {
      assertOnlyKeys(args, []);
      const project = await ppro.Project.getActiveProject();
      if (!project) throw commandError("UXP_NO_ACTIVE_PROJECT", "No active project");
      const projectGuid = requiredProjectGuid(project);
      const before = await insertionBinSnapshot(project);
      // The insertion target is panel state that can change while its item
      // properties are read. Resolve both the active project and target again
      // before returning so callers never receive a mixed-project snapshot.
      const currentProject = await ppro.Project.getActiveProject();
      if (!currentProject || requiredProjectGuid(currentProject) !== projectGuid) {
        throw commandError("UXP_STALE_PROJECT", "The active project changed while reading the insertion bin; retry the inspection");
      }
      const insertionBin = await insertionBinSnapshot(currentProject);
      if (before.projectItemId !== insertionBin.projectItemId) {
        throw commandError("UXP_STALE_INSERTION_BIN", "The Project-panel insertion bin changed while reading it; retry the inspection");
      }
      return { projectGuid, insertionBin, verificationBoundary: "project_insertion_bin_identity_readback" };
    }
    async function insertionBinSnapshot(project) {
      if (typeof project.getInsertionBin !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere does not expose the Project-panel insertion bin");
      }
      const item = await project.getInsertionBin();
      if (!item || typeof item.getId !== "function") {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not return an identifiable insertion bin");
      }
      const projectItemId = await item.getId();
      if (typeof projectItemId !== "string" || !projectItemId.trim() || projectItemId.length > 512) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not return a valid insertion-bin project-item ID");
      }
      const name = String(item.name == null ? "" : item.name);
      if (name.length > 1024) throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned an oversized insertion-bin name");
      const type = Number(item.type);
      if (!Number.isInteger(type) || type < 0 || type > 1024) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not return a valid insertion-bin item type");
      }
      return { projectItemId, name, type };
    }
    function requiredProjectGuid(project) {
      const guid = stringifyGuid(project && project.guid);
      if (!guid || guid.length > 512) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not return a valid active-project GUID");
      return guid;
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
      const name = requiredString(args.name, "name"), presetPath = await allowedPath(args.presetPath, "presetPath", "file");
      const project = await ppro.Project.getActiveProject();
      if (!project) throw commandError("UXP_NO_ACTIVE_PROJECT", "No active project");
      const sequence = await project.createSequenceWithPresetPath(name, presetPath);
      if (!sequence) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not return the created sequence");
      const verified = Array.from(await project.getSequences() || []).some((item) => String(item.guid || "") === String(sequence.guid || ""));
      if (!verified) throw commandError("UXP_VERIFICATION_FAILED", "Created sequence was not present in the project");
      return { created: true, outcome: "verified", sequence: { guid: String(sequence.guid || ""), name: String(sequence.name || name) } };
    }
    async function inspectSequenceRange(args) {
      assertOnlyKeys(args, []);
      const context = await activeContext(false);
      return {
        ...await sequenceRangeSnapshot(context.sequence),
        verificationBoundary: "sequence_range_readback"
      };
    }
    async function updateSequenceRange(args) {
      const input = validateSequenceRangeUpdateArgs(args);
      // TickTime construction can cross the host boundary. Do it before the
      // per-sequence exclusion scope so the guarded snapshot is the final
      // asynchronous preflight step before action creation.
      const ticks = {
        inPoint: input.updates.inSeconds == null ? null : await tickTime(input.updates.inSeconds, "updates.inSeconds"),
        outPoint: input.updates.outSeconds == null ? null : await tickTime(input.updates.outSeconds, "updates.outSeconds"),
        zeroPoint: input.updates.zeroPointSeconds == null ? null : await tickTime(input.updates.zeroPointSeconds, "updates.zeroPointSeconds")
      };
      return withSequenceRangeUpdateLock(input.expectedSequenceGuid, async () => {
        const context = await activeContext(true);
        const before = await sequenceRangeSnapshot(context.sequence);
        if (before.sequenceGuid !== input.expectedSequenceGuid) {
          throw commandError("UXP_STALE_SEQUENCE", "The active sequence changed before the range update; inspect the current range and retry");
        }
        assertExpectedSequenceRange(before.range, input.expectedRange);
        const desired = { ...before.range, ...input.updates };
        assertValidSequenceRange(desired, "requested sequence range");
        let committed = false;
        context.project.lockedAccess(() => {
          committed = context.project.executeTransaction((compoundAction) => {
            if (ticks.inPoint) {
              const action = context.sequence.createSetInPointAction(ticks.inPoint);
              if (!action || compoundAction.addAction(action) === false) {
                throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the sequence in point action");
              }
            }
            if (ticks.outPoint) {
              const action = context.sequence.createSetOutPointAction(ticks.outPoint);
              if (!action || compoundAction.addAction(action) === false) {
                throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the sequence out point action");
              }
            }
            if (ticks.zeroPoint) {
              const action = context.sequence.createSetZeroPointAction(ticks.zeroPoint);
              if (!action || compoundAction.addAction(action) === false) {
                throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the sequence zero point action");
              }
            }
          }, "Update sequence range");
        });
        assertTransactionCommitted(committed, "sequence range update");
        const after = await sequenceRangeSnapshot(context.sequence);
        if (after.sequenceGuid !== before.sequenceGuid || !sameSequenceRange(after.range, desired)) {
          throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not retain the requested sequence range");
        }
        return {
          updated: true,
          outcome: "verified",
          sequenceGuid: after.sequenceGuid,
          range: after.range,
          verified: "sequence_range_readback",
          operation: operationSemantics({
            mutatesProject: true,
            verificationStatus: "verified",
            verificationBoundary: "sequence_range_readback",
            verificationEvidence: [{ type: "sequence_range", sequenceGuid: after.sequenceGuid, range: after.range }],
            undoSupported: true,
            undoLabel: "Update sequence range",
            transactionActionGroup: true,
            cancellationSupported: false
          })
        };
      });
    }
    function withSequenceRangeUpdateLock(sequenceGuid, operation) {
      const previous = sequenceRangeUpdateTails.get(sequenceGuid) || Promise.resolve();
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const tail = previous.catch(() => undefined).then(() => gate);
      sequenceRangeUpdateTails.set(sequenceGuid, tail);
      return previous.catch(() => undefined).then(operation).finally(() => {
        release();
        if (sequenceRangeUpdateTails.get(sequenceGuid) === tail) sequenceRangeUpdateTails.delete(sequenceGuid);
      });
    }
    async function inspectSequencePlayhead(args) {
      assertOnlyKeys(args, []);
      const context = await activeContext(false);
      return {
        ...await sequencePlayheadSnapshot(context.sequence),
        verificationBoundary: "sequence_playhead_readback"
      };
    }
    async function inspectSequenceTiming(args) {
      assertOnlyKeys(args, []);
      const context = await activeContext(false);
      const snapshot = await sequenceTimingSnapshot(context.sequence);
      // Every timing field is a native asynchronous read. Re-resolve the active
      // sequence after that read set so the returned snapshot belongs to the
      // same active sequence at both the start and end of this request. The
      // documented API does not provide an atomic snapshot or an activation
      // revision, so a transient switch back to the same sequence is not
      // distinguishable from an unchanged active sequence.
      const current = await activeContext(false);
      if (sequenceGuidRequired(current.sequence) !== snapshot.sequenceGuid) {
        throw commandError("UXP_STALE_SEQUENCE", "The active sequence no longer matches the timing snapshot; retry the inspection");
      }
      return { ...snapshot, verificationBoundary: "sequence_timing_readback" };
    }
    async function inspectSequenceTimingByGuid(args) {
      assertOnlyKeys(args, ["sequenceGuid"]);
      const requestedSequenceGuid = sequenceGuidArgument(args.sequenceGuid, "sequenceGuid");
      const project = await ppro.Project.getActiveProject();
      if (!project) throw commandError("UXP_NO_ACTIVE_PROJECT", "No active project");
      if (typeof project.getSequence !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere cannot resolve a sequence by GUID");
      }
      const projectGuid = requiredProjectGuid(project);
      const firstSequence = await project.getSequence(requestedSequenceGuid.native);
      if (!firstSequence) throw commandError("UXP_TARGET_NOT_FOUND", "sequenceGuid was not found in the active project");
      const first = await sequenceTimingSnapshot(firstSequence);
      if (first.sequenceGuid !== requestedSequenceGuid.text) {
        throw commandError("UXP_STALE_SEQUENCE", "The requested sequence GUID did not match Premiere's resolved sequence");
      }
      // Re-resolve the active project and the requested sequence after every
      // asynchronous timing read. Project.getSequence() is the documented
      // targeted lookup; it avoids activating a different timeline just to
      // inspect it. Premiere exposes no atomic sequence-timing snapshot, so
      // require a complete second equal read rather than returning a mixed
      // first snapshot when the target changes during inspection.
      const currentProject = await ppro.Project.getActiveProject();
      if (!currentProject || requiredProjectGuid(currentProject) !== projectGuid ||
        typeof currentProject.getSequence !== "function") {
        throw commandError("UXP_STALE_PROJECT", "The active project changed while reading the target sequence; retry the inspection");
      }
      const finalSequence = await currentProject.getSequence(requestedSequenceGuid.native);
      if (!finalSequence) throw commandError("UXP_STALE_SEQUENCE", "The requested sequence changed or was removed while reading it; retry the inspection");
      const final = await sequenceTimingSnapshot(finalSequence);
      if (final.sequenceGuid !== requestedSequenceGuid.text || !sameSequenceTimingSnapshot(first, final)) {
        throw commandError("UXP_STALE_SEQUENCE", "The requested sequence timing changed while reading it; retry the inspection");
      }
      return {
        ...final,
        projectGuid,
        requestedSequenceGuid: requestedSequenceGuid.text,
        verificationBoundary: "targeted_sequence_timing_double_readback"
      };
    }
    async function setSequencePlayhead(args) {
      const input = validateSequencePlayheadSetArgs(args);
      // TickTime construction can cross the host boundary. Construct it before
      // the per-sequence exclusion scope so the guarded snapshot is the final
      // asynchronous preflight step before the host setter is invoked.
      const position = await tickTime(input.positionSeconds, "positionSeconds");
      return withSequencePlayheadSetLock(input.expectedSequenceGuid, async () => {
        const context = await activeContext(false);
        const before = await sequencePlayheadSnapshot(context.sequence);
        if (before.sequenceGuid !== input.expectedSequenceGuid) {
          throw commandError("UXP_STALE_SEQUENCE", "The active sequence changed before the player position was set; inspect the current playhead and retry");
        }
        if (!sameSeconds(before.positionSeconds, input.expectedPositionSeconds)) {
          throw commandError("UXP_STALE_PLAYHEAD", "The sequence player position changed before it was set; inspect the current playhead and retry");
        }
        const accepted = await context.sequence.setPlayerPosition(position);
        if (accepted !== true) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not confirm the sequence player position");
        // Re-resolve the active sequence for postcondition readback: a user can
        // switch sequences while Premiere awaits the host setter.
        const after = await sequencePlayheadSnapshot((await activeContext(false)).sequence);
        if (after.sequenceGuid !== before.sequenceGuid || !sameSeconds(after.positionSeconds, input.positionSeconds)) {
          throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not retain the requested sequence player position");
        }
        return {
          positioned: true,
          outcome: "verified",
          sequenceGuid: after.sequenceGuid,
          positionSeconds: after.positionSeconds,
          verified: "sequence_playhead_readback",
          operation: operationSemantics({
            mutatesProject: false,
            verificationStatus: "verified",
            verificationBoundary: "sequence_playhead_readback",
            verificationEvidence: [{ type: "sequence_playhead", sequenceGuid: after.sequenceGuid, positionSeconds: after.positionSeconds }],
            undoSupported: false,
            cancellationSupported: false
          })
        };
      });
    }
    function withSequencePlayheadSetLock(sequenceGuid, operation) {
      const previous = sequencePlayheadSetTails.get(sequenceGuid) || Promise.resolve();
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const tail = previous.catch(() => undefined).then(() => gate);
      sequencePlayheadSetTails.set(sequenceGuid, tail);
      return previous.catch(() => undefined).then(operation).finally(() => {
        release();
        if (sequencePlayheadSetTails.get(sequenceGuid) === tail) sequencePlayheadSetTails.delete(sequenceGuid);
      });
    }
    function inspectAppPreferences(args) {
      assertOnlyKeys(args, []);
      return {
        preferences: Object.keys(APP_PREFERENCE_KEYS).map((preference) => appPreferenceSnapshot(preference)),
        verificationBoundary: "app_preference_native_string_readback"
      };
    }
    function setAppPreference(args) {
      const input = validateAppPreferenceSetArgs(args);
      return withAppPreferenceSetLock(input.preference, () => {
        const before = appPreferenceSnapshot(input.preference);
        if (before.value !== input.expectedValue) {
          throw commandError("UXP_STALE_APP_PREFERENCE", "The app preference changed before it was set; inspect current preferences and retry");
        }
        const persistenceFlag = ppro.AppPreference[input.persistence === "persistent" ? "PROPERTY_PERSISTENT" : "PROPERTY_NON_PERSISTENT"];
        const accepted = ppro.AppPreference.setValue(preferenceNativeKey(input.preference), input.value, persistenceFlag);
        if (accepted !== true) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the app preference update");
        const after = appPreferenceSnapshot(input.preference);
        if (after.value !== input.value) {
          throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not retain the requested app preference value");
        }
        return {
          updated: true,
          outcome: "verified",
          preference: input.preference,
          beforeValue: before.value,
          value: after.value,
          persistence: input.persistence,
          verified: "app_preference_native_string_readback",
          operation: operationSemantics({
            // Adobe exposes AppPreference as application state, not a project
            // action or transaction. Do not claim project mutation or Undo.
            mutatesProject: false,
            verificationStatus: "verified",
            verificationBoundary: "app_preference_native_string_readback",
            verificationEvidence: [{ type: "app_preference", preference: input.preference, beforeValue: before.value, value: after.value, persistence: input.persistence }],
            undoSupported: false,
            cancellationSupported: false
          })
        };
      });
    }
    function appPreferenceSnapshot(preference) {
      const value = ppro.AppPreference.getValue(preferenceNativeKey(preference));
      if (typeof value !== "string" || value.length > MAX_APP_PREFERENCE_VALUE_CHARS) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not return a bounded native string app preference value");
      }
      return { preference, value };
    }
    function preferenceNativeKey(preference) {
      const property = APP_PREFERENCE_KEYS[preference], value = property && ppro.AppPreference && ppro.AppPreference[property];
      if (typeof value !== "string" || !value) throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build does not expose the requested app preference key");
      return value;
    }
    function withAppPreferenceSetLock(preference, operation) {
      const previous = appPreferenceSetTails.get(preference) || Promise.resolve();
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const tail = previous.catch(() => undefined).then(() => gate);
      appPreferenceSetTails.set(preference, tail);
      return previous.catch(() => undefined).then(operation).finally(() => {
        release();
        if (appPreferenceSetTails.get(preference) === tail) appPreferenceSetTails.delete(preference);
      });
    }
    async function exportInterchange(args) {
      assertOnlyKeys(args, ["format", "outputFilePath", "suppressUI", "operationId"]);
      const format = requiredString(args.format, "format"), outputFilePath = await allowedPath(args.outputFilePath, "outputFilePath", "file");
      if (format !== "otio" && format !== "fcpxml") throw commandError("UXP_INVALID_ARGUMENT", "format must be otio or fcpxml");
      const context = await activeContext(false);
      const method = format === "otio" ? "exportAsOpenTimelineIO" : "exportAsFinalCutProXML";
      const exported = await ppro.ProjectConverter[method](context.sequence, outputFilePath, args.suppressUI !== false);
      if (!exported) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not confirm the interchange export");
      return { exported: true, outcome: "verified", format, outputFilePath };
    }
    async function exportAaf(args) {
      const input = validateAafArgs(args);
      input.outputFilePath = await allowedPath(input.outputFilePath, "outputFilePath", "file");
      if (input.options.videoMixdownPresetPath != null) {
        input.options.videoMixdownPresetPath = await allowedPath(input.options.videoMixdownPresetPath, "videoMixdownPresetPath", "file");
      }
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
      for (let i = 0; i < source.length; i += 1) markers.push(await markerSnapshot(source[i], input.includeWebLinks));
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
    async function sequenceRangeSnapshot(sequence) {
      const sequenceGuid = String(sequence && sequence.guid || "");
      if (!sequenceGuid) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not provide a stable active-sequence GUID");
      const [inPoint, outPoint, zeroPoint, endPoint] = await Promise.all([
        sequence.getInPoint(), sequence.getOutPoint(), sequence.getZeroPoint(), sequence.getEndTime()
      ]);
      const range = {
        inSeconds: tickSecondsRequired(inPoint, "sequence in point"),
        outSeconds: tickSecondsRequired(outPoint, "sequence out point"),
        zeroPointSeconds: tickSecondsRequired(zeroPoint, "sequence zero point"),
        endSeconds: tickSecondsRequired(endPoint, "sequence end point")
      };
      assertValidSequenceRange(range, "Premiere sequence range");
      return { sequenceGuid, range };
    }
    async function sequencePlayheadSnapshot(sequence) {
      const sequenceGuid = sequenceGuidRequired(sequence);
      return {
        sequenceGuid,
        positionSeconds: tickSecondsRequired(await sequence.getPlayerPosition(), "sequence player position")
      };
    }
    async function sequenceTimingSnapshot(sequence) {
      const sequenceGuid = sequenceGuidRequired(sequence);
      const [frameSize, timebase, audioDisplay, videoDisplay, projectItem] = await Promise.all([
        sequence.getFrameSize(),
        sequence.getTimebase(),
        sequence.getSequenceAudioTimeDisplayFormat(),
        sequence.getSequenceVideoTimeDisplayFormat(),
        sequence.getProjectItem()
      ]);
      if (!projectItem || typeof projectItem.getId !== "function") {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not return an identifiable sequence project item");
      }
      const projectItemId = await projectItem.getId();
      if (typeof projectItemId !== "string" || !projectItemId.trim() || projectItemId.length > 512) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not return a valid sequence project-item ID");
      }
      return {
        sequenceGuid,
        sequenceName: snapshotString(sequence.name, "sequence name", 255),
        frameSize: frameSizeSnapshot(frameSize),
        timebase: timebaseSnapshot(timebase),
        audioTimeDisplayFormat: timeDisplaySnapshot(audioDisplay, "sequence audio time display format"),
        videoTimeDisplayFormat: timeDisplaySnapshot(videoDisplay, "sequence video time display format"),
        projectItem: {
          id: projectItemId,
          name: snapshotString(projectItem.name, "sequence project-item name", 255)
        }
      };
    }
    function sequenceGuidRequired(sequence) {
      const rawGuid = sequence && sequence.guid;
      const isStringGuid = typeof rawGuid === "string";
      const isGuidObject = rawGuid && typeof rawGuid === "object" &&
        typeof rawGuid.toString === "function" && rawGuid.toString !== Object.prototype.toString;
      if (!isStringGuid && !isGuidObject) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not provide a stable active-sequence GUID");
      }
      let sequenceGuid;
      try { sequenceGuid = isStringGuid ? rawGuid : rawGuid.toString(); } catch (_) { sequenceGuid = ""; }
      if (typeof sequenceGuid !== "string" || !sequenceGuid.trim() || sequenceGuid !== sequenceGuid.trim() || sequenceGuid.length > 512) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not provide a stable active-sequence GUID");
      }
      return sequenceGuid;
    }
    function sequenceGuidArgument(value, name) {
      if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 512) {
        throw commandError("UXP_INVALID_ARGUMENT", name + " is required and must be a bounded GUID string");
      }
      if (!ppro.Guid || typeof ppro.Guid.fromString !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere cannot parse sequence GUIDs");
      }
      let native;
      try { native = ppro.Guid.fromString(value); } catch (_) {
        throw commandError("UXP_INVALID_ARGUMENT", name + " is not a valid Premiere GUID");
      }
      if (!native) throw commandError("UXP_INVALID_ARGUMENT", name + " is not a valid Premiere GUID");
      return { text: value, native };
    }
    function sameSequenceTimingSnapshot(left, right) {
      return left && right &&
        left.sequenceGuid === right.sequenceGuid &&
        left.sequenceName === right.sequenceName &&
        left.timebase === right.timebase &&
        left.frameSize && right.frameSize &&
        left.frameSize.width === right.frameSize.width && left.frameSize.height === right.frameSize.height &&
        left.audioTimeDisplayFormat && right.audioTimeDisplayFormat &&
        left.audioTimeDisplayFormat.type === right.audioTimeDisplayFormat.type &&
        left.videoTimeDisplayFormat && right.videoTimeDisplayFormat &&
        left.videoTimeDisplayFormat.type === right.videoTimeDisplayFormat.type &&
        left.projectItem && right.projectItem &&
        left.projectItem.id === right.projectItem.id && left.projectItem.name === right.projectItem.name;
    }
    function frameSizeSnapshot(value) {
      if (!value || typeof value.width !== "number" || typeof value.height !== "number" ||
        !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) ||
        value.width < 1 || value.height < 1 ||
        value.width > MAX_SEQUENCE_FRAME_WIDTH || value.height > MAX_SEQUENCE_FRAME_HEIGHT) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not return a valid sequence frame size");
      }
      return { width: value.width, height: value.height };
    }
    function timebaseSnapshot(value) {
      if (typeof value !== "string" || !new RegExp("^[1-9]\\d{0," + (MAX_SEQUENCE_TIMEBASE_DIGITS - 1) + "}$").test(value)) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not return a valid sequence timebase");
      }
      return value;
    }
    function timeDisplaySnapshot(value, name) {
      if (!value || typeof value.type !== "number" || !Number.isSafeInteger(value.type) || value.type < 0) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not return a valid " + name);
      }
      return { type: value.type };
    }
    function snapshotString(value, name, maximum) {
      if (typeof value !== "string" || !value.trim() || value.length > maximum) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not return a valid " + name);
      }
      return value;
    }
    function validateSequenceRangeUpdateArgs(args) {
      assertObject(args);
      assertOnlyKeys(args, ["expectedSequenceGuid", "expectedRange", "updates", "operationId"]);
      if (typeof args.expectedSequenceGuid !== "string" || !args.expectedSequenceGuid || args.expectedSequenceGuid.length > 512) {
        throw commandError("UXP_INVALID_ARGUMENT", "expectedSequenceGuid is required and must be at most 512 characters");
      }
      const expectedRange = validateExpectedSequenceRange(args.expectedRange, "expectedRange");
      const updates = validateSequenceRangeUpdates(args.updates);
      if (updates.inSeconds == null && updates.outSeconds == null && updates.zeroPointSeconds == null) {
        throw commandError("UXP_INVALID_ARGUMENT", "updates must include at least one sequence range field");
      }
      return { expectedSequenceGuid: args.expectedSequenceGuid, expectedRange, updates };
    }
    function validateSequencePlayheadSetArgs(args) {
      assertObject(args);
      assertOnlyKeys(args, ["expectedSequenceGuid", "expectedPositionSeconds", "positionSeconds", "operationId"]);
      if (typeof args.expectedSequenceGuid !== "string" || !args.expectedSequenceGuid || args.expectedSequenceGuid.length > 512) {
        throw commandError("UXP_INVALID_ARGUMENT", "expectedSequenceGuid is required and must be at most 512 characters");
      }
      return {
        expectedSequenceGuid: args.expectedSequenceGuid,
        expectedPositionSeconds: boundedSeconds(args.expectedPositionSeconds, "expectedPositionSeconds"),
        positionSeconds: boundedSeconds(args.positionSeconds, "positionSeconds")
      };
    }
    function validateExpectedSequenceRange(value, name) {
      assertObject(value);
      assertOnlyKeys(value, ["inSeconds", "outSeconds", "zeroPointSeconds", "endSeconds"]);
      const result = {};
      for (const key of ["inSeconds", "outSeconds", "zeroPointSeconds", "endSeconds"]) {
        if (value[key] == null) {
          throw commandError("UXP_INVALID_ARGUMENT", name + "." + key + " is required");
        }
        result[key] = boundedSeconds(value[key], name + "." + key);
      }
      return result;
    }
    function validateSequenceRangeUpdates(value) {
      assertObject(value);
      assertOnlyKeys(value, ["inSeconds", "outSeconds", "zeroPointSeconds"]);
      const result = {};
      for (const key of ["inSeconds", "outSeconds", "zeroPointSeconds"]) {
        if (value[key] != null) result[key] = boundedSeconds(value[key], "updates." + key);
      }
      return result;
    }
    function assertExpectedSequenceRange(actual, expected) {
      if (!sameSeconds(actual.inSeconds, expected.inSeconds) || !sameSeconds(actual.outSeconds, expected.outSeconds) ||
        !sameSeconds(actual.zeroPointSeconds, expected.zeroPointSeconds) || !sameSeconds(actual.endSeconds, expected.endSeconds)) {
        throw commandError("UXP_STALE_RANGE", "The sequence range changed before the update; inspect the current range and retry");
      }
    }
    function assertValidSequenceRange(range, name) {
      const inSeconds = boundedSeconds(range.inSeconds, name + ".inSeconds");
      const outSeconds = boundedSeconds(range.outSeconds, name + ".outSeconds");
      const endSeconds = boundedSeconds(range.endSeconds, name + ".endSeconds");
      boundedSeconds(range.zeroPointSeconds, name + ".zeroPointSeconds");
      if (inSeconds > outSeconds || outSeconds > endSeconds) {
        throw commandError("UXP_INVALID_ARGUMENT", name + " must satisfy inSeconds <= outSeconds <= endSeconds");
      }
    }
    function sameSequenceRange(actual, expected) {
      return sameSeconds(actual.inSeconds, expected.inSeconds) && sameSeconds(actual.outSeconds, expected.outSeconds) &&
        sameSeconds(actual.zeroPointSeconds, expected.zeroPointSeconds) && sameSeconds(actual.endSeconds, expected.endSeconds);
    }
    function sameSeconds(left, right) {
      return typeof left === "number" && typeof right === "number" && Math.abs(left - right) <= 0.000001;
    }
    function tickSecondsRequired(value, name) {
      if (!value || typeof value.seconds !== "number" || !Number.isFinite(value.seconds) || value.seconds < 0) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not return a valid " + name);
      }
      return value.seconds;
    }
    function boundedSeconds(value, name) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 86400) {
        throw commandError("UXP_INVALID_ARGUMENT", name + " must be a finite number from 0 through 86400");
      }
      return value;
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
      const outputDirectory = await allowedPath(args.outputDirectory, "outputDirectory", "directory");
      const filename = Protocol.safeFilename(args.filename);
      const exporterFilename = Protocol.exporterFrameName(filename);
      const position = args.seconds == null ? await context.sequence.getPlayerPosition() : await tickTime(args.seconds, "seconds");
      const size = await context.sequence.getFrameSize();
      const width = positiveInt(args.width, size.width, "width"), height = positiveInt(args.height, size.height, "height");
      const returned = await ppro.Exporter.exportSequenceFrame(context.sequence, position, exporterFilename, outputDirectory, width, height);
      if (returned !== true) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not confirm frame export; no output path is reported");
      const path = Protocol.joinPath(outputDirectory, filename);
      return { path, width, height, seconds: position.seconds, exporterResult: returned };
    }
    async function liftSelection(args) {
      const input = validateLiftArgs(args), context = await activeContext(true);
      const sequenceGuid = String(context.sequence.guid || "");
      if (input.expectedSequenceGuid && input.expectedSequenceGuid !== sequenceGuid) {
        throw commandError("UXP_STALE_SEQUENCE", "The active sequence changed before the lift request; inspect the project and retry with its current sequence GUID");
      }
      const selection = await context.sequence.getSelection();
      if (!selection || typeof selection.getTrackItems !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build does not expose timeline item selection for UXP lift");
      }
      const selectedItems = Array.from(await selection.getTrackItems() || []);
      if (!selectedItems.length) throw commandError("UXP_INVALID_ARGUMENT", "Select one or more timeline items before requesting a lift");
      const editor = await ppro.SequenceEditor.getEditor(context.sequence);
      const mediaType = ppro.Constants && ppro.Constants.MediaType && ppro.Constants.MediaType.ANY;
      if (!editor || typeof editor.createRemoveItemsAction !== "function" || mediaType == null) {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build does not expose the documented SequenceEditor lift action");
      }
      let committed = false;
      context.project.lockedAccess(() => {
        const action = editor.createRemoveItemsAction(selection, false, mediaType, false);
        committed = context.project.executeTransaction((compoundAction) => {
          if (!action || compoundAction.addAction(action) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the selection lift action");
        }, "Lift selected timeline items");
      });
      assertTransactionCommitted(committed, "selection lift");
      return {
        lifted: true, selectedItemCount: selectedItems.length, ripple: false, outcome: "committed_unverified",
        verificationBoundary: "project_executeTransaction_return",
        operation: operationSemantics({
          mutatesProject: true, verificationStatus: "not_verified", verificationBoundary: "project_executeTransaction_return",
          verificationEvidence: [{ type: "transaction", accepted: true, selectedItemCount: selectedItems.length }],
          undoSupported: true, undoLabel: "Lift selected timeline items", transactionActionGroup: true, cancellationSupported: true
        })
      };
    }
    async function listTransitions() {
      const matchNames = await currentVideoTransitionMatchNames();
      return { matchNames, count: matchNames.length };
    }
    async function inspectTransition(args) {
      const input = validateInspectTransitionArgs(args), context = await activeContext(false);
      return {
        target: await transitionTargetSnapshot(context.sequence, input.videoTrackIndex, input.clipIndex, input.position),
        verificationBoundary: "video_transition_target_readback"
      };
    }
    async function addTransition(args) {
      const input = validateAddArgs(args);
      const duration = input.durationSeconds == null ? null : await tickTime(input.durationSeconds, "durationSeconds");
      return withTransitionUpdateLock(input.expectedTarget.sequenceGuid, async () => {
        const context = await guardedTransitionContext(input), target = context.target;
        if (context.before.transitionPresent) {
          throw commandError("UXP_STALE_TRANSITION_TARGET", "A transition is already present at the requested edge; inspect and retry");
        }
        const available = await currentVideoTransitionMatchNames();
        if (!available.includes(input.matchName) && !listedVideoTransitionMatchNames.has(input.matchName)) {
          throw commandError("UXP_TRANSITION_NOT_FOUND", "Unknown video transition matchName: " + input.matchName);
        }
        const transition = await ppro.TransitionFactory.createVideoTransition(input.matchName);
        if (!transition) throw commandError("UXP_TRANSITION_NOT_FOUND", "Premiere could not create video transition: " + input.matchName);
        const options = ppro.AddTransitionOptions();
        options.setApplyToStart(input.position === "start");
        if (duration) options.setDuration(duration);
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
        const after = await transitionTargetSnapshot(context.sequence, input.videoTrackIndex, input.clipIndex, input.position);
        if (!after.transitionPresent) throw commandError("UXP_VERIFICATION_FAILED", "Premiere committed the transition transaction but no transition is present at the requested edge");
        return verifiedTransitionResult(true, input, after, "Add video transition");
      });
    }
    async function currentVideoTransitionMatchNames() {
      const matchNames = Array.from(await ppro.TransitionFactory.getVideoTransitionMatchNames() || []);
      for (let i = 0; i < matchNames.length; i += 1) {
        if (typeof matchNames[i] === "string" && matchNames[i]) listedVideoTransitionMatchNames.add(matchNames[i]);
      }
      return matchNames;
    }
    async function removeTransition(args) {
      const input = validateRemoveArgs(args);
      return withTransitionUpdateLock(input.expectedTarget.sequenceGuid, async () => {
        const context = await guardedTransitionContext(input), target = context.target;
        if (!context.before.transitionPresent) {
          throw commandError("UXP_STALE_TRANSITION_TARGET", "No transition is present at the requested edge; inspect and retry");
        }
        let committed = false;
        context.project.lockedAccess(() => {
          const action = target.createRemoveVideoTransitionAction(context.positionValue);
          committed = context.project.executeTransaction((compoundAction) => {
            if (!action || compoundAction.addAction(action) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the transition action");
          }, "Remove video transition");
        });
        assertTransactionCommitted(committed, "transition removal");
        const after = await transitionTargetSnapshot(context.sequence, input.videoTrackIndex, input.clipIndex, input.position);
        if (after.transitionPresent) throw commandError("UXP_VERIFICATION_FAILED", "Premiere committed the transition transaction but the requested edge is still occupied");
        return verifiedTransitionResult(false, input, after, "Remove video transition");
      });
    }
    async function guardedTransitionContext(input) {
      const context = await activeContext(true), sequenceGuid = String(context.sequence.guid || "");
      if (!sequenceGuid || sequenceGuid !== input.expectedTarget.sequenceGuid) {
        throw commandError("UXP_STALE_SEQUENCE", "The active sequence changed before the transition update; inspect and retry");
      }
      const positionValue = transitionPositionValue(input.position);
      const target = await videoClipAt(context.sequence, input.videoTrackIndex, input.clipIndex);
      const before = await transitionTargetSnapshot(context.sequence, input.videoTrackIndex, input.clipIndex, input.position, target, positionValue);
      assertExpectedTransitionTarget(before, input.expectedTarget);
      return { ...context, target, before, positionValue };
    }
    async function transitionTargetSnapshot(sequence, videoTrackIndex, clipIndex, position, target, positionValue) {
      const item = target || await videoClipAt(sequence, videoTrackIndex, clipIndex);
      const edge = positionValue == null ? transitionPositionValue(position) : positionValue;
      if (typeof item.getProjectItem !== "function" || typeof item.getStartTime !== "function" || typeof item.getEndTime !== "function" || typeof item.hasVideoTransition !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build cannot read a complete video-transition target snapshot");
      }
      const projectItem = await item.getProjectItem();
      if (!projectItem || typeof projectItem.getId !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build cannot identify the selected video clip");
      const projectItemId = await projectItem.getId();
      const startSeconds = tickSecondsRequired(await item.getStartTime(), "video transition target start"), endSeconds = tickSecondsRequired(await item.getEndTime(), "video transition target end");
      if (typeof projectItemId !== "string" || !projectItemId || endSeconds < startSeconds) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not return a complete video-transition target snapshot");
      }
      const transitionPresent = await item.hasVideoTransition(edge);
      if (typeof transitionPresent !== "boolean") throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not return a boolean video-transition edge state");
      const sequenceGuid = String(sequence && sequence.guid || "");
      if (!sequenceGuid) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not provide a stable active-sequence GUID");
      return { sequenceGuid, videoTrackIndex, clipIndex, projectItemId, startSeconds, endSeconds, position, transitionPresent };
    }
    function transitionPositionValue(position) {
      const positions = ppro.Constants && ppro.Constants.TransitionPosition, value = positions && positions[String(position).toUpperCase()];
      if (value == null) throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere transition position constants are unavailable");
      return value;
    }
    function assertExpectedTransitionTarget(actual, expected) {
      if (actual.sequenceGuid !== expected.sequenceGuid || actual.videoTrackIndex !== expected.videoTrackIndex || actual.clipIndex !== expected.clipIndex ||
        actual.projectItemId !== expected.projectItemId || !sameSeconds(actual.startSeconds, expected.startSeconds) || !sameSeconds(actual.endSeconds, expected.endSeconds) ||
        actual.position !== expected.position || actual.transitionPresent !== expected.transitionPresent) {
        throw commandError("UXP_STALE_TRANSITION_TARGET", "The video-transition target changed before the update; inspect and retry");
      }
    }
    function verifiedTransitionResult(applied, input, target, undoLabel) {
      return {
        ...(applied ? { applied: true, matchName: input.matchName } : { removed: true }),
        outcome: "verified", verified: "video_transition_edge_readback", target,
        operation: operationSemantics({
          mutatesProject: true, verificationStatus: "verified", verificationBoundary: "video_transition_edge_readback",
          verificationEvidence: [{ type: "video_transition_edge", target }], undoSupported: true,
          undoLabel, transactionActionGroup: true, cancellationSupported: false
        })
      };
    }
    function withTransitionUpdateLock(sequenceGuid, operation) {
      const previous = transitionUpdateTails.get(sequenceGuid) || Promise.resolve();
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const tail = previous.catch(() => undefined).then(() => gate);
      transitionUpdateTails.set(sequenceGuid, tail);
      return previous.catch(() => undefined).then(operation).finally(() => {
        release();
        if (transitionUpdateTails.get(sequenceGuid) === tail) transitionUpdateTails.delete(sequenceGuid);
      });
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
    async function markerSnapshot(marker, includeWebLinks) {
      const start = await marker.getStart(), duration = await marker.getDuration();
      const snapshot = {
        guid: stringifyGuid(marker.guid), name: String(await marker.getName() || ""),
        comments: String(await marker.getComments() || ""), type: String(await marker.getType() || ""),
        colorIndex: await marker.getColorIndex(), startSeconds: tickSeconds(start), durationSeconds: tickSeconds(duration)
      };
      if (includeWebLinks) {
        snapshot.url = await optionalMarkerString(marker, "getUrl");
        snapshot.target = await optionalMarkerString(marker, "getTarget");
      }
      return snapshot;
    }
    async function optionalMarkerString(marker, method) {
      if (!marker || typeof marker[method] !== "function") return null;
      const value = await marker[method]();
      return value == null ? "" : String(value);
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
    async function allowedPath(value, label, kind) {
      const path = requiredString(value, label);
      return workspace && typeof workspace.assertPathAllowed === "function"
        ? await workspace.assertPathAllowed(path, { label, kind })
        : path;
    }
    function canExportFrame() { return !!(ppro.Exporter && typeof ppro.Exporter.exportSequenceFrame === "function"); }
    function canLiftSelection() {
      return !!(ppro.SequenceEditor && typeof ppro.SequenceEditor.getEditor === "function" &&
        ppro.Constants && ppro.Constants.MediaType && ppro.Constants.MediaType.ANY != null) && activeSequenceHas(["getSelection"]);
    }
    function canInspectProject() { return !!(ppro.Project && typeof ppro.Project.getActiveProject === "function"); }
    async function activeProjectHas(name) {
      if (!canInspectProject()) return false;
      const project = await ppro.Project.getActiveProject();
      return !project || typeof project[name] === "function";
    }
    function canSaveProject() { return activeProjectHas("save"); }
    function canInspectProjectInsertionBin() { return activeProjectHas("getInsertionBin"); }
    function canCreatePresetSequence() { return activeProjectHas("createSequenceWithPresetPath"); }
    function canInspectSequenceRange() {
      return activeSequenceHas(["getInPoint", "getOutPoint", "getZeroPoint", "getEndTime"]);
    }
    function canInspectSequencePlayhead() {
      return activeSequenceHas(["getPlayerPosition"]);
    }
    function canInspectSequenceTiming() {
      return activeSequenceHas([
        "getFrameSize", "getTimebase", "getSequenceAudioTimeDisplayFormat",
        "getSequenceVideoTimeDisplayFormat", "getProjectItem"
      ]);
    }
    async function canInspectSequenceTimingByGuid() {
      if (!canInspectProject() || !ppro.Guid || typeof ppro.Guid.fromString !== "function") return false;
      const project = await ppro.Project.getActiveProject();
      return !project || typeof project.getSequence === "function";
    }
    function canInspectAppPreferences() {
      if (!ppro.AppPreference || typeof ppro.AppPreference.getValue !== "function") return false;
      return Object.values(APP_PREFERENCE_KEYS).every((property) => typeof ppro.AppPreference[property] === "string" && ppro.AppPreference[property]);
    }
    function canSetAppPreferences() {
      return canInspectAppPreferences() && typeof ppro.AppPreference.setValue === "function" &&
        Number.isFinite(ppro.AppPreference.PROPERTY_PERSISTENT) && Number.isFinite(ppro.AppPreference.PROPERTY_NON_PERSISTENT);
    }
    async function canSetSequencePlayhead() {
      return !!(ppro.TickTime && typeof ppro.TickTime.createWithSeconds === "function" &&
        await canInspectSequencePlayhead() && await activeSequenceHas(["setPlayerPosition"]));
    }
    async function canUpdateSequenceRange() {
      if (!ppro.TickTime || typeof ppro.TickTime.createWithSeconds !== "function" || !await canInspectSequenceRange()) return false;
      const project = await ppro.Project.getActiveProject();
      if (!project) return true;
      if (typeof project.lockedAccess !== "function" || typeof project.executeTransaction !== "function") return false;
      const sequence = await project.getActiveSequence();
      return !sequence || ["createSetInPointAction", "createSetOutPointAction", "createSetZeroPointAction"]
        .every((method) => typeof sequence[method] === "function");
    }
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
    function canInspectTransitions() {
      return activeSequenceHas(["getVideoTrackCount", "getVideoTrack"]);
    }
    async function canMutateTransitions() {
      if (!canListTransitions() || typeof ppro.TransitionFactory.createVideoTransition !== "function" ||
        typeof ppro.AddTransitionOptions !== "function" || !ppro.TickTime || typeof ppro.TickTime.createWithSeconds !== "function" ||
        !(ppro.Constants && ppro.Constants.TrackItemType && ppro.Constants.TransitionPosition) || !await canInspectTransitions()) return false;
      const project = await ppro.Project.getActiveProject();
      return !project || (typeof project.lockedAccess === "function" && typeof project.executeTransaction === "function");
    }
    async function initialize() {
      return nextWorkflowRuntime && typeof nextWorkflowRuntime.initialize === "function"
        ? nextWorkflowRuntime.initialize()
        : { initialized: true };
    }
    async function dispose() {
      return nextWorkflowRuntime && typeof nextWorkflowRuntime.dispose === "function"
        ? nextWorkflowRuntime.dispose()
        : { disposed: true };
    }
    return { definitions, dispatch, capabilities, stateSnapshot, initialize, dispose };
  }

  function validateAddArgs(args) {
    assertObject(args);
    assertOnlyKeys(args, ["videoTrackIndex", "clipIndex", "matchName", "position", "durationSeconds", "forceSingleSided", "transitionAlignment", "expectedTarget", "operationId"]);
    const result = targetArgs(args);
    if (typeof args.matchName !== "string" || !args.matchName.trim() || args.matchName.length > 256) throw commandError("UXP_INVALID_ARGUMENT", "matchName must be a non-empty string of at most 256 characters");
    result.matchName = args.matchName; result.position = optionalPosition(args.position);
    result.expectedTarget = validateExpectedTransitionTarget(args.expectedTarget, result);
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
    assertObject(args); assertOnlyKeys(args, ["videoTrackIndex", "clipIndex", "position", "expectedTarget", "operationId"]);
    const result = targetArgs(args); result.position = optionalPosition(args.position); result.expectedTarget = validateExpectedTransitionTarget(args.expectedTarget, result); return result;
  }
  function validateInspectTransitionArgs(args) {
    assertObject(args); assertOnlyKeys(args, ["videoTrackIndex", "clipIndex", "position"]);
    const result = targetArgs(args); result.position = optionalPosition(args.position); return result;
  }
  function validateExpectedTransitionTarget(value, target) {
    assertObject(value);
    assertOnlyKeys(value, ["sequenceGuid", "videoTrackIndex", "clipIndex", "projectItemId", "startSeconds", "endSeconds", "position", "transitionPresent"]);
    const sequenceGuid = boundedString(value.sequenceGuid, "expectedTarget.sequenceGuid", 512);
    const projectItemId = boundedString(value.projectItemId, "expectedTarget.projectItemId", 512);
    const videoTrackIndex = nonNegativeInt(value.videoTrackIndex, "expectedTarget.videoTrackIndex"), clipIndex = nonNegativeInt(value.clipIndex, "expectedTarget.clipIndex");
    if (videoTrackIndex !== target.videoTrackIndex || clipIndex !== target.clipIndex) {
      throw commandError("UXP_INVALID_ARGUMENT", "expectedTarget coordinates must match videoTrackIndex and clipIndex");
    }
    const position = optionalPosition(value.position);
    if (position !== target.position) throw commandError("UXP_INVALID_ARGUMENT", "expectedTarget.position must match position");
    const startSeconds = boundedTransitionSeconds(value.startSeconds, "expectedTarget.startSeconds"), endSeconds = boundedTransitionSeconds(value.endSeconds, "expectedTarget.endSeconds");
    if (endSeconds < startSeconds) throw commandError("UXP_INVALID_ARGUMENT", "expectedTarget.endSeconds must be greater than or equal to startSeconds");
    return { sequenceGuid, videoTrackIndex, clipIndex, projectItemId, startSeconds, endSeconds, position, transitionPresent: requiredBoolean(value.transitionPresent, "expectedTarget.transitionPresent") };
  }
  function validateLiftArgs(args) {
    assertObject(args); assertOnlyKeys(args, ["expectedSequenceGuid", "operationId"]);
    const result = {};
    if (args.expectedSequenceGuid != null) result.expectedSequenceGuid = boundedString(args.expectedSequenceGuid, "expectedSequenceGuid", 512);
    return result;
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
  function validateAppPreferenceSetArgs(args) {
    assertObject(args);
    assertOnlyKeys(args, ["preference", "expectedValue", "value", "persistence", "confirmPreferenceChange", "operationId"]);
    const preference = args.preference;
    if (preference !== "auto_peak_generation" && preference !== "import_workspace" && preference !== "show_quickstart_dialog") {
      throw commandError("UXP_INVALID_ARGUMENT", "preference must be auto_peak_generation, import_workspace, or show_quickstart_dialog");
    }
    if (args.confirmPreferenceChange !== true) {
      throw commandError("UXP_CONFIRMATION_REQUIRED", "App preference changes are direct application-state updates; pass confirmPreferenceChange=true after review");
    }
    const persistence = args.persistence;
    if (persistence !== "persistent" && persistence !== "non_persistent") {
      throw commandError("UXP_INVALID_ARGUMENT", "persistence must be persistent or non_persistent");
    }
    return {
      preference,
      expectedValue: boundedStringAllowEmpty(args.expectedValue, "expectedValue", 1024),
      value: boundedStringAllowEmpty(args.value, "value", 1024),
      persistence,
      operationId: requiredOperationId(args.operationId)
    };
  }
  function validateMarkerListArgs(args) {
    assertObject(args); assertOnlyKeys(args, ["scope", "projectItemId", "projectItemName", "filters", "includeWebLinks"]);
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
    return Object.assign({ scope, filters, includeWebLinks: optionalBoolean(args.includeWebLinks, false, "includeWebLinks") }, target);
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
  function boundedTransitionSeconds(value, name) { const number = nonNegativeNumber(value, name); if (number > 86400) throw commandError("UXP_INVALID_ARGUMENT", name + " must be at most 86400"); return number; }
  function positiveNumber(value, name) { const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw commandError("UXP_INVALID_ARGUMENT", name + " must be positive"); return number; }
  function positiveInt(value, fallback, name) { return Math.round(positiveNumber(value == null ? fallback : value, name)); }
  function requiredString(value, name) { if (typeof value !== "string" || !value.trim() || value.length > 4096) throw commandError("UXP_INVALID_ARGUMENT", name + " must be a non-empty string"); return value; }
  function boundedString(value, name, maximum) { if (typeof value !== "string" || !value.trim() || value.length > maximum) throw commandError("UXP_INVALID_ARGUMENT", name + " must be a non-empty string of at most " + maximum + " characters"); return value; }
  function boundedStringAllowEmpty(value, name, maximum) { if (typeof value !== "string" || value.length > maximum) throw commandError("UXP_INVALID_ARGUMENT", name + " must be a string of at most " + maximum + " characters"); return value; }
  function requiredBoolean(value, name) { if (typeof value !== "boolean") throw commandError("UXP_INVALID_ARGUMENT", name + " must be a boolean"); return value; }
  function optionalBoolean(value, fallback, name) { return value == null ? fallback : requiredBoolean(value, name); }
  function oneOfInt(value, name, allowed) { if (!Number.isInteger(value) || !allowed.includes(value)) throw commandError("UXP_INVALID_ARGUMENT", name + " must be one of " + allowed.join(", ")); return value; }
  function requiredOperationId(value) { if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw commandError("UXP_INVALID_ARGUMENT", "operationId is required and must be 1-128 safe characters"); return value; }
  function validateOperationId(value) { if (value == null) return null; if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw commandError("UXP_INVALID_ARGUMENT", "operationId must be 1-128 safe characters"); return value; }
  function simpleRevision(value) { var hash = 2166136261; for (var i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); } return "uxp-" + (hash >>> 0).toString(16); }
  function commandError(code, message) { const error = new Error(message); error.code = code; return error; }
  return { createCommandRegistry, validateAddArgs, validateRemoveArgs, validateInspectTransitionArgs, commandError };
});
