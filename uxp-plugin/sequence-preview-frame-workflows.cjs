(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpSequencePreviewFrameWorkflows = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // This workflow intentionally owns its per-sequence lock instead of extending
  // the broad sequence-settings profile. A reviewed preview rectangle must not
  // be silently applied after another invocation has changed the same sequence.
  function createSequencePreviewFrameWorkflowDefinitions(deps) {
    const ppro = deps.ppro;
    const tails = new Map();
    const definitions = {
      "sequence.previewFrame.inspect": {
        readOnly: true,
        targetCapabilityProbe: true,
        minHostVersion: "26.3.0",
        probe: canUseSequencePreviewFrame,
        handler: inspectSequencePreviewFrame
      },
      "sequence.previewFrame.update": {
        destructive: true,
        undoable: true,
        idempotent: true,
        targetCapabilityProbe: true,
        minHostVersion: "26.3.0",
        probe: canUseSequencePreviewFrame,
        handler: updateSequencePreviewFrame
      }
    };

    function canUseSequencePreviewFrame() {
      return !!(ppro.Project && typeof ppro.Project.getActiveProject === "function" && typeof ppro.RectF === "function");
    }

    async function inspectSequencePreviewFrame(args) {
      assertOnlyKeys(args, ["sequenceId"]);
      const sequenceId = requiredGuid(args.sequenceId, "sequenceId");
      const first = await targetSequence(sequenceId, false);
      const before = await previewFrameSnapshot(first);
      const second = await targetSequence(sequenceId, false);
      const after = await previewFrameSnapshot(second);
      if (!sameSnapshot(before, after)) {
        throw commandError("UXP_STALE_SEQUENCE_PREVIEW_FRAME", "The reviewed project, sequence, or preview frame changed while it was being inspected");
      }
      return after;
    }

    async function updateSequencePreviewFrame(args) {
      assertOnlyKeys(args, ["sequenceId", "previewWidth", "previewHeight", "expectedSnapshot", "confirmSetPreviewFrame", "operationId"]);
      const sequenceId = requiredGuid(args.sequenceId, "sequenceId");
      const requested = previewRect(args.previewWidth, args.previewHeight, "requested preview frame");
      const expected = requiredSnapshot(args.expectedSnapshot);
      requireConfirmation(args.confirmSetPreviewFrame);
      requireOperationId(args.operationId);
      if (expected.sequenceId !== sequenceId) {
        throw commandError("UXP_INVALID_ARGUMENT", "expectedSnapshot.sequenceId must exactly match sequenceId");
      }
      // The complete reviewed owner identity is enough to join the tail before
      // *any* live preflight getter. If the project has changed, the guarded
      // snapshot inside the tail fails closed instead of selecting a new owner.
      const lockKey = expected.projectGuid + "\u0000" + expected.sequenceId;
      return withSequenceLock(lockKey, async function () {
        // Re-resolve only after joining the owner-specific tail. A distinct
        // operation ID cannot bypass the reviewed snapshot between preflight
        // and action construction inside this bridge process.
        let context;
        try {
          context = await targetSequence(sequenceId, true);
        } catch (error) {
          if (error && error.code === "UXP_TARGET_NOT_FOUND") {
            throw commandError("UXP_STALE_SEQUENCE_PREVIEW_FRAME", "The reviewed sequence no longer resolves before preview-frame action creation");
          }
          throw error;
        }
        const before = await previewFrameSnapshot(context);
        if (!sameSnapshot(before, expected)) {
          throw commandError("UXP_STALE_SEQUENCE_PREVIEW_FRAME", "The reviewed preview frame changed before action creation");
        }
        const settings = await requiredMethod(context.sequence, "getSettings")();
        if (!settings || typeof settings.setPreviewFrameRect !== "function") {
          throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere does not expose SequenceSettings.setPreviewFrameRect for this sequence");
        }
        const nativeRect = nativeRectFor(requested);
        let accepted;
        try {
          accepted = await settings.setPreviewFrameRect(nativeRect);
        } catch (error) {
          throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the requested preview frame rectangle: " + messageOf(error));
        }
        if (accepted !== true) throw commandError("UXP_ACTION_REJECTED", "Premiere did not accept the requested preview frame rectangle");

        let committed = false;
        context.project.lockedAccess(function () {
          if (requiredGuid(context.project.guid, "active project GUID") !== before.projectGuid ||
              requiredGuid(context.sequence.guid, "target sequence GUID") !== before.sequenceId) {
            throw commandError("UXP_STALE_SEQUENCE_PREVIEW_FRAME", "The active project or reviewed sequence changed before preview-frame action creation");
          }
          if (typeof context.sequence.createSetSettingsAction !== "function") {
            throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere does not expose Sequence.createSetSettingsAction for this sequence");
          }
          const action = context.sequence.createSetSettingsAction(settings);
          if (!action) throw commandError("UXP_ACTION_REJECTED", "Premiere did not create a preview-frame settings action");
          committed = context.project.executeTransaction(function (compoundAction) {
            if (!compoundAction || typeof compoundAction.addAction !== "function" || compoundAction.addAction(action) === false) {
              throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the preview-frame settings action");
            }
          }, "Set sequence preview frame");
        });
        if (!committed) throw commandError("UXP_TRANSACTION_FAILED", "Premiere did not commit the preview-frame settings transaction");

        const after = await previewFrameSnapshot(await targetSequence(sequenceId, true));
        if (after.projectGuid !== before.projectGuid || after.sequenceId !== before.sequenceId ||
            after.previewWidth !== requested.width || after.previewHeight !== requested.height) {
          throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not retain the requested preview frame after the transaction");
        }
        return {
          previewFrameUpdated: true,
          before,
          after,
          outcome: "verified",
          verificationBoundary: "sequence_preview_frame_readback",
          undoLabel: "Set sequence preview frame"
        };
      });
    }

    async function targetSequence(sequenceId, requireTransaction) {
      if (!ppro.Project || typeof ppro.Project.getActiveProject !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere project APIs are unavailable");
      }
      const project = await ppro.Project.getActiveProject();
      if (!project) throw commandError("UXP_NO_ACTIVE_PROJECT", "No active project");
      if (requireTransaction && (typeof project.lockedAccess !== "function" || typeof project.executeTransaction !== "function")) {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build does not expose locked undoable transactions");
      }
      const projectGuid = requiredGuid(project.guid, "active project GUID");
      const sequences = await requiredMethod(project, "getSequences")();
      if (!Array.isArray(sequences)) throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned an invalid sequence collection");
      if (sequences.length > 1024) throw commandError("UXP_TARGET_TOO_LARGE", "The active project has more than 1024 sequences");
      const sequence = sequences.find(function (candidate) {
        return candidate && guidString(candidate.guid) === sequenceId;
      });
      if (!sequence) throw commandError("UXP_TARGET_NOT_FOUND", "sequenceId does not identify a sequence in the active project");
      return { project, projectGuid, sequence, sequenceId: requiredGuid(sequence.guid, "target sequence GUID") };
    }

    async function previewFrameSnapshot(context) {
      const settings = await requiredMethod(context.sequence, "getSettings")();
      if (!settings || typeof settings.getPreviewFrameRect !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere does not expose SequenceSettings.getPreviewFrameRect for this sequence");
      }
      const rect = await settings.getPreviewFrameRect();
      const dimensions = previewRect(rect && rect.width, rect && rect.height, "native preview frame");
      return {
        projectGuid: context.projectGuid,
        sequenceId: context.sequenceId,
        previewWidth: dimensions.width,
        previewHeight: dimensions.height
      };
    }

    function nativeRectFor(requested) {
      let rect;
      try { rect = new ppro.RectF(); } catch (error) {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere could not construct a documented RectF: " + messageOf(error));
      }
      if (!rect || typeof rect !== "object") throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere did not construct a documented RectF");
      try {
        rect.width = requested.width;
        rect.height = requested.height;
      } catch (error) {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere rejected the requested RectF dimensions: " + messageOf(error));
      }
      if (Number(rect.width) !== requested.width || Number(rect.height) !== requested.height) {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere did not retain the requested RectF dimensions");
      }
      return rect;
    }

    function withSequenceLock(key, operation) {
      const previous = tails.get(key) || Promise.resolve();
      let release;
      const gate = new Promise(function (resolve) { release = resolve; });
      const tail = previous.catch(function () { return undefined; }).then(function () { return gate; });
      tails.set(key, tail);
      return previous.catch(function () { return undefined; }).then(operation).finally(function () {
        release();
        if (tails.get(key) === tail) tails.delete(key);
      });
    }

    return definitions;
  }

  function assertObject(value, name) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw commandError("UXP_INVALID_ARGUMENT", (name || "args") + " must be an object");
  }
  function assertOnlyKeys(value, allowed) {
    assertObject(value, "args");
    const unknown = Object.keys(value).filter(function (key) { return !allowed.includes(key); });
    if (unknown.length) throw commandError("UXP_INVALID_ARGUMENT", "Unknown argument: " + unknown[0]);
  }
  function requiredMethod(value, method) {
    if (!value || typeof value[method] !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere does not expose " + method + " for this target");
    return value[method].bind(value);
  }
  function requiredSnapshot(value) {
    assertObject(value, "expectedSnapshot");
    const keys = ["projectGuid", "sequenceId", "previewWidth", "previewHeight"];
    assertOnlyKeys(value, keys);
    for (let index = 0; index < keys.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, keys[index])) {
        throw commandError("UXP_INVALID_ARGUMENT", "expectedSnapshot." + keys[index] + " is required");
      }
    }
    const dimensions = previewRect(value.previewWidth, value.previewHeight, "expectedSnapshot preview frame");
    return {
      projectGuid: requiredGuid(value.projectGuid, "expectedSnapshot.projectGuid"),
      sequenceId: requiredGuid(value.sequenceId, "expectedSnapshot.sequenceId"),
      previewWidth: dimensions.width,
      previewHeight: dimensions.height
    };
  }
  function previewRect(width, height, name) {
    return {
      width: boundedInt(width, name + ".width", 16, 10240),
      height: boundedInt(height, name + ".height", 16, 8192)
    };
  }
  function boundedInt(value, name, minimum, maximum) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw commandError("UXP_INVALID_ARGUMENT", name + " must be an integer from " + minimum + " to " + maximum);
    }
    return value;
  }
  function requireConfirmation(value) {
    if (value !== true) throw commandError("UXP_CONFIRMATION_REQUIRED", "sequence.previewFrame.update requires confirmSetPreviewFrame: true after reviewing the complete snapshot");
  }
  function requireOperationId(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw commandError("UXP_INVALID_ARGUMENT", "operationId is required and must be 1-128 safe characters");
  }
  function sameSnapshot(left, right) {
    return left.projectGuid === right.projectGuid && left.sequenceId === right.sequenceId &&
      left.previewWidth === right.previewWidth && left.previewHeight === right.previewHeight;
  }
  function requiredGuid(value, name) {
    const guid = guidString(value);
    if (!guid || guid.length > 128 || guid.indexOf("\u0000") !== -1) throw commandError("UXP_VERIFICATION_FAILED", name + " is unavailable or invalid");
    return guid;
  }
  function guidString(value) {
    if (value == null) return "";
    try { return typeof value.toString === "function" ? String(value.toString()) : String(value); } catch (_) { return ""; }
  }
  function messageOf(error) { return error && error.message ? String(error.message) : String(error || "unknown error"); }
  function commandError(code, message) { const error = new Error(message); error.code = code; return error; }

  return { createSequencePreviewFrameWorkflowDefinitions };
});
