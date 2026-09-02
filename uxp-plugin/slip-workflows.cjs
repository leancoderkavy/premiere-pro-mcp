(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpSlipWorkflows = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // A slip is deliberately a separate, narrow operation rather than a
  // convenience alias for trackItem.update: it preserves timeline timing,
  // requires the complete reviewed state, and serializes its whole guarded
  // preflight/transaction/readback boundary per target.
  function createSlipWorkflowDefinitions(deps) {
    const ppro = deps.ppro;
    const slipTails = new Map();
    const definitions = {
      "trackItem.slip.inspect": {
        readOnly: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canUseTrackItemSlip,
        handler: inspectTrackItemSlip
      },
      "trackItem.slip": {
        destructive: true,
        undoable: true,
        idempotent: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canUseTrackItemSlip,
        handler: slipTrackItem
      }
    };

    function canUseTrackItemSlip() {
      return !!(ppro.Project && typeof ppro.Project.getActiveProject === "function" &&
        ppro.TickTime && typeof ppro.TickTime.createWithSeconds === "function");
    }

    async function inspectTrackItemSlip(args) {
      assertOnlyKeys(args, ["mediaType", "trackIndex", "clipIndex"]);
      const context = await activeTarget(args, false);
      return await slipSnapshot(context);
    }

    async function slipTrackItem(args) {
      assertOnlyKeys(args, ["mediaType", "trackIndex", "clipIndex", "expectedSnapshot", "slipBySeconds", "confirmSlip", "operationId"]);
      requireConfirmation(args.confirmSlip);
      requireOperationId(args.operationId);
      const target = targetCoordinates(args);
      const expected = requiredSnapshot(args.expectedSnapshot);
      const requestedOffset = signedOffset(args.slipBySeconds);
      assertExpectedTarget(expected, target);
      const initial = await activeTarget(target, true);
      if (expected.projectGuid !== initial.projectGuid || expected.sequenceId !== initial.sequenceId) {
        throw commandError("UXP_STALE_TRACK_ITEM", "The active project or sequence no longer matches the reviewed slip snapshot");
      }
      const key = initial.projectGuid + "\u0000" + initial.sequenceId + "\u0000" + target.mediaType + "\u0000" + target.trackIndex + "\u0000" + target.clipIndex;
      return withSlipLock(key, async function () {
        // Resolve the active target only after entering the per-item tail so
        // a different operation ID cannot reuse a snapshot taken before a
        // prior slip completed.
        const context = await activeTarget(target, true);
        if (context.projectGuid !== expected.projectGuid || context.sequenceId !== expected.sequenceId) {
          throw commandError("UXP_STALE_TRACK_ITEM", "The active project or sequence changed before the slip transaction");
        }
        const before = await slipSnapshot(context);
        if (!sameSnapshot(before, expected)) {
          throw commandError("UXP_STALE_TRACK_ITEM", "The timeline item changed since the reviewed slip snapshot");
        }
        assertSlipSupported(before);
        const desired = desiredSlip(before, requestedOffset);
        // The complete asynchronous snapshot is captured immediately before
        // this synchronous action-creation boundary. The keyed tail prevents
        // another MCP slip from interleaving between this check and readback.
        let committed = false;
        context.project.lockedAccess(function () {
          if (guidString(context.project.guid) !== before.projectGuid || guidString(context.sequence.guid) !== before.sequenceId) {
            throw commandError("UXP_STALE_TRACK_ITEM", "The reviewed project or sequence changed before slip action creation");
          }
          const inAction = createPointAction(context.item, "createSetInPointAction", desired.inSeconds, "source in point");
          const outAction = createPointAction(context.item, "createSetOutPointAction", desired.outSeconds, "source out point");
          committed = context.project.executeTransaction(function (compoundAction) {
            if (compoundAction.addAction(inAction) === false || compoundAction.addAction(outAction) === false) {
              throw commandError("UXP_ACTION_REJECTED", "Premiere rejected a slip action");
            }
          }, "Slip timeline item source");
        });
        if (!committed) throw commandError("UXP_TRANSACTION_FAILED", "Premiere did not commit the slip transaction");

        // Resolve by coordinate again rather than trusting the retained object.
        // An action may have committed even when this verification fails, so
        // callers must inspect before issuing another edit after that error.
        const afterContext = await activeTarget(target, true);
        if (afterContext.projectGuid !== before.projectGuid || afterContext.sequenceId !== before.sequenceId) {
          throw commandError("UXP_VERIFICATION_FAILED", "Premiere changed the active project or sequence during the committed slip");
        }
        const after = await slipSnapshot(afterContext);
        if (!sameSlipResult(before, after, desired)) {
          throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not retain the requested source-only slip");
        }
        return {
          slipped: true,
          before,
          after,
          slipBySeconds: requestedOffset,
          outcome: "verified",
          verificationBoundary: "track_item_source_and_timeline_readback",
          undoLabel: "Slip timeline item source"
        };
      });
    }

    async function activeTarget(args, requireTransaction) {
      if (!ppro.Project || typeof ppro.Project.getActiveProject !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere project APIs are unavailable");
      }
      const project = await ppro.Project.getActiveProject();
      if (!project) throw commandError("UXP_NO_ACTIVE_PROJECT", "No active project");
      if (requireTransaction && (typeof project.lockedAccess !== "function" || typeof project.executeTransaction !== "function")) {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build does not expose locked undoable transactions");
      }
      if (typeof project.getActiveSequence !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere cannot resolve the active sequence");
      const sequence = await project.getActiveSequence();
      if (!sequence) throw commandError("UXP_NO_ACTIVE_SEQUENCE", "No active sequence");
      const projectGuid = requiredGuid(project.guid, "active project GUID"), sequenceId = requiredGuid(sequence.guid, "active sequence GUID");
      const target = targetCoordinates(args), item = await trackItemAt(sequence, target);
      return { project, sequence, item, projectGuid, sequenceId, ...target };
    }

    async function trackItemAt(sequence, target) {
      const title = target.mediaType === "video" ? "Video" : "Audio";
      const countMethod = "get" + title + "TrackCount", trackMethod = "get" + title + "Track";
      if (typeof sequence[countMethod] !== "function" || typeof sequence[trackMethod] !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", target.mediaType + " track APIs are unavailable");
      }
      const count = Number(await sequence[countMethod]());
      if (!Number.isSafeInteger(count) || count < 0) throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned an invalid " + target.mediaType + " track count");
      if (target.trackIndex >= count) throw commandError("UXP_TARGET_NOT_FOUND", target.mediaType + " trackIndex is out of range");
      const track = await sequence[trackMethod](target.trackIndex);
      const itemType = ppro.Constants && ppro.Constants.TrackItemType;
      if (!track || !itemType || itemType.CLIP == null || typeof track.getTrackItems !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Clip track-item APIs are unavailable");
      }
      const items = Array.from(await track.getTrackItems(itemType.CLIP, false) || []);
      if (items.length > 512) throw commandError("UXP_TARGET_TOO_LARGE", "The target track has more than 512 clip items");
      const item = items[target.clipIndex];
      if (!item) throw commandError("UXP_TARGET_NOT_FOUND", "clipIndex is out of range");
      return item;
    }

    async function slipSnapshot(context) {
      const snapshot = {
        projectGuid: context.projectGuid,
        sequenceId: context.sequenceId,
        mediaType: context.mediaType,
        trackIndex: context.trackIndex,
        clipIndex: context.clipIndex,
        startSeconds: tickSeconds(await requiredMethod(context.item, "getStartTime")()),
        endSeconds: tickSeconds(await requiredMethod(context.item, "getEndTime")()),
        inSeconds: tickSeconds(await requiredMethod(context.item, "getInPoint")()),
        outSeconds: tickSeconds(await requiredMethod(context.item, "getOutPoint")()),
        durationSeconds: tickSeconds(await requiredMethod(context.item, "getDuration")()),
        speed: Number(await requiredMethod(context.item, "getSpeed")()),
        reversed: Boolean(await requiredMethod(context.item, "isSpeedReversed")())
      };
      for (const key of ["startSeconds", "endSeconds", "inSeconds", "outSeconds", "durationSeconds"]) {
        if (!Number.isFinite(snapshot[key]) || snapshot[key] < 0 || snapshot[key] > 86400) {
          throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned an invalid " + key + " for the timeline item");
        }
      }
      if (!Number.isFinite(snapshot.speed) || snapshot.speed < 0 || snapshot.speed > 100) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned an invalid timeline-item speed");
      }
      return snapshot;
    }

    function desiredSlip(before, offset) {
      const sourceDuration = before.outSeconds - before.inSeconds;
      if (!numbersEqual(before.endSeconds - before.startSeconds, before.durationSeconds) ||
        !numbersEqual(sourceDuration, before.durationSeconds) || sourceDuration <= 0) {
        throw commandError("UXP_TARGET_UNSUPPORTED", "Slip requires an unchanged forward 1x timeline and source duration");
      }
      const inSeconds = before.inSeconds + offset, outSeconds = before.outSeconds + offset;
      if (inSeconds < 0 || outSeconds > 86400 || outSeconds <= inSeconds) {
        throw commandError("UXP_TARGET_UNSUPPORTED", "The requested slip exceeds the documented source-time bounds");
      }
      return { inSeconds, outSeconds, sourceDuration };
    }

    function assertSlipSupported(snapshot) {
      if (!numbersEqual(snapshot.speed, 1) || snapshot.reversed) {
        throw commandError("UXP_TARGET_UNSUPPORTED", "Slip only supports forward 1x track items");
      }
    }

    function sameSlipResult(before, after, desired) {
      return sameSnapshotIdentity(before, after) &&
        numbersEqual(after.startSeconds, before.startSeconds) &&
        numbersEqual(after.endSeconds, before.endSeconds) &&
        numbersEqual(after.durationSeconds, before.durationSeconds) &&
        numbersEqual(after.speed, before.speed) && after.reversed === before.reversed &&
        numbersEqual(after.inSeconds, desired.inSeconds) && numbersEqual(after.outSeconds, desired.outSeconds) &&
        numbersEqual(after.outSeconds - after.inSeconds, desired.sourceDuration);
    }

    function sameSnapshot(left, right) {
      return sameSnapshotIdentity(left, right) &&
        numbersEqual(left.startSeconds, right.startSeconds) &&
        numbersEqual(left.endSeconds, right.endSeconds) &&
        numbersEqual(left.inSeconds, right.inSeconds) &&
        numbersEqual(left.outSeconds, right.outSeconds) &&
        numbersEqual(left.durationSeconds, right.durationSeconds) &&
        numbersEqual(left.speed, right.speed) && left.reversed === right.reversed;
    }

    function sameSnapshotIdentity(left, right) {
      return left.projectGuid === right.projectGuid && left.sequenceId === right.sequenceId &&
        left.mediaType === right.mediaType && left.trackIndex === right.trackIndex && left.clipIndex === right.clipIndex;
    }

    function withSlipLock(key, operation) {
      const previous = slipTails.get(key) || Promise.resolve();
      let release;
      const gate = new Promise(function (resolve) { release = resolve; });
      const tail = previous.catch(function () { return undefined; }).then(function () { return gate; });
      slipTails.set(key, tail);
      return previous.catch(function () { return undefined; }).then(operation).finally(function () {
        release();
        if (slipTails.get(key) === tail) slipTails.delete(key);
      });
    }

    function createPointAction(item, method, seconds, label) {
      const creator = requiredMethod(item, method);
      const action = creator(ppro.TickTime.createWithSeconds(seconds));
      if (!action) throw commandError("UXP_ACTION_REJECTED", "Premiere did not create the " + label + " action");
      return action;
    }

    function targetCoordinates(args) {
      return {
        mediaType: enumValue(args.mediaType, "mediaType", ["video", "audio"]),
        trackIndex: nonNegativeInt(args.trackIndex, "trackIndex"),
        clipIndex: nonNegativeInt(args.clipIndex, "clipIndex")
      };
    }

    function requiredSnapshot(value) {
      assertObject(value, "expectedSnapshot");
      const allowed = ["projectGuid", "sequenceId", "mediaType", "trackIndex", "clipIndex", "startSeconds", "endSeconds", "inSeconds", "outSeconds", "durationSeconds", "speed", "reversed"];
      assertOnlyKeys(value, allowed);
      for (const key of allowed) if (!(key in value)) throw commandError("UXP_INVALID_ARGUMENT", "expectedSnapshot." + key + " is required");
      return {
        projectGuid: requiredGuid(value.projectGuid, "expectedSnapshot.projectGuid"),
        sequenceId: requiredGuid(value.sequenceId, "expectedSnapshot.sequenceId"),
        mediaType: enumValue(value.mediaType, "expectedSnapshot.mediaType", ["video", "audio"]),
        trackIndex: nonNegativeInt(value.trackIndex, "expectedSnapshot.trackIndex"),
        clipIndex: nonNegativeInt(value.clipIndex, "expectedSnapshot.clipIndex"),
        startSeconds: boundedSeconds(value.startSeconds, "expectedSnapshot.startSeconds"),
        endSeconds: boundedSeconds(value.endSeconds, "expectedSnapshot.endSeconds"),
        inSeconds: boundedSeconds(value.inSeconds, "expectedSnapshot.inSeconds"),
        outSeconds: boundedSeconds(value.outSeconds, "expectedSnapshot.outSeconds"),
        durationSeconds: boundedSeconds(value.durationSeconds, "expectedSnapshot.durationSeconds"),
        speed: boundedSpeed(value.speed, "expectedSnapshot.speed"),
        reversed: requiredBoolean(value.reversed, "expectedSnapshot.reversed")
      };
    }

    function assertExpectedTarget(expected, target) {
      if (expected.mediaType !== target.mediaType || expected.trackIndex !== target.trackIndex || expected.clipIndex !== target.clipIndex) {
        throw commandError("UXP_INVALID_ARGUMENT", "expectedSnapshot target coordinates must match mediaType, trackIndex, and clipIndex");
      }
    }

    function signedOffset(value) {
      const offset = Number(value);
      if (!Number.isFinite(offset) || offset < -60 || offset > 60 || numbersEqual(offset, 0)) {
        throw commandError("UXP_INVALID_ARGUMENT", "slipBySeconds must be a non-zero number from -60 to 60");
      }
      return offset;
    }

    function requiredMethod(target, name) {
      if (!target || typeof target[name] !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "The timeline item does not expose " + name);
      return target[name].bind(target);
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

    function tickSeconds(value) {
      const seconds = value && Number(value.seconds);
      return Number.isFinite(seconds) ? seconds : null;
    }

    function numbersEqual(left, right) {
      return Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Math.abs(Number(left) - Number(right)) < 0.000001;
    }

    return definitions;
  }

  function assertObject(value, name) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw commandError("UXP_INVALID_ARGUMENT", name + " must be an object");
  }
  function assertOnlyKeys(value, allowed) {
    assertObject(value, "arguments");
    for (const key of Object.keys(value)) if (allowed.indexOf(key) === -1) throw commandError("UXP_INVALID_ARGUMENT", "Unexpected argument: " + key);
  }
  function enumValue(value, name, allowed) {
    if (allowed.indexOf(value) === -1) throw commandError("UXP_INVALID_ARGUMENT", name + " must be one of " + allowed.join(", "));
    return value;
  }
  function nonNegativeInt(value, name) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 511) throw commandError("UXP_INVALID_ARGUMENT", name + " must be an integer from 0 to 511");
    return value;
  }
  function boundedSeconds(value, name) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) throw commandError("UXP_INVALID_ARGUMENT", name + " must be a number from 0 to 86400");
    return seconds;
  }
  function boundedSpeed(value, name) {
    const speed = Number(value);
    if (!Number.isFinite(speed) || speed < 0 || speed > 100) throw commandError("UXP_INVALID_ARGUMENT", name + " must be a number from 0 to 100");
    return speed;
  }
  function requiredBoolean(value, name) {
    if (typeof value !== "boolean") throw commandError("UXP_INVALID_ARGUMENT", name + " must be a boolean");
    return value;
  }
  function requireConfirmation(value) {
    if (value !== true) throw commandError("UXP_CONFIRMATION_REQUIRED", "confirmSlip must be true after reviewing the complete slip snapshot");
  }
  function requireOperationId(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
      throw commandError("UXP_INVALID_ARGUMENT", "operationId is required and must be a 1-128 character operation token");
    }
    return value;
  }
  function commandError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  return { createSlipWorkflowDefinitions };
});
