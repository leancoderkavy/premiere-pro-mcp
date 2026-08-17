(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpNextWorkflows = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createNextWorkflowDefinitions(deps) {
    const ppro = deps.ppro, events = deps.events;
    const now = typeof deps.now === "function" ? deps.now : function () { return Date.now(); };
    const sleep = typeof deps.sleep === "function" ? deps.sleep : function (milliseconds) {
      return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
    };
    return {
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
      }
    };

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

  return { createNextWorkflowDefinitions };
});
