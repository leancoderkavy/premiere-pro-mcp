(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpRippleDeleteWorkflows = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // A coordinate-bound ripple delete is deliberately narrower than the legacy
  // QE command: it removes exactly one item only when its immediate successor
  // is contiguous, so post-readback can prove the closed cut without reading
  // unrelated items on the track.
  function createRippleDeleteWorkflowDefinitions(deps) {
    const ppro = deps.ppro;
    const fallbackTails = new Map();
    const locks = deps.locks && typeof deps.locks.withTrackMutationLock === "function"
      ? deps.locks
      : { withTrackMutationLock: localLock };
    const definitions = {
      "trackItem.rippleDelete.inspect": {
        readOnly: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canUseRippleDelete,
        handler: inspectRippleDelete
      },
      "trackItem.rippleDelete": {
        destructive: true,
        undoable: true,
        idempotent: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canUseRippleDelete,
        handler: rippleDelete
      }
    };

    function canUseRippleDelete() {
      return !!(ppro.Project && typeof ppro.Project.getActiveProject === "function" &&
        ppro.SequenceEditor && typeof ppro.SequenceEditor.getEditor === "function" &&
        ppro.TrackItemSelection && typeof ppro.TrackItemSelection.createEmptySelection === "function" &&
        ppro.Constants && ppro.Constants.MediaType);
    }

    async function inspectRippleDelete(args) {
      assertOnlyKeys(args, ["mediaType", "trackIndex", "clipIndex"]);
      const context = await activeTarget(args, false);
      const snapshot = await rippleSnapshot(context);
      assertRippleSupported(snapshot);
      return snapshot;
    }

    async function rippleDelete(args) {
      assertOnlyKeys(args, ["mediaType", "trackIndex", "clipIndex", "expectedSnapshot", "confirmRippleDelete", "operationId"]);
      requireConfirmation(args.confirmRippleDelete);
      requireOperationId(args.operationId);
      const target = targetCoordinates(args), expected = requiredSnapshot(args.expectedSnapshot);
      assertExpectedTarget(expected, target);
      const initial = await activeTarget(target, true);
      if (initial.projectGuid !== expected.projectGuid || initial.sequenceId !== expected.sequenceId) {
        throw commandError("UXP_STALE_TRACK_ITEM", "The active project or sequence no longer matches the reviewed ripple-delete snapshot");
      }
      const key = initial.projectGuid + "\u0000" + initial.sequenceId + "\u0000" + target.mediaType + "\u0000" + target.trackIndex;
      return locks.withTrackMutationLock(key, async function () {
        // This full preflight occurs after entering the same per-track tail as
        // slips, slides, and append duplicates, so a distinct operation ID
        // cannot construct a remove action from an obsolete timeline state.
        let context;
        try {
          context = await activeTarget(target, true);
        } catch (error) {
          if (error && error.code === "UXP_TARGET_NOT_FOUND") {
            throw commandError("UXP_STALE_TRACK_ITEM", "The reviewed target no longer exists before the ripple-delete transaction");
          }
          throw error;
        }
        if (context.projectGuid !== expected.projectGuid || context.sequenceId !== expected.sequenceId) {
          throw commandError("UXP_STALE_TRACK_ITEM", "The active project or sequence changed before the ripple-delete transaction");
        }
        let before;
        try {
          before = await rippleSnapshot(context);
        } catch (error) {
          if (error && error.code === "UXP_TARGET_UNSUPPORTED") {
            throw commandError("UXP_STALE_TRACK_ITEM", "The reviewed contiguous successor changed before the ripple-delete transaction");
          }
          throw error;
        }
        if (!sameSnapshot(before, expected)) {
          throw commandError("UXP_STALE_TRACK_ITEM", "The reviewed target or contiguous successor changed since inspection");
        }
        assertRippleSupported(before);
        let committed = false;
        context.project.lockedAccess(function () {
          if (guidString(context.project.guid) !== before.projectGuid || guidString(context.sequence.guid) !== before.sequenceId) {
            throw commandError("UXP_STALE_TRACK_ITEM", "The reviewed project or sequence changed before ripple-delete action creation");
          }
          const editor = ppro.SequenceEditor.getEditor(context.sequence);
          const mediaType = ppro.Constants.MediaType[context.mediaType.toUpperCase()];
          if (!editor || typeof editor.createRemoveItemsAction !== "function" || mediaType == null) {
            throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere does not expose documented ripple-delete actions");
          }
          const selection = createSingleItemSelection(context.item);
          const action = editor.createRemoveItemsAction(selection, true, mediaType, false);
          if (!action) throw commandError("UXP_ACTION_REJECTED", "Premiere did not create the ripple-delete action");
          committed = context.project.executeTransaction(function (compoundAction) {
            if (compoundAction.addAction(action) === false) {
              throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the ripple-delete action");
            }
          }, "Ripple delete timeline item");
        });
        if (!committed) throw commandError("UXP_TRANSACTION_FAILED", "Premiere did not commit the ripple-delete transaction");

        // The successor now occupies the removed target's coordinate. No
        // unrelated item field is read after the host transaction commits.
        const afterContext = await activeTarget(target, true);
        if (afterContext.projectGuid !== before.projectGuid || afterContext.sequenceId !== before.sequenceId) {
          throw commandError("UXP_VERIFICATION_FAILED", "Premiere changed the active project or sequence during the committed ripple delete");
        }
        const after = await rippleReadback(afterContext, before);
        if (!sameRippleResult(before, after)) {
          throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not retain the requested contiguous ripple-delete result");
        }
        return {
          rippleDeleted: true,
          before,
          after,
          outcome: "verified",
          verificationBoundary: "contiguous_successor_track_item_readback",
          undoLabel: "Ripple delete timeline item"
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
      const target = targetCoordinates(args), resolved = await trackItemsAt(sequence, target);
      const item = resolved.items[target.clipIndex];
      if (!item) throw commandError("UXP_TARGET_NOT_FOUND", "clipIndex is out of range");
      return {
        project,
        sequence,
        projectGuid: requiredGuid(project.guid, "active project GUID"),
        sequenceId: requiredGuid(sequence.guid, "active sequence GUID"),
        ...target,
        item,
        items: resolved.items
      };
    }

    async function trackItemsAt(sequence, target) {
      const title = target.mediaType === "video" ? "Video" : "Audio";
      const countMethod = "get" + title + "TrackCount", trackMethod = "get" + title + "Track";
      if (typeof sequence[countMethod] !== "function" || typeof sequence[trackMethod] !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", target.mediaType + " track APIs are unavailable");
      }
      const count = Number(await sequence[countMethod]());
      if (!Number.isSafeInteger(count) || count < 0) throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned an invalid " + target.mediaType + " track count");
      if (target.trackIndex >= count) throw commandError("UXP_TARGET_NOT_FOUND", target.mediaType + " trackIndex is out of range");
      const track = await sequence[trackMethod](target.trackIndex), itemType = ppro.Constants && ppro.Constants.TrackItemType;
      if (!track || !itemType || itemType.CLIP == null || typeof track.getTrackItems !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Clip track-item APIs are unavailable");
      }
      const items = Array.from(await track.getTrackItems(itemType.CLIP, false) || []);
      if (!items.length) throw commandError("UXP_TARGET_NOT_FOUND", "The target track has no clip items");
      if (items.length > 512) throw commandError("UXP_TARGET_TOO_LARGE", "The target track has more than 512 clip items");
      return { items };
    }

    async function rippleSnapshot(context) {
      const following = context.items[context.clipIndex + 1];
      if (!following) throw commandError("UXP_TARGET_UNSUPPORTED", "Ripple delete requires one immediate following clip item on the same track");
      return {
        projectGuid: context.projectGuid,
        sequenceId: context.sequenceId,
        mediaType: context.mediaType,
        trackIndex: context.trackIndex,
        clipIndex: context.clipIndex,
        trackItemCount: context.items.length,
        target: await itemSnapshot(context.item, "target"),
        following: await itemSnapshot(following, "following")
      };
    }

    async function rippleReadback(context, before) {
      return {
        projectGuid: context.projectGuid,
        sequenceId: context.sequenceId,
        mediaType: context.mediaType,
        trackIndex: context.trackIndex,
        successorClipIndex: before.clipIndex,
        trackItemCount: context.items.length,
        successor: await itemSnapshot(context.item, "successor readback")
      };
    }

    async function itemSnapshot(item, label) {
      const sourceItem = await requiredMethod(item, "getProjectItem")();
      const snapshot = {
        projectItemId: requiredIdentifier(await requiredMethod(sourceItem, "getId")(), label + " source project-item ID"),
        startSeconds: tickSeconds(await requiredMethod(item, "getStartTime")()),
        endSeconds: tickSeconds(await requiredMethod(item, "getEndTime")()),
        inSeconds: tickSeconds(await requiredMethod(item, "getInPoint")()),
        outSeconds: tickSeconds(await requiredMethod(item, "getOutPoint")()),
        durationSeconds: tickSeconds(await requiredMethod(item, "getDuration")()),
        speed: Number(await requiredMethod(item, "getSpeed")()),
        reversed: Boolean(await requiredMethod(item, "isSpeedReversed")())
      };
      for (const key of ["startSeconds", "endSeconds", "inSeconds", "outSeconds", "durationSeconds"]) {
        if (!Number.isFinite(snapshot[key]) || snapshot[key] < 0 || snapshot[key] > 86400) {
          throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned an invalid " + label + " " + key);
        }
      }
      if (!Number.isFinite(snapshot.speed) || snapshot.speed < 0 || snapshot.speed > 100) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned an invalid " + label + " speed");
      }
      return snapshot;
    }

    function assertRippleSupported(snapshot) {
      if (snapshot.clipIndex >= snapshot.trackItemCount - 1) {
        throw commandError("UXP_TARGET_UNSUPPORTED", "Ripple delete requires a following clip item to close the requested cut");
      }
      const target = snapshot.target, following = snapshot.following;
      if (target.endSeconds <= target.startSeconds || following.endSeconds <= following.startSeconds ||
        target.durationSeconds <= 0 || following.durationSeconds <= 0 ||
        !numbersEqual(target.endSeconds, following.startSeconds)) {
        throw commandError("UXP_TARGET_UNSUPPORTED", "Ripple delete supports only positive-duration items with one contiguous same-track successor");
      }
    }

    function sameRippleResult(before, after) {
      const targetTimelineDuration = before.target.endSeconds - before.target.startSeconds;
      const following = before.following, successor = after.successor;
      return after.projectGuid === before.projectGuid && after.sequenceId === before.sequenceId &&
        after.mediaType === before.mediaType && after.trackIndex === before.trackIndex &&
        after.successorClipIndex === before.clipIndex && after.trackItemCount === before.trackItemCount - 1 &&
        successor.projectItemId === following.projectItemId &&
        numbersEqual(successor.startSeconds, following.startSeconds - targetTimelineDuration) &&
        numbersEqual(successor.endSeconds, following.endSeconds - targetTimelineDuration) &&
        numbersEqual(successor.inSeconds, following.inSeconds) && numbersEqual(successor.outSeconds, following.outSeconds) &&
        numbersEqual(successor.durationSeconds, following.durationSeconds) &&
        numbersEqual(successor.speed, following.speed) && successor.reversed === following.reversed;
    }

    function sameSnapshot(left, right) {
      return left.projectGuid === right.projectGuid && left.sequenceId === right.sequenceId &&
        left.mediaType === right.mediaType && left.trackIndex === right.trackIndex &&
        left.clipIndex === right.clipIndex && left.trackItemCount === right.trackItemCount &&
        sameItem(left.target, right.target) && sameItem(left.following, right.following);
    }

    function sameItem(left, right) {
      return left.projectItemId === right.projectItemId && numbersEqual(left.startSeconds, right.startSeconds) &&
        numbersEqual(left.endSeconds, right.endSeconds) && numbersEqual(left.inSeconds, right.inSeconds) &&
        numbersEqual(left.outSeconds, right.outSeconds) && numbersEqual(left.durationSeconds, right.durationSeconds) &&
        numbersEqual(left.speed, right.speed) && left.reversed === right.reversed;
    }

    function createSingleItemSelection(item) {
      let selection = null;
      const created = ppro.TrackItemSelection.createEmptySelection(function (value) { selection = value; });
      if (created !== true || !selection || typeof selection.addItem !== "function" || selection.addItem(item, false) !== true) {
        throw commandError("UXP_SELECTION_REJECTED", "Premiere rejected the bounded ripple-delete selection");
      }
      return selection;
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
      const allowed = ["projectGuid", "sequenceId", "mediaType", "trackIndex", "clipIndex", "trackItemCount", "target", "following"];
      assertOnlyKeys(value, allowed);
      for (const key of allowed) if (!(key in value)) throw commandError("UXP_INVALID_ARGUMENT", "expectedSnapshot." + key + " is required");
      return {
        projectGuid: requiredGuid(value.projectGuid, "expectedSnapshot.projectGuid"),
        sequenceId: requiredGuid(value.sequenceId, "expectedSnapshot.sequenceId"),
        mediaType: enumValue(value.mediaType, "expectedSnapshot.mediaType", ["video", "audio"]),
        trackIndex: nonNegativeInt(value.trackIndex, "expectedSnapshot.trackIndex"),
        clipIndex: nonNegativeInt(value.clipIndex, "expectedSnapshot.clipIndex"),
        trackItemCount: positiveInt(value.trackItemCount, "expectedSnapshot.trackItemCount"),
        target: requiredItemSnapshot(value.target, "expectedSnapshot.target"),
        following: requiredItemSnapshot(value.following, "expectedSnapshot.following")
      };
    }

    function requiredItemSnapshot(value, name) {
      assertObject(value, name);
      const allowed = ["projectItemId", "startSeconds", "endSeconds", "inSeconds", "outSeconds", "durationSeconds", "speed", "reversed"];
      assertOnlyKeys(value, allowed);
      for (const key of allowed) if (!(key in value)) throw commandError("UXP_INVALID_ARGUMENT", name + "." + key + " is required");
      return {
        projectItemId: requiredIdentifier(value.projectItemId, name + ".projectItemId"),
        startSeconds: boundedSeconds(value.startSeconds, name + ".startSeconds"),
        endSeconds: boundedSeconds(value.endSeconds, name + ".endSeconds"),
        inSeconds: boundedSeconds(value.inSeconds, name + ".inSeconds"),
        outSeconds: boundedSeconds(value.outSeconds, name + ".outSeconds"),
        durationSeconds: boundedSeconds(value.durationSeconds, name + ".durationSeconds"),
        speed: boundedSpeed(value.speed, name + ".speed"),
        reversed: requiredBoolean(value.reversed, name + ".reversed")
      };
    }

    function assertExpectedTarget(expected, target) {
      if (expected.mediaType !== target.mediaType || expected.trackIndex !== target.trackIndex || expected.clipIndex !== target.clipIndex) {
        throw commandError("UXP_INVALID_ARGUMENT", "expectedSnapshot target coordinates must match mediaType, trackIndex, and clipIndex");
      }
    }

    function localLock(key, operation) {
      const previous = fallbackTails.get(key) || Promise.resolve();
      let release;
      const gate = new Promise(function (resolve) { release = resolve; });
      const tail = previous.catch(function () { return undefined; }).then(function () { return gate; });
      fallbackTails.set(key, tail);
      return previous.catch(function () { return undefined; }).then(operation).finally(function () {
        release();
        if (fallbackTails.get(key) === tail) fallbackTails.delete(key);
      });
    }

    function requiredMethod(target, name) { if (!target || typeof target[name] !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "The required item does not expose " + name); return target[name].bind(target); }
    function assertObject(value, name) { if (!value || typeof value !== "object" || Array.isArray(value)) throw commandError("UXP_INVALID_ARGUMENT", name + " must be an object"); }
    function assertOnlyKeys(value, allowed) { assertObject(value, "arguments"); for (const key of Object.keys(value)) if (allowed.indexOf(key) === -1) throw commandError("UXP_INVALID_ARGUMENT", "Unexpected argument: " + key); }
    function enumValue(value, name, allowed) { if (allowed.indexOf(value) === -1) throw commandError("UXP_INVALID_ARGUMENT", name + " must be one of " + allowed.join(", ")); return value; }
    function nonNegativeInt(value, name) { if (!Number.isSafeInteger(value) || value < 0 || value > 511) throw commandError("UXP_INVALID_ARGUMENT", name + " must be an integer from 0 to 511"); return value; }
    function positiveInt(value, name) { if (!Number.isSafeInteger(value) || value < 1 || value > 512) throw commandError("UXP_INVALID_ARGUMENT", name + " must be an integer from 1 to 512"); return value; }
    function boundedSeconds(value, name) { const seconds = Number(value); if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) throw commandError("UXP_INVALID_ARGUMENT", name + " must be a number from 0 to 86400"); return seconds; }
    function boundedSpeed(value, name) { const speed = Number(value); if (!Number.isFinite(speed) || speed < 0 || speed > 100) throw commandError("UXP_INVALID_ARGUMENT", name + " must be a number from 0 to 100"); return speed; }
    function requiredBoolean(value, name) { if (typeof value !== "boolean") throw commandError("UXP_INVALID_ARGUMENT", name + " must be a boolean"); return value; }
    function requireConfirmation(value) { if (value !== true) throw commandError("UXP_CONFIRMATION_REQUIRED", "trackItem.rippleDelete requires confirmRippleDelete: true"); }
    function requireOperationId(value) { if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw commandError("UXP_INVALID_ARGUMENT", "operationId is required and must be 1-128 safe characters"); }
    function requiredGuid(value, name) { const guid = guidString(value); if (!guid || guid.length > 128 || guid.indexOf("\u0000") !== -1) throw commandError("UXP_VERIFICATION_FAILED", name + " is unavailable or invalid"); return guid; }
    function requiredIdentifier(value, name) { const id = guidString(value); if (!id || id.length > 512 || id.indexOf("\u0000") !== -1) throw commandError("UXP_VERIFICATION_FAILED", name + " is unavailable or invalid"); return id; }
    function guidString(value) { if (value == null) return ""; try { return typeof value.toString === "function" ? String(value.toString()) : String(value); } catch (_) { return ""; } }
    function tickSeconds(value) { const seconds = value && Number(value.seconds); return Number.isFinite(seconds) ? seconds : null; }
    function numbersEqual(left, right) { return Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Math.abs(Number(left) - Number(right)) < 0.000001; }
    function commandError(code, message) { const error = new Error(message); error.code = code; return error; }

    return definitions;
  }

  return { createRippleDeleteWorkflowDefinitions };
});
