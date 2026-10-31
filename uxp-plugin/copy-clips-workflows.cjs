(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpCopyClipsWorkflows = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Copy a time range of clips from one sequence to another (or to another
  // place in the same sequence) the way an editor's copy and paste does: each
  // clip is cloned with SequenceEditor.createCloneTrackItemAction, so it keeps
  // its effects, keyframes, enabled state and source range. Legacy CEP can only
  // re-place a clip from its project item, which drops all of that.
  //
  // A clip wholly inside the range is cloned straight to its destination. A
  // clip that crosses an edge of the range is cloned whole to a parking spot
  // past the end of every destination track, trimmed to the range there, and
  // then moved into place, so its untrimmed length never overwrites a
  // neighbour. Every destination range must be empty beforehand; nothing is
  // ever overwritten.
  const MAX_PLACEMENTS = 512;
  const TICKS_PER_SECOND = 254016000000n;
  const PARKING_GAP = 10n * TICKS_PER_SECOND;

  function createCopyClipsWorkflowDefinitions(deps) {
    const ppro = deps.ppro;
    const definitions = {
      "sequence.copyClips.inspect": {
        readOnly: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canCopy,
        handler: inspectCopy
      },
      "sequence.copyClips": {
        destructive: true,
        undoable: true,
        idempotent: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canCopy,
        handler: applyCopy
      }
    };
    const TIME_KEYS = ["sourceStart", "sourceEnd", "destinationStart"];
    const ARG_KEYS = ["sourceSequenceId", "destinationSequenceId", "sourceStartTicks", "sourceEndTicks", "destinationStartTicks",
      "sourceStartSeconds", "sourceEndSeconds", "destinationStartSeconds",
      "videoTracks", "audioTracks", "videoTrackOffset", "audioTrackOffset"];

    function canCopy() {
      return !!(ppro.Project && typeof ppro.Project.getActiveProject === "function" &&
        ppro.SequenceEditor && typeof ppro.SequenceEditor.getEditor === "function" &&
        ppro.TickTime && typeof ppro.TickTime.createWithTicks === "function" &&
        ppro.Constants && ppro.Constants.TrackItemType);
    }

    async function inspectCopy(args) {
      assertOnlyKeys(args, ARG_KEYS);
      const request = copyRequest(args);
      const context = await projectContext(request, false);
      await resolveTimes(context, request);
      return (await planCopy(context, request)).snapshot;
    }

    async function applyCopy(args) {
      assertOnlyKeys(args, ARG_KEYS.concat(["expectedSnapshot", "confirmCopy", "operationId"]));
      if (args.confirmCopy !== true) throw commandError("UXP_CONFIRMATION_REQUIRED", "sequence.copyClips requires confirmCopy: true");
      if (typeof args.operationId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(args.operationId)) {
        throw commandError("UXP_INVALID_ARGUMENT", "operationId is required and must be 1-128 safe characters");
      }
      assertObject(args.expectedSnapshot, "expectedSnapshot");
      const request = copyRequest(args);
      const context = await projectContext(request, true);
      await resolveTimes(context, request);
      const plan = await planCopy(context, request);
      if (canonical(plan.snapshot) !== canonical(args.expectedSnapshot)) {
        throw commandError("UXP_STALE_TRACK_ITEM", "The source clips or the destination changed since inspection; inspect again before copying");
      }
      const editor = ppro.SequenceEditor.getEditor(context.destination);
      if (!editor || typeof editor.createCloneTrackItemAction !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere does not expose SequenceEditor clone actions");
      }
      const label = "Copy " + plan.snapshot.clips.length + " clip" + (plan.snapshot.clips.length === 1 ? "" : "s") + " from " + plan.snapshot.sourceSequenceName;
      const direct = plan.entries.filter(function (entry) { return !entry.trimmed; });
      const parked = plan.entries.filter(function (entry) { return entry.trimmed; });

      // Transaction 1: every clone, direct ones at their destination and
      // trimmed ones at the parking spot.
      context.project.lockedAccess(function () {
        const actions = checked(plan.entries.map(function (entry) {
          const at = entry.trimmed ? entry.parkedStart : BigInt(entry.placement.startTicks);
          return editor.createCloneTrackItemAction(entry.item, ppro.TickTime.createWithTicks(String(at - entry.sourceStart)),
            plan.videoTrackOffset, plan.audioTrackOffset, false, false);
        }));
        committed(context.project.executeTransaction(function (compoundAction) {
          for (const action of actions) if (compoundAction.addAction(action) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected a copy action");
        }, label), label);
      });
      let steps = 1;
      try {
        if (parked.length) {
          // Transaction 2: trim each parked clone to the range. Transaction 3:
          // move it into place.
          const clones = [];
          for (const entry of parked) clones.push({ entry, item: await findClone(context.destination, entry, entry.parkedStart) });
          context.project.lockedAccess(function () {
            const actions = [];
            for (const clone of clones) {
              const placement = clone.entry.placement, head = BigInt(placement.trimHeadTicks), tail = BigInt(placement.trimTailTicks);
              if (head > 0n) {
                actions.push(requiredMethod(clone.item, "createSetInPointAction")(ppro.TickTime.createWithTicks(placement.inTicks)));
                actions.push(requiredMethod(clone.item, "createSetStartAction")(ppro.TickTime.createWithTicks(String(clone.entry.parkedStart + head))));
              }
              if (tail > 0n) {
                actions.push(requiredMethod(clone.item, "createSetOutPointAction")(ppro.TickTime.createWithTicks(placement.outTicks)));
                actions.push(requiredMethod(clone.item, "createSetEndAction")(ppro.TickTime.createWithTicks(String(clone.entry.parkedEnd - tail))));
              }
            }
            checked(actions);
            committed(context.project.executeTransaction(function (compoundAction) {
          for (const action of actions) if (compoundAction.addAction(action) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected a copy action");
        }, label + " (trim)"), label + " (trim)");
          });
          steps++;
          const trimmed = [];
          for (const entry of parked) trimmed.push({ entry, item: await findClone(context.destination, entry, entry.parkedStart + BigInt(entry.placement.trimHeadTicks)) });
          context.project.lockedAccess(function () {
            const actions = checked(trimmed.map(function (clone) {
              const from = clone.entry.parkedStart + BigInt(clone.entry.placement.trimHeadTicks);
              return requiredMethod(clone.item, "createMoveAction")(ppro.TickTime.createWithTicks(String(BigInt(clone.entry.placement.startTicks) - from)));
            }));
            committed(context.project.executeTransaction(function (compoundAction) {
          for (const action of actions) if (compoundAction.addAction(action) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected a copy action");
        }, label + " (place)"), label + " (place)");
          });
          steps++;
        }
      } catch (error) {
        return { copied: false, committed: true, verified: false, partial: true, outcome: "committed_unverified", undoSteps: steps,
          readbackError: error && error.message ? error.message : String(error), rollbackPerformed: false,
          verificationBoundary: "committed_transaction_with_failed_follow_up",
          nextStep: "Some clips were cloned but not trimmed or placed. Use Premiere Undo " + steps + " time" + (steps === 1 ? "" : "s") + " to remove them, then inspect again." };
      }

      try {
        const problems = await readbackProblems(context.destination, plan);
        if (problems.length) {
          return { copied: false, committed: true, verified: false, partial: true, outcome: "committed_unverified", undoSteps: steps,
            problems: problems.slice(0, 20), rollbackPerformed: false,
            verificationBoundary: "committed_transaction_with_failed_readback",
            nextStep: "The copy committed but did not read back as planned. Use Premiere Undo " + steps + " time" + (steps === 1 ? "" : "s") + " to remove it, then inspect again." };
        }
        return { copied: true, committed: true, verified: true, outcome: "verified",
          sourceSequenceName: plan.snapshot.sourceSequenceName, destinationSequenceName: plan.snapshot.destinationSequenceName,
          clipsCopied: direct.length + parked.length, clipsTrimmed: parked.length, undoSteps: steps,
          verificationBoundary: "placement_start_source_range_and_project_item_readback", undoLabel: label };
      } catch (error) {
        return { copied: false, committed: true, verified: false, partial: true, outcome: "committed_unverified", undoSteps: steps,
          readbackError: error && error.message ? error.message : String(error), rollbackPerformed: false,
          verificationBoundary: "committed_transaction_with_failed_readback",
          nextStep: "Inspect the destination before any retry. Use Premiere Undo " + steps + " time" + (steps === 1 ? "" : "s") + " to remove the copy." };
      }
    }

    function checked(actions) {
      for (const action of actions) if (!action) throw commandError("UXP_ACTION_REJECTED", "Premiere did not create every copy action");
      return actions;
    }

    function committed(result, label) {
      if (!result) throw commandError("UXP_TRANSACTION_FAILED", "Premiere did not commit the copy transaction (" + label + ")");
    }

    async function projectContext(request, requireTransaction) {
      const project = await ppro.Project.getActiveProject();
      if (!project) throw commandError("UXP_NO_ACTIVE_PROJECT", "No active project");
      if (requireTransaction && (typeof project.lockedAccess !== "function" || typeof project.executeTransaction !== "function")) {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build does not expose locked undoable transactions");
      }
      const sequences = Array.from(await requiredMethod(project, "getSequences")() || []);
      const find = function (id, role) {
        const match = sequences.filter(function (sequence) { return identifier(sequence.guid) === id; });
        if (match.length !== 1) throw commandError("UXP_TARGET_NOT_FOUND", "The " + role + " sequence " + id + " is not in the active project");
        return match[0];
      };
      return { project, source: find(request.sourceSequenceId, "source"), destination: find(request.destinationSequenceId, "destination") };
    }

    // Seconds snap to the nearest frame of the sequence they are measured on,
    // so a range edge never splits a frame.
    async function resolveTimes(context, request) {
      for (const key of TIME_KEYS) {
        if (request[key + "Ticks"] != null) continue;
        const sequence = key === "destinationStart" ? context.destination : context.source;
        const frame = BigInt(String(await requiredMethod(sequence, "getTimebase")()));
        if (frame <= 0n) throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned an invalid sequence timebase");
        const exact = BigInt(Math.round(request[key + "Seconds"] * 1000000)) * TICKS_PER_SECOND;
        const perFrame = frame * 1000000n;
        request[key + "Ticks"] = String((exact + perFrame / 2n) / perFrame * frame);
      }
      if (BigInt(request.sourceEndTicks) <= BigInt(request.sourceStartTicks)) throw commandError("UXP_INVALID_ARGUMENT", "The source end must be after the source start");
    }

    async function planCopy(context, request) {
      const { project, source, destination } = context;
      const rangeStart = BigInt(request.sourceStartTicks), rangeEnd = BigInt(request.sourceEndTicks);
      const shift = BigInt(request.destinationStartTicks) - rangeStart;
      const entries = [];
      for (const mediaType of ["video", "audio"]) {
        const sourceCount = await trackCount(source, mediaType), destinationCount = await trackCount(destination, mediaType);
        const wanted = request[mediaType + "Tracks"];
        const offset = request[mediaType + "TrackOffset"];
        const tracks = wanted || range(sourceCount);
        for (const trackIndex of tracks) {
          if (trackIndex >= sourceCount) throw commandError("UXP_TARGET_NOT_FOUND", "Source " + mediaType + " track " + trackIndex + " does not exist");
          const items = await clipItems(source, mediaType, trackIndex);
          for (let clipIndex = 0; clipIndex < items.length; clipIndex++) {
            const item = items[clipIndex];
            const start = BigInt(await ticksOf(item, "getStartTime")), end = BigInt(await ticksOf(item, "getEndTime"));
            if (end <= rangeStart || start >= rangeEnd) continue;
            const targetTrackIndex = trackIndex + offset;
            if (targetTrackIndex < 0 || targetTrackIndex >= destinationCount) {
              throw commandError("UXP_TARGET_UNSUPPORTED", "Destination " + mediaType + " track " + targetTrackIndex + " does not exist; add a track and inspect again");
            }
            const name = String(await maybeCall(item, "getName") || "a clip");
            const inPoint = BigInt(await ticksOf(item, "getInPoint")), outPoint = BigInt(await ticksOf(item, "getOutPoint"));
            const head = start < rangeStart ? rangeStart - start : 0n, tail = end > rangeEnd ? end - rangeEnd : 0n;
            if (head > 0n || tail > 0n) {
              const speed = Number(await requiredMethod(item, "getSpeed")()), reversed = Boolean(await requiredMethod(item, "isSpeedReversed")());
              if (Math.abs(speed - 1) > 0.0001 || reversed) {
                throw commandError("UXP_TARGET_UNSUPPORTED", name + " crosses the edge of the range and has a speed change or is reversed; widen the range to take it whole");
              }
            }
            entries.push({
              item, sourceStart: start, sourceIn: inPoint, trimmed: head > 0n || tail > 0n,
              placement: {
                mediaType, sourceTrackIndex: trackIndex, sourceClipIndex: clipIndex, targetTrackIndex, name,
                projectItemId: await projectItemId(item),
                startTicks: String(start + head + shift), endTicks: String(end - tail + shift),
                inTicks: String(inPoint + head), outTicks: String(outPoint - tail),
                trimHeadTicks: String(head), trimTailTicks: String(tail),
                disabled: Boolean(await maybeCall(item, "isDisabled"))
              }
            });
            if (entries.length > MAX_PLACEMENTS) throw commandError("UXP_TARGET_TOO_LARGE", "The range holds more than " + MAX_PLACEMENTS + " clips");
          }
        }
      }
      if (!entries.length) throw commandError("UXP_TARGET_NOT_FOUND", "No clips on the chosen source tracks fall inside the range");
      for (const entry of entries) {
        if (BigInt(entry.placement.startTicks) < 0n) throw commandError("UXP_INVALID_ARGUMENT", "The destination start would place " + entry.placement.name + " before the start of the sequence");
      }

      // Nothing at the destination may be overwritten, and the parking spot
      // sits past the last clip on every destination track the copy touches.
      const occupancy = {};
      let lastEnd = 0n;
      for (const entry of entries) {
        const placement = entry.placement, key = placement.mediaType + ":" + placement.targetTrackIndex;
        if (!occupancy[key]) {
          occupancy[key] = [];
          for (const item of await clipItems(destination, placement.mediaType, placement.targetTrackIndex)) {
            occupancy[key].push({ start: BigInt(await ticksOf(item, "getStartTime")), end: BigInt(await ticksOf(item, "getEndTime")), name: String(await maybeCall(item, "getName") || "a clip") });
          }
        }
        for (const occupant of occupancy[key]) {
          if (occupant.end > lastEnd) lastEnd = occupant.end;
          if (occupant.start < BigInt(placement.endTicks) && occupant.end > BigInt(placement.startTicks)) {
            throw commandError("UXP_TARGET_OCCUPIED", "Destination " + placement.mediaType + " track " + placement.targetTrackIndex + " is occupied by " + occupant.name + " where " + placement.name + " would land");
          }
        }
        if (BigInt(placement.endTicks) > lastEnd) lastEnd = BigInt(placement.endTicks);
      }
      let parking = lastEnd + PARKING_GAP;
      for (const entry of entries) {
        if (!entry.trimmed) continue;
        entry.parkedStart = parking;
        entry.parkedEnd = parking + BigInt(entry.placement.endTicks) - BigInt(entry.placement.startTicks) + BigInt(entry.placement.trimHeadTicks) + BigInt(entry.placement.trimTailTicks);
        parking = entry.parkedEnd + PARKING_GAP;
      }

      return {
        entries,
        videoTrackOffset: request.videoTrackOffset,
        audioTrackOffset: request.audioTrackOffset,
        snapshot: {
          projectGuid: requiredIdentifier(project.guid, "project GUID"),
          sourceSequenceId: request.sourceSequenceId,
          sourceSequenceName: String(await maybeCall(source, "getName") || source.name || ""),
          destinationSequenceId: request.destinationSequenceId,
          destinationSequenceName: String(await maybeCall(destination, "getName") || destination.name || ""),
          sourceStartTicks: request.sourceStartTicks,
          sourceEndTicks: request.sourceEndTicks,
          destinationStartTicks: request.destinationStartTicks,
          clips: entries.map(function (entry) { return entry.placement; })
        }
      };
    }

    async function findClone(sequence, entry, startTicks) {
      const placement = entry.placement;
      for (const item of await clipItems(sequence, placement.mediaType, placement.targetTrackIndex)) {
        if (await ticksOf(item, "getStartTime") === String(startTicks) && await projectItemId(item) === placement.projectItemId) return item;
      }
      throw commandError("UXP_VERIFICATION_FAILED", placement.name + " is not at its parking position on " + placement.mediaType + " track " + placement.targetTrackIndex);
    }

    async function readbackProblems(sequence, plan) {
      const problems = [];
      const claimed = new Set();
      const cache = {};
      async function track(mediaType, index) {
        const key = mediaType + ":" + index;
        if (!cache[key]) {
          cache[key] = [];
          for (const item of await clipItems(sequence, mediaType, index)) {
            cache[key].push({ start: await ticksOf(item, "getStartTime"), end: await ticksOf(item, "getEndTime"),
              inTicks: await ticksOf(item, "getInPoint"), outTicks: await ticksOf(item, "getOutPoint"),
              projectItemId: await projectItemId(item), disabled: Boolean(await maybeCall(item, "isDisabled")) });
          }
        }
        return cache[key];
      }
      for (const entry of plan.entries) {
        const want = entry.placement;
        const items = await track(want.mediaType, want.targetTrackIndex);
        let found = -1;
        for (let index = 0; index < items.length; index++) {
          const key = want.mediaType + ":" + want.targetTrackIndex + ":" + index;
          if (claimed.has(key)) continue;
          if (items[index].projectItemId === want.projectItemId && items[index].start === want.startTicks) { found = index; claimed.add(key); break; }
        }
        if (found === -1) { problems.push(want.name + " is not at its planned start on " + want.mediaType + " track " + want.targetTrackIndex); continue; }
        const got = items[found];
        if (got.end !== want.endTicks || got.inTicks !== want.inTicks || got.outTicks !== want.outTicks) problems.push(want.name + " on " + want.mediaType + " track " + want.targetTrackIndex + " does not have its planned source range");
        if (got.disabled !== want.disabled) problems.push(want.name + " on " + want.mediaType + " track " + want.targetTrackIndex + " changed enabled state");
        if (entry.trimmed && items.some(function (item) { return BigInt(item.start) >= entry.parkedStart && item.projectItemId === want.projectItemId; })) {
          problems.push(want.name + " was left at its parking position on " + want.mediaType + " track " + want.targetTrackIndex);
        }
      }
      return problems;
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

    async function maybeCall(target, name) {
      if (!target || typeof target[name] !== "function") return undefined;
      try { return await target[name](); } catch (_) { return undefined; }
    }

    function copyRequest(args) {
      const request = {};
      for (const key of ["sourceSequenceId", "destinationSequenceId"]) {
        if (typeof args[key] !== "string" || !args[key] || args[key].length > 512) throw commandError("UXP_INVALID_ARGUMENT", key + " is required");
        request[key] = args[key];
      }
      for (const key of TIME_KEYS) {
        const ticks = args[key + "Ticks"], seconds = args[key + "Seconds"];
        if ((ticks == null) === (seconds == null)) throw commandError("UXP_INVALID_ARGUMENT", "Give exactly one of " + key + "Ticks or " + key + "Seconds");
        if (ticks != null && (typeof ticks !== "string" || !/^\d{1,30}$/.test(ticks))) throw commandError("UXP_INVALID_ARGUMENT", key + "Ticks must be a non-negative tick string");
        if (seconds != null && (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0 || seconds > 86400)) throw commandError("UXP_INVALID_ARGUMENT", key + "Seconds must be a number from 0 to 86400");
        request[key + "Ticks"] = ticks == null ? null : ticks;
        request[key + "Seconds"] = seconds == null ? null : seconds;
      }
      for (const mediaType of ["video", "audio"]) {
        const tracks = args[mediaType + "Tracks"];
        if (tracks != null) {
          if (!Array.isArray(tracks) || tracks.length > 64 || tracks.some(function (value) { return !Number.isSafeInteger(value) || value < 0 || value > 511; }) ||
            new Set(tracks).size !== tracks.length) {
            throw commandError("UXP_INVALID_ARGUMENT", mediaType + "Tracks must be a list of distinct track indexes from 0 to 511");
          }
        }
        request[mediaType + "Tracks"] = tracks == null ? null : tracks.slice();
        const offset = args[mediaType + "TrackOffset"] == null ? 0 : args[mediaType + "TrackOffset"];
        if (!Number.isSafeInteger(offset) || offset < -511 || offset > 511) throw commandError("UXP_INVALID_ARGUMENT", mediaType + "TrackOffset must be an integer from -511 to 511");
        request[mediaType + "TrackOffset"] = offset;
      }
      if (request.videoTracks && request.audioTracks && !request.videoTracks.length && !request.audioTracks.length) {
        throw commandError("UXP_INVALID_ARGUMENT", "Choose at least one video or audio track");
      }
      return request;
    }

    function range(count) { const out = []; for (let index = 0; index < count; index++) out.push(index); return out; }

    function canonical(value) {
      if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
      if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ":" + canonical(value[key]); }).join(",") + "}";
      return JSON.stringify(value);
    }

    function identifier(value) { try { return value == null ? "" : String(typeof value.toString === "function" ? value.toString() : value); } catch (_) { return ""; } }
    function requiredMethod(target, name) { if (!target || typeof target[name] !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "The required item does not expose " + name); return target[name].bind(target); }
    function assertObject(value, name) { if (!value || typeof value !== "object" || Array.isArray(value)) throw commandError("UXP_INVALID_ARGUMENT", name + " must be an object"); }
    function assertOnlyKeys(value, allowed) { assertObject(value, "arguments"); for (const key of Object.keys(value)) if (allowed.indexOf(key) === -1) throw commandError("UXP_INVALID_ARGUMENT", "Unexpected argument: " + key); }
    function requiredIdentifier(value, name) { const id = identifier(value); if (!id || id.length > 512 || id.indexOf("\u0000") !== -1) throw commandError("UXP_VERIFICATION_FAILED", name + " is unavailable or invalid"); return id; }
    function commandError(code, message) { const error = new Error(message); error.code = code; return error; }

    return definitions;
  }

  return { createCopyClipsWorkflowDefinitions };
});
