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

  function requiredPath(value, name) {
    if (typeof value !== "string" || !value.trim() || value.length > 4096 || value.indexOf("\0") !== -1) {
      throw commandError("UXP_INVALID_ARGUMENT", name + " must be a non-empty absolute path of at most 4096 characters");
    }
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
