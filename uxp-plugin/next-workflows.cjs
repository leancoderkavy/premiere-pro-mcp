(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpNextWorkflows = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createNextWorkflowDefinitions(deps) {
    return createNextWorkflowRuntime(deps).definitions;
  }

  function createNextWorkflowRuntime(deps) {
    const ppro = deps.ppro, events = deps.events;
    const now = typeof deps.now === "function" ? deps.now : function () { return Date.now(); };
    const sleep = typeof deps.sleep === "function" ? deps.sleep : function (milliseconds) {
      return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
    };
    const scheduleTimer = typeof deps.setTimer === "function" ? deps.setTimer : function (callback, milliseconds) {
      return setTimeout(callback, milliseconds);
    };
    const cancelTimer = typeof deps.clearTimer === "function" ? deps.clearTimer : function (timer) { clearTimeout(timer); };
    const localStorage = deps.storage || (typeof globalThis !== "undefined" ? globalThis.localStorage : null);
    const GROWING_LEASE_KEY = "premiereMcp.growingMediaLease";
    let growingLease = null, growingTimer = null;
    // Source-media mutations share a per-project-item tail.  A frame-rate or
    // pixel-aspect-ratio override must not slip between a guarded timing
    // update's preflight and readback (or the other way around).
    const sourceMediaUpdateTails = new Map();
    const definitions = {
      "events.list": {
        readOnly: true,
        minHostVersion: "25.6.0",
        probe: canUseEvents,
        handler: listEvents
      },
      "events.wait": {
        readOnly: true,
        minHostVersion: "25.6.0",
        probe: canUseEvents,
        handler: waitForEvents
      },
      "readiness.snapshot": {
        readOnly: true,
        minHostVersion: "25.6.0",
        probe: canInspectReadiness,
        handler: readinessSnapshot
      },
      "readiness.analysis.wait": {
        readOnly: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canWaitForAnalysis,
        handler: waitForAnalysis
      },
      "readiness.operation.wait": {
        readOnly: true,
        minHostVersion: "25.6.0",
        probe: canUseEvents,
        handler: waitForOperation
      },
      "project.sessions.list": {
        readOnly: true,
        minHostVersion: "26.2.0",
        probe: canListProjectSessions,
        handler: listProjectSessions
      },
      "project.sessions.validate": {
        readOnly: true,
        requiresWorkspace: true,
        minHostVersion: "26.2.0",
        probe: canManageProjectSessions,
        handler: validateProjectSession
      },
      "project.sessions.create": {
        destructive: true,
        undoable: false,
        requiresWorkspace: true,
        minHostVersion: "26.2.0",
        probe: canManageProjectSessions,
        handler: createProjectSession
      },
      "project.sessions.open": {
        destructive: true,
        undoable: false,
        requiresWorkspace: true,
        minHostVersion: "26.2.0",
        probe: canManageProjectSessions,
        handler: openProjectSession
      },
      "project.sessions.save": {
        destructive: true,
        undoable: false,
        idempotent: true,
        minHostVersion: "26.2.0",
        probe: canManageProjectSessions,
        handler: saveProjectSession
      },
      "project.sessions.saveAs": {
        destructive: true,
        undoable: false,
        requiresWorkspace: true,
        minHostVersion: "26.2.0",
        probe: canManageProjectSessions,
        handler: saveProjectSessionAs
      },
      "project.sessions.branchCopies": {
        destructive: true,
        undoable: false,
        requiresWorkspace: true,
        minHostVersion: "26.2.0",
        probe: canManageProjectSessions,
        handler: createProjectBranchCopies
      },
      "project.sessions.close": {
        destructive: true,
        undoable: false,
        minHostVersion: "26.2.0",
        probe: canManageProjectSessions,
        handler: closeProjectSession
      },
      "growing.status": {
        readOnly: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canControlGrowingMedia,
        handler: growingMediaStatus
      },
      "growing.pause": {
        destructive: true,
        undoable: false,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canControlGrowingMedia,
        handler: pauseGrowingMedia
      },
      "growing.resume": {
        destructive: true,
        undoable: false,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canControlGrowingMedia,
        handler: resumeGrowingMedia
      },
      "checkpoint.has": {
        readOnly: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canUseWorkflowCheckpoints,
        handler: hasWorkflowCheckpoint
      },
      "checkpoint.get": {
        readOnly: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canUseWorkflowCheckpoints,
        handler: getWorkflowCheckpoint
      },
      "checkpoint.set": {
        destructive: true,
        undoable: true,
        idempotent: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canUseWorkflowCheckpoints,
        handler: setWorkflowCheckpoint
      },
      "checkpoint.clear": {
        destructive: true,
        undoable: true,
        idempotent: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canUseWorkflowCheckpoints,
        handler: clearWorkflowCheckpoint
      },
      "media.health.inspect": {
        readOnly: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canMaintainMediaHealth,
        handler: inspectMediaHealth
      },
      "media.health.refresh": {
        destructive: true,
        undoable: false,
        idempotent: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canMaintainMediaHealth,
        handler: refreshMediaHealth
      },
      "media.health.setOffline": {
        destructive: true,
        undoable: true,
        idempotent: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canMaintainMediaHealth,
        handler: setMediaOffline
      },
      "media.health.findByPath": {
        readOnly: true,
        requiresWorkspace: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canMaintainMediaHealth,
        handler: findMediaByPath
      },
      "source.mediaTiming.inspect": {
        readOnly: true,
        targetCapabilityProbe: true,
        minHostVersion: "26.3.0",
        probe: canManageSourceMediaTiming,
        handler: inspectSourceMediaTiming
      },
      "source.mediaTiming.setStart": {
        destructive: true,
        undoable: true,
        idempotent: true,
        targetCapabilityProbe: true,
        minHostVersion: "26.3.0",
        probe: canManageSourceMediaTiming,
        handler: setSourceMediaStart
      },
      "source.mediaOverrides.inspect": {
        readOnly: true,
        targetCapabilityProbe: true,
        minHostVersion: "26.3.0",
        probe: canManageSourceMediaOverrides,
        handler: inspectSourceMediaOverrides
      },
      "source.mediaOverrides.update": {
        destructive: true,
        undoable: true,
        idempotent: true,
        targetCapabilityProbe: true,
        minHostVersion: "26.3.0",
        probe: canManageSourceMediaOverrides,
        handler: updateSourceMediaOverrides
      },
      "track.state.inspect": {
        readOnly: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canManageTrackState,
        handler: inspectTrackState
      },
      "track.state.set": {
        destructive: true,
        undoable: false,
        idempotent: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canManageTrackState,
        handler: setTrackState
      },
      "source.clip.inspect": {
        readOnly: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canManageSourceClip,
        handler: inspectSourceClip
      },
      "source.clip.update": {
        destructive: true,
        undoable: true,
        idempotent: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canManageSourceClip,
        handler: updateSourceClip
      }
    };

    return { definitions, initialize, dispose };

    function canUseEvents() {
      return !!(events && typeof events.list === "function" && typeof events.wait === "function");
    }

    function listEvents(args) {
      assertOnlyKeys(args, ["afterRevision", "categories", "eventNames", "limit"]);
      return events.list(query(args, false));
    }

    function waitForEvents(args) {
      assertOnlyKeys(args, ["afterRevision", "categories", "eventNames", "limit", "timeoutMs"]);
      return events.wait(query(args, true));
    }

    function canInspectReadiness() {
      return !!(ppro && ppro.Project && typeof ppro.Project.getActiveProject === "function");
    }

    function canListProjectSessions() {
      return !!(ppro && ppro.ProjectUtils &&
        typeof ppro.ProjectUtils.getProjectViewIds === "function" &&
        typeof ppro.ProjectUtils.getProjectFromViewId === "function");
    }

    function canManageProjectSessions() {
      return !!(canListProjectSessions() && ppro.Project &&
        typeof ppro.Project.getActiveProject === "function" &&
        typeof ppro.Project.getProject === "function" &&
        typeof ppro.Project.open === "function" &&
        typeof ppro.Project.createProject === "function" &&
        typeof ppro.Project.isProject === "function");
    }

    async function canControlGrowingMedia() {
      if (!ppro || !ppro.Project || typeof ppro.Project.getActiveProject !== "function") return false;
      try {
        const project = await ppro.Project.getActiveProject();
        return !!(project && typeof project.pauseGrowing === "function");
      } catch (_) { return false; }
    }

    function canUseWorkflowCheckpoints() {
      return !!(ppro && ppro.Properties && typeof ppro.Properties.getProperties === "function");
    }

    function canMaintainMediaHealth() {
      return !!(ppro && ppro.ClipProjectItem && typeof ppro.ClipProjectItem.cast === "function");
    }

    function canManageSourceMediaTiming() {
      return !!(canMaintainMediaHealth() && ppro.TickTime && typeof ppro.TickTime.createWithSeconds === "function");
    }

    function canManageSourceMediaOverrides() {
      return !!canMaintainMediaHealth();
    }

    async function canManageTrackState() {
      if (!canInspectReadiness()) return false;
      try {
        const project = await ppro.Project.getActiveProject();
        const sequence = project && await project.getActiveSequence();
        return !!(sequence && typeof sequence.getVideoTrackCount === "function" &&
          typeof sequence.getAudioTrackCount === "function" && typeof sequence.getCaptionTrackCount === "function");
      } catch (_) { return false; }
    }

    function canManageSourceClip() {
      return !!(canMaintainMediaHealth() && ppro.TickTime && typeof ppro.TickTime.createWithSeconds === "function" &&
        ppro.Constants && ppro.Constants.MediaType);
    }

    async function initialize() {
      const stored = readGrowingLease();
      if (!stored) return { recovered: false };
      growingLease = stored;
      try {
        const receipt = await resumeLease("startup_recovery");
        return { recovered: !!receipt.resumed, receipt };
      } catch (error) {
        return { recovered: false, recoveryPending: true, error: error && error.message || String(error) };
      }
    }

    async function dispose() {
      clearGrowingTimer();
      if (!growingLease && !readGrowingLease()) return { resumed: false, alreadyResumed: true };
      try { return await resumeLease("panel_or_bridge_disconnect"); }
      catch (error) { return { resumed: false, recoveryPending: true, error: error && error.message || String(error) }; }
    }

    async function canWaitForAnalysis() {
      if (!canInspectReadiness()) return false;
      try {
        const project = await ppro.Project.getActiveProject();
        const sequence = project && await project.getActiveSequence();
        return !!(sequence && typeof sequence.isDoneAnalyzingForVideoEffects === "function");
      } catch (_) {
        return false;
      }
    }

    async function readinessSnapshot(args) {
      assertOnlyKeys(args, ["sequenceId"]);
      const project = await activeProject(false);
      const sequence = project && await resolveSequence(project, args.sequenceId, false);
      const analysisSupported = !!(sequence && typeof sequence.isDoneAnalyzingForVideoEffects === "function");
      const analysisDone = analysisSupported ? !!(await sequence.isDoneAnalyzingForVideoEffects()) : null;
      const journal = canUseEvents() ? events.status() : null;
      return {
        projectOpen: !!project,
        sequenceId: sequence ? guidString(sequence.guid) : null,
        analysisSupported,
        analysisDone,
        eventRevision: journal ? journal.latestRevision : null,
        capturedAt: new Date(now()).toISOString()
      };
    }

    async function waitForAnalysis(args) {
      assertOnlyKeys(args, ["sequenceId", "expectedSequenceId", "timeoutMs", "pollMinMs", "pollMaxMs"]);
      const project = await activeProject(true), sequence = await resolveSequence(project, args.sequenceId, true);
      if (typeof sequence.isDoneAnalyzingForVideoEffects !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This sequence cannot report video-effect analysis readiness");
      }
      const sequenceId = guidString(sequence.guid);
      if (args.expectedSequenceId != null && optionalToken(args.expectedSequenceId, "expectedSequenceId") !== sequenceId) {
        throw commandError("UXP_STALE_TARGET", "The active or requested sequence changed before the readiness wait");
      }
      const timeoutMs = args.timeoutMs == null ? 30000 : integer(args.timeoutMs, "timeoutMs", 0, 60000);
      const pollMinMs = args.pollMinMs == null ? 100 : integer(args.pollMinMs, "pollMinMs", 100, 2000);
      const pollMaxMs = args.pollMaxMs == null ? 2000 : integer(args.pollMaxMs, "pollMaxMs", pollMinMs, 5000);
      const startedAt = now();
      let interval = pollMinMs, checks = 0;
      while (true) {
        checks += 1;
        if (await sequence.isDoneAnalyzingForVideoEffects()) {
          return {
            ready: true, timedOut: false, sequenceId, checks,
            elapsedMs: Math.max(0, now() - startedAt),
            verificationBoundary: "sequence_analysis_readback"
          };
        }
        const elapsed = Math.max(0, now() - startedAt);
        if (elapsed >= timeoutMs) {
          return {
            ready: false, timedOut: true, sequenceId, checks, elapsedMs: elapsed,
            verificationBoundary: "sequence_analysis_readback"
          };
        }
        await sleep(Math.min(interval, timeoutMs - elapsed));
        interval = Math.min(pollMaxMs, Math.ceil(interval * 1.5));
      }
    }

    async function waitForOperation(args) {
      assertOnlyKeys(args, ["operationType", "afterRevision", "timeoutMs"]);
      if (args.afterRevision == null) {
        throw commandError("UXP_INVALID_ARGUMENT", "afterRevision from a pre-dispatch readiness snapshot is required");
      }
      const operationType = optionalToken(args.operationType, "operationType");
      const names = {
        import: "operation.import.complete",
        export: "operation.export.complete",
        effectDrop: "operation.effect.drop.complete",
        generativeExtend: "operation.generative.extend.complete"
      };
      if (!names[operationType]) throw commandError("UXP_INVALID_ARGUMENT", "operationType is not supported");
      const result = await events.wait({
        afterRevision: integer(args.afterRevision, "afterRevision", 0, Number.MAX_SAFE_INTEGER),
        categories: ["operation"],
        eventNames: [names[operationType]],
        limit: 1,
        timeoutMs: args.timeoutMs == null ? 30000 : integer(args.timeoutMs, "timeoutMs", 0, 60000)
      });
      const receipt = result.events[0] || null;
      return {
        ready: !!receipt,
        timedOut: !receipt && !!result.timedOut,
        operationType,
        receipt,
        outcome: receipt ? operationOutcome(receipt.detail && receipt.detail.state) : "pending",
        overflow: result.overflow,
        latestRevision: result.latestRevision,
        verificationBoundary: receipt ? "operation_terminal_event_only" : "bounded_wait_timeout"
      };
    }

    async function listProjectSessions(args) {
      assertOnlyKeys(args, ["includePaths"]);
      const includePaths = optionalBoolean(args.includePaths, false, "includePaths");
      const projects = await openProjectInventory(includePaths);
      const active = await ppro.Project.getActiveProject();
      return {
        count: projects.length,
        activeProjectId: active ? guidString(active.guid) : null,
        projects,
        pathDisclosure: includePaths ? "requested" : "redacted"
      };
    }

    async function validateProjectSession(args) {
      assertOnlyKeys(args, ["path"]);
      const path = await allowedWorkspacePath(args.path, "path");
      return {
        isProject: !!ppro.Project.isProject(path),
        pathAccepted: true,
        pathDisclosure: "caller_supplied_only"
      };
    }

    async function createProjectSession(args) {
      assertOnlyKeys(args, ["path", "confirmExternalWrite", "confirmOverwrite", "operationId"]);
      requireConfirmation(args.confirmExternalWrite, "confirmExternalWrite", "Creating a project writes a new file");
      const path = await allowedWorkspacePath(args.path, "path");
      rejectExistingProject(path, args.confirmOverwrite);
      const project = await ppro.Project.createProject(path);
      assertProjectPath(project, path, "created project");
      return projectMutationReceipt("created", project, path);
    }

    async function openProjectSession(args) {
      assertOnlyKeys(args, ["path", "showDialogs", "addToMru", "operationId"]);
      const path = await allowedWorkspacePath(args.path, "path");
      if (!ppro.Project.isProject(path)) throw commandError("UXP_TARGET_NOT_FOUND", "The requested path is not an openable Premiere project");
      const project = await ppro.Project.open(path, openOptions(args));
      assertProjectPath(project, path, "opened project");
      return projectMutationReceipt("opened", project, path);
    }

    async function saveProjectSession(args) {
      assertOnlyKeys(args, ["projectId", "expectedPath", "operationId"]);
      const project = await targetProject(args.projectId);
      if (args.expectedPath != null) assertProjectPath(project, requiredPath(args.expectedPath, "expectedPath"), "target project");
      if (typeof project.save !== "function" || !await project.save()) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not confirm the project save");
      }
      return projectMutationReceipt("saved", project, String(project.path || ""));
    }

    async function saveProjectSessionAs(args) {
      assertOnlyKeys(args, ["projectId", "expectedPath", "path", "confirmExternalWrite", "confirmOverwrite", "operationId"]);
      requireConfirmation(args.confirmExternalWrite, "confirmExternalWrite", "Save As writes a new project file and retargets the project handle");
      const project = await targetProject(args.projectId);
      if (args.expectedPath != null) assertProjectPath(project, requiredPath(args.expectedPath, "expectedPath"), "target project");
      const path = await allowedWorkspacePath(args.path, "path");
      rejectExistingProject(path, args.confirmOverwrite);
      if (typeof project.saveAs !== "function" || !await project.saveAs(path)) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not confirm Save As");
      }
      assertProjectPath(project, path, "Save As project");
      return projectMutationReceipt("saved_as", project, path);
    }

    async function createProjectBranchCopies(args) {
      assertOnlyKeys(args, ["projectId", "expectedPath", "paths", "confirmExternalWrite", "confirmOverwrite", "operationId"]);
      requireConfirmation(args.confirmExternalWrite, "confirmExternalWrite", "Branch copies write, close, and reopen project files");
      if (!Array.isArray(args.paths) || !args.paths.length || args.paths.length > 16) {
        throw commandError("UXP_INVALID_ARGUMENT", "paths must contain 1-16 project paths");
      }
      let project = await targetProject(args.projectId);
      const sourcePath = await allowedWorkspacePath(args.expectedPath == null ? project.path : args.expectedPath, "expectedPath");
      assertProjectPath(project, sourcePath, "source project");
      const paths = [];
      for (let i = 0; i < args.paths.length; i += 1) {
        const path = await allowedWorkspacePath(args.paths[i], "paths[" + i + "]");
        if (samePath(path, sourcePath) || paths.some(function (item) { return samePath(item, path); })) {
          throw commandError("UXP_INVALID_ARGUMENT", "Branch paths must be distinct from the source and each other");
        }
        rejectExistingProject(path, args.confirmOverwrite);
        paths.push(path);
      }
      const branches = [];
      for (let i = 0; i < paths.length; i += 1) {
        const path = paths[i];
        if (typeof project.saveAs !== "function" || !await project.saveAs(path)) {
          throw commandError("UXP_PARTIAL_FAILURE", "Premiere stopped while creating branch copy " + (i + 1));
        }
        assertProjectPath(project, path, "branch copy");
        branches.push({ index: i, projectId: guidString(project.guid), path, verified: "project_path_readback" });
        if (typeof project.close !== "function" || !await project.close(closeOptions({ promptIfDirty: false }))) {
          throw commandError("UXP_PARTIAL_FAILURE", "Branch copy was saved but its project view could not be closed");
        }
        project = await ppro.Project.open(sourcePath, openOptions({ showDialogs: false, addToMru: false }));
        assertProjectPath(project, sourcePath, "reopened source project");
      }
      return {
        created: branches.length,
        branches,
        sourceProjectId: guidString(project.guid),
        sourceReopened: true,
        outcome: "verified",
        verificationBoundary: "project_path_readback_after_each_save_as"
      };
    }

    async function closeProjectSession(args) {
      assertOnlyKeys(args, ["projectId", "expectedPath", "saveBeforeClose", "confirmClose", "confirmDiscardUnsaved", "operationId"]);
      requireConfirmation(args.confirmClose, "confirmClose", "Closing a project changes the Premiere workspace");
      const project = await targetProject(args.projectId);
      if (args.expectedPath != null) assertProjectPath(project, requiredPath(args.expectedPath, "expectedPath"), "target project");
      const projectId = guidString(project.guid);
      const saveBeforeClose = optionalBoolean(args.saveBeforeClose, true, "saveBeforeClose");
      if (saveBeforeClose) {
        if (typeof project.save !== "function" || !await project.save()) {
          throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not confirm the pre-close save");
        }
      } else {
        requireConfirmation(args.confirmDiscardUnsaved, "confirmDiscardUnsaved", "Closing without saving may discard project changes");
      }
      if (typeof project.close !== "function" || !await project.close(closeOptions({ promptIfDirty: false }))) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not confirm the project close");
      }
      const remaining = await openProjectInventory(false);
      if (remaining.some(function (item) { return item.projectId === projectId; })) {
        throw commandError("UXP_VERIFICATION_FAILED", "The closed project is still present in an open Project view");
      }
      return { closed: true, saved: saveBeforeClose, projectId, outcome: "verified", verificationBoundary: "project_view_absence_readback" };
    }

    function growingMediaStatus(args) {
      assertOnlyKeys(args, []);
      const stored = readGrowingLease();
      const lease = growingLease || stored;
      return {
        pausedByThisPanel: !!lease,
        projectId: lease ? lease.projectId : null,
        expiresAt: lease ? new Date(lease.expiresAt).toISOString() : null,
        recoveryPending: !!stored && !growingLease,
        verificationBoundary: "panel_local_lease_only"
      };
    }

    async function pauseGrowingMedia(args) {
      assertOnlyKeys(args, ["projectId", "expectedPath", "leaseMs", "confirmPause", "operationId"]);
      requireConfirmation(args.confirmPause, "confirmPause", "Pausing growing-media swaps can delay visibility of newly written media");
      const leaseMs = args.leaseMs == null ? 60000 : integer(args.leaseMs, "leaseMs", 1000, 600000);
      const project = await targetProject(args.projectId);
      if (args.expectedPath != null) assertProjectPath(project, requiredPath(args.expectedPath, "expectedPath"), "target project");
      if (typeof project.pauseGrowing !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "This project cannot control growing media");
      if (growingLease || readGrowingLease()) await resumeLease("superseded_by_new_lease");
      if (!await project.pauseGrowing(true)) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not confirm the growing-media pause request");
      growingLease = {
        schemaVersion: 1,
        projectId: guidString(project.guid),
        expiresAt: now() + leaseMs
      };
      writeGrowingLease(growingLease);
      clearGrowingTimer();
      growingTimer = scheduleTimer(function () {
        Promise.resolve(resumeLease("lease_expired")).catch(function () {});
      }, leaseMs);
      return {
        paused: true,
        projectId: growingLease.projectId,
        leaseMs,
        expiresAt: new Date(growingLease.expiresAt).toISOString(),
        outcome: "committed_unverified",
        verificationBoundary: "project_pauseGrowing_host_return_only"
      };
    }

    async function resumeGrowingMedia(args) {
      assertOnlyKeys(args, ["projectId", "operationId"]);
      return resumeLease("explicit_resume", args.projectId);
    }

    async function hasWorkflowCheckpoint(args) {
      assertOnlyKeys(args, ["owner", "sequenceId", "expectedOwnerId", "name"]);
      const context = await checkpointContext(args);
      return checkpointReceipt(context, context.properties.hasValue(context.key), null, null);
    }

    async function getWorkflowCheckpoint(args) {
      assertOnlyKeys(args, ["owner", "sequenceId", "expectedOwnerId", "name", "valueType"]);
      const context = await checkpointContext(args);
      const valueType = checkpointValueType(args.valueType);
      const exists = !!context.properties.hasValue(context.key);
      return checkpointReceipt(context, exists, valueType, exists ? readCheckpointValue(context.properties, context.key, valueType) : null);
    }

    async function setWorkflowCheckpoint(args) {
      assertOnlyKeys(args, ["owner", "sequenceId", "expectedOwnerId", "name", "valueType", "value", "persistence", "operationId"]);
      const context = await checkpointContext(args);
      const valueType = checkpointValueType(args.valueType);
      const value = checkpointValue(args.value, valueType);
      const persistence = checkpointPersistence(args.persistence);
      let committed = false;
      context.project.lockedAccess(function () {
        const action = context.properties.createSetValueAction(context.key, value, persistence.value);
        committed = context.project.executeTransaction(function (compoundAction) {
          if (!action || compoundAction.addAction(action) === false) {
            throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the checkpoint set action");
          }
        }, "Set Premiere MCP checkpoint");
      });
      if (!committed) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not commit the checkpoint transaction");
      if (!context.properties.hasValue(context.key)) throw commandError("UXP_VERIFICATION_FAILED", "Checkpoint was absent after the transaction");
      const readback = readCheckpointValue(context.properties, context.key, valueType);
      if (!sameCheckpointValue(readback, value, valueType)) throw commandError("UXP_VERIFICATION_FAILED", "Checkpoint readback did not match the requested value");
      return {
        ...checkpointReceipt(context, true, valueType, readback),
        persistence: persistence.name,
        outcome: "verified",
        verificationBoundary: "typed_property_readback"
      };
    }

    async function clearWorkflowCheckpoint(args) {
      assertOnlyKeys(args, ["owner", "sequenceId", "expectedOwnerId", "name", "operationId"]);
      const context = await checkpointContext(args);
      if (!context.properties.hasValue(context.key)) {
        return { ...checkpointReceipt(context, false, null, null), cleared: false, outcome: "verified", verificationBoundary: "property_absence_readback" };
      }
      let committed = false;
      context.project.lockedAccess(function () {
        const action = context.properties.createClearValueAction(context.key);
        committed = context.project.executeTransaction(function (compoundAction) {
          if (!action || compoundAction.addAction(action) === false) {
            throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the checkpoint clear action");
          }
        }, "Clear Premiere MCP checkpoint");
      });
      if (!committed || context.properties.hasValue(context.key)) {
        throw commandError("UXP_VERIFICATION_FAILED", "Checkpoint remained after the clear transaction");
      }
      return { ...checkpointReceipt(context, false, null, null), cleared: true, outcome: "verified", verificationBoundary: "property_absence_readback" };
    }

    async function checkpointContext(args) {
      const owner = args.owner == null ? "project" : args.owner;
      if (owner !== "project" && owner !== "sequence") throw commandError("UXP_INVALID_ARGUMENT", "owner must be project or sequence");
      const project = await activeProject(true);
      const target = owner === "project" ? project : await resolveSequence(project, args.sequenceId, true);
      const ownerId = guidString(target.guid);
      if (args.expectedOwnerId != null && optionalToken(args.expectedOwnerId, "expectedOwnerId") !== ownerId) {
        throw commandError("UXP_STALE_TARGET", "The checkpoint owner changed before dispatch");
      }
      const name = checkpointName(args.name);
      const properties = await ppro.Properties.getProperties(target);
      if (!properties || typeof properties.hasValue !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This checkpoint owner does not expose Adobe properties");
      }
      return { owner, ownerId, project, target, properties, name, key: "premiereMcp." + name };
    }

    function checkpointName(value) {
      if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value) || value.indexOf("premiereMcp.") === 0) {
        throw commandError("UXP_INVALID_ARGUMENT", "name must be a 1-96 character unprefixed checkpoint token");
      }
      return value;
    }

    function checkpointValueType(value) {
      if (value !== "string" && value !== "int" && value !== "float" && value !== "bool") {
        throw commandError("UXP_INVALID_ARGUMENT", "valueType must be string, int, float, or bool");
      }
      return value;
    }

    function checkpointValue(value, valueType) {
      if (valueType === "string") {
        if (typeof value !== "string" || value.length > 8192 || value.indexOf("\0") !== -1) {
          throw commandError("UXP_INVALID_ARGUMENT", "string checkpoint values must be at most 8192 characters and contain no NUL");
        }
        return value;
      }
      if (valueType === "bool") {
        if (typeof value !== "boolean") throw commandError("UXP_INVALID_ARGUMENT", "bool checkpoint values must be boolean");
        return value;
      }
      if (typeof value !== "number" || !Number.isFinite(value)) throw commandError("UXP_INVALID_ARGUMENT", valueType + " checkpoint values must be finite numbers");
      if (valueType === "int" && (!Number.isSafeInteger(value) || Math.abs(value) > 2147483647)) {
        throw commandError("UXP_INVALID_ARGUMENT", "int checkpoint values must be 32-bit safe integers");
      }
      return value;
    }

    function checkpointPersistence(value) {
      const name = value == null ? "session" : value;
      if (name !== "session" && name !== "persistent") throw commandError("UXP_INVALID_ARGUMENT", "persistence must be session or persistent");
      const constants = ppro.Constants && ppro.Constants.PropertyType || {};
      const persistent = ppro.Properties.PROPERTY_PERSISTENT != null ? ppro.Properties.PROPERTY_PERSISTENT : constants.PERSISTENT;
      const nonPersistent = ppro.Properties.PROPERTY_NON_PERSISTENT != null ? ppro.Properties.PROPERTY_NON_PERSISTENT : constants.NON_PERSISTENT;
      const flag = name === "persistent" ? persistent : nonPersistent;
      if (flag == null) throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build does not expose checkpoint persistence constants");
      return { name, value: flag };
    }

    function readCheckpointValue(properties, key, valueType) {
      const readers = { string: "getValue", int: "getValueAsInt", float: "getValueAsFloat", bool: "getValueAsBool" };
      const reader = readers[valueType];
      if (typeof properties[reader] !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "This checkpoint value type is unavailable");
      return properties[reader](key);
    }

    function sameCheckpointValue(left, right, valueType) {
      if (valueType === "float") return Math.abs(left - right) <= Math.max(1e-9, Math.abs(right) * 1e-9);
      return left === right;
    }

    function checkpointReceipt(context, exists, valueType, value) {
      return {
        owner: context.owner,
        ownerId: context.ownerId,
        name: context.name,
        keyNamespace: "premiereMcp.",
        exists: !!exists,
        valueType: valueType || null,
        value: exists && valueType ? value : null
      };
    }

    async function inspectMediaHealth(args) {
      assertOnlyKeys(args, ["projectItemIds", "includePaths", "includeMediaTiming"]);
      const project = await activeProject(true);
      const clips = await resolveMediaHealthClips(project, args.projectItemIds);
      const includePaths = optionalBoolean(args.includePaths, false, "includePaths");
      const includeMediaTiming = optionalBoolean(args.includeMediaTiming, false, "includeMediaTiming");
      const items = [];
      for (let i = 0; i < clips.length; i += 1) items.push(await mediaHealthSnapshot(clips[i], includePaths, includeMediaTiming));
      return { count: items.length, items, pathDisclosure: includePaths ? "requested" : "redacted" };
    }

    async function refreshMediaHealth(args) {
      assertOnlyKeys(args, ["projectItemIds", "expectedOffline", "operationId"]);
      const project = await activeProject(true);
      const clips = await resolveMediaHealthClips(project, args.projectItemIds);
      const expectedOffline = optionalExpectedBoolean(args.expectedOffline, "expectedOffline");
      const preflight = [];
      for (let i = 0; i < clips.length; i += 1) {
        const offline = !!(await clips[i].isOffline());
        if (expectedOffline != null && offline !== expectedOffline) {
          throw commandError("UXP_STALE_TARGET", "A media item changed offline state before refresh");
        }
        preflight.push({ clip: clips[i], projectItemId: await clipProjectItemId(clips[i]), beforeOffline: offline });
      }
      const items = [];
      for (let i = 0; i < preflight.length; i += 1) {
        const target = preflight[i];
        try {
          const accepted = !!(await target.clip.refreshMedia());
          items.push({
            projectItemId: target.projectItemId,
            accepted,
            beforeOffline: target.beforeOffline,
            afterOffline: !!(await target.clip.isOffline()),
            verificationBoundary: "refreshMedia_return_and_offline_readback"
          });
        } catch (error) {
          items.push({ projectItemId: target.projectItemId, accepted: false, error: error && error.message || String(error) });
        }
      }
      const refreshed = items.filter(function (item) { return item.accepted; }).length;
      return {
        requested: items.length,
        refreshed,
        failed: items.length - refreshed,
        items,
        outcome: refreshed === items.length ? "verified" : refreshed ? "partial" : "failed",
        verificationBoundary: "per_item_refresh_return_and_offline_readback"
      };
    }

    async function setMediaOffline(args) {
      assertOnlyKeys(args, ["projectItemIds", "expectedOffline", "confirmSetOffline", "operationId"]);
      requireConfirmation(args.confirmSetOffline, "confirmSetOffline", "Setting source media offline changes every selected clip reference");
      const project = await activeProject(true);
      const clips = await resolveMediaHealthClips(project, args.projectItemIds);
      const expectedOffline = optionalExpectedBoolean(args.expectedOffline, "expectedOffline");
      const targets = [];
      for (let i = 0; i < clips.length; i += 1) {
        const offline = !!(await clips[i].isOffline());
        if (expectedOffline != null && offline !== expectedOffline) {
          throw commandError("UXP_STALE_TARGET", "A media item changed offline state before the transaction");
        }
        targets.push({ clip: clips[i], projectItemId: await clipProjectItemId(clips[i]) });
      }
      let committed = false;
      project.lockedAccess(function () {
        const actions = targets.map(function (target) { return target.clip.createSetOfflineAction(); });
        committed = project.executeTransaction(function (compoundAction) {
          for (let i = 0; i < actions.length; i += 1) {
            if (!actions[i] || compoundAction.addAction(actions[i]) === false) {
              throw commandError("UXP_ACTION_REJECTED", "Premiere rejected a set-offline action");
            }
          }
        }, "Set source media offline");
      });
      if (!committed) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not commit the set-offline transaction");
      const items = [];
      for (let i = 0; i < targets.length; i += 1) {
        const offline = !!(await targets[i].clip.isOffline());
        if (!offline) throw commandError("UXP_VERIFICATION_FAILED", "A media item remained online after the transaction");
        items.push({ projectItemId: targets[i].projectItemId, offline: true });
      }
      return {
        updated: items.length,
        items,
        outcome: "verified",
        verificationBoundary: "offline_state_readback",
        undoLabel: "Set source media offline"
      };
    }

    async function findMediaByPath(args) {
      assertOnlyKeys(args, ["projectItemId", "matchPath", "ignoreSubclips", "includePaths"]);
      const project = await activeProject(true);
      const clips = await resolveMediaHealthClips(project, args.projectItemId == null ? null : [args.projectItemId]);
      if (clips.length !== 1) throw commandError("UXP_INVALID_ARGUMENT", "find_by_media_path requires exactly one seed media item");
      const matchPath = await allowedWorkspacePath(args.matchPath, "matchPath");
      if (typeof clips[0].findItemsMatchingMediaPath !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This media item cannot search project media paths");
      }
      const matches = Array.from(await clips[0].findItemsMatchingMediaPath(
        matchPath, optionalBoolean(args.ignoreSubclips, true, "ignoreSubclips")
      ) || []);
      if (matches.length > 512) throw commandError("UXP_PROJECT_TOO_LARGE", "Media-path search exceeded the 512-result safety cap");
      const includePaths = optionalBoolean(args.includePaths, false, "includePaths");
      const items = [];
      for (let i = 0; i < matches.length; i += 1) {
        const clip = castMediaClip(matches[i]);
        const snapshot = await mediaHealthSnapshot(clip, includePaths);
        items.push(snapshot);
      }
      return {
        count: items.length,
        items,
        matchPath: includePaths ? matchPath : null,
        pathDisclosure: includePaths ? "requested" : "redacted"
      };
    }

    async function inspectSourceMediaTiming(args) {
      assertOnlyKeys(args, ["projectItemId"]);
      const projectItemId = boundedIdentifier(args.projectItemId, "projectItemId");
      const project = await activeProject(true);
      const clips = await resolveMediaHealthClips(project, [projectItemId]);
      return {
        ...await sourceMediaTimingSnapshot(clips[0], projectItemId),
        verificationBoundary: "source_media_timing_readback"
      };
    }

    async function setSourceMediaStart(args) {
      assertOnlyKeys(args, ["projectItemId", "expectedTiming", "startSeconds", "confirmSetStart", "operationId"]);
      requireConfirmation(args.confirmSetStart, "confirmSetStart", "Changing a source media start time changes its timecode offset");
      const projectItemId = boundedIdentifier(args.projectItemId, "projectItemId");
      const expectedTiming = requiredSourceMediaTiming(args.expectedTiming, "expectedTiming");
      const startSeconds = boundedSeconds(args.startSeconds, "startSeconds");
      const initialProject = await activeProject(true);
      const projectId = guidString(initialProject.guid);
      if (!projectId) throw commandError("UXP_COMMAND_UNAVAILABLE", "The active project does not expose a stable GUID");
      return withSourceMediaUpdateLock(projectId + "\u0000" + projectItemId, async function () {
        const project = await activeProject(true);
        if (guidString(project.guid) !== projectId) {
          throw commandError("UXP_STALE_TARGET", "The active project changed before the source media timing update");
        }
        const clips = await resolveMediaHealthClips(project, [projectItemId]);
        const clip = clips[0];
        const before = await sourceMediaTimingSnapshot(clip, projectItemId);
        if (!sameSourceMediaTiming(before, expectedTiming)) {
          throw commandError("UXP_STALE_TARGET", "The source media timing changed before the transaction");
        }
        const media = await sourceMediaForUpdate(clip);
        let committed = false;
        project.lockedAccess(function () {
          const current = synchronousSourceMediaTimingSnapshot(media, projectItemId);
          if (!sameSourceMediaTiming(current, expectedTiming)) {
            throw commandError("UXP_STALE_TARGET", "The source media timing changed before action creation");
          }
          const action = media.createSetStartAction(ppro.TickTime.createWithSeconds(startSeconds));
          if (!action) throw commandError("UXP_ACTION_REJECTED", "Premiere did not create the source media start action");
          committed = project.executeTransaction(function (compoundAction) {
            if (compoundAction.addAction(action) === false) {
              throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the source media start action");
            }
          }, "Set source media start time");
        });
        if (!committed) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not commit the source media timing transaction");
        const afterProject = await activeProject(true);
        if (guidString(afterProject.guid) !== projectId) {
          throw commandError("UXP_VERIFICATION_FAILED", "The active project changed before source media timing readback");
        }
        const afterClip = (await resolveMediaHealthClips(afterProject, [projectItemId]))[0];
        const after = await sourceMediaTimingSnapshot(afterClip, projectItemId);
        if (!sameSeconds(after.startSeconds, startSeconds) || !sameSeconds(after.durationSeconds, expectedTiming.durationSeconds)) {
          throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not retain the requested source media timing");
        }
        return {
          updated: true,
          projectItemId,
          before,
          after,
          outcome: "verified",
          verificationBoundary: "source_media_timing_readback",
          undoLabel: "Set source media start time"
        };
      });
    }

    async function inspectSourceMediaOverrides(args) {
      assertOnlyKeys(args, ["projectItemId"]);
      const projectItemId = boundedIdentifier(args.projectItemId, "projectItemId");
      const project = await activeProject(true);
      const projectGuid = guidString(project.guid);
      if (!projectGuid) throw commandError("UXP_COMMAND_UNAVAILABLE", "The active project does not expose a stable GUID");
      const clips = await resolveMediaHealthClips(project, [projectItemId]);
      return {
        ...await sourceMediaOverrideSnapshot(projectGuid, clips[0], projectItemId),
        verificationBoundary: "source_media_effective_interpretation_readback"
      };
    }

    async function updateSourceMediaOverrides(args) {
      assertOnlyKeys(args, ["projectItemId", "expectedOverrides", "frameRate", "pixelAspectRatio", "confirmMediaInterpretation", "operationId"]);
      requireConfirmation(args.confirmMediaInterpretation, "confirmMediaInterpretation", "Changing source media interpretation can alter editorial timing and framing");
      const projectItemId = boundedIdentifier(args.projectItemId, "projectItemId");
      const expected = requiredSourceMediaOverrides(args.expectedOverrides, "expectedOverrides");
      const requested = requestedSourceMediaOverrides(args);
      requireOperationId(args.operationId, "operationId");
      const initialProject = await activeProject(true);
      const projectGuid = guidString(initialProject.guid);
      if (!projectGuid) throw commandError("UXP_COMMAND_UNAVAILABLE", "The active project does not expose a stable GUID");
      if (projectGuid !== expected.projectGuid) {
        throw commandError("UXP_STALE_TARGET", "The active project does not match the inspected source media override snapshot");
      }
      return withSourceMediaUpdateLock(projectGuid + "\u0000" + projectItemId, async function () {
        const project = await activeProject(true);
        if (guidString(project.guid) !== projectGuid) {
          throw commandError("UXP_STALE_TARGET", "The active project changed before the source media override update");
        }
        const clip = (await resolveMediaHealthClips(project, [projectItemId]))[0];
        const before = await sourceMediaOverrideSnapshot(projectGuid, clip, projectItemId);
        if (!sameSourceMediaOverrides(before, expected)) {
          throw commandError("UXP_STALE_TARGET", "The source media interpretation changed before the transaction");
        }
        let committed = false;
        project.lockedAccess(function () {
          // getFootageInterpretation() is asynchronous in the documented API,
          // so the complete stale snapshot is intentionally taken immediately
          // before this synchronous locked action-creation boundary.  The
          // per-item tail prevents another MCP mutation from interleaving here.
          if (guidString(project.guid) !== projectGuid) {
            throw commandError("UXP_STALE_TARGET", "The active project changed before source media override action creation");
          }
          const actions = [];
          if (requested.frameRate != null) {
            if (typeof clip.createSetOverrideFrameRateAction !== "function") {
              throw commandError("UXP_COMMAND_UNAVAILABLE", "This source clip cannot create an override frame-rate action");
            }
            actions.push(clip.createSetOverrideFrameRateAction(requested.frameRate));
          }
          if (requested.pixelAspectRatio != null) {
            if (typeof clip.createSetOverridePixelAspectRatioAction !== "function") {
              throw commandError("UXP_COMMAND_UNAVAILABLE", "This source clip cannot create an override pixel-aspect-ratio action");
            }
            actions.push(clip.createSetOverridePixelAspectRatioAction(
              requested.pixelAspectRatio.numerator, requested.pixelAspectRatio.denominator
            ));
          }
          committed = project.executeTransaction(function (compoundAction) {
            for (let i = 0; i < actions.length; i += 1) {
              if (!actions[i] || compoundAction.addAction(actions[i]) === false) {
                throw commandError("UXP_ACTION_REJECTED", "Premiere rejected a source media override action");
              }
            }
          }, "Set source media interpretation override");
        });
        if (!committed) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not commit the source media override transaction");
        const afterProject = await activeProject(true);
        if (guidString(afterProject.guid) !== projectGuid) {
          throw commandError("UXP_VERIFICATION_FAILED", "The active project changed before source media override readback");
        }
        const afterClip = (await resolveMediaHealthClips(afterProject, [projectItemId]))[0];
        const after = await sourceMediaOverrideSnapshot(projectGuid, afterClip, projectItemId);
        const expectedAfter = {
          projectGuid,
          projectItemId,
          frameRate: requested.frameRate == null ? expected.frameRate : requested.frameRate,
          pixelAspectRatio: requested.pixelAspectRatio == null
            ? expected.pixelAspectRatio
            : requested.pixelAspectRatio.numerator / requested.pixelAspectRatio.denominator
        };
        if (!sameSourceMediaOverrides(after, expectedAfter)) {
          throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not retain the requested source media interpretation override");
        }
        return {
          updated: true,
          projectItemId,
          before,
          after,
          requested,
          outcome: "verified",
          verificationBoundary: "source_media_effective_interpretation_readback",
          undoLabel: "Set source media interpretation override"
        };
      });
    }

    function withSourceMediaUpdateLock(key, operation) {
      const previous = sourceMediaUpdateTails.get(key) || Promise.resolve();
      let release;
      const gate = new Promise(function (resolve) { release = resolve; });
      const tail = previous.catch(function () { return undefined; }).then(function () { return gate; });
      sourceMediaUpdateTails.set(key, tail);
      return previous.catch(function () { return undefined; }).then(operation).finally(function () {
        release();
        if (sourceMediaUpdateTails.get(key) === tail) sourceMediaUpdateTails.delete(key);
      });
    }

    async function sourceMediaOverrideSnapshot(projectGuid, clip, projectItemId) {
      if (!clip || typeof clip.getFootageInterpretation !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This project item cannot expose source media interpretation");
      }
      const interpretation = await clip.getFootageInterpretation();
      if (!interpretation || typeof interpretation.getFrameRate !== "function" || typeof interpretation.getPixelAspectRatio !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This source media cannot read its effective frame rate and pixel aspect ratio");
      }
      return {
        projectGuid,
        projectItemId,
        frameRate: boundedSourceFrameRate(interpretation.getFrameRate(), "host frameRate"),
        pixelAspectRatio: boundedPixelAspectRatio(interpretation.getPixelAspectRatio(), "host pixelAspectRatio")
      };
    }

    function requiredSourceMediaOverrides(value, name) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw commandError("UXP_INVALID_ARGUMENT", name + " must be an inspect snapshot object");
      }
      assertOnlyKeys(value, ["projectGuid", "frameRate", "pixelAspectRatio"]);
      return {
        projectGuid: optionalToken(value.projectGuid, name + ".projectGuid"),
        frameRate: boundedSourceFrameRate(value.frameRate, name + ".frameRate"),
        pixelAspectRatio: boundedPixelAspectRatio(value.pixelAspectRatio, name + ".pixelAspectRatio")
      };
    }

    function requestedSourceMediaOverrides(args) {
      const frameRate = args.frameRate == null ? null : boundedSourceFrameRate(args.frameRate, "frameRate");
      let pixelAspectRatio = null;
      if (args.pixelAspectRatio != null) {
        const value = args.pixelAspectRatio;
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw commandError("UXP_INVALID_ARGUMENT", "pixelAspectRatio must be a ratio object");
        }
        assertOnlyKeys(value, ["numerator", "denominator"]);
        pixelAspectRatio = {
          numerator: integer(value.numerator, "pixelAspectRatio.numerator", 1, 10000),
          denominator: integer(value.denominator, "pixelAspectRatio.denominator", 1, 10000)
        };
        boundedPixelAspectRatio(pixelAspectRatio.numerator / pixelAspectRatio.denominator, "pixelAspectRatio");
      }
      if (frameRate == null && pixelAspectRatio == null) {
        throw commandError("UXP_INVALID_ARGUMENT", "Provide frameRate and/or pixelAspectRatio to update");
      }
      return { frameRate, pixelAspectRatio };
    }

    function boundedSourceFrameRate(value, name) {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 1 || number > 240) {
        throw commandError("UXP_INVALID_ARGUMENT", name + " must be between 1 and 240 frames per second");
      }
      return number;
    }

    function boundedPixelAspectRatio(value, name) {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0.01 || number > 100) {
        throw commandError("UXP_INVALID_ARGUMENT", name + " must be between 0.01 and 100");
      }
      return number;
    }

    function sameSourceMediaOverrides(left, right) {
      return !!left && !!right && left.projectGuid === right.projectGuid &&
        (right.projectItemId == null || left.projectItemId === right.projectItemId) &&
        sameSeconds(left.frameRate, right.frameRate) && sameSeconds(left.pixelAspectRatio, right.pixelAspectRatio);
    }

    async function sourceMediaForUpdate(clip) {
      if (!clip || typeof clip.getMedia !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This project item cannot expose source media timing");
      }
      const media = await clip.getMedia();
      if (!media || typeof media.createSetStartAction !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This source media cannot create a start-time action");
      }
      return media;
    }

    async function sourceMediaTimingSnapshot(clip, projectItemId) {
      const media = await sourceMediaForRead(clip);
      const start = await mediaTimingValue(media, "start");
      const duration = await mediaTimingValue(media, "duration");
      if (start.seconds == null || duration.seconds == null) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not return a bounded source media timing snapshot");
      }
      return { projectItemId, startSeconds: start.seconds, durationSeconds: duration.seconds };
    }

    async function sourceMediaForRead(clip) {
      if (!clip || typeof clip.getMedia !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This project item cannot expose source media timing");
      }
      const media = await clip.getMedia();
      if (!media) throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere did not return source media for this project item");
      return media;
    }

    function synchronousSourceMediaTimingSnapshot(media, projectItemId) {
      const start = synchronousMediaTimingValue(media, "start");
      const duration = synchronousMediaTimingValue(media, "duration");
      if (start == null || duration == null) {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This host cannot synchronously read stable source media timing during action creation");
      }
      return { projectItemId, startSeconds: start, durationSeconds: duration };
    }

    function synchronousMediaTimingValue(media, propertyName) {
      try {
        const value = media[propertyName];
        if (value && typeof value.then === "function") return null;
        return boundedMediaTimingSeconds(value);
      } catch (_) { return null; }
    }

    function requiredSourceMediaTiming(value, name) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw commandError("UXP_INVALID_ARGUMENT", name + " must be an inspect snapshot object");
      }
      assertOnlyKeys(value, ["startSeconds", "durationSeconds"]);
      return {
        startSeconds: boundedSeconds(value.startSeconds, name + ".startSeconds"),
        durationSeconds: boundedSeconds(value.durationSeconds, name + ".durationSeconds")
      };
    }

    function sameSourceMediaTiming(left, right) {
      return !!left && !!right && sameSeconds(left.startSeconds, right.startSeconds) && sameSeconds(left.durationSeconds, right.durationSeconds);
    }

    async function resolveMediaHealthClips(project, projectItemIds) {
      if (projectItemIds == null) {
        if (!ppro.ProjectUtils || typeof ppro.ProjectUtils.getSelection !== "function") {
          throw commandError("UXP_INVALID_ARGUMENT", "projectItemIds are required because Project-panel selection is unavailable");
        }
        const selection = await ppro.ProjectUtils.getSelection(project);
        const selected = selection && Array.from(await selection.getItems() || []);
        if (!selected || !selected.length || selected.length > 64) {
          throw commandError("UXP_INVALID_ARGUMENT", "Select 1-64 media items or pass projectItemIds");
        }
        return selected.map(castMediaClip);
      }
      if (!Array.isArray(projectItemIds) || !projectItemIds.length || projectItemIds.length > 64) {
        throw commandError("UXP_INVALID_ARGUMENT", "projectItemIds must contain 1-64 identifiers");
      }
      const wanted = projectItemIds.map(function (value, index) { return boundedIdentifier(value, "projectItemIds[" + index + "]"); });
      if (new Set(wanted).size !== wanted.length) throw commandError("UXP_INVALID_ARGUMENT", "projectItemIds must be unique");
      const found = new Map(), queue = [await project.getRootItem()];
      let visited = 0;
      while (queue.length && found.size < wanted.length) {
        const folder = queue.shift();
        if (!folder || typeof folder.getItems !== "function") continue;
        const children = Array.from(await folder.getItems() || []);
        for (let i = 0; i < children.length; i += 1) {
          visited += 1;
          if (visited > 10000) throw commandError("UXP_PROJECT_TOO_LARGE", "Project-item lookup exceeded 10000 entries");
          const item = children[i], id = await projectItemId(item);
          if (wanted.indexOf(id) !== -1) found.set(id, castMediaClip(item));
          const childFolder = castFolder(item);
          if (childFolder) queue.push(childFolder);
        }
      }
      const missing = wanted.filter(function (id) { return !found.has(id); });
      if (missing.length) throw commandError("UXP_TARGET_NOT_FOUND", "One or more projectItemIds were not found as media clips");
      return wanted.map(function (id) { return found.get(id); });
    }

    function castMediaClip(item) {
      try {
        const clip = ppro.ClipProjectItem.cast(item);
        if (clip) return clip;
      } catch (_) {}
      throw commandError("UXP_TARGET_NOT_FOUND", "A selected project item is not a media clip");
    }

    function castFolder(item) {
      if (!ppro.FolderItem || typeof ppro.FolderItem.cast !== "function") return null;
      try { return ppro.FolderItem.cast(item) || null; } catch (_) { return null; }
    }

    async function projectItemId(item) {
      let value = item;
      if (ppro.ProjectItem && typeof ppro.ProjectItem.cast === "function") {
        try { value = ppro.ProjectItem.cast(item) || item; } catch (_) {}
      }
      if (!value || typeof value.getId !== "function") return "";
      return String(await value.getId() || "");
    }

    function clipProjectItemId(clip) {
      return projectItemId(clip);
    }

    async function mediaHealthSnapshot(clip, includePaths, includeMediaTiming) {
      const id = await clipProjectItemId(clip);
      const offline = typeof clip.isOffline === "function" ? !!(await clip.isOffline()) : null;
      const hasProxy = typeof clip.hasProxy === "function" ? !!(await clip.hasProxy()) : null;
      const result = {
        projectItemId: id,
        name: String(clip.name || ""),
        offline,
        canChangeMediaPath: typeof clip.canChangeMediaPath === "function" ? !!(await clip.canChangeMediaPath()) : null,
        canProxy: typeof clip.canProxy === "function" ? !!(await clip.canProxy()) : null,
        hasProxy,
        mergedClip: typeof clip.isMergedClip === "function" ? !!(await clip.isMergedClip()) : null,
        multicamClip: typeof clip.isMulticamClip === "function" ? !!(await clip.isMulticamClip()) : null
      };
      if (includePaths) {
        result.mediaPath = typeof clip.getMediaFilePath === "function" ? String(await clip.getMediaFilePath() || "") : null;
        result.proxyPath = hasProxy && typeof clip.getProxyPath === "function" ? String(await clip.getProxyPath() || "") : null;
        result.originatingProjectPath = typeof clip.getOriginatingProjectPath === "function"
          ? String(await clip.getOriginatingProjectPath() || "") : null;
      }
      if (includeMediaTiming) result.mediaTiming = await mediaTimingSnapshot(clip);
      return result;
    }

    async function mediaTimingSnapshot(clip) {
      const unavailable = function () {
        return {
          available: false,
          startSeconds: null,
          durationSeconds: null,
          startAccessor: null,
          durationAccessor: null
        };
      };
      if (!clip || typeof clip.getMedia !== "function") return unavailable();
      let media;
      try { media = await clip.getMedia(); } catch (_) { return unavailable(); }
      if (!media) return unavailable();
      const start = await mediaTimingValue(media, "start");
      const duration = await mediaTimingValue(media, "duration");
      return {
        available: start.seconds != null && duration.seconds != null,
        startSeconds: start.seconds,
        durationSeconds: duration.seconds,
        startAccessor: start.accessor,
        durationAccessor: duration.accessor
      };
    }

    async function mediaTimingValue(media, propertyName) {
      try {
        return { accessor: propertyName, seconds: boundedMediaTimingSeconds(await media[propertyName]) };
      } catch (_) {
        return { accessor: propertyName, seconds: null };
      }
    }

    function boundedMediaTimingSeconds(value) {
      try {
        if (!value || typeof value !== "object" || typeof value.seconds !== "number") return null;
        const seconds = value.seconds;
        return Number.isFinite(seconds) && seconds >= 0 && seconds <= 86400000 ? seconds : null;
      } catch (_) { return null; }
    }

    async function inspectTrackState(args) {
      assertOnlyKeys(args, ["sequenceId", "expectedSequenceId", "mediaType", "trackIndices"]);
      const project = await activeProject(true), sequence = await resolveSequence(project, args.sequenceId, true);
      const sequenceId = guidString(sequence.guid);
      if (args.expectedSequenceId != null && optionalToken(args.expectedSequenceId, "expectedSequenceId") !== sequenceId) {
        throw commandError("UXP_STALE_TARGET", "The target sequence changed before track inspection");
      }
      const mediaType = trackMediaType(args.mediaType, true);
      if (mediaType === "all" && args.trackIndices != null) {
        throw commandError("UXP_INVALID_ARGUMENT", "trackIndices require one explicit mediaType");
      }
      const mediaTypes = mediaType === "all" ? ["video", "audio", "caption"] : [mediaType];
      const tracks = [];
      for (let i = 0; i < mediaTypes.length; i += 1) {
        const type = mediaTypes[i], indices = await requestedTrackIndices(sequence, type, args.trackIndices, false);
        for (let j = 0; j < indices.length; j += 1) tracks.push(await trackStateSnapshot(await trackAt(sequence, type, indices[j]), type, indices[j]));
      }
      return { sequenceId, count: tracks.length, tracks, verificationBoundary: "track_mute_readback" };
    }

    async function setTrackState(args) {
      assertOnlyKeys(args, ["sequenceId", "expectedSequenceId", "mediaType", "trackIndices", "muted", "expectedMuted", "operationId"]);
      const project = await activeProject(true), sequence = await resolveSequence(project, args.sequenceId, true);
      const sequenceId = guidString(sequence.guid);
      if (args.expectedSequenceId != null && optionalToken(args.expectedSequenceId, "expectedSequenceId") !== sequenceId) {
        throw commandError("UXP_STALE_TARGET", "The target sequence changed before track mutation");
      }
      const mediaType = trackMediaType(args.mediaType, false);
      if (typeof args.muted !== "boolean") throw commandError("UXP_INVALID_ARGUMENT", "muted must be a boolean");
      const expectedMuted = optionalExpectedBoolean(args.expectedMuted, "expectedMuted");
      const indices = await requestedTrackIndices(sequence, mediaType, args.trackIndices, true);
      const targets = [];
      for (let i = 0; i < indices.length; i += 1) {
        const track = await trackAt(sequence, mediaType, indices[i]);
        if (typeof track.setMute !== "function" || typeof track.isMuted !== "function") {
          throw commandError("UXP_COMMAND_UNAVAILABLE", "A target track cannot report and set mute state");
        }
        const beforeMuted = !!(await track.isMuted());
        if (expectedMuted != null && beforeMuted !== expectedMuted) {
          throw commandError("UXP_STALE_TARGET", "A target track changed mute state before dispatch");
        }
        targets.push({ track, trackIndex: indices[i], beforeMuted });
      }
      const tracks = [];
      for (let i = 0; i < targets.length; i += 1) {
        const target = targets[i];
        try {
          const accepted = !!(await target.track.setMute(args.muted));
          const afterMuted = !!(await target.track.isMuted());
          tracks.push({
            mediaType, trackIndex: target.trackIndex, beforeMuted: target.beforeMuted,
            requestedMuted: args.muted, accepted, afterMuted,
            verified: accepted && afterMuted === args.muted
          });
        } catch (error) {
          tracks.push({
            mediaType, trackIndex: target.trackIndex, beforeMuted: target.beforeMuted,
            requestedMuted: args.muted, accepted: false, verified: false,
            error: error && error.message || String(error)
          });
        }
      }
      const verified = tracks.filter(function (track) { return track.verified; }).length;
      return {
        sequenceId,
        mediaType,
        requested: tracks.length,
        updated: verified,
        failed: tracks.length - verified,
        tracks,
        outcome: verified === tracks.length ? "verified" : verified ? "partial" : "failed",
        undoable: false,
        verificationBoundary: "per_track_mute_readback"
      };
    }

    function trackMediaType(value, allowAll) {
      const result = value == null ? (allowAll ? "all" : null) : value;
      if (result === "video" || result === "audio" || result === "caption" || (allowAll && result === "all")) return result;
      throw commandError("UXP_INVALID_ARGUMENT", "mediaType must be " + (allowAll ? "all, " : "") + "video, audio, or caption");
    }

    async function requestedTrackIndices(sequence, mediaType, values, required) {
      const countMethod = { video: "getVideoTrackCount", audio: "getAudioTrackCount", caption: "getCaptionTrackCount" }[mediaType];
      const count = Number(await sequence[countMethod]());
      if (!Number.isInteger(count) || count < 0 || count > 1024) throw commandError("UXP_PROJECT_TOO_LARGE", "Track count is invalid or exceeds 1024");
      if (values == null) {
        if (required) throw commandError("UXP_INVALID_ARGUMENT", "trackIndices are required for set");
        if (count > 64) throw commandError("UXP_PROJECT_TOO_LARGE", "Inspecting all tracks exceeds the 64-track response cap");
        return Array.from({ length: count }, function (_, index) { return index; });
      }
      if (!Array.isArray(values) || !values.length || values.length > 64) {
        throw commandError("UXP_INVALID_ARGUMENT", "trackIndices must contain 1-64 indices");
      }
      const indices = values.map(function (value, index) { return integer(value, "trackIndices[" + index + "]", 0, Math.max(0, count - 1)); });
      if (new Set(indices).size !== indices.length) throw commandError("UXP_INVALID_ARGUMENT", "trackIndices must be unique");
      return indices;
    }

    async function trackAt(sequence, mediaType, index) {
      const method = { video: "getVideoTrack", audio: "getAudioTrack", caption: "getCaptionTrack" }[mediaType];
      if (typeof sequence[method] !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "This sequence cannot access " + mediaType + " tracks");
      const track = await sequence[method](index);
      if (!track) throw commandError("UXP_TARGET_NOT_FOUND", "Track index was not found");
      return track;
    }

    async function trackStateSnapshot(track, mediaType, requestedIndex) {
      return {
        mediaType,
        trackIndex: typeof track.getIndex === "function" ? Number(await track.getIndex()) : requestedIndex,
        trackId: track.id == null ? null : Number(track.id),
        name: String(track.name || ""),
        muted: typeof track.isMuted === "function" ? !!(await track.isMuted()) : null
      };
    }

    async function inspectSourceClip(args) {
      assertOnlyKeys(args, ["items"]);
      const input = validateSourceClipItems(args.items, false);
      const project = await activeProject(true);
      const clips = await resolveMediaHealthClips(project, input.map(function (item) { return item.projectItemId; }));
      const items = [];
      for (let i = 0; i < input.length; i += 1) items.push(await sourceClipSnapshot(clips[i], input[i].projectItemId, input[i].mediaType));
      return { count: items.length, items, verificationBoundary: "source_in_out_readback" };
    }

    async function updateSourceClip(args) {
      assertOnlyKeys(args, ["items", "operationId"]);
      const input = validateSourceClipItems(args.items, true);
      const project = await activeProject(true);
      const clips = await resolveMediaHealthClips(project, input.map(function (item) { return item.projectItemId; }));
      const targets = [];
      for (let i = 0; i < input.length; i += 1) {
        const before = await sourceClipSnapshot(clips[i], input[i].projectItemId, input[i].mediaType);
        if (input[i].expectedInSeconds != null && !sameSeconds(before.inSeconds, input[i].expectedInSeconds)) {
          throw commandError("UXP_STALE_TARGET", "A source in point changed before the transaction");
        }
        if (input[i].expectedOutSeconds != null && !sameSeconds(before.outSeconds, input[i].expectedOutSeconds)) {
          throw commandError("UXP_STALE_TARGET", "A source out point changed before the transaction");
        }
        targets.push({ input: input[i], clip: clips[i], before });
      }
      let committed = false;
      project.lockedAccess(function () {
        const actions = [];
        for (let i = 0; i < targets.length; i += 1) {
          const target = targets[i], value = target.input;
          if (value.clearInOut) {
            actions.push(target.clip.createClearInOutPointsAction());
          } else if (value.inSeconds != null && value.outSeconds != null) {
            actions.push(target.clip.createSetInOutPointsAction(
              ppro.TickTime.createWithSeconds(value.inSeconds),
              ppro.TickTime.createWithSeconds(value.outSeconds)
            ));
          } else {
            if (value.inSeconds != null) actions.push(target.clip.createSetInPointAction(ppro.TickTime.createWithSeconds(value.inSeconds)));
            if (value.outSeconds != null) actions.push(target.clip.createSetOutPointAction(ppro.TickTime.createWithSeconds(value.outSeconds)));
          }
          if (value.scaleToFrame) actions.push(target.clip.createSetScaleToFrameSizeAction());
        }
        committed = project.executeTransaction(function (compoundAction) {
          for (let i = 0; i < actions.length; i += 1) {
            if (!actions[i] || compoundAction.addAction(actions[i]) === false) {
              throw commandError("UXP_ACTION_REJECTED", "Premiere rejected a source-clip action");
            }
          }
        }, "Update source clip trim and framing");
      });
      if (!committed) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not commit the source-clip transaction");
      const items = [];
      let fullyVerified = true;
      for (let i = 0; i < targets.length; i += 1) {
        const target = targets[i], after = await sourceClipSnapshot(target.clip, target.input.projectItemId, target.input.mediaType);
        let trimVerified = true;
        if (target.input.inSeconds != null) trimVerified = trimVerified && sameSeconds(after.inSeconds, target.input.inSeconds);
        if (target.input.outSeconds != null) trimVerified = trimVerified && sameSeconds(after.outSeconds, target.input.outSeconds);
        const clearVerified = target.input.clearInOut ? false : null;
        const scaleVerified = target.input.scaleToFrame ? false : null;
        if (!trimVerified) throw commandError("UXP_VERIFICATION_FAILED", "Source in/out readback did not match the requested trim");
        if (target.input.clearInOut || target.input.scaleToFrame) fullyVerified = false;
        items.push({
          projectItemId: target.input.projectItemId,
          mediaType: target.input.mediaType,
          before: target.before,
          after,
          trimVerified,
          clearRequested: target.input.clearInOut,
          clearVerified,
          scaleToFrameRequested: target.input.scaleToFrame,
          scaleToFrameVerified: scaleVerified
        });
      }
      return {
        updated: items.length,
        items,
        outcome: fullyVerified ? "verified" : "committed_unverified",
        verificationBoundary: fullyVerified ? "source_in_out_readback" : "transaction_commit_with_missing_clear_or_scale_getter",
        undoLabel: "Update source clip trim and framing"
      };
    }

    function validateSourceClipItems(value, mutation) {
      if (!Array.isArray(value) || !value.length || value.length > 64) {
        throw commandError("UXP_INVALID_ARGUMENT", "items must contain 1-64 source clips");
      }
      const ids = new Set();
      return value.map(function (item, index) {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw commandError("UXP_INVALID_ARGUMENT", "items[" + index + "] must be an object");
        const allowed = mutation
          ? ["projectItemId", "mediaType", "expectedInSeconds", "expectedOutSeconds", "inSeconds", "outSeconds", "clearInOut", "scaleToFrame"]
          : ["projectItemId", "mediaType"];
        assertOnlyKeys(item, allowed);
        const projectItemId = boundedIdentifier(item.projectItemId, "items[" + index + "].projectItemId");
        if (ids.has(projectItemId)) throw commandError("UXP_INVALID_ARGUMENT", "Each projectItemId may appear only once per transaction");
        ids.add(projectItemId);
        const mediaType = item.mediaType == null ? "video" : item.mediaType;
        if (mediaType !== "video" && mediaType !== "audio") throw commandError("UXP_INVALID_ARGUMENT", "mediaType must be video or audio");
        const result = { projectItemId, mediaType };
        if (!mutation) return result;
        const numberKeys = ["expectedInSeconds", "expectedOutSeconds", "inSeconds", "outSeconds"];
        for (let i = 0; i < numberKeys.length; i += 1) {
          const key = numberKeys[i];
          if (item[key] != null) result[key] = boundedSeconds(item[key], "items[" + index + "]." + key);
        }
        result.clearInOut = optionalBoolean(item.clearInOut, false, "items[" + index + "].clearInOut");
        result.scaleToFrame = optionalBoolean(item.scaleToFrame, false, "items[" + index + "].scaleToFrame");
        if (item.scaleToFrame === false) throw commandError("UXP_INVALID_ARGUMENT", "scaleToFrame supports only true because Adobe exposes only a set-true action");
        if (result.clearInOut && (result.inSeconds != null || result.outSeconds != null)) {
          throw commandError("UXP_INVALID_ARGUMENT", "clearInOut cannot be combined with new in/out points");
        }
        if (result.inSeconds != null && result.outSeconds != null && result.outSeconds <= result.inSeconds) {
          throw commandError("UXP_INVALID_ARGUMENT", "outSeconds must be greater than inSeconds");
        }
        if (!result.clearInOut && !result.scaleToFrame && result.inSeconds == null && result.outSeconds == null) {
          throw commandError("UXP_INVALID_ARGUMENT", "Each update item must request a trim, clear, or scale-to-frame action");
        }
        return result;
      });
    }

    async function sourceClipSnapshot(clip, projectItemId, mediaType) {
      if (typeof clip.getInPoint !== "function" || typeof clip.getOutPoint !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This source clip cannot report in/out points");
      }
      const mediaConstants = ppro.Constants && ppro.Constants.MediaType || {};
      const constant = mediaConstants[mediaType === "video" ? "VIDEO" : "AUDIO"];
      if (constant == null) throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere media-type constants are unavailable");
      return {
        projectItemId,
        mediaType,
        inSeconds: tickSeconds(await clip.getInPoint(constant)),
        outSeconds: tickSeconds(await clip.getOutPoint(constant))
      };
    }

    function tickSeconds(value) {
      const seconds = value && Number(value.seconds);
      return Number.isFinite(seconds) ? seconds : null;
    }

    function sameSeconds(left, right) {
      return typeof left === "number" && Math.abs(left - right) <= 1e-6;
    }

    async function resumeLease(reason, explicitProjectId) {
      const lease = growingLease || readGrowingLease();
      const projectId = explicitProjectId == null ? lease && lease.projectId : optionalToken(explicitProjectId, "projectId");
      if (!lease && !projectId) {
        return { resumed: false, alreadyResumed: true, reason, outcome: "verified", verificationBoundary: "panel_local_lease_only" };
      }
      const project = await projectForLease(projectId);
      if (!project || typeof project.pauseGrowing !== "function") {
        throw commandError("UXP_RECOVERY_PENDING", "The paused project is not currently available for growing-media recovery");
      }
      if (!await project.pauseGrowing(false)) {
        throw commandError("UXP_RECOVERY_PENDING", "Premiere did not confirm the growing-media resume request");
      }
      clearGrowingTimer();
      growingLease = null;
      removeGrowingLease();
      return {
        resumed: true,
        projectId: guidString(project.guid),
        reason,
        outcome: "committed_unverified",
        verificationBoundary: "project_pauseGrowing_host_return_only"
      };
    }

    async function projectForLease(projectId) {
      if (projectId && ppro.Guid && typeof ppro.Guid.fromString === "function" &&
        ppro.Project && typeof ppro.Project.getProject === "function") {
        try {
          const project = ppro.Project.getProject(ppro.Guid.fromString(projectId));
          if (project) return project;
        } catch (_) {}
      }
      return ppro.Project && typeof ppro.Project.getActiveProject === "function"
        ? ppro.Project.getActiveProject()
        : null;
    }

    function readGrowingLease() {
      if (!localStorage || typeof localStorage.getItem !== "function") return null;
      try {
        const value = JSON.parse(localStorage.getItem(GROWING_LEASE_KEY) || "null");
        if (!value || value.schemaVersion !== 1 || typeof value.projectId !== "string" ||
          !Number.isFinite(value.expiresAt)) return null;
        return { schemaVersion: 1, projectId: value.projectId, expiresAt: value.expiresAt };
      } catch (_) { return null; }
    }

    function writeGrowingLease(value) {
      if (!localStorage || typeof localStorage.setItem !== "function") return;
      try { localStorage.setItem(GROWING_LEASE_KEY, JSON.stringify(value)); } catch (_) {}
    }

    function removeGrowingLease() {
      if (!localStorage || typeof localStorage.removeItem !== "function") return;
      try { localStorage.removeItem(GROWING_LEASE_KEY); } catch (_) {}
    }

    function clearGrowingTimer() {
      if (growingTimer != null) cancelTimer(growingTimer);
      growingTimer = null;
    }

    async function openProjectInventory(includePaths) {
      const viewIds = Array.from(await ppro.ProjectUtils.getProjectViewIds() || []);
      if (viewIds.length > 64) throw commandError("UXP_PROJECT_TOO_LARGE", "Open Project views exceed the 64-view safety cap");
      const seen = new Set(), projects = [];
      for (let i = 0; i < viewIds.length; i += 1) {
        const project = await ppro.ProjectUtils.getProjectFromViewId(viewIds[i]);
        if (!project) continue;
        const projectId = guidString(project.guid);
        if (!projectId || seen.has(projectId)) continue;
        seen.add(projectId);
        projects.push({
          projectId,
          name: String(project.name || ""),
          hasPath: !!project.path,
          ...(includePaths ? { path: String(project.path || "") } : {})
        });
      }
      return projects;
    }

    async function targetProject(projectId) {
      if (projectId == null) {
        const active = await ppro.Project.getActiveProject();
        if (!active) throw commandError("UXP_NO_ACTIVE_PROJECT", "No active project");
        return active;
      }
      const token = optionalToken(projectId, "projectId");
      if (!ppro.Guid || typeof ppro.Guid.fromString !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build cannot resolve a project GUID");
      }
      let project = null;
      try { project = ppro.Project.getProject(ppro.Guid.fromString(token)); } catch (_) {}
      if (!project) throw commandError("UXP_TARGET_NOT_FOUND", "The requested project is not open");
      return project;
    }

    async function allowedWorkspacePath(value, label) {
      const path = requiredPath(value, label);
      if (!deps.workspace || typeof deps.workspace.assertPathAllowed !== "function") {
        throw commandError("UXP_WORKSPACE_REQUIRED", "An approved UXP workspace is required");
      }
      return deps.workspace.assertPathAllowed(path, { label, kind: "file" });
    }

    function rejectExistingProject(path, confirmation) {
      if (ppro.Project.isProject(path) && confirmation !== true) {
        throw commandError("UXP_CONFIRMATION_REQUIRED", "confirmOverwrite is required when the destination is already a Premiere project");
      }
    }

    function projectMutationReceipt(action, project, path) {
      return {
        action,
        projectId: guidString(project.guid),
        projectName: String(project.name || ""),
        path,
        outcome: "verified",
        verificationBoundary: "project_path_readback"
      };
    }

    function assertProjectPath(project, expectedPath, label) {
      if (!project || !samePath(String(project.path || ""), expectedPath)) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not expose the expected " + label + " path");
      }
    }

    function samePath(left, right) {
      const normalize = function (value) { return String(value || "").replace(/\\/g, "/").replace(/\/$/, ""); };
      const a = normalize(left), b = normalize(right);
      return /^[A-Za-z]:\//.test(a) || /^\/\//.test(a) ? a.toLowerCase() === b.toLowerCase() : a === b;
    }

    function openOptions(args) {
      const value = typeof ppro.OpenProjectOptions === "function" ? ppro.OpenProjectOptions() : undefined;
      if (!value) return undefined;
      const showDialogs = optionalBoolean(args.showDialogs, false, "showDialogs");
      const addToMru = optionalBoolean(args.addToMru, false, "addToMru");
      if (typeof value.setShowConvertProjectDialog === "function") value.setShowConvertProjectDialog(showDialogs);
      if (typeof value.setShowLocateFileDialog === "function") value.setShowLocateFileDialog(showDialogs);
      if (typeof value.setShowWarningDialog === "function") value.setShowWarningDialog(showDialogs);
      if (typeof value.setAddToMRUList === "function") value.setAddToMRUList(addToMru);
      return value;
    }

    function closeOptions(args) {
      const value = typeof ppro.CloseProjectOptions === "function" ? ppro.CloseProjectOptions() : undefined;
      if (!value) return undefined;
      if (typeof value.setPromptIfDirty === "function") value.setPromptIfDirty(!!args.promptIfDirty);
      if (typeof value.setShowCancelButton === "function") value.setShowCancelButton(true);
      if (typeof value.setIsAppBeingPreparedToQuit === "function") value.setIsAppBeingPreparedToQuit(false);
      if (typeof value.setSaveWorkspace === "function") value.setSaveWorkspace(true);
      return value;
    }

    async function activeProject(required) {
      const project = canInspectReadiness() ? await ppro.Project.getActiveProject() : null;
      if (!project && required) throw commandError("UXP_NO_ACTIVE_PROJECT", "No active project");
      return project;
    }

    async function resolveSequence(project, sequenceId, required) {
      if (!project) return null;
      if (sequenceId == null) {
        const active = await project.getActiveSequence();
        if (!active && required) throw commandError("UXP_NO_ACTIVE_SEQUENCE", "No active sequence");
        return active;
      }
      const wanted = optionalToken(sequenceId, "sequenceId");
      const values = Array.from(await project.getSequences() || []);
      if (values.length > 1024) throw commandError("UXP_PROJECT_TOO_LARGE", "Sequence lookup exceeds 1024 entries");
      const sequence = values.find(function (item) { return guidString(item && item.guid) === wanted; }) || null;
      if (!sequence && required) throw commandError("UXP_TARGET_NOT_FOUND", "Sequence was not found");
      return sequence;
    }

    function operationOutcome(state) {
      if (state == null) return "unknown";
      const constants = ppro.Constants && ppro.Constants.OperationCompleteState || {};
      const staticValues = ppro.OperationCompleteEvent || {};
      const success = constants.SUCCESS != null ? constants.SUCCESS : staticValues.OPERATION_STATE_SUCCESS;
      const cancelled = constants.CANCELLED != null ? constants.CANCELLED : staticValues.OPERATION_STATE_CANCELLED;
      const failed = constants.FAILED != null ? constants.FAILED : staticValues.OPERATION_STATE_FAILED;
      if (state === success) return "completed";
      if (state === cancelled) return "cancelled";
      if (state === failed) return "failed";
      return "unknown";
    }
  }

  function query(args, allowTimeout) {
    const value = args || {};
    return {
      afterRevision: value.afterRevision == null ? 0 : integer(value.afterRevision, "afterRevision", 0, Number.MAX_SAFE_INTEGER),
      categories: tokenArray(value.categories, "categories"),
      eventNames: tokenArray(value.eventNames, "eventNames"),
      limit: value.limit == null ? 100 : integer(value.limit, "limit", 1, 256),
      timeoutMs: allowTimeout && value.timeoutMs != null ? integer(value.timeoutMs, "timeoutMs", 0, 60000) : 0
    };
  }

  function tokenArray(value, name) {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > 32) throw commandError("UXP_INVALID_ARGUMENT", name + " must contain at most 32 values");
    return value.map(function (item) {
      if (typeof item !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(item)) {
        throw commandError("UXP_INVALID_ARGUMENT", name + " contains an invalid token");
      }
      return item;
    });
  }

  function integer(value, name, minimum, maximum) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum || number > maximum) {
      throw commandError("UXP_INVALID_ARGUMENT", name + " must be an integer between " + minimum + " and " + maximum);
    }
    return number;
  }

  function optionalToken(value, name) {
    if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
      throw commandError("UXP_INVALID_ARGUMENT", name + " must be a 1-128 character token");
    }
    return value;
  }

  function requireOperationId(value, name) {
    if (value == null) throw commandError("UXP_INVALID_ARGUMENT", name + " is required for safe replay");
    return optionalToken(value, name);
  }

  function requiredPath(value, name) {
    if (typeof value !== "string" || !value.trim() || value.length > 4096 || value.indexOf("\0") !== -1) {
      throw commandError("UXP_INVALID_ARGUMENT", name + " must be a non-empty absolute path of at most 4096 characters");
    }
    return value;
  }

  function boundedIdentifier(value, name) {
    if (typeof value !== "string" || !value || value.length > 512 || value.indexOf("\0") !== -1) {
      throw commandError("UXP_INVALID_ARGUMENT", name + " must be a non-empty identifier of at most 512 characters");
    }
    return value;
  }

  function boundedSeconds(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 86400000) {
      throw commandError("UXP_INVALID_ARGUMENT", name + " must be between 0 and 86400000 seconds");
    }
    return number;
  }

  function optionalExpectedBoolean(value, name) {
    if (value == null) return null;
    if (typeof value !== "boolean") throw commandError("UXP_INVALID_ARGUMENT", name + " must be a boolean");
    return value;
  }

  function optionalBoolean(value, fallback, name) {
    if (value == null) return fallback;
    if (typeof value !== "boolean") throw commandError("UXP_INVALID_ARGUMENT", name + " must be a boolean");
    return value;
  }

  function requireConfirmation(value, name, reason) {
    if (value !== true) throw commandError("UXP_CONFIRMATION_REQUIRED", name + " must be true. " + reason + ".");
  }

  function guidString(value) {
    if (value == null) return "";
    try { return typeof value.toString === "function" ? String(value.toString()) : String(value); } catch (_) { return ""; }
  }

  function assertOnlyKeys(value, allowed) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw commandError("UXP_INVALID_ARGUMENT", "arguments must be an object");
    for (const key of Object.keys(value)) if (allowed.indexOf(key) === -1) throw commandError("UXP_INVALID_ARGUMENT", "Unexpected argument: " + key);
  }

  function commandError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  return { createNextWorkflowDefinitions, createNextWorkflowRuntime };
});
