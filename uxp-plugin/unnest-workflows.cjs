(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpUnnestWorkflows = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Unnest by cloning. Legacy CEP can only re-place a nested clip from its
  // project item, which loses the clip's effect stack (Lumetri curves are not
  // even readable there). SequenceEditor.createCloneTrackItemAction accepts a
  // track item from the nested sequence and clones it into the parent with its
  // effects, keyframes, enabled state and source range intact (live 26.0.2:
  // the cloned clip rendered pixel-identical to the nested one). The nest's
  // video and audio references are removed and every nested clip is cloned in
  // ONE transaction, so a single Undo restores the nest.
  const MAX_PLACEMENTS = 512;

  function createUnnestWorkflowDefinitions(deps) {
    const ppro = deps.ppro;
    const definitions = {
      "sequence.unnest.inspect": {
        readOnly: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canUnnest,
        handler: inspectUnnest
      },
      "sequence.unnest": {
        destructive: true,
        undoable: true,
        idempotent: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canUnnest,
        handler: applyUnnest
      }
    };

    function canUnnest() {
      return !!(ppro.Project && typeof ppro.Project.getActiveProject === "function" &&
        ppro.SequenceEditor && typeof ppro.SequenceEditor.getEditor === "function" &&
        ppro.TickTime && typeof ppro.TickTime.createWithTicks === "function" &&
        ppro.TrackItemSelection && typeof ppro.TrackItemSelection.createEmptySelection === "function" &&
        ppro.ClipProjectItem && typeof ppro.ClipProjectItem.cast === "function" &&
        ppro.Constants && ppro.Constants.TrackItemType && ppro.Constants.MediaType);
    }

    async function inspectUnnest(args) {
      assertOnlyKeys(args, ["mediaType", "trackIndex", "clipIndex"]);
      const context = await activeContext(false);
      return (await planUnnest(context, targetCoordinates(args))).snapshot;
    }

    async function applyUnnest(args) {
      assertOnlyKeys(args, ["mediaType", "trackIndex", "clipIndex", "expectedSnapshot", "confirmUnnest", "operationId"]);
      if (args.confirmUnnest !== true) throw commandError("UXP_CONFIRMATION_REQUIRED", "sequence.unnest requires confirmUnnest: true");
      if (typeof args.operationId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(args.operationId)) {
        throw commandError("UXP_INVALID_ARGUMENT", "operationId is required and must be 1-128 safe characters");
      }
      assertObject(args.expectedSnapshot, "expectedSnapshot");
      const target = targetCoordinates(args);
      const context = await activeContext(true);
      const plan = await planUnnest(context, target);
      if (canonical(plan.snapshot) !== canonical(args.expectedSnapshot)) {
        throw commandError("UXP_STALE_TRACK_ITEM", "The nest, its contents, or the destination changed since inspection; inspect again before unnesting");
      }

      let committed = false;
      context.project.lockedAccess(function () {
        const editor = ppro.SequenceEditor.getEditor(context.sequence);
        if (!editor || typeof editor.createCloneTrackItemAction !== "function" || typeof editor.createRemoveItemsAction !== "function") {
          throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere does not expose SequenceEditor clone and remove actions");
        }
        const actions = [];
        // Remove the nest first so every clone lands in an empty range.
        for (const reference of plan.referenceItems) {
          const selection = singleSelection(reference.item);
          const mediaType = ppro.Constants.MediaType[reference.mediaType.toUpperCase()];
          actions.push(editor.createRemoveItemsAction(selection, false, mediaType, false));
        }
        const offset = ppro.TickTime.createWithTicks(String(plan.offsetTicks));
        for (const source of plan.sourceItems) {
          actions.push(editor.createCloneTrackItemAction(source.item, offset, plan.videoTrackOffset, plan.audioTrackOffset, false, false));
        }
        for (const action of actions) if (!action) throw commandError("UXP_ACTION_REJECTED", "Premiere did not create every unnest action");
        committed = context.project.executeTransaction(function (compoundAction) {
          for (const action of actions) {
            if (compoundAction.addAction(action) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected an unnest action");
          }
        }, "Unnest " + plan.snapshot.nestedSequenceName);
      });
      if (!committed) throw commandError("UXP_TRANSACTION_FAILED", "Premiere did not commit the unnest transaction");

      try {
        const problems = await readbackProblems(context.sequence, plan);
        if (problems.length) {
          return { unnested: false, committed: true, verified: false, partial: true, outcome: "committed_unverified",
            problems: problems.slice(0, 20), rollbackPerformed: false,
            verificationBoundary: "committed_transaction_with_failed_readback",
            nextStep: "The unnest committed as one transaction but did not read back as planned. Use Premiere Undo once to restore the nest, then inspect again." };
        }
        return { unnested: true, committed: true, verified: true, outcome: "verified",
          nestedSequenceName: plan.snapshot.nestedSequenceName, clipsCloned: plan.snapshot.clones.length,
          referencesRemoved: plan.snapshot.references.length,
          verificationBoundary: "placement_start_source_range_and_project_item_readback",
          undoLabel: "Unnest " + plan.snapshot.nestedSequenceName };
      } catch (error) {
        return { unnested: false, committed: true, verified: false, partial: true, outcome: "committed_unverified",
          readbackError: error && error.message ? error.message : String(error), rollbackPerformed: false,
          verificationBoundary: "committed_transaction_with_failed_readback",
          nextStep: "Inspect the timeline before any retry. Use Premiere Undo once to restore the nest." };
      }
    }

    async function activeContext(requireTransaction) {
      const project = await ppro.Project.getActiveProject();
      if (!project) throw commandError("UXP_NO_ACTIVE_PROJECT", "No active project");
      if (requireTransaction && (typeof project.lockedAccess !== "function" || typeof project.executeTransaction !== "function")) {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build does not expose locked undoable transactions");
      }
      const sequence = await project.getActiveSequence();
      if (!sequence) throw commandError("UXP_NO_ACTIVE_SEQUENCE", "No active sequence");
      return { project, sequence };
    }

    async function planUnnest(context, target) {
      const { project, sequence } = context;
      const nestItem = (await clipItems(sequence, target.mediaType, target.trackIndex))[target.clipIndex];
      if (!nestItem) throw commandError("UXP_TARGET_NOT_FOUND", "clipIndex is out of range");
      const nestedSequence = await nestedSequenceOf(nestItem);
      if (!nestedSequence) throw commandError("UXP_TARGET_UNSUPPORTED", "The target clip is not a nested sequence");
      const nestProjectItemId = await projectItemId(nestItem);
      const nestStart = await ticksOf(nestItem, "getStartTime"), nestEnd = await ticksOf(nestItem, "getEndTime");

      // Every clip of this nested sequence at exactly this position: at most
      // one video and one audio reference (a nest dropped with picture and sound).
      const references = [];
      for (const mediaType of ["video", "audio"]) {
        const count = await trackCount(sequence, mediaType);
        for (let trackIndex = 0; trackIndex < count; trackIndex++) {
          const items = await clipItems(sequence, mediaType, trackIndex);
          for (let clipIndex = 0; clipIndex < items.length; clipIndex++) {
            const item = items[clipIndex];
            if (await projectItemId(item) !== nestProjectItemId) continue;
            if (await ticksOf(item, "getStartTime") !== nestStart || await ticksOf(item, "getEndTime") !== nestEnd) continue;
            if (references.some(function (ref) { return ref.mediaType === mediaType; })) {
              throw commandError("UXP_TARGET_UNSUPPORTED", "More than one " + mediaType + " clip of this nest sits at the same position; move or remove the duplicate first");
            }
            references.push({ mediaType, trackIndex, clipIndex, item,
              inTicks: await ticksOf(item, "getInPoint"), outTicks: await ticksOf(item, "getOutPoint"),
              speed: Number(await requiredMethod(item, "getSpeed")()), reversed: Boolean(await requiredMethod(item, "isSpeedReversed")()) });
          }
        }
      }
      if (!references.length) throw commandError("UXP_TARGET_NOT_FOUND", "The nest clip was not found at its own position");
      const first = references[0];
      for (const ref of references) {
        if (Math.abs(ref.speed - 1) > 0.0001 || ref.reversed) throw commandError("UXP_TARGET_UNSUPPORTED", "The nest has a speed change or is reversed; cloning its contents would change what plays");
        if (ref.inTicks !== first.inTicks || ref.outTicks !== first.outTicks) throw commandError("UXP_TARGET_UNSUPPORTED", "The nest's video and audio clips play different ranges of the nested sequence");
      }
      const offsetTicks = BigInt(nestStart) - BigInt(first.inTicks);

      const sourceItems = [], clones = [];
      for (const ref of references) {
        let contentStart = null, contentEnd = null;
        const nestedCount = await trackCount(nestedSequence, ref.mediaType);
        const parentCount = await trackCount(sequence, ref.mediaType);
        for (let trackIndex = 0; trackIndex < nestedCount; trackIndex++) {
          const items = await clipItems(nestedSequence, ref.mediaType, trackIndex);
          for (const item of items) {
            const start = BigInt(await ticksOf(item, "getStartTime")), end = BigInt(await ticksOf(item, "getEndTime"));
            if (contentStart === null || start < contentStart) contentStart = start;
            if (contentEnd === null || end > contentEnd) contentEnd = end;
            const targetTrackIndex = ref.trackIndex + trackIndex;
            if (targetTrackIndex >= parentCount) {
              throw commandError("UXP_TARGET_UNSUPPORTED", "Destination " + ref.mediaType + " track " + targetTrackIndex + " does not exist; add a track and inspect again");
            }
            sourceItems.push({ item, mediaType: ref.mediaType });
            clones.push({
              mediaType: ref.mediaType, sourceTrackIndex: trackIndex, targetTrackIndex,
              name: String(await requiredMethod(item, "getName")()),
              projectItemId: await projectItemId(item),
              startTicks: String(start + offsetTicks), endTicks: String(end + offsetTicks),
              inTicks: await ticksOf(item, "getInPoint"), outTicks: await ticksOf(item, "getOutPoint"),
              disabled: Boolean(await maybeCall(item, "isDisabled"))
            });
            if (clones.length > MAX_PLACEMENTS) throw commandError("UXP_TARGET_TOO_LARGE", "The nest holds more than " + MAX_PLACEMENTS + " clips");
          }
        }
        // A trimmed nest plays only part of its content; cloning everything
        // would bring the hidden head or tail back.
        if (contentStart !== null && (BigInt(first.inTicks) > contentStart || BigInt(first.outTicks) < contentEnd)) {
          throw commandError("UXP_TARGET_UNSUPPORTED", "The nest is trimmed: it plays less than its " + ref.mediaType + " content, so unnesting would change what plays");
        }
      }
      if (!clones.length) throw commandError("UXP_TARGET_UNSUPPORTED", "The nested sequence has no clips of the referenced media types");

      // Every destination range must be empty apart from the nest itself.
      const referenceIds = [];
      for (const ref of references) referenceIds.push(ref.mediaType + ":" + ref.trackIndex + ":" + ref.clipIndex);
      const occupancy = {};
      for (const placement of clones) {
        const key = placement.mediaType + ":" + placement.targetTrackIndex;
        if (!occupancy[key]) {
          const items = await clipItems(sequence, placement.mediaType, placement.targetTrackIndex);
          occupancy[key] = [];
          for (let clipIndex = 0; clipIndex < items.length; clipIndex++) {
            if (referenceIds.indexOf(key + ":" + clipIndex) !== -1) continue;
            occupancy[key].push({ start: BigInt(await ticksOf(items[clipIndex], "getStartTime")), end: BigInt(await ticksOf(items[clipIndex], "getEndTime")), name: String(await maybeCall(items[clipIndex], "getName") || "a clip") });
          }
        }
        for (const occupant of occupancy[key]) {
          if (occupant.start < BigInt(placement.endTicks) && occupant.end > BigInt(placement.startTicks)) {
            throw commandError("UXP_TARGET_OCCUPIED", "Destination " + placement.mediaType + " track " + placement.targetTrackIndex + " is occupied by " + occupant.name + " where " + placement.name + " would land");
          }
        }
      }

      const videoRef = references.find(function (ref) { return ref.mediaType === "video"; });
      const audioRef = references.find(function (ref) { return ref.mediaType === "audio"; });
      return {
        nestProjectItemId,
        referenceItems: references,
        sourceItems,
        offsetTicks,
        videoTrackOffset: videoRef ? videoRef.trackIndex : 0,
        audioTrackOffset: audioRef ? audioRef.trackIndex : 0,
        snapshot: {
          projectGuid: requiredIdentifier(project.guid, "project GUID"),
          sequenceId: requiredIdentifier(sequence.guid, "sequence GUID"),
          nestedSequenceId: requiredIdentifier(nestedSequence.guid, "nested sequence GUID"),
          nestedSequenceName: String(await maybeCall(nestItem, "getName") || ""),
          references: references.map(function (ref) {
            return { mediaType: ref.mediaType, trackIndex: ref.trackIndex, clipIndex: ref.clipIndex, startTicks: nestStart, endTicks: nestEnd, inTicks: ref.inTicks, outTicks: ref.outTicks };
          }),
          offsetTicks: String(offsetTicks),
          clones
        }
      };
    }

    async function readbackProblems(sequence, plan) {
      const problems = [];
      const claimed = new Set();
      const cache = {};
      async function track(mediaType, index) {
        const key = mediaType + ":" + index;
        if (!cache[key]) {
          const items = await clipItems(sequence, mediaType, index);
          cache[key] = [];
          for (const item of items) {
            cache[key].push({ start: await ticksOf(item, "getStartTime"), end: await ticksOf(item, "getEndTime"),
              inTicks: await ticksOf(item, "getInPoint"), outTicks: await ticksOf(item, "getOutPoint"),
              projectItemId: await projectItemId(item), disabled: Boolean(await maybeCall(item, "isDisabled")) });
          }
        }
        return cache[key];
      }
      for (const want of plan.snapshot.clones) {
        const items = await track(want.mediaType, want.targetTrackIndex);
        let found = -1;
        for (let index = 0; index < items.length; index++) {
          const key = want.mediaType + ":" + want.targetTrackIndex + ":" + index;
          if (claimed.has(key)) continue;
          const got = items[index];
          if (got.projectItemId === want.projectItemId && got.start === want.startTicks) { found = index; claimed.add(key); break; }
        }
        if (found === -1) { problems.push(want.name + " is not at its planned start on " + want.mediaType + " track " + want.targetTrackIndex); continue; }
        const got = items[found];
        if (got.end !== want.endTicks || got.inTicks !== want.inTicks || got.outTicks !== want.outTicks) problems.push(want.name + " on " + want.mediaType + " track " + want.targetTrackIndex + " does not have its nested source range");
        if (got.disabled !== want.disabled) problems.push(want.name + " on " + want.mediaType + " track " + want.targetTrackIndex + " changed enabled state");
      }
      for (const ref of plan.snapshot.references) {
        const items = await track(ref.mediaType, ref.trackIndex);
        if (items.some(function (item) { return item.projectItemId === plan.nestProjectItemId && item.start === ref.startTicks; })) {
          problems.push("the nest's " + ref.mediaType + " clip is still on track " + ref.trackIndex);
        }
      }
      return problems;
    }

    async function nestedSequenceOf(item) {
      const projectItem = await requiredMethod(item, "getProjectItem")();
      const clipItem = projectItem ? ppro.ClipProjectItem.cast(projectItem) : null;
      if (!clipItem || typeof clipItem.isSequence !== "function" || !(await clipItem.isSequence())) return null;
      if (typeof clipItem.getSequence !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere cannot resolve the nested sequence");
      return clipItem.getSequence();
    }

    async function trackCount(sequence, mediaType) {
      const method = mediaType === "video" ? "getVideoTrackCount" : "getAudioTrackCount";
      const count = Number(await requiredMethod(sequence, method)());
      if (!Number.isSafeInteger(count) || count < 0 || count > 512) throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned an invalid " + mediaType + " track count");
      return count;
    }

    async function clipItems(sequence, mediaType, trackIndex) {
      const method = mediaType === "video" ? "getVideoTrack" : "getAudioTrack";
      const track = await requiredMethod(sequence, method)(trackIndex);
      if (!track || typeof track.getTrackItems !== "function") throw commandError("UXP_TARGET_NOT_FOUND", mediaType + " track " + trackIndex + " is unavailable");
      const items = Array.from(await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false) || []);
      if (items.length > MAX_PLACEMENTS) throw commandError("UXP_TARGET_TOO_LARGE", "A track has more than " + MAX_PLACEMENTS + " clip items");
      return items;
    }

    async function ticksOf(item, method) {
      const time = await requiredMethod(item, method)();
      const ticks = time && time.ticks != null ? String(time.ticks) : "";
      if (!/^-?\d{1,30}$/.test(ticks)) throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned an unreadable " + method + " tick value");
      return ticks;
    }

    async function projectItemId(item) {
      const projectItem = await requiredMethod(item, "getProjectItem")();
      return requiredIdentifier(projectItem && typeof projectItem.getId === "function" ? await projectItem.getId() : null, "project-item ID");
    }

    function singleSelection(item) {
      let selection = null;
      const created = ppro.TrackItemSelection.createEmptySelection(function (value) { selection = value; });
      if (created !== true || !selection || typeof selection.addItem !== "function" || selection.addItem(item, false) !== true) {
        throw commandError("UXP_SELECTION_REJECTED", "Premiere rejected the nest selection");
      }
      return selection;
    }

    async function maybeCall(target, name) {
      if (!target || typeof target[name] !== "function") return undefined;
      try { return await target[name](); } catch (_) { return undefined; }
    }

    function targetCoordinates(args) {
      if (["video", "audio"].indexOf(args.mediaType) === -1) throw commandError("UXP_INVALID_ARGUMENT", "mediaType must be one of video, audio");
      for (const key of ["trackIndex", "clipIndex"]) {
        if (!Number.isSafeInteger(args[key]) || args[key] < 0 || args[key] > 511) throw commandError("UXP_INVALID_ARGUMENT", key + " must be an integer from 0 to 511");
      }
      return { mediaType: args.mediaType, trackIndex: args.trackIndex, clipIndex: args.clipIndex };
    }

    function canonical(value) {
      if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
      if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ":" + canonical(value[key]); }).join(",") + "}";
      return JSON.stringify(value);
    }

    function requiredMethod(target, name) { if (!target || typeof target[name] !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "The required item does not expose " + name); return target[name].bind(target); }
    function assertObject(value, name) { if (!value || typeof value !== "object" || Array.isArray(value)) throw commandError("UXP_INVALID_ARGUMENT", name + " must be an object"); }
    function assertOnlyKeys(value, allowed) { assertObject(value, "arguments"); for (const key of Object.keys(value)) if (allowed.indexOf(key) === -1) throw commandError("UXP_INVALID_ARGUMENT", "Unexpected argument: " + key); }
    function requiredIdentifier(value, name) { let id = ""; try { id = value == null ? "" : String(typeof value.toString === "function" ? value.toString() : value); } catch (_) { id = ""; } if (!id || id.length > 512 || id.indexOf("\u0000") !== -1) throw commandError("UXP_VERIFICATION_FAILED", name + " is unavailable or invalid"); return id; }
    function commandError(code, message) { const error = new Error(message); error.code = code; return error; }

    return definitions;
  }

  return { createUnnestWorkflowDefinitions };
});
