(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpAdvancedWorkflows = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_SELECTION_ITEMS = 64;
  const MAX_PROJECT_ITEMS = 4096;
  const MAX_VIEW_ITEMS = 256;
  const MAX_KEYFRAMES = 256;
  const MAX_MARKERS = 2048;
  const MAX_SEQUENCES = 1024;
  const MAX_BIN_CHILDREN = 1024;

  function createAdvancedWorkflowDefinitions(deps) {
    const ppro = deps.ppro, Protocol = deps.Protocol, workspace = deps.workspace, events = deps.events;
    const appendLocks = new Map();
    const definitions = {
      "projectSelection.views": { readOnly: true, minHostVersion: "25.6.0", probe: canUseProjectViews, handler: listProjectViews },
      "projectSelection.inspect": { readOnly: true, minHostVersion: "25.6.0", probe: canUseProjectViews, handler: inspectProjectSelection },
      "markers.inspect": { readOnly: true, targetCapabilityProbe: true, minHostVersion: "26.3.0", probe: canUseMarkers, handler: inspectMarkers },
      "markers.add": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "26.3.0", probe: canUseMarkers, handler: addMarker },
      "markers.addBeatGrid": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "26.3.0", probe: canUseMarkers, handler: addBeatGrid },
      "markers.update": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "26.3.0", probe: canUseMarkers, handler: updateMarker },
      "markers.remove": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "26.3.0", probe: canUseMarkers, handler: removeMarker },
      "bins.inspect": { readOnly: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseBins, handler: inspectBin },
      "bins.create": { destructive: true, undoable: true, minHostVersion: "25.6.0", probe: canUseBins, handler: createBin },
      "bins.createSmart": { destructive: true, undoable: true, minHostVersion: "25.6.0", probe: canUseBins, handler: createSmartBin },
      "bins.rename": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseBins, handler: renameProjectItem },
      "bins.move": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseBins, handler: moveProjectItem },
      "bins.color": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseBins, handler: colorProjectItem },
      "bins.remove": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseBins, handler: removeProjectItem },
      "sequenceSettings.get": { readOnly: true, targetCapabilityProbe: true, minHostVersion: "26.2.0", probe: canUseSequenceSettings, handler: getSequenceSettings },
      "sequenceSettings.update": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "26.2.0", probe: canUseSequenceSettings, handler: updateSequenceSettings },
      "project.import": { destructive: true, undoable: false, requiresWorkspace: true, minHostVersion: "25.6.0", probe: canImportProjectMedia, handler: importProjectMedia },
      "parameters.inspect": { readOnly: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseParameters, handler: inspectParameter },
      "parameters.set": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseParameters, handler: setParameterValue },
      "parameters.keyframeAdd": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseParameters, handler: addParameterKeyframe },
      "parameters.keyframeRemove": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseParameters, handler: removeParameterKeyframe },
      "parameters.keyframeRemoveRange": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseParameters, handler: removeParameterKeyframeRange },
      "parameters.keyframeInterpolation": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseParameters, handler: setParameterInterpolation },
      "trackItem.inspect": { readOnly: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseTrackItems, handler: inspectTrackItem },
      "trackItem.update": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseTrackItems, handler: updateTrackItem },
      "trackItem.splitEdit": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseTrackItems, handler: makeSplitEdit },
      "timeline.insert": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseSequenceEditor, handler: insertTimelineItem },
      "timeline.overwrite": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseSequenceEditor, handler: overwriteTimelineItem },
      "timeline.cloneSelection": { destructive: true, undoable: true, minHostVersion: "25.6.0", probe: canUseSequenceEditor, handler: cloneTimelineSelection },
      "timeline.removeSelection": { destructive: true, undoable: true, minHostVersion: "25.6.0", probe: canUseSequenceEditor, handler: removeTimelineSelection },
      "timeline.mogrtPath": { destructive: true, undoable: false, requiresWorkspace: true, minHostVersion: "25.6.0", probe: canUseMogrtPath, handler: insertMogrtPath },
      "timeline.mogrtLibrary": { destructive: true, undoable: false, minHostVersion: "25.6.0", probe: canUseMogrtLibrary, handler: insertMogrtLibrary },
      "sequences.inspect": { readOnly: true, minHostVersion: "25.6.0", probe: canUseSequences, handler: inspectSequences },
      "sequences.createFromMedia": { destructive: true, undoable: false, minHostVersion: "25.6.0", probe: canUseSequences, handler: createSequenceFromMedia },
      "sequences.clone": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseSequences, handler: cloneSequence },
      "sequences.subsequence": { destructive: true, undoable: false, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseSequences, handler: createSubsequence },
      "sequences.activate": { idempotent: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseSequences, handler: activateSequence },
      "sequences.open": { idempotent: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseSequences, handler: openSequence },
      "sequences.close": { idempotent: true, targetCapabilityProbe: true, minHostVersion: "26.2.0", probe: canCloseSequence, handler: closeSequence },
      "sequences.delete": { destructive: true, undoable: false, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseSequences, handler: deleteSequence },
      "encoder.preflight": { readOnly: true, conditionalWorkspace: true, minHostVersion: "25.6.0", probe: canUseEncoder, handler: encoderPreflight },
      "encoder.jobs": { readOnly: true, minHostVersion: "25.6.0", probe: canTrackEncoderJobs, handler: inspectEncoderJobs },
      "encoder.wait": { readOnly: true, minHostVersion: "25.6.0", probe: canTrackEncoderJobs, handler: waitForEncoderJob },
      "encoder.sequence": { destructive: true, undoable: false, requiresWorkspace: true, minHostVersion: "25.6.0", probe: canUseEncoder, handler: encodeSequence },
      "encoder.projectItem": { destructive: true, undoable: false, targetCapabilityProbe: true, requiresWorkspace: true, minHostVersion: "25.6.0", probe: canUseEncoder, handler: encodeProjectItem },
      "encoder.file": { destructive: true, undoable: false, requiresWorkspace: true, minHostVersion: "25.6.0", probe: canUseEncoder, handler: encodeFile }
    };

    async function activeProject(requireTransactions) {
      const project = await ppro.Project.getActiveProject();
      if (!project) throw commandError("UXP_NO_ACTIVE_PROJECT", "No active project");
      if (requireTransactions && (typeof project.lockedAccess !== "function" || typeof project.executeTransaction !== "function")) {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build does not expose locked undoable transactions");
      }
      return project;
    }

    async function activeContext(requireTransactions) {
      const project = await activeProject(requireTransactions), sequence = await project.getActiveSequence();
      if (!sequence) throw commandError("UXP_NO_ACTIVE_SEQUENCE", "No active sequence");
      return { project, sequence };
    }

    function commitActions(project, label, actions) {
      // Every caller creates the actions and invokes this helper from the same
      // lexical project.lockedAccess() callback; the helper only centralizes
      // compound-action rejection and commit checks.
      // eslint-disable-next-line @adobe/premierepro/prefer-locked-access-wrapper
      const committed = project.executeTransaction((compoundAction) => {
        for (const action of actions) {
          if (!action || compoundAction.addAction(action) === false) {
            throw commandError("UXP_ACTION_REJECTED", "Premiere rejected an action in " + label);
          }
        }
      }, label);
      if (!committed) throw commandError("UXP_TRANSACTION_FAILED", "Premiere did not commit " + label);
    }

    function tick(seconds, name) {
      const value = finiteNumber(seconds, name || "seconds", -86400, 86400);
      if (!ppro.TickTime || typeof ppro.TickTime.createWithSeconds !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere cannot create TickTime values");
      }
      return ppro.TickTime.createWithSeconds(value);
    }

    function tickSeconds(value) {
      const seconds = value && Number(value.seconds);
      return Number.isFinite(seconds) ? seconds : null;
    }

    function guidString(value) {
      if (value == null) return "";
      try { return typeof value.toString === "function" ? String(value.toString()) : String(value); } catch (_) { return ""; }
    }

    function guidFromString(value, name) {
      const text = boundedString(value, name, 128);
      if (!ppro.Guid || typeof ppro.Guid.fromString !== "function") return text;
      try { return ppro.Guid.fromString(text); } catch (_) { throw commandError("UXP_INVALID_ARGUMENT", name + " is not a valid GUID"); }
    }

    async function projectItemId(item) {
      if (!item || typeof item.getId !== "function") return "";
      const value = await item.getId();
      return value == null ? "" : String(value);
    }

    async function projectItemSnapshot(item) {
      let colorLabelIndex = null, parentId = null;
      try { if (typeof item.getColorLabelIndex === "function") colorLabelIndex = await item.getColorLabelIndex(); } catch (_) {}
      try { if (typeof item.getParentBin === "function") parentId = await projectItemId(await item.getParentBin()); } catch (_) {}
      return { id: await projectItemId(item), name: String(item && item.name || ""), type: item && item.type != null ? item.type : null, colorLabelIndex, parentId };
    }

    function isFolder(item) {
      if (!ppro.FolderItem || typeof ppro.FolderItem.cast !== "function") return false;
      try { return !!ppro.FolderItem.cast(item); } catch (_) { return false; }
    }

    function asFolder(item, label) {
      if (!ppro.FolderItem || typeof ppro.FolderItem.cast !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "Folder APIs are unavailable");
      try {
        const folder = ppro.FolderItem.cast(item);
        if (folder) return folder;
      } catch (_) {}
      throw commandError("UXP_TARGET_UNSUPPORTED", label + " is not a project bin");
    }

    function asClip(item, label) {
      if (!ppro.ClipProjectItem || typeof ppro.ClipProjectItem.cast !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "Clip project-item APIs are unavailable");
      try {
        const clip = ppro.ClipProjectItem.cast(item);
        if (clip) return clip;
      } catch (_) {}
      throw commandError("UXP_TARGET_UNSUPPORTED", label + " is not a media clip");
    }

    async function selectedProjectItems(project, viewId) {
      if (!ppro.ProjectUtils) throw commandError("UXP_COMMAND_UNAVAILABLE", "Project panel selection APIs are unavailable");
      let selection;
      if (viewId) {
        if (typeof ppro.ProjectUtils.getSelectionFromViewId !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "View-specific selection is unavailable");
        selection = await ppro.ProjectUtils.getSelectionFromViewId(guidFromString(viewId, "viewId"));
      } else {
        if (typeof ppro.ProjectUtils.getSelection !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "Project panel selection is unavailable");
        selection = await ppro.ProjectUtils.getSelection(project);
      }
      const items = selection && typeof selection.getItems === "function" ? Array.from(await selection.getItems() || []) : [];
      if (items.length > MAX_VIEW_ITEMS) throw commandError("UXP_SELECTION_TOO_LARGE", "Project panel selection exceeds " + MAX_VIEW_ITEMS + " items");
      return items;
    }

    async function findProjectItem(project, wantedId) {
      const id = boundedString(wantedId, "projectItemId", 512);
      try {
        const selected = await selectedProjectItems(project);
        for (const item of selected) if (await projectItemId(item) === id) return item;
      } catch (_) {}
      const root = await project.getRootItem(), queue = root ? [root] : [];
      let visited = 0;
      while (queue.length) {
        const folder = queue.shift();
        const children = folder && typeof folder.getItems === "function" ? Array.from(await folder.getItems() || []) : [];
        for (const item of children) {
          visited += 1;
          if (visited > MAX_PROJECT_ITEMS) throw commandError("UXP_PROJECT_TOO_LARGE", "Project-item lookup exceeded " + MAX_PROJECT_ITEMS + " entries; select the target in its Project view");
          if (await projectItemId(item) === id) return item;
          if (isFolder(item)) queue.push(item);
        }
      }
      throw commandError("UXP_TARGET_NOT_FOUND", "projectItemId was not found");
    }

    async function resolveProjectItem(project, id, requireOneSelection) {
      if (id) return findProjectItem(project, id);
      const items = await selectedProjectItems(project);
      if (requireOneSelection !== false && items.length !== 1) throw commandError("UXP_INVALID_ARGUMENT", "Select exactly one Project item or pass projectItemId");
      return requireOneSelection === false ? items : items[0];
    }

    async function resolveFolder(project, id, label) {
      return id ? asFolder(await findProjectItem(project, id), label || "projectItemId") : asFolder(await project.getRootItem(), "project root");
    }

    async function sequenceSnapshot(sequence) {
      return { id: guidString(sequence && sequence.guid), name: String(sequence && sequence.name || "") };
    }

    async function boundedSequences(project) {
      const values = typeof project.getSequences === "function" ? Array.from(await project.getSequences() || []) : [];
      if (values.length > MAX_SEQUENCES) throw commandError("UXP_PROJECT_TOO_LARGE", "Sequence lookup exceeds " + MAX_SEQUENCES + " entries");
      return values;
    }

    async function listSequences(project) {
      const values = await boundedSequences(project);
      const result = [];
      for (const sequence of values) result.push(await sequenceSnapshot(sequence));
      return result;
    }

    async function resolveSequence(project, sequenceId) {
      if (!sequenceId) {
        const active = await project.getActiveSequence();
        if (!active) throw commandError("UXP_NO_ACTIVE_SEQUENCE", "No active sequence");
        return active;
      }
      const wanted = boundedString(sequenceId, "sequenceId", 128), sequences = await boundedSequences(project);
      for (const sequence of sequences) if (guidString(sequence.guid) === wanted) return sequence;
      throw commandError("UXP_TARGET_NOT_FOUND", "sequenceId was not found");
    }

    async function trackItemAt(sequence, mediaType, trackIndex, clipIndex) {
      const title = mediaType === "video" ? "Video" : "Audio", countMethod = "get" + title + "TrackCount", trackMethod = "get" + title + "Track";
      const count = await sequence[countMethod]();
      if (trackIndex >= count) throw commandError("UXP_TARGET_NOT_FOUND", mediaType + " trackIndex is out of range");
      const track = await sequence[trackMethod](trackIndex), itemType = ppro.Constants && ppro.Constants.TrackItemType;
      if (!track || !itemType || itemType.CLIP == null || typeof track.getTrackItems !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "Clip track-item APIs are unavailable");
      const items = Array.from(await track.getTrackItems(itemType.CLIP, false) || []);
      if (!items[clipIndex]) throw commandError("UXP_TARGET_NOT_FOUND", "clipIndex is out of range");
      return items[clipIndex];
    }

    async function selectedTrackItems(sequence) {
      const selection = await sequence.getSelection(), items = selection && typeof selection.getTrackItems === "function" ? Array.from(await selection.getTrackItems() || []) : [];
      if (!items.length) throw commandError("UXP_EMPTY_SELECTION", "Select at least one timeline item");
      if (items.length > MAX_SELECTION_ITEMS) throw commandError("UXP_SELECTION_TOO_LARGE", "Select at most " + MAX_SELECTION_ITEMS + " timeline items");
      return { selection, items };
    }

    async function listProjectViews(args) {
      assertObject(args); assertOnlyKeys(args, []);
      const ids = Array.from(await ppro.ProjectUtils.getProjectViewIds() || []), views = [];
      for (const id of ids.slice(0, 64)) {
        const project = await ppro.ProjectUtils.getProjectFromViewId(id);
        views.push({ viewId: guidString(id), projectId: guidString(project && project.guid), projectName: String(project && project.name || "") });
      }
      return { count: views.length, limited: ids.length > 64, views };
    }

    async function inspectProjectSelection(args) {
      assertObject(args); assertOnlyKeys(args, ["viewId"]);
      const project = await activeProject(false), items = await selectedProjectItems(project, args.viewId), snapshots = [];
      for (const item of items) snapshots.push(await projectItemSnapshot(item));
      return { viewId: args.viewId || null, count: snapshots.length, items: snapshots, resolver: "project_view_selection" };
    }

    async function markerContext(args, includeMutationFields) {
      const allowed = ["ownerType", "sequenceId", "projectItemId", "markerGuid", "expectedName"];
      if (includeMutationFields) allowed.push("name", "markerType", "startSeconds", "durationSeconds", "comments", "colorIndex", "operationId");
      assertObject(args); assertOnlyKeys(args, allowed);
      const ownerType = args.ownerType == null ? "sequence" : enumValue(args.ownerType, "ownerType", ["sequence", "projectItem"]);
      const project = await activeProject(includeMutationFields);
      const owner = ownerType === "sequence" ? await resolveSequence(project, args.sequenceId) : asClip(await resolveProjectItem(project, args.projectItemId, true), "projectItemId");
      const collection = await ppro.Markers.getMarkers(owner);
      if (!collection || typeof collection.getMarkers !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere did not return a marker collection");
      return { project, owner, ownerType, collection };
    }

    async function markerSnapshot(marker) {
      return {
        guid: guidString(marker.guid), name: String(await marker.getName() || ""), type: String(await marker.getType() || ""),
        comments: String(await marker.getComments() || ""), colorIndex: await marker.getColorIndex(),
        startSeconds: tickSeconds(await marker.getStart()), durationSeconds: tickSeconds(await marker.getDuration())
      };
    }

    async function markerList(collection) {
      const result = [];
      for (const marker of boundedMarkers(collection)) result.push(await markerSnapshot(marker));
      return result;
    }

    async function findMarker(collection, markerGuid, expectedName) {
      const wanted = boundedString(markerGuid, "markerGuid", 128);
      for (const marker of boundedMarkers(collection)) {
        if (guidString(marker.guid) !== wanted) continue;
        if (expectedName != null && String(await marker.getName() || "") !== expectedName) throw commandError("UXP_STALE_MARKER", "Marker name no longer matches expectedName");
        return marker;
      }
      throw commandError("UXP_TARGET_NOT_FOUND", "markerGuid was not found");
    }

    async function inspectMarkers(args) {
      const context = await markerContext(args, false), markers = await markerList(context.collection);
      return { ownerType: context.ownerType, count: markers.length, markers };
    }

    async function addMarker(args) {
      const context = await markerContext(args, true), name = boundedString(args.name, "name", 255);
      const markerType = args.markerType == null ? String(ppro.Marker && ppro.Marker.MARKER_TYPE_COMMENT || "Comment") : boundedString(args.markerType, "markerType", 128);
      const start = tick(finiteNumber(args.startSeconds == null ? 0 : args.startSeconds, "startSeconds", 0, 86400), "startSeconds"), duration = tick(finiteNumber(args.durationSeconds == null ? 0 : args.durationSeconds, "durationSeconds", 0, 86400), "durationSeconds");
      const comments = args.comments == null ? "" : boundedStringAllowEmpty(args.comments, "comments", 4000);
      const ownerId = context.ownerType === "sequence" ? guidString(context.owner && context.owner.guid) : await projectItemId(context.owner);
      return withAppendLock(appendLockKey(context.project, "markers", context.ownerType + ":" + ownerId), async () => {
        const before = await markerList(context.collection);
        assertAppendCapacity(before, MAX_MARKERS, "Marker creation");
        context.project.lockedAccess(() => {
          commitActions(context.project, "Add marker", [context.collection.createAddMarkerAction(name, markerType, start, duration, comments)]);
        });
        const after = await markerList(context.collection), added = after.filter((value) => !before.some((old) => old.guid === value.guid));
        return mutationResult(added.length === 1, { added: true, marker: added[0] || null, beforeCount: before.length, afterCount: after.length }, "marker_guid_readback", "Add marker");
      });
    }

    async function addBeatGrid(args) {
      assertObject(args); assertOnlyKeys(args, ["sequenceId", "beatTimesSeconds", "offsetSeconds", "namePrefix", "comments", "markerType", "operationId"]);
      const context = await markerContext({ ownerType: "sequence", sequenceId: args.sequenceId }, true);
      if (!Array.isArray(args.beatTimesSeconds) || !args.beatTimesSeconds.length || args.beatTimesSeconds.length > 512) {
        throw commandError("UXP_INVALID_ARGUMENT", "beatTimesSeconds must contain between 1 and 512 entries");
      }
      const offset = finiteNumber(args.offsetSeconds == null ? 0 : args.offsetSeconds, "offsetSeconds", -86400, 86400);
      const prefix = args.namePrefix == null ? "Beat" : boundedString(args.namePrefix, "namePrefix", 64);
      const comments = args.comments == null ? "" : boundedStringAllowEmpty(args.comments, "comments", 1000);
      const markerType = args.markerType == null ? String(ppro.Marker && ppro.Marker.MARKER_TYPE_COMMENT || "Comment") : boundedString(args.markerType, "markerType", 128);
      const times = [], seen = new Set();
      for (let index = 0; index < args.beatTimesSeconds.length; index++) {
        const value = finiteNumber(args.beatTimesSeconds[index], "beatTimesSeconds[" + index + "]", 0, 86400);
        const positioned = value + offset;
        if (positioned < 0 || positioned > 86400) throw commandError("UXP_INVALID_ARGUMENT", "offset beat times must remain between 0 and 86400 seconds");
        const key = positioned.toFixed(9);
        if (seen.has(key)) throw commandError("UXP_INVALID_ARGUMENT", "offset beat times must be unique");
        seen.add(key); times.push(positioned);
      }
      for (let index = 1; index < times.length; index++) {
        if (times[index] <= times[index - 1]) throw commandError("UXP_INVALID_ARGUMENT", "beatTimesSeconds must be strictly increasing");
      }
      const ownerId = guidString(context.owner && context.owner.guid);
      return withAppendLock(appendLockKey(context.project, "markers", "sequence:" + ownerId), async () => {
        const before = await markerList(context.collection);
        if (before.length + times.length > MAX_MARKERS) throw commandError("UXP_COLLECTION_LIMIT", "Beat marker creation would exceed the " + MAX_MARKERS + " marker limit");
        context.project.lockedAccess(() => {
          const actions = times.map((time, index) => context.collection.createAddMarkerAction(prefix + " " + (index + 1), markerType, tick(time, "beat time"), tick(0, "durationSeconds"), comments));
          commitActions(context.project, "Add beat grid markers", actions);
        });
        const after = await markerList(context.collection), beforeGuids = new Set(before.map((marker) => marker.guid));
        const added = after.filter((marker) => !beforeGuids.has(marker.guid));
        const addedGuids = new Set(added.map((marker) => marker.guid));
        const verified = added.length === times.length && addedGuids.size === added.length
          && added.every((marker, index) => Boolean(marker.guid) && marker.name === prefix + " " + (index + 1) && numbersEqual(marker.startSeconds, times[index]));
        return mutationResult(verified, { added: added.length, markers: added, beforeCount: before.length, afterCount: after.length, offsetSeconds: offset }, "beat_marker_guid_and_time_readback", "Add beat grid markers");
      });
    }

    async function updateMarker(args) {
      const context = await markerContext(args, true), marker = await findMarker(context.collection, args.markerGuid, args.expectedName);
      const requested = [args.name, args.comments, args.markerType, args.durationSeconds, args.startSeconds, args.colorIndex].filter((value) => value != null);
      if (!requested.length) throw commandError("UXP_INVALID_ARGUMENT", "Provide at least one marker field to update");
      context.project.lockedAccess(() => {
        const actions = [];
        if (args.name != null) actions.push(marker.createSetNameAction(boundedString(args.name, "name", 255)));
        if (args.comments != null) actions.push(marker.createSetCommentsAction(boundedStringAllowEmpty(args.comments, "comments", 4000)));
        if (args.markerType != null) actions.push(marker.createSetTypeAction(boundedString(args.markerType, "markerType", 128)));
        if (args.durationSeconds != null) actions.push(marker.createSetDurationAction(tick(finiteNumber(args.durationSeconds, "durationSeconds", 0, 86400), "durationSeconds")));
        if (args.startSeconds != null) actions.push(context.collection.createMoveMarkerAction(marker, tick(finiteNumber(args.startSeconds, "startSeconds", 0, 86400), "startSeconds")));
        if (args.colorIndex != null) actions.push(marker.createSetColorByIndexAction(boundedInt(args.colorIndex, "colorIndex", 0, 6)));
        commitActions(context.project, "Update marker", actions);
      });
      const updated = await findMarker(context.collection, args.markerGuid), snapshot = await markerSnapshot(updated);
      const verified = (args.name == null || snapshot.name === args.name)
        && (args.comments == null || snapshot.comments === args.comments)
        && (args.markerType == null || snapshot.type === args.markerType)
        && (args.durationSeconds == null || numbersEqual(snapshot.durationSeconds, args.durationSeconds))
        && (args.startSeconds == null || numbersEqual(snapshot.startSeconds, args.startSeconds))
        && (args.colorIndex == null || snapshot.colorIndex === args.colorIndex);
      return mutationResult(verified, { updated: true, marker: snapshot }, "marker_field_readback", "Update marker");
    }

    async function removeMarker(args) {
      const context = await markerContext(args, true), marker = await findMarker(context.collection, args.markerGuid, args.expectedName);
      context.project.lockedAccess(() => {
        commitActions(context.project, "Remove marker", [context.collection.createRemoveMarkerAction(marker)]);
      });
      const remaining = await markerList(context.collection), verified = !remaining.some((value) => value.guid === args.markerGuid);
      return mutationResult(verified, { removed: true, markerGuid: args.markerGuid, remainingCount: remaining.length }, "marker_guid_absence_readback", "Remove marker");
    }

    async function binChildren(folder) {
      const children = Array.from(await folder.getItems() || []);
      if (children.length > MAX_BIN_CHILDREN) throw commandError("UXP_BIN_TOO_LARGE", "Bin inspection exceeds " + MAX_BIN_CHILDREN + " immediate children");
      const values = [];
      for (const child of children) values.push(await projectItemSnapshot(child));
      return values;
    }

    async function inspectBin(args) {
      assertObject(args); assertOnlyKeys(args, ["binId"]);
      const project = await activeProject(false), folder = await resolveFolder(project, args.binId, "binId"), items = await binChildren(folder);
      return { bin: await projectItemSnapshot(folder), count: items.length, items };
    }

    async function createBin(args) {
      assertObject(args); assertOnlyKeys(args, ["parentBinId", "name", "makeUnique", "operationId"]);
      const project = await activeProject(true), folder = await resolveFolder(project, args.parentBinId, "parentBinId"), name = boundedString(args.name, "name", 255);
      const makeUnique = optionalBoolean(args.makeUnique, true, "makeUnique");
      return withAppendLock(appendLockKey(project, "bin", await projectItemId(folder)), async () => {
        const before = await binChildren(folder);
        assertAppendCapacity(before, MAX_BIN_CHILDREN, "Project-bin creation");
        project.lockedAccess(() => {
          commitActions(project, "Create project bin", [folder.createBinAction(name, makeUnique)]);
        });
        const after = await binChildren(folder), added = after.filter((value) => !before.some((old) => old.id === value.id));
        return mutationResult(added.length === 1, { created: true, item: added[0] || null }, "bin_child_id_readback", "Create project bin");
      });
    }

    async function createSmartBin(args) {
      assertObject(args); assertOnlyKeys(args, ["parentBinId", "name", "searchQuery", "operationId"]);
      const project = await activeProject(true), folder = await resolveFolder(project, args.parentBinId, "parentBinId"), name = boundedString(args.name, "name", 255), query = boundedString(args.searchQuery, "searchQuery", 4000);
      return withAppendLock(appendLockKey(project, "bin", await projectItemId(folder)), async () => {
        const before = await binChildren(folder);
        assertAppendCapacity(before, MAX_BIN_CHILDREN, "Smart-bin creation");
        project.lockedAccess(() => {
          commitActions(project, "Create smart bin", [folder.createSmartBinAction(name, query)]);
        });
        const after = await binChildren(folder), added = after.filter((value) => !before.some((old) => old.id === value.id));
        return mutationResult(added.length === 1, { created: true, item: added[0] || null }, "bin_child_id_readback", "Create smart bin");
      });
    }

    async function renameProjectItem(args) {
      assertObject(args); assertOnlyKeys(args, ["projectItemId", "expectedName", "name", "operationId"]);
      const project = await activeProject(true), item = await resolveProjectItem(project, args.projectItemId, true), before = await projectItemSnapshot(item);
      assertExpected(before.name, args.expectedName, "UXP_STALE_PROJECT_ITEM", "Project item name");
      const name = boundedString(args.name, "name", 255);
      project.lockedAccess(() => {
        const action = typeof item.createSetNameAction === "function" ? item.createSetNameAction(name) : asFolder(item, "projectItemId").createRenameBinAction(name);
        commitActions(project, "Rename project item", [action]);
      });
      const after = await projectItemSnapshot(item);
      return mutationResult(after.name === name, { renamed: true, before, after }, "project_item_name_readback", "Rename project item");
    }

    async function moveProjectItem(args) {
      assertObject(args); assertOnlyKeys(args, ["projectItemId", "destinationBinId", "expectedParentId", "operationId"]);
      const project = await activeProject(true), item = await resolveProjectItem(project, args.projectItemId, true), before = await projectItemSnapshot(item);
      assertExpected(before.parentId, args.expectedParentId, "UXP_STALE_PROJECT_ITEM", "Project item parent");
      const destination = await resolveFolder(project, args.destinationBinId, "destinationBinId");
      let source = await project.getRootItem();
      try { if (typeof item.getParentBin === "function") source = asFolder(await item.getParentBin(), "current parent"); } catch (_) {}
      project.lockedAccess(() => {
        commitActions(project, "Move project item", [source.createMoveItemAction(item, destination)]);
      });
      const after = await projectItemSnapshot(item), destinationId = await projectItemId(destination);
      return mutationResult(after.parentId === destinationId, { moved: true, before, after, destinationBinId: destinationId }, "project_item_parent_readback", "Move project item");
    }

    async function colorProjectItem(args) {
      assertObject(args); assertOnlyKeys(args, ["projectItemId", "colorIndex", "operationId"]);
      const project = await activeProject(true), item = await resolveProjectItem(project, args.projectItemId, true), colorIndex = boundedInt(args.colorIndex, "colorIndex", 0, 14), before = await projectItemSnapshot(item);
      if (typeof item.createSetColorLabelAction !== "function") throw commandError("UXP_TARGET_UNSUPPORTED", "Project item does not support color labels");
      project.lockedAccess(() => {
        commitActions(project, "Set project item color", [item.createSetColorLabelAction(colorIndex)]);
      });
      const after = await projectItemSnapshot(item);
      return mutationResult(after.colorLabelIndex === colorIndex, { updated: true, before, after }, "project_item_color_readback", "Set project item color");
    }

    async function removeProjectItem(args) {
      assertObject(args); assertOnlyKeys(args, ["projectItemId", "expectedName", "operationId"]);
      const project = await activeProject(true), item = await resolveProjectItem(project, args.projectItemId, true), before = await projectItemSnapshot(item);
      assertExpected(before.name, args.expectedName, "UXP_STALE_PROJECT_ITEM", "Project item name");
      let parent = await project.getRootItem();
      try { if (typeof item.getParentBin === "function") parent = asFolder(await item.getParentBin(), "current parent"); } catch (_) {}
      project.lockedAccess(() => {
        commitActions(project, "Remove project item", [parent.createRemoveItemAction(item)]);
      });
      let verified = false;
      try { await findProjectItem(project, before.id); } catch (error) { if (error && error.code === "UXP_TARGET_NOT_FOUND") verified = true; }
      return mutationResult(verified, { removed: true, item: before }, "project_item_absence_readback", "Remove project item");
    }

    async function settingsSnapshot(settings) {
      const videoRate = typeof settings.getVideoFrameRate === "function" ? settings.getVideoFrameRate() : null;
      const audioRate = typeof settings.getAudioSampleRate === "function" ? await settings.getAudioSampleRate() : null;
      const videoRect = typeof settings.getVideoFrameRect === "function" ? await settings.getVideoFrameRect() : null;
      const previewRect = typeof settings.getPreviewFrameRect === "function" ? await settings.getPreviewFrameRect() : null;
      return {
        maximumBitDepth: await maybeCall(settings, "getMaximumBitDepth"), maxRenderQuality: await maybeCall(settings, "getMaxRenderQuality"),
        compositeInLinearColor: await maybeCall(settings, "getCompositeInLinearColor"), audioChannelCount: await maybeCall(settings, "getAudioChannelCount"),
        audioChannelType: await maybeCall(settings, "getAudioChannelType"), audioSampleRate: rateValue(audioRate), videoFrameRate: rateValue(videoRate),
        videoFieldType: await maybeCall(settings, "getVideoFieldType"), videoPixelAspectRatio: await maybeCall(settings, "getVideoPixelAspectRatio"),
        editingMode: await maybeCall(settings, "getEditingMode"), previewFileFormat: await maybeCall(settings, "getPreviewFileFormat"), previewCodec: await maybeCall(settings, "getPreviewCodec"),
        videoFrame: rectValue(videoRect), previewFrame: rectValue(previewRect)
      };
    }

    async function getSequenceSettings(args) {
      assertObject(args); assertOnlyKeys(args, ["sequenceId"]);
      const project = await activeProject(false), sequence = await resolveSequence(project, args.sequenceId), settings = await sequence.getSettings();
      return { sequence: await sequenceSnapshot(sequence), settings: await settingsSnapshot(settings) };
    }

    async function updateSequenceSettings(args) {
      assertObject(args); assertOnlyKeys(args, ["sequenceId", "updates", "operationId"]);
      const updates = validateSettingsUpdates(args.updates), project = await activeProject(true), sequence = await resolveSequence(project, args.sequenceId), settings = await sequence.getSettings(), before = await settingsSnapshot(settings);
      const setters = {
        maximumBitDepth: ["setMaximumBitDepth", updates.maximumBitDepth], maxRenderQuality: ["setMaxRenderQuality", updates.maxRenderQuality],
        compositeInLinearColor: ["setCompositeInLinearColor", updates.compositeInLinearColor], videoFieldType: ["setVideoFieldType", updates.videoFieldType],
        videoPixelAspectRatio: ["setVideoPixelAspectRatio", updates.videoPixelAspectRatio], editingMode: ["setEditingMode", updates.editingMode],
        previewFileFormat: ["setPreviewFileFormat", updates.previewFileFormat], previewCodec: ["setPreviewCodec", updates.previewCodec]
      };
      for (const key of Object.keys(setters)) {
        const method = setters[key][0], value = setters[key][1];
        if (value !== undefined && (typeof settings[method] !== "function" || await settings[method](value) === false)) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected sequence setting " + key);
      }
      if (updates.videoFrameRate !== undefined) {
        const rate = createFrameRate(updates.videoFrameRate);
        if (typeof settings.setVideoFrameRate !== "function" || settings.setVideoFrameRate(rate) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected videoFrameRate");
      }
      if (updates.audioSampleRate !== undefined) {
        if (typeof settings.setAudioSampleRate !== "function" || await settings.setAudioSampleRate(createFrameRate(updates.audioSampleRate)) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected audioSampleRate");
      }
      if (updates.videoWidth !== undefined || updates.videoHeight !== undefined) {
        if (typeof ppro.RectF !== "function" || typeof settings.setVideoFrameRect !== "function") {
          throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere does not expose video frame rectangle updates");
        }
        const rect = new ppro.RectF(), current = before.videoFrame || {};
        rect.width = updates.videoWidth === undefined ? current.width : updates.videoWidth;
        rect.height = updates.videoHeight === undefined ? current.height : updates.videoHeight;
        if (await settings.setVideoFrameRect(rect) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected video frame dimensions");
      }
      project.lockedAccess(() => {
        commitActions(project, "Update sequence settings", [sequence.createSetSettingsAction(settings)]);
      });
      const after = await settingsSnapshot(await sequence.getSettings()), verified = Object.keys(updates).every((key) => settingMatches(after, key, updates[key]));
      return mutationResult(verified, { updated: true, sequence: await sequenceSnapshot(sequence), before, after, changedFields: Object.keys(updates) }, "sequence_settings_readback", "Update sequence settings");
    }

    async function importProjectMedia(args) {
      assertObject(args); assertOnlyKeys(args, ["mode", "paths", "projectPath", "sequenceIds", "aepPath", "compNames", "targetBinId", "suppressUI", "asNumberedStills", "confirmNonUndoable", "operationId"]);
      requireConfirmation(args.confirmNonUndoable, "Documented import APIs are direct host calls without an Action undo boundary");
      const mode = enumValue(args.mode, "mode", ["files", "sequences", "aeComps", "allAEComps"]), project = await activeProject(false), targetBin = args.targetBinId ? await resolveFolder(project, args.targetBinId, "targetBinId") : undefined;
      const readbackFolder = targetBin || asFolder(await project.getRootItem(), "project root");
      const beforeItems = await binChildren(readbackFolder), beforeSequences = await listSequences(project);
      let accepted = false, requested = 0;
      if (mode === "files") {
        const paths = await boundedPathArray(args.paths, "paths", 100, "file"); requested = paths.length;
        accepted = await project.importFiles(paths, optionalBoolean(args.suppressUI, true, "suppressUI"), targetBin, optionalBoolean(args.asNumberedStills, false, "asNumberedStills"));
      } else if (mode === "sequences") {
        const projectPath = await allowedPath(args.projectPath, "projectPath", "file"), ids = args.sequenceIds == null ? undefined : boundedStringArray(args.sequenceIds, "sequenceIds", 64, 128).map((id) => guidFromString(id, "sequenceId"));
        requested = ids ? ids.length : 0; accepted = await project.importSequences(projectPath, ids);
      } else {
        if (ppro.Utils && typeof ppro.Utils.isAEInstalled === "function" && !await ppro.Utils.isAEInstalled()) throw commandError("UXP_DEPENDENCY_UNAVAILABLE", "After Effects is not installed");
        const aepPath = await allowedPath(args.aepPath, "aepPath", "file");
        if (mode === "aeComps") {
          const names = boundedStringArray(args.compNames, "compNames", 64, 255); requested = names.length; accepted = await project.importAEComps(aepPath, names, targetBin);
        } else { requested = 1; accepted = await project.importAllAEComps(aepPath, targetBin); }
      }
      if (!accepted) throw commandError("UXP_HOST_REJECTED", "Premiere rejected the import request");
      const afterItems = await binChildren(readbackFolder), afterSequences = await listSequences(project);
      const addedItemIds = afterItems.filter((item) => !beforeItems.some((old) => old.id === item.id)).map((item) => item.id);
      const addedSequenceIds = afterSequences.filter((item) => !beforeSequences.some((old) => old.id === item.id)).map((item) => item.id);
      const observedAddedCount = addedItemIds.length + addedSequenceIds.length;
      // The documented import calls return only acceptance and the bounded
      // folder/sequence snapshots cannot prove that every requested identity
      // was imported. Report the commit honestly without treating a partial
      // positive delta as full verification.
      return directMutationResult(false, { imported: true, mode, requested, observedAddedCount, addedItemIds, addedSequenceIds }, "import_host_return_and_bounded_post_state");
    }

    async function parameterContext(args, mutation) {
      const allowed = ["mediaType", "trackIndex", "clipIndex", "componentIndex", "paramIndex", "expectedComponentId", "expectedParamName", "timeSeconds"];
      if (mutation) allowed.push("value", "endSeconds", "interpolation", "operationId");
      assertObject(args); assertOnlyKeys(args, allowed);
      const mediaType = enumValue(args.mediaType, "mediaType", ["video", "audio"]), trackIndex = nonNegativeInt(args.trackIndex, "trackIndex"), clipIndex = nonNegativeInt(args.clipIndex, "clipIndex"), componentIndex = nonNegativeInt(args.componentIndex, "componentIndex"), paramIndex = nonNegativeInt(args.paramIndex, "paramIndex");
      const context = await activeContext(mutation), item = await trackItemAt(context.sequence, mediaType, trackIndex, clipIndex), chain = await item.getComponentChain();
      const count = chain.getComponentCount();
      if (componentIndex >= count) throw commandError("UXP_TARGET_NOT_FOUND", "componentIndex is out of range");
      const component = chain.getComponentAtIndex(componentIndex), componentId = await componentIdentifier(component);
      assertExpected(componentId, args.expectedComponentId, "UXP_STALE_EFFECT_CHAIN", "Component identity");
      if (paramIndex >= component.getParamCount()) throw commandError("UXP_TARGET_NOT_FOUND", "paramIndex is out of range");
      const param = component.getParam(paramIndex), paramName = String(param.displayName || "");
      assertExpected(paramName, args.expectedParamName, "UXP_STALE_PARAMETER", "Parameter name");
      return { ...context, item, component, componentId, param, paramName, mediaType, trackIndex, clipIndex, componentIndex, paramIndex };
    }

    async function componentIdentifier(component) {
      let matchName = "", displayName = "";
      try { matchName = String(await component.getMatchName() || ""); } catch (_) {}
      try { displayName = String(await component.getDisplayName() || ""); } catch (_) {}
      return matchName || displayName;
    }

    async function parameterSnapshot(context, timeSeconds) {
      const supported = typeof context.param.areKeyframesSupported === "function" ? !!await context.param.areKeyframesSupported() : false;
      const varying = typeof context.param.isTimeVarying === "function" ? !!context.param.isTimeVarying() : false;
      const rawTimes = typeof context.param.getKeyframeListAsTickTimes === "function" ? Array.from(context.param.getKeyframeListAsTickTimes() || []) : [];
      const times = rawTimes.slice(0, MAX_KEYFRAMES).map(tickSeconds);
      let value = null;
      if (timeSeconds != null && typeof context.param.getValueAtTime === "function") value = await context.param.getValueAtTime(tick(finiteNumber(timeSeconds, "timeSeconds", 0, 86400), "timeSeconds"));
      else if (typeof context.param.getStartValue === "function") value = keyframeValue(await context.param.getStartValue());
      return {
        mediaType: context.mediaType, trackIndex: context.trackIndex, clipIndex: context.clipIndex,
        componentIndex: context.componentIndex, componentId: context.componentId, paramIndex: context.paramIndex,
        paramName: context.paramName, keyframesSupported: supported, timeVarying: varying,
        keyframeCount: rawTimes.length, keyframeTimesSeconds: times, keyframesLimited: rawTimes.length > MAX_KEYFRAMES, value
      };
    }

    function completeKeyframeTimes(param) {
      if (!param || typeof param.getKeyframeListAsTickTimes !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere cannot enumerate keyframes for safe removal verification");
      }
      const rawTimes = Array.from(param.getKeyframeListAsTickTimes() || []);
      if (rawTimes.length > MAX_KEYFRAMES) {
        throw commandError("UXP_PROJECT_TOO_LARGE", "Keyframe removal verification exceeds " + MAX_KEYFRAMES + " entries");
      }
      return rawTimes.map(tickSeconds);
    }

    async function inspectParameter(args) {
      const context = await parameterContext(args, false);
      return parameterSnapshot(context, args.timeSeconds);
    }

    async function setParameterValue(args) {
      const context = await parameterContext(args, true), value = scalarValue(args.value), before = await parameterSnapshot(context, args.timeSeconds);
      if (before.timeVarying) throw commandError("UXP_TARGET_UNSUPPORTED", "Use add_keyframe to change a time-varying parameter");
      context.project.lockedAccess(() => {
        const keyframe = context.param.createKeyframe(value);
        commitActions(context.project, "Set effect parameter", [context.param.createSetValueAction(keyframe, true)]);
      });
      const after = await parameterSnapshot(context, args.timeSeconds), verified = valuesEqual(after.value, value);
      return mutationResult(verified, { updated: true, before, after }, "parameter_value_readback", "Set effect parameter");
    }

    async function addParameterKeyframe(args) {
      const context = await parameterContext(args, true), value = scalarValue(args.value), timeSeconds = finiteNumber(args.timeSeconds, "timeSeconds", 0, 86400), time = tick(timeSeconds, "timeSeconds"), before = await parameterSnapshot(context);
      if (!before.keyframesSupported) throw commandError("UXP_TARGET_UNSUPPORTED", "This parameter does not support keyframes");
      context.project.lockedAccess(() => {
        const actions = [], keyframe = context.param.createKeyframe(value);
        keyframe.position = time;
        if (!before.timeVarying) actions.push(context.param.createSetTimeVaryingAction(true));
        actions.push(context.param.createAddKeyframeAction(keyframe));
        commitActions(context.project, "Add effect keyframe", actions);
      });
      const after = await parameterSnapshot(context, timeSeconds), verified = after.keyframeTimesSeconds.some((seconds) => numbersEqual(seconds, timeSeconds)) && valuesEqual(after.value, value);
      return mutationResult(verified, { added: true, before, after }, "parameter_keyframe_readback", "Add effect keyframe");
    }

    async function removeParameterKeyframe(args) {
      const context = await parameterContext(args, true), timeSeconds = finiteNumber(args.timeSeconds, "timeSeconds", 0, 86400);
      const beforeTimes = completeKeyframeTimes(context.param);
      const existed = beforeTimes.some((seconds) => numbersEqual(seconds, timeSeconds));
      if (!existed) return verifiedNoopResult({ removed: false, unchanged: true, timeSeconds, after: await parameterSnapshot(context) }, "parameter_keyframe_absence_preflight");
      context.project.lockedAccess(() => {
        commitActions(context.project, "Remove effect keyframe", [context.param.createRemoveKeyframeAction(tick(timeSeconds, "timeSeconds"), true)]);
      });
      const afterTimes = completeKeyframeTimes(context.param), after = await parameterSnapshot(context), verified = !afterTimes.some((seconds) => numbersEqual(seconds, timeSeconds));
      return mutationResult(verified, { removed: verified, removalRequested: true, timeSeconds, after }, "complete_parameter_keyframe_absence_readback", "Remove effect keyframe");
    }

    async function removeParameterKeyframeRange(args) {
      const context = await parameterContext(args, true), start = finiteNumber(args.timeSeconds, "timeSeconds", 0, 86400), end = finiteNumber(args.endSeconds, "endSeconds", 0, 86400);
      if (end < start) throw commandError("UXP_INVALID_ARGUMENT", "endSeconds must be greater than or equal to timeSeconds");
      const beforeTimes = completeKeyframeTimes(context.param);
      const existed = beforeTimes.some((seconds) => seconds != null && seconds >= start && seconds <= end);
      if (!existed) return verifiedNoopResult({ removed: false, unchanged: true, startSeconds: start, endSeconds: end, after: await parameterSnapshot(context) }, "parameter_keyframe_range_absence_preflight");
      context.project.lockedAccess(() => {
        commitActions(context.project, "Remove effect keyframe range", [context.param.createRemoveKeyframeRangeAction(tick(start), tick(end), true)]);
      });
      const afterTimes = completeKeyframeTimes(context.param), after = await parameterSnapshot(context), verified = !afterTimes.some((seconds) => seconds != null && seconds >= start && seconds <= end);
      return mutationResult(verified, { removed: verified, removalRequested: true, startSeconds: start, endSeconds: end, after }, "complete_parameter_keyframe_range_readback", "Remove effect keyframe range");
    }

    async function setParameterInterpolation(args) {
      const context = await parameterContext(args, true), timeSeconds = finiteNumber(args.timeSeconds, "timeSeconds", 0, 86400), modeName = enumValue(args.interpolation, "interpolation", ["linear", "hold", "bezier", "time"]), constants = ppro.Constants && ppro.Constants.InterpolationMode || {};
      const mode = constants[modeName.toUpperCase()];
      if (mode == null) throw commandError("UXP_COMMAND_UNAVAILABLE", "Interpolation constants are unavailable");
      context.project.lockedAccess(() => {
        commitActions(context.project, "Set keyframe interpolation", [context.param.createSetInterpolationAtKeyframeAction(tick(timeSeconds, "timeSeconds"), mode, true)]);
      });
      let verified = false, readback = null;
      try { const keyframe = context.param.getKeyframePtr(tick(timeSeconds)); readback = await keyframe.getTemporalInterpolationMode(); verified = readback === mode; } catch (_) {}
      return mutationResult(verified, { updated: true, interpolation: modeName, interpolationValue: readback }, "keyframe_interpolation_readback", "Set keyframe interpolation");
    }

    async function trackItemContext(args, mutation) {
      const allowed = ["mediaType", "trackIndex", "clipIndex", "expectedStartSeconds", "expectedEndSeconds"];
      if (mutation) allowed.push("moveBySeconds", "startSeconds", "endSeconds", "inSeconds", "outSeconds", "disabled", "name", "operationId");
      assertObject(args); assertOnlyKeys(args, allowed);
      const mediaType = enumValue(args.mediaType, "mediaType", ["video", "audio"]), trackIndex = nonNegativeInt(args.trackIndex, "trackIndex"), clipIndex = nonNegativeInt(args.clipIndex, "clipIndex"), context = await activeContext(mutation), item = await trackItemAt(context.sequence, mediaType, trackIndex, clipIndex);
      return { ...context, item, mediaType, trackIndex, clipIndex };
    }

    async function trackItemSnapshot(context) {
      return {
        mediaType: context.mediaType, trackIndex: context.trackIndex, clipIndex: context.clipIndex,
        name: await maybeCall(context.item, "getName"), startSeconds: tickSeconds(await context.item.getStartTime()), endSeconds: tickSeconds(await context.item.getEndTime()),
        inSeconds: tickSeconds(await context.item.getInPoint()), outSeconds: tickSeconds(await context.item.getOutPoint()), durationSeconds: tickSeconds(await context.item.getDuration()),
        speed: await maybeCall(context.item, "getSpeed"), reversed: await maybeCall(context.item, "isSpeedReversed"), adjustmentLayer: await maybeCall(context.item, "isAdjustmentLayer"), disabled: await maybeCall(context.item, "isDisabled")
      };
    }

    async function inspectTrackItem(args) {
      const context = await trackItemContext(args, false);
      return trackItemSnapshot(context);
    }

    async function updateTrackItem(args) {
      const context = await trackItemContext(args, true), before = await trackItemSnapshot(context);
      assertExpectedNumber(before.startSeconds, args.expectedStartSeconds, "UXP_STALE_TRACK_ITEM", "Track item start");
      assertExpectedNumber(before.endSeconds, args.expectedEndSeconds, "UXP_STALE_TRACK_ITEM", "Track item end");
      if (args.moveBySeconds != null && (args.startSeconds != null || args.endSeconds != null)) throw commandError("UXP_INVALID_ARGUMENT", "moveBySeconds cannot be combined with startSeconds or endSeconds");
      const requested = [args.moveBySeconds, args.startSeconds, args.endSeconds, args.inSeconds, args.outSeconds, args.disabled, args.name].filter((value) => value != null);
      if (!requested.length) throw commandError("UXP_INVALID_ARGUMENT", "Provide at least one track-item field to update");
      context.project.lockedAccess(() => {
        const actions = [];
        if (args.moveBySeconds != null) actions.push(context.item.createMoveAction(tick(args.moveBySeconds, "moveBySeconds")));
        if (args.startSeconds != null) actions.push(context.item.createSetStartAction(tick(finiteNumber(args.startSeconds, "startSeconds", 0, 86400), "startSeconds")));
        if (args.endSeconds != null) actions.push(context.item.createSetEndAction(tick(finiteNumber(args.endSeconds, "endSeconds", 0, 86400), "endSeconds")));
        if (args.inSeconds != null) actions.push(context.item.createSetInPointAction(tick(finiteNumber(args.inSeconds, "inSeconds", 0, 86400), "inSeconds")));
        if (args.outSeconds != null) actions.push(context.item.createSetOutPointAction(tick(finiteNumber(args.outSeconds, "outSeconds", 0, 86400), "outSeconds")));
        if (args.disabled != null) actions.push(context.item.createSetDisabledAction(requiredBoolean(args.disabled, "disabled")));
        if (args.name != null) actions.push(context.item.createSetNameAction(boundedString(args.name, "name", 255)));
        commitActions(context.project, "Update timeline item", actions);
      });
      const after = await trackItemSnapshot(context), verified = trackItemUpdateMatches(before, after, args);
      return mutationResult(verified, { updated: true, before, after, changedFields: requested.length }, "track_item_readback", "Update timeline item");
    }

    async function makeSplitEdit(args) {
      assertObject(args); assertOnlyKeys(args, ["kind", "audioTrackIndex", "audioClipIndex", "videoTrackIndex", "videoClipIndex", "extensionSeconds", "operationId"]);
      const kind = enumValue(args.kind, "kind", ["j_cut", "l_cut"]), extension = finiteNumber(args.extensionSeconds, "extensionSeconds", 0.001, 60);
      const context = await activeContext(true);
      const audioContext = { ...context, item: await trackItemAt(context.sequence, "audio", nonNegativeInt(args.audioTrackIndex, "audioTrackIndex"), nonNegativeInt(args.audioClipIndex, "audioClipIndex")), mediaType: "audio", trackIndex: args.audioTrackIndex, clipIndex: args.audioClipIndex };
      const videoContext = { ...context, item: await trackItemAt(context.sequence, "video", nonNegativeInt(args.videoTrackIndex, "videoTrackIndex"), nonNegativeInt(args.videoClipIndex, "videoClipIndex")), mediaType: "video", trackIndex: args.videoTrackIndex, clipIndex: args.videoClipIndex };
      const before = { audio: await trackItemSnapshot(audioContext), video: await trackItemSnapshot(videoContext) };
      if (!numbersEqual(before.audio.speed, 1) || before.audio.reversed) throw commandError("UXP_TARGET_UNSUPPORTED", "Split edits require forward 1x audio so source sync can be preserved");
      const edge = kind === "j_cut" ? "startSeconds" : "endSeconds";
      if (!numbersEqual(before.audio[edge], before.video[edge])) throw commandError("UXP_STALE_TRACK_ITEM", "Audio and video " + (kind === "j_cut" ? "start" : "end") + " edges are not aligned");
      const timelineValue = Number(before.audio[edge]) + (kind === "j_cut" ? -extension : extension);
      const sourceField = kind === "j_cut" ? "inSeconds" : "outSeconds", sourceValue = Number(before.audio[sourceField]) + (kind === "j_cut" ? -extension : extension);
      if (timelineValue < 0 || sourceValue < 0) throw commandError("UXP_TARGET_UNSUPPORTED", "The requested J-cut exceeds the available leading timeline or source handle");
      context.project.lockedAccess(() => {
        const actions = kind === "j_cut"
          ? [audioContext.item.createSetStartAction(tick(timelineValue)), audioContext.item.createSetInPointAction(tick(sourceValue))]
          : [audioContext.item.createSetEndAction(tick(timelineValue)), audioContext.item.createSetOutPointAction(tick(sourceValue))];
        commitActions(context.project, kind === "j_cut" ? "Create J-cut" : "Create L-cut", actions);
      });
      const after = await trackItemSnapshot(audioContext), verified = numbersEqual(after[edge], timelineValue) && numbersEqual(after[sourceField], sourceValue);
      return mutationResult(verified, { splitEdit: kind, extensionSeconds: extension, before, after }, "split_edit_audio_edge_and_source_readback", kind === "j_cut" ? "Create J-cut" : "Create L-cut");
    }

    async function editorContext(requireTransactions) {
      const context = await activeContext(requireTransactions), editor = ppro.SequenceEditor.getEditor(context.sequence);
      if (!editor) throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere did not return a SequenceEditor");
      return { ...context, editor };
    }

    async function insertTimelineItem(args) {
      assertObject(args); assertOnlyKeys(args, ["projectItemId", "timeSeconds", "videoTrackIndex", "audioTrackIndex", "limitShift", "operationId"]);
      const context = await editorContext(true), item = await resolveProjectItem(context.project, args.projectItemId, true), time = tick(finiteNumber(args.timeSeconds, "timeSeconds", 0, 86400), "timeSeconds"), video = nonNegativeInt(args.videoTrackIndex, "videoTrackIndex"), audio = nonNegativeInt(args.audioTrackIndex, "audioTrackIndex"), limitShift = optionalBoolean(args.limitShift, false, "limitShift");
      context.project.lockedAccess(() => {
        commitActions(context.project, "Insert timeline item", [context.editor.createInsertProjectItemAction(item, time, video, audio, limitShift)]);
      });
      return mutationResult(false, { inserted: true, projectItemId: await projectItemId(item), timeSeconds: args.timeSeconds, videoTrackIndex: video, audioTrackIndex: audio }, "sequence_editor_transaction", "Insert timeline item");
    }

    async function overwriteTimelineItem(args) {
      assertObject(args); assertOnlyKeys(args, ["projectItemId", "timeSeconds", "videoTrackIndex", "audioTrackIndex", "operationId"]);
      const context = await editorContext(true), item = await resolveProjectItem(context.project, args.projectItemId, true), time = tick(finiteNumber(args.timeSeconds, "timeSeconds", 0, 86400), "timeSeconds"), video = nonNegativeInt(args.videoTrackIndex, "videoTrackIndex"), audio = nonNegativeInt(args.audioTrackIndex, "audioTrackIndex");
      context.project.lockedAccess(() => {
        commitActions(context.project, "Overwrite timeline item", [context.editor.createOverwriteItemAction(item, time, video, audio)]);
      });
      return mutationResult(false, { overwritten: true, projectItemId: await projectItemId(item), timeSeconds: args.timeSeconds, videoTrackIndex: video, audioTrackIndex: audio }, "sequence_editor_transaction", "Overwrite timeline item");
    }

    async function cloneTimelineSelection(args) {
      assertObject(args); assertOnlyKeys(args, ["timeOffsetSeconds", "videoTrackOffset", "audioTrackOffset", "alignToVideo", "insert", "operationId"]);
      const context = await editorContext(true), selected = await selectedTrackItems(context.sequence), offset = tick(args.timeOffsetSeconds, "timeOffsetSeconds"), videoOffset = boundedInt(args.videoTrackOffset == null ? 0 : args.videoTrackOffset, "videoTrackOffset", -128, 128), audioOffset = boundedInt(args.audioTrackOffset == null ? 0 : args.audioTrackOffset, "audioTrackOffset", -128, 128), align = optionalBoolean(args.alignToVideo, true, "alignToVideo"), insert = optionalBoolean(args.insert, false, "insert");
      context.project.lockedAccess(() => {
        const actions = selected.items.map((item) => context.editor.createCloneTrackItemAction(item, offset, videoOffset, audioOffset, align, insert));
        commitActions(context.project, "Clone selected timeline items", actions);
      });
      return mutationResult(false, { cloned: selected.items.length, timeOffsetSeconds: args.timeOffsetSeconds, videoTrackOffset: videoOffset, audioTrackOffset: audioOffset }, "sequence_editor_transaction", "Clone selected timeline items");
    }

    async function removeTimelineSelection(args) {
      assertObject(args); assertOnlyKeys(args, ["ripple", "mediaType", "shiftOverlapping", "operationId"]);
      const context = await editorContext(true), selected = await selectedTrackItems(context.sequence), mediaType = enumValue(args.mediaType == null ? "any" : args.mediaType, "mediaType", ["any", "video", "audio"]), constants = ppro.Constants && ppro.Constants.MediaType || {}, value = constants[mediaType.toUpperCase()];
      if (value == null) throw commandError("UXP_COMMAND_UNAVAILABLE", "MediaType constants are unavailable");
      context.project.lockedAccess(() => {
        commitActions(context.project, "Remove selected timeline items", [context.editor.createRemoveItemsAction(selected.selection, optionalBoolean(args.ripple, false, "ripple"), value, optionalBoolean(args.shiftOverlapping, false, "shiftOverlapping"))]);
      });
      return mutationResult(false, { removed: selected.items.length, mediaType }, "sequence_editor_transaction", "Remove selected timeline items");
    }

    async function insertMogrtPath(args) {
      assertObject(args); assertOnlyKeys(args, ["filePath", "timeSeconds", "videoTrackIndex", "audioTrackIndex", "confirmNonUndoable", "operationId"]);
      requireConfirmation(args.confirmNonUndoable, "MOGRT insertion is a direct SequenceEditor call without an Action boundary");
      const context = await editorContext(false), path = await allowedPath(args.filePath, "filePath", "file"), values = Array.from(await context.editor.insertMogrtFromPath(path, tick(finiteNumber(args.timeSeconds, "timeSeconds", 0, 86400), "timeSeconds"), nonNegativeInt(args.videoTrackIndex, "videoTrackIndex"), nonNegativeInt(args.audioTrackIndex, "audioTrackIndex")) || []);
      return directMutationResult(false, { inserted: values.length, source: "path" }, "sequence_editor_host_return");
    }

    async function insertMogrtLibrary(args) {
      assertObject(args); assertOnlyKeys(args, ["libraryName", "elementName", "timeSeconds", "videoTrackIndex", "audioTrackIndex", "confirmNonUndoable", "operationId"]);
      requireConfirmation(args.confirmNonUndoable, "MOGRT insertion is a direct SequenceEditor call without an Action boundary");
      const context = await editorContext(false), values = Array.from(await context.editor.insertMogrtFromLibrary(boundedString(args.libraryName, "libraryName", 255), boundedString(args.elementName, "elementName", 255), tick(finiteNumber(args.timeSeconds, "timeSeconds", 0, 86400), "timeSeconds"), nonNegativeInt(args.videoTrackIndex, "videoTrackIndex"), nonNegativeInt(args.audioTrackIndex, "audioTrackIndex")) || []);
      return directMutationResult(false, { inserted: values.length, source: "library" }, "sequence_editor_host_return");
    }

    async function inspectSequences(args) {
      assertObject(args); assertOnlyKeys(args, []);
      const project = await activeProject(false), active = await project.getActiveSequence(), sequences = await listSequences(project);
      return { activeSequenceId: guidString(active && active.guid), count: sequences.length, sequences };
    }

    async function createSequenceFromMedia(args) {
      assertObject(args); assertOnlyKeys(args, ["name", "projectItemIds", "targetBinId", "confirmNonUndoable", "operationId"]);
      requireConfirmation(args.confirmNonUndoable, "Creating a sequence from media is a direct Project call without an Action boundary");
      const project = await activeProject(false), ids = boundedStringArray(args.projectItemIds, "projectItemIds", 64, 512), clips = [];
      for (const id of ids) clips.push(asClip(await findProjectItem(project, id), "projectItemId"));
      const target = args.targetBinId ? await resolveFolder(project, args.targetBinId, "targetBinId") : undefined, sequence = await project.createSequenceFromMedia(boundedString(args.name, "name", 255), clips, target);
      if (!sequence) throw commandError("UXP_HOST_REJECTED", "Premiere did not create a sequence");
      return directMutationResult(false, { created: true, sequence: await sequenceSnapshot(sequence) }, "create_sequence_host_return");
    }

    async function cloneSequence(args) {
      assertObject(args); assertOnlyKeys(args, ["sequenceId", "operationId"]);
      const project = await activeProject(true), sequence = await resolveSequence(project, args.sequenceId);
      return withAppendLock(appendLockKey(project, "sequences", "all"), async () => {
        const before = await listSequences(project);
        assertAppendCapacity(before, MAX_SEQUENCES, "Sequence cloning");
        project.lockedAccess(() => {
          commitActions(project, "Clone sequence", [sequence.createCloneAction()]);
        });
        const after = await listSequences(project), added = after.filter((value) => !before.some((old) => old.id === value.id));
        return mutationResult(added.length === 1, { cloned: true, source: await sequenceSnapshot(sequence), sequence: added[0] || null }, "sequence_identity_readback", "Clone sequence");
      });
    }

    async function createSubsequence(args) {
      assertObject(args); assertOnlyKeys(args, ["sequenceId", "ignoreTrackTargeting", "confirmNonUndoable", "operationId"]);
      requireConfirmation(args.confirmNonUndoable, "Creating a subsequence is a direct Sequence call without an Action boundary");
      const project = await activeProject(false), sequence = await resolveSequence(project, args.sequenceId), created = await sequence.createSubsequence(optionalBoolean(args.ignoreTrackTargeting, false, "ignoreTrackTargeting"));
      if (!created) throw commandError("UXP_HOST_REJECTED", "Premiere did not create a subsequence");
      return directMutationResult(false, { created: true, sequence: await sequenceSnapshot(created) }, "create_subsequence_host_return");
    }

    async function activateSequence(args) { return sequenceDirectAction(args, "activate", "setActiveSequence"); }
    async function openSequence(args) { return sequenceDirectAction(args, "open", "openSequence"); }
    async function closeSequence(args) { return sequenceDirectAction(args, "close", "closeSequence"); }

    async function sequenceDirectAction(args, action, method) {
      assertObject(args); assertOnlyKeys(args, ["sequenceId", "operationId"]);
      const project = await activeProject(false), sequence = await resolveSequence(project, args.sequenceId), accepted = await project[method](sequence);
      if (!accepted) throw commandError("UXP_HOST_REJECTED", "Premiere rejected sequence " + action);
      const resultField = { activate: "activated", open: "opened", close: "closed" }[action];
      return { [resultField]: true, outcome: "committed_unverified", verified: false, sequence: await sequenceSnapshot(sequence), verificationBoundary: "host_return",
        operation: operationSemantics({ mutatesProject: false, verificationStatus: "not_verified", verificationBoundary: "host_return", verificationEvidence: [{ type: "host_return", accepted: true }] }) };
    }

    async function deleteSequence(args) {
      assertObject(args); assertOnlyKeys(args, ["sequenceId", "expectedName", "confirmNonUndoable", "operationId"]);
      requireConfirmation(args.confirmNonUndoable, "Deleting a sequence is not exposed as an undoable Action");
      const project = await activeProject(false);
      await listSequences(project);
      const sequence = await resolveSequence(project, args.sequenceId), snapshot = await sequenceSnapshot(sequence);
      assertExpected(snapshot.name, args.expectedName, "UXP_STALE_SEQUENCE", "Sequence name");
      if (!await project.deleteSequence(sequence)) throw commandError("UXP_HOST_REJECTED", "Premiere rejected sequence deletion");
      const remaining = await listSequences(project), verified = !remaining.some((value) => value.id === snapshot.id);
      return directMutationResult(verified, { deleted: true, sequence: snapshot }, "sequence_absence_readback");
    }

    function encoderManager() {
      const manager = ppro.EncoderManager.getManager();
      if (!manager) throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere did not return EncoderManager");
      if (manager.isAMEInstalled === false) throw commandError("UXP_DEPENDENCY_UNAVAILABLE", "Adobe Media Encoder is not installed");
      return manager;
    }

    async function encoderPreflight(args) {
      assertObject(args); assertOnlyKeys(args, ["sequenceId", "presetFile"]);
      const manager = encoderManager();
      let extension = null;
      if (args.presetFile != null) {
        const project = await activeProject(false);
        const sequence = await resolveSequence(project, args.sequenceId), preset = await allowedPath(args.presetFile, "presetFile", "file");
        extension = await ppro.EncoderManager.getExportFileExtension(sequence, preset);
      }
      return { ameInstalled: manager.isAMEInstalled !== false, extension, sequenceId: args.sequenceId || null };
    }

    function exportType(value) {
      const name = enumValue(value, "exportType", ["queueToAme", "queueToApp", "immediately"]), constants = ppro.Constants && ppro.Constants.ExportType || {};
      const map = { queueToAme: "QUEUE_TO_AME", queueToApp: "QUEUE_TO_APP", immediately: "IMMEDIATELY" }, resolved = constants[map[name]];
      if (resolved != null) return resolved;
      const fallback = { queueToAme: ppro.EncoderManager.EXPORT_QUEUE_TO_AME, queueToApp: ppro.EncoderManager.EXPORT_QUEUE_TO_APP, immediately: ppro.EncoderManager.EXPORT_IMMEDIATELY }[name];
      if (fallback == null) throw commandError("UXP_COMMAND_UNAVAILABLE", "Encoder export type constants are unavailable");
      return fallback;
    }

    async function encodeSequence(args) {
      assertObject(args); assertOnlyKeys(args, ["sequenceId", "exportType", "outputFile", "presetFile", "exportFull", "confirmExternalWrite", "operationId"]);
      requireExternalWrite(args.confirmExternalWrite);
      const project = await activeProject(false), sequence = await resolveSequence(project, args.sequenceId), manager = encoderManager(), output = await allowedPath(args.outputFile, "outputFile", "file"), preset = await allowedPath(args.presetFile, "presetFile", "file");
      const job = beginEncoderJob("sequence", args.operationId);
      const accepted = await runTrackedEncode(job, function () {
        return manager.exportSequence(sequence, exportType(args.exportType), output, preset, optionalBoolean(args.exportFull, true, "exportFull"));
      }, "Premiere rejected sequence export");
      return externalWriteResult({ queued: true, kind: "sequence", sequence: await sequenceSnapshot(sequence), outputFile: output, encodeJob: accepted });
    }

    async function encodeProjectItem(args) {
      assertObject(args); assertOnlyKeys(args, ["projectItemId", "outputFile", "presetFile", "workArea", "removeUponCompletion", "startQueueImmediately", "confirmExternalWrite", "operationId"]);
      requireExternalWrite(args.confirmExternalWrite);
      const project = await activeProject(false), clip = asClip(await resolveProjectItem(project, args.projectItemId, true), "projectItemId"), manager = encoderManager(), output = await allowedPath(args.outputFile, "outputFile", "file"), preset = await allowedPath(args.presetFile, "presetFile", "file");
      const job = beginEncoderJob("projectItem", args.operationId);
      const accepted = await runTrackedEncode(job, function () {
        return manager.encodeProjectItem(clip, output, preset, boundedInt(args.workArea == null ? 0 : args.workArea, "workArea", 0, 16), optionalBoolean(args.removeUponCompletion, false, "removeUponCompletion"), optionalBoolean(args.startQueueImmediately, true, "startQueueImmediately"));
      }, "Premiere rejected project-item encode");
      return externalWriteResult({ queued: true, kind: "projectItem", projectItemId: await projectItemId(clip), outputFile: output, encodeJob: accepted });
    }

    async function encodeFile(args) {
      assertObject(args); assertOnlyKeys(args, ["filePath", "outputFile", "presetFile", "inSeconds", "outSeconds", "workArea", "removeUponCompletion", "startQueueImmediately", "confirmExternalWrite", "operationId"]);
      requireExternalWrite(args.confirmExternalWrite);
      const manager = encoderManager(), input = await allowedPath(args.filePath, "filePath", "file"), output = await allowedPath(args.outputFile, "outputFile", "file"), preset = await allowedPath(args.presetFile, "presetFile", "file"), start = finiteNumber(args.inSeconds, "inSeconds", 0, 86400), end = finiteNumber(args.outSeconds, "outSeconds", 0, 86400);
      if (end <= start) throw commandError("UXP_INVALID_ARGUMENT", "outSeconds must be greater than inSeconds");
      const job = beginEncoderJob("file", args.operationId);
      const accepted = await runTrackedEncode(job, function () {
        return manager.encodeFile(input, output, preset, tick(start), tick(end), boundedInt(args.workArea == null ? 0 : args.workArea, "workArea", 0, 16), optionalBoolean(args.removeUponCompletion, false, "removeUponCompletion"), optionalBoolean(args.startQueueImmediately, true, "startQueueImmediately"));
      }, "Premiere rejected file encode");
      return externalWriteResult({ queued: true, kind: "file", outputFile: output, encodeJob: accepted });
    }

    function inspectEncoderJobs(args) {
      assertObject(args); assertOnlyKeys(args, ["jobId", "limit"]);
      return events.listEncodeJobs({
        jobId: args.jobId == null ? undefined : boundedString(args.jobId, "jobId", 128),
        limit: args.limit == null ? undefined : boundedInt(args.limit, "limit", 1, 64)
      });
    }

    function waitForEncoderJob(args) {
      assertObject(args); assertOnlyKeys(args, ["jobId", "timeoutMs"]);
      return events.waitForEncodeJob({
        jobId: boundedString(args.jobId, "jobId", 128),
        timeoutMs: args.timeoutMs == null ? 0 : boundedInt(args.timeoutMs, "timeoutMs", 0, 60000)
      });
    }

    function beginEncoderJob(kind, operationId) {
      if (!canTrackEncoderJobs()) return null;
      return events.beginEncodeJob({ kind, operationId: operationId || undefined });
    }

    async function runTrackedEncode(job, callback, rejectionMessage) {
      let accepted;
      try {
        accepted = await callback();
      } catch (error) {
        if (job) events.markEncodeRejected(job.jobId, "host_error");
        throw error;
      }
      if (!accepted) {
        if (job) events.markEncodeRejected(job.jobId, "host_rejected");
        throw commandError("UXP_HOST_REJECTED", rejectionMessage);
      }
      return job ? events.markEncodeAccepted(job.jobId) : null;
    }

    function operationSemantics(options) { return Protocol && typeof Protocol.operationSemantics === "function" ? Protocol.operationSemantics(options) : undefined; }

    function mutationResult(verified, values, boundary, undoLabel) {
      return { ...values, outcome: verified ? "verified" : "committed_unverified", verified, verificationBoundary: boundary,
        operation: operationSemantics({ mutatesProject: true, verificationStatus: verified ? "verified" : "not_verified", verificationBoundary: boundary, verificationEvidence: [{ type: boundary, verified }], undoSupported: true, undoLabel, transactionActionGroup: true, cancellationSupported: true }) };
    }

    function verifiedNoopResult(values, boundary) {
      return { ...values, outcome: "verified", verified: true, verificationBoundary: boundary,
        operation: operationSemantics({ mutatesProject: false, verificationStatus: "verified", verificationBoundary: boundary, verificationEvidence: [{ type: boundary, verified: true }], cancellationSupported: true }) };
    }

    function directMutationResult(verified, values, boundary) {
      return { ...values, outcome: verified ? "verified" : "committed_unverified", verified, verificationBoundary: boundary,
        operation: operationSemantics({ mutatesProject: true, verificationStatus: verified ? "verified" : "not_verified", verificationBoundary: boundary, verificationEvidence: [{ type: boundary, verified }], undoSupported: false, cancellationSupported: true }) };
    }

    function externalWriteResult(values) {
      return { ...values, outcome: "committed_unverified", verified: false, verificationBoundary: "encoder_host_return",
        operation: operationSemantics({ mutatesProject: false, externalSideEffect: true, verificationStatus: "not_verified", verificationBoundary: "encoder_host_return", verificationEvidence: [{ type: "host_return", accepted: true }], undoSupported: false, cancellationSupported: true }) };
    }

    async function allowedPath(value, label, kind) {
      const path = boundedString(value, label, 4096);
      return workspace && typeof workspace.assertPathAllowed === "function" ? await workspace.assertPathAllowed(path, { label, kind }) : path;
    }

    async function boundedPathArray(value, name, maximum, kind) {
      if (!Array.isArray(value) || !value.length || value.length > maximum) throw commandError("UXP_INVALID_ARGUMENT", name + " must contain 1-" + maximum + " paths");
      return Promise.all(value.map((path, index) => allowedPath(path, name + "[" + index + "]", kind)));
    }

    function boundedMarkers(collection) {
      const values = Array.from(collection.getMarkers() || []);
      if (values.length > MAX_MARKERS) throw commandError("UXP_PROJECT_TOO_LARGE", "Marker lookup exceeds " + MAX_MARKERS + " entries");
      return values;
    }

    function assertAppendCapacity(values, maximum, operation) {
      if (values.length >= maximum) {
        throw commandError("UXP_PROJECT_TOO_LARGE", operation + " requires readback capacity below " + maximum + " entries");
      }
    }

    function appendLockKey(project, collectionType, targetId) {
      return guidString(project && project.guid) + ":" + collectionType + ":" + targetId;
    }

    async function withAppendLock(key, callback) {
      const previous = appendLocks.get(key) || Promise.resolve();
      let release = function () {};
      const current = new Promise((resolve) => { release = resolve; });
      appendLocks.set(key, current);
      await previous;
      try {
        return await callback();
      } finally {
        release();
        if (appendLocks.get(key) === current) appendLocks.delete(key);
      }
    }

    function validateSettingsUpdates(value) {
      assertObject(value);
      const allowed = ["maximumBitDepth", "maxRenderQuality", "compositeInLinearColor", "audioSampleRate", "videoFrameRate", "videoFieldType", "videoPixelAspectRatio", "editingMode", "previewFileFormat", "previewCodec", "videoWidth", "videoHeight"];
      assertOnlyKeys(value, allowed);
      if (!Object.keys(value).length) throw commandError("UXP_INVALID_ARGUMENT", "updates must contain at least one sequence setting");
      const result = {};
      for (const key of ["maximumBitDepth", "maxRenderQuality", "compositeInLinearColor"]) if (value[key] !== undefined) result[key] = requiredBoolean(value[key], key);
      if (value.audioSampleRate !== undefined) result.audioSampleRate = finiteNumber(value.audioSampleRate, "audioSampleRate", 1, 384000);
      if (value.videoFrameRate !== undefined) result.videoFrameRate = finiteNumber(value.videoFrameRate, "videoFrameRate", 1, 240);
      if (value.videoFieldType !== undefined) result.videoFieldType = boundedInt(value.videoFieldType, "videoFieldType", 0, 2);
      if (value.videoPixelAspectRatio !== undefined) result.videoPixelAspectRatio = boundedString(value.videoPixelAspectRatio, "videoPixelAspectRatio", 64);
      for (const key of ["editingMode", "previewFileFormat", "previewCodec"]) if (value[key] !== undefined) result[key] = boundedString(value[key], key, 255);
      for (const key of ["videoWidth", "videoHeight"]) if (value[key] !== undefined) result[key] = boundedInt(value[key], key, 16, 32768);
      return result;
    }

    function createFrameRate(value) {
      if (!ppro.FrameRate || typeof ppro.FrameRate.createWithValue !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "FrameRate factory is unavailable");
      return ppro.FrameRate.createWithValue(value);
    }

    function rateValue(value) { const result = value && Number(value.value); return Number.isFinite(result) ? result : null; }
    function rectValue(value) { return value ? { width: Number(value.width), height: Number(value.height) } : null; }
    async function maybeCall(target, method) { try { return typeof target[method] === "function" ? await target[method]() : null; } catch (_) { return null; } }
    function settingMatches(after, key, value) { if (key === "videoWidth") return after.videoFrame && numbersEqual(after.videoFrame.width, value); if (key === "videoHeight") return after.videoFrame && numbersEqual(after.videoFrame.height, value); return valuesEqual(after[key], value); }
    function keyframeValue(value) { return value && value.value && Object.prototype.hasOwnProperty.call(value.value, "value") ? value.value.value : value && value.value !== undefined ? value.value : null; }
    function scalarValue(value) { if (typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean") throw commandError("UXP_INVALID_ARGUMENT", "value must be a number, string, or boolean"); if (typeof value === "number" && !Number.isFinite(value)) throw commandError("UXP_INVALID_ARGUMENT", "value must be finite"); if (typeof value === "string" && value.length > 4000) throw commandError("UXP_INVALID_ARGUMENT", "value string exceeds 4000 characters"); return value; }

    function trackItemUpdateMatches(before, after, args) {
      if (args.startSeconds != null && !numbersEqual(after.startSeconds, args.startSeconds)) return false;
      if (args.endSeconds != null && !numbersEqual(after.endSeconds, args.endSeconds)) return false;
      if (args.inSeconds != null && !numbersEqual(after.inSeconds, args.inSeconds)) return false;
      if (args.outSeconds != null && !numbersEqual(after.outSeconds, args.outSeconds)) return false;
      if (args.disabled != null && after.disabled !== args.disabled) return false;
      if (args.name != null && after.name !== args.name) return false;
      if (args.moveBySeconds != null && (!numbersEqual(after.startSeconds, Number(before.startSeconds) + args.moveBySeconds) || !numbersEqual(after.endSeconds, Number(before.endSeconds) + args.moveBySeconds))) return false;
      return true;
    }

    function canInspectProject() { return !!(ppro.Project && typeof ppro.Project.getActiveProject === "function"); }
    function canUseProjectViews() { return canInspectProject() && !!(ppro.ProjectUtils && typeof ppro.ProjectUtils.getSelection === "function" && typeof ppro.ProjectUtils.getProjectViewIds === "function"); }
    function canUseMarkers() { return canInspectProject() && !!(ppro.Markers && typeof ppro.Markers.getMarkers === "function"); }
    function canUseBins() { return canInspectProject() && !!(ppro.FolderItem && typeof ppro.FolderItem.cast === "function"); }
    function canUseSequenceSettings() { return canInspectProject(); }
    async function canImportProjectMedia() {
      if (!canInspectProject()) return false;
      const project = await ppro.Project.getActiveProject();
      return !!project && ["importFiles", "importSequences", "importAEComps", "importAllAEComps"].every((method) => typeof project[method] === "function");
    }
    function canUseParameters() { return canInspectProject() && !!(ppro.Constants && ppro.Constants.TrackItemType); }
    function canUseTrackItems() { return canUseParameters(); }
    function canUseSequenceEditor() { return canInspectProject() && !!(ppro.SequenceEditor && typeof ppro.SequenceEditor.getEditor === "function"); }
    function canUseMogrtPath() { return canUseSequenceEditor(); }
    function canUseMogrtLibrary() { return canUseSequenceEditor(); }
    function canUseSequences() { return canInspectProject(); }
    async function canCloseSequence() {
      if (!canInspectProject()) return false;
      const project = await ppro.Project.getActiveProject();
      return !!project && typeof project.closeSequence === "function";
    }
    function canUseEncoder() { return !!(ppro.EncoderManager && typeof ppro.EncoderManager.getManager === "function"); }
    function canTrackEncoderJobs() { return !!(events && typeof events.beginEncodeJob === "function" && typeof events.listEncodeJobs === "function" && typeof events.waitForEncodeJob === "function"); }

    return definitions;
  }

  function assertObject(value) { if (!value || typeof value !== "object" || Array.isArray(value)) throw commandError("UXP_INVALID_ARGUMENT", "args must be an object"); }
  function assertOnlyKeys(value, allowed) { const unknown = Object.keys(value).filter((key) => !allowed.includes(key)); if (unknown.length) throw commandError("UXP_INVALID_ARGUMENT", "Unknown argument: " + unknown[0]); }
  function boundedString(value, name, maximum) { if (typeof value !== "string" || !value.trim() || value.length > maximum) throw commandError("UXP_INVALID_ARGUMENT", name + " must be a non-empty string of at most " + maximum + " characters"); return value; }
  function boundedStringAllowEmpty(value, name, maximum) { if (typeof value !== "string" || value.length > maximum) throw commandError("UXP_INVALID_ARGUMENT", name + " must be a string of at most " + maximum + " characters"); return value; }
  function boundedStringArray(value, name, maximum, itemMaximum) { if (!Array.isArray(value) || !value.length || value.length > maximum) throw commandError("UXP_INVALID_ARGUMENT", name + " must contain 1-" + maximum + " values"); return value.map((item, index) => boundedString(item, name + "[" + index + "]", itemMaximum)); }
  function nonNegativeInt(value, name) { if (!Number.isInteger(value) || value < 0) throw commandError("UXP_INVALID_ARGUMENT", name + " must be a non-negative integer"); return value; }
  function boundedInt(value, name, minimum, maximum) { if (!Number.isInteger(value) || value < minimum || value > maximum) throw commandError("UXP_INVALID_ARGUMENT", name + " must be an integer from " + minimum + " to " + maximum); return value; }
  function finiteNumber(value, name, minimum, maximum) { const number = Number(value); if (!Number.isFinite(number) || number < minimum || number > maximum) throw commandError("UXP_INVALID_ARGUMENT", name + " must be from " + minimum + " to " + maximum); return number; }
  function requiredBoolean(value, name) { if (typeof value !== "boolean") throw commandError("UXP_INVALID_ARGUMENT", name + " must be a boolean"); return value; }
  function optionalBoolean(value, fallback, name) { return value == null ? fallback : requiredBoolean(value, name); }
  function enumValue(value, name, allowed) { if (!allowed.includes(value)) throw commandError("UXP_INVALID_ARGUMENT", name + " must be one of " + allowed.join(", ")); return value; }
  function requireConfirmation(value, message) { if (value !== true) throw commandError("UXP_CONFIRMATION_REQUIRED", message + "; pass confirmNonUndoable=true after review"); }
  function assertExpected(actual, expected, code, label) { if (expected != null && actual !== expected) throw commandError(code, label + " no longer matches the expected value"); }
  function assertExpectedNumber(actual, expected, code, label) { if (expected != null && !numbersEqual(actual, expected)) throw commandError(code, label + " no longer matches the expected value"); }
  function requireExternalWrite(value) { if (value !== true) throw commandError("UXP_CONFIRMATION_REQUIRED", "Encoding writes external files and may overwrite an existing output; pass confirmExternalWrite=true after review"); }
  function numbersEqual(left, right) { return Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Math.abs(Number(left) - Number(right)) < 0.000001; }
  function valuesEqual(left, right) { return typeof right === "number" ? numbersEqual(left, right) : left === right; }
  function commandError(code, message) { const error = new Error(message); error.code = code; return error; }

  return { createAdvancedWorkflowDefinitions };
});
