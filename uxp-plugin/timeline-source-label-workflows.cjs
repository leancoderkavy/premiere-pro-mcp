(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpTimelineSourceLabelWorkflows = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // This is deliberately a source-project-item label action resolved from one
  // active timeline coordinate. It does not claim to label a timeline-only
  // instance: Premiere's documented color-label action belongs to the source
  // ClipProjectItem, so other uses of that source can reflect the change.
  function createTimelineSourceLabelWorkflowDefinitions(deps) {
    const ppro = deps.ppro;
    const fallbackTails = new Map();
    const locks = deps.colorLabelLocks && typeof deps.colorLabelLocks.withProjectItemColorLabelLock === "function"
      ? deps.colorLabelLocks
      : { withProjectItemColorLabelLock: localLock };
    const definitions = {
      "timeline.sourceLabel.inspect": {
        readOnly: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canUseTimelineSourceLabels,
        handler: inspectTimelineSourceLabel
      },
      "timeline.sourceLabel.update": {
        destructive: true,
        undoable: true,
        idempotent: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canUseTimelineSourceLabels,
        handler: updateTimelineSourceLabel
      }
    };

    function canUseTimelineSourceLabels() {
      return !!(ppro.Project && typeof ppro.Project.getActiveProject === "function" &&
        ppro.Constants && ppro.Constants.TrackItemType && ppro.ClipProjectItem && typeof ppro.ClipProjectItem.cast === "function");
    }

    async function inspectTimelineSourceLabel(args) {
      assertOnlyKeys(args, ["mediaType", "trackIndex", "clipIndex"]);
      return sourceLabelSnapshot(await activeTarget(args, false));
    }

    async function updateTimelineSourceLabel(args) {
      assertOnlyKeys(args, ["mediaType", "trackIndex", "clipIndex", "colorIndex", "expectedSnapshot", "confirmSetLabel", "operationId"]);
      requireConfirmation(args.confirmSetLabel);
      requireOperationId(args.operationId);
      const target = targetCoordinates(args), colorIndex = labelColorIndex(args.colorIndex);
      const expected = requiredSnapshot(args.expectedSnapshot);
      assertExpectedTarget(expected, target);
      const initial = await activeTarget(target, true);
      const initialSnapshot = await sourceLabelSnapshot(initial);
      if (initialSnapshot.projectGuid !== expected.projectGuid || initialSnapshot.sequenceId !== expected.sequenceId ||
        initialSnapshot.sourceProjectItemId !== expected.sourceProjectItemId) {
        throw commandError("UXP_STALE_SOURCE_LABEL", "The active project, sequence, or timeline source item no longer matches the reviewed label snapshot");
      }
      const key = initialSnapshot.projectGuid + "\u0000" + initialSnapshot.sourceProjectItemId;
      return locks.withProjectItemColorLabelLock(key, async function () {
        // Re-resolve after joining the source-global tail. This catches both a
        // competing coordinate update and the generic project-bin color tool,
        // which uses the same lock for the same ClipProjectItem.
        let context;
        try {
          context = await activeTarget(target, true);
        } catch (error) {
          if (error && error.code === "UXP_TARGET_NOT_FOUND") {
            throw commandError("UXP_STALE_SOURCE_LABEL", "The reviewed timeline coordinate no longer resolves before color-label action creation");
          }
          throw error;
        }
        const before = await sourceLabelSnapshot(context);
        if (!sameSnapshot(before, expected)) {
          throw commandError("UXP_STALE_SOURCE_LABEL", "The reviewed timeline source label changed since inspection");
        }
        let committed = false;
        context.project.lockedAccess(function () {
          if (guidString(context.project.guid) !== before.projectGuid || guidString(context.sequence.guid) !== before.sequenceId) {
            throw commandError("UXP_STALE_SOURCE_LABEL", "The active project or sequence changed before color-label action creation");
          }
          if (typeof context.source.createSetColorLabelAction !== "function") {
            throw commandError("UXP_COMMAND_UNAVAILABLE", "This timeline source item cannot create a documented color-label action");
          }
          const action = context.source.createSetColorLabelAction(colorIndex);
          if (!action) throw commandError("UXP_ACTION_REJECTED", "Premiere did not create the source color-label action");
          committed = context.project.executeTransaction(function (compoundAction) {
            if (!compoundAction || typeof compoundAction.addAction !== "function" || compoundAction.addAction(action) === false) {
              throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the source color-label action");
            }
          }, "Set timeline source label");
        });
        if (!committed) throw commandError("UXP_TRANSACTION_FAILED", "Premiere did not commit the source color-label transaction");

        const after = await sourceLabelSnapshot(await activeTarget(target, true));
        if (!sameTargetAfterUpdate(before, after, colorIndex)) {
          throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not retain the requested source color label at the reviewed timeline coordinate");
        }
        return {
          sourceLabelUpdated: true,
          before,
          after,
          outcome: "verified",
          verificationBoundary: "timeline_coordinate_source_color_label_readback",
          undoLabel: "Set timeline source label"
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
      const target = targetCoordinates(args), items = await clipItemsAt(sequence, target);
      const item = items[target.clipIndex];
      if (!item) throw commandError("UXP_TARGET_NOT_FOUND", "clipIndex is out of range");
      const sourceItem = await requiredMethod(item, "getProjectItem")();
      let source;
      try { source = ppro.ClipProjectItem.cast(sourceItem); } catch (_) { source = null; }
      if (!source) throw commandError("UXP_TARGET_UNSUPPORTED", "The resolved timeline item has no ClipProjectItem color-label surface");
      const sourceProjectItemId = requiredIdentifier(await requiredMethod(source, "getId")(), "source project-item ID");
      return {
        project,
        sequence,
        projectGuid: requiredGuid(project.guid, "active project GUID"),
        sequenceId: requiredGuid(sequence.guid, "active sequence GUID"),
        source,
        sourceProjectItemId,
        trackItem: item,
        trackItemCount: items.length,
        ...target
      };
    }

    async function clipItemsAt(sequence, target) {
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
      return items;
    }

    async function sourceLabelSnapshot(context) {
      const colorLabelIndex = Number(await requiredMethod(context.source, "getColorLabelIndex")());
      if (!Number.isSafeInteger(colorLabelIndex) || colorLabelIndex < 0 || colorLabelIndex > 15) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned an invalid source color-label index");
      }
      const startSeconds = tickSeconds(await requiredMethod(context.trackItem, "getStartTime")());
      const endSeconds = tickSeconds(await requiredMethod(context.trackItem, "getEndTime")());
      if (!validSeconds(startSeconds) || !validSeconds(endSeconds) || endSeconds < startSeconds) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned invalid timeline coordinates for the source-label target");
      }
      return {
        projectGuid: context.projectGuid,
        sequenceId: context.sequenceId,
        mediaType: context.mediaType,
        trackIndex: context.trackIndex,
        clipIndex: context.clipIndex,
        trackItemCount: context.trackItemCount,
        sourceProjectItemId: context.sourceProjectItemId,
        sourceColorLabelIndex: colorLabelIndex,
        startSeconds,
        endSeconds
      };
    }

    function targetCoordinates(args) {
      return {
        mediaType: enumValue(args.mediaType, "mediaType", ["video", "audio"]),
        trackIndex: boundedInt(args.trackIndex, "trackIndex", 0, 511),
        clipIndex: boundedInt(args.clipIndex, "clipIndex", 0, 511)
      };
    }

    function requiredSnapshot(value) {
      assertObject(value, "expectedSnapshot");
      const allowed = ["projectGuid", "sequenceId", "mediaType", "trackIndex", "clipIndex", "trackItemCount", "sourceProjectItemId", "sourceColorLabelIndex", "startSeconds", "endSeconds"];
      assertOnlyKeys(value, allowed);
      for (let index = 0; index < allowed.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, allowed[index])) {
          throw commandError("UXP_INVALID_ARGUMENT", "expectedSnapshot." + allowed[index] + " is required");
        }
      }
      const snapshot = {
        projectGuid: requiredGuid(value.projectGuid, "expectedSnapshot.projectGuid"),
        sequenceId: requiredGuid(value.sequenceId, "expectedSnapshot.sequenceId"),
        mediaType: enumValue(value.mediaType, "expectedSnapshot.mediaType", ["video", "audio"]),
        trackIndex: boundedInt(value.trackIndex, "expectedSnapshot.trackIndex", 0, 511),
        clipIndex: boundedInt(value.clipIndex, "expectedSnapshot.clipIndex", 0, 511),
        trackItemCount: boundedInt(value.trackItemCount, "expectedSnapshot.trackItemCount", 1, 512),
        sourceProjectItemId: requiredIdentifier(value.sourceProjectItemId, "expectedSnapshot.sourceProjectItemId"),
        sourceColorLabelIndex: labelColorIndex(value.sourceColorLabelIndex),
        startSeconds: boundedSeconds(value.startSeconds, "expectedSnapshot.startSeconds"),
        endSeconds: boundedSeconds(value.endSeconds, "expectedSnapshot.endSeconds")
      };
      if (snapshot.endSeconds < snapshot.startSeconds) throw commandError("UXP_INVALID_ARGUMENT", "expectedSnapshot.endSeconds must not precede startSeconds");
      return snapshot;
    }

    function assertExpectedTarget(expected, target) {
      if (expected.mediaType !== target.mediaType || expected.trackIndex !== target.trackIndex || expected.clipIndex !== target.clipIndex) {
        throw commandError("UXP_INVALID_ARGUMENT", "expectedSnapshot coordinates must exactly match the requested timeline target");
      }
    }

    function sameSnapshot(left, right) {
      return left.projectGuid === right.projectGuid && left.sequenceId === right.sequenceId && left.mediaType === right.mediaType &&
        left.trackIndex === right.trackIndex && left.clipIndex === right.clipIndex && left.trackItemCount === right.trackItemCount &&
        left.sourceProjectItemId === right.sourceProjectItemId && left.sourceColorLabelIndex === right.sourceColorLabelIndex &&
        sameNumber(left.startSeconds, right.startSeconds) && sameNumber(left.endSeconds, right.endSeconds);
    }

    function sameTargetAfterUpdate(before, after, colorIndex) {
      return before.projectGuid === after.projectGuid && before.sequenceId === after.sequenceId && before.mediaType === after.mediaType &&
        before.trackIndex === after.trackIndex && before.clipIndex === after.clipIndex && before.trackItemCount === after.trackItemCount &&
        before.sourceProjectItemId === after.sourceProjectItemId && after.sourceColorLabelIndex === colorIndex &&
        sameNumber(before.startSeconds, after.startSeconds) && sameNumber(before.endSeconds, after.endSeconds);
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

    return definitions;
  }

  function assertObject(value, name) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw commandError("UXP_INVALID_ARGUMENT", (name || "args") + " must be an object");
  }
  function assertOnlyKeys(value, allowed) {
    const unknown = Object.keys(value).filter(function (key) { return !allowed.includes(key); });
    if (unknown.length) throw commandError("UXP_INVALID_ARGUMENT", "Unknown argument: " + unknown[0]);
  }
  function requiredMethod(value, method) {
    if (!value || typeof value[method] !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere does not expose " + method + " for this target");
    return value[method].bind(value);
  }
  function enumValue(value, name, allowed) {
    if (!allowed.includes(value)) throw commandError("UXP_INVALID_ARGUMENT", name + " must be one of " + allowed.join(", "));
    return value;
  }
  function boundedInt(value, name, minimum, maximum) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) throw commandError("UXP_INVALID_ARGUMENT", name + " must be an integer from " + minimum + " to " + maximum);
    return value;
  }
  function labelColorIndex(value) { return boundedInt(value, "colorIndex", 0, 15); }
  function boundedSeconds(value, name) {
    const seconds = Number(value);
    if (!validSeconds(seconds)) throw commandError("UXP_INVALID_ARGUMENT", name + " must be a number from 0 to 86400");
    return seconds;
  }
  function validSeconds(value) { return Number.isFinite(value) && value >= 0 && value <= 86400; }
  function sameNumber(left, right) { return Math.abs(Number(left) - Number(right)) <= 0.000001; }
  function requireConfirmation(value) {
    if (value !== true) throw commandError("UXP_CONFIRMATION_REQUIRED", "timeline.sourceLabel.update requires confirmSetLabel: true after reviewing the complete snapshot");
  }
  function requireOperationId(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw commandError("UXP_INVALID_ARGUMENT", "operationId is required and must be 1-128 safe characters");
  }
  function requiredGuid(value, name) {
    const guid = guidString(value);
    if (!guid || guid.length > 128 || guid.indexOf("\u0000") !== -1) throw commandError("UXP_VERIFICATION_FAILED", name + " is unavailable or invalid");
    return guid;
  }
  function requiredIdentifier(value, name) {
    const id = guidString(value);
    if (!id || id.length > 512 || id.indexOf("\u0000") !== -1) throw commandError("UXP_VERIFICATION_FAILED", name + " is unavailable or invalid");
    return id;
  }
  function guidString(value) {
    if (value == null) return "";
    try { return typeof value.toString === "function" ? String(value.toString()) : String(value); } catch (_) { return ""; }
  }
  function tickSeconds(value) { const seconds = value && Number(value.seconds); return Number.isFinite(seconds) ? seconds : null; }
  function commandError(code, message) { const error = new Error(message); error.code = code; return error; }

  return { createTimelineSourceLabelWorkflowDefinitions };
});
