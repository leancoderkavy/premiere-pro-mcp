(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpWorkflows = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_SELECTION_ITEMS = 64;
  const MAX_METADATA_CHARS = 350000;
  const MAX_METADATA_RESULT_BYTES = 900000;

  function utf8ByteLength(value) {
    let bytes = 0;
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < value.length &&
        value.charCodeAt(i + 1) >= 0xDC00 && value.charCodeAt(i + 1) <= 0xDFFF) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    }
    return bytes;
  }

  function createWorkflowDefinitions(deps) {
    const ppro = deps.ppro, Protocol = deps.Protocol, workspace = deps.workspace;
    const definitions = {
      "effects.catalog": { readOnly: true, minHostVersion: "25.6.0", probe: canUseEffects, handler: effectCatalog },
      "effects.chain.get": { readOnly: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseEffects, handler: effectChain },
      "effects.chain.add": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseEffects, handler: addEffect },
      "effects.chain.remove": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseEffects, handler: removeEffect },
      "selection.inspect": { readOnly: true, minHostVersion: "25.6.0", probe: canUseSelection, handler: inspectSelection },
      "selection.targets.inspect": { readOnly: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseSelection, handler: inspectSelectionTargets },
      "selection.update": { idempotent: true, minHostVersion: "25.6.0", probe: canManageSelection, handler: updateSelection },
      "effects.selection.add": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseEffectsSelection, handler: addEffectToSelection },
      "effects.selection.remove": { destructive: true, undoable: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseEffectsSelection, handler: removeEffectFromSelection },
      "sceneEdit.detect": { destructive: true, undoable: false, minHostVersion: "25.6.0", probe: canDetectScenes, handler: detectScenes },
      "proxy.inspect": { readOnly: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canUseClipItems, handler: inspectProxy },
      "proxy.attach": { destructive: true, undoable: false, idempotent: true, targetCapabilityProbe: true, requiresWorkspace: true, minHostVersion: "25.6.0", probe: canAttachProxy, handler: attachProxy },
      "ingest.get": { readOnly: true, minHostVersion: "25.6.0", probe: canUseIngest, handler: getIngest },
      "ingest.configure": { destructive: true, undoable: true, idempotent: true, minHostVersion: "25.6.0", probe: canUseIngest, handler: configureIngest },
      "media.relink": { destructive: true, undoable: false, idempotent: true, targetCapabilityProbe: true, requiresWorkspace: true, minHostVersion: "25.6.0", probe: canRelink, handler: relinkMedia },
      "metadata.get": { readOnly: true, minHostVersion: "25.6.0", probe: canUseMetadata, handler: getMetadata },
      "metadata.update": { destructive: true, undoable: true, idempotent: true, minHostVersion: "25.6.0", probe: canUseMetadata, handler: updateMetadata },
      "color.preflight": { readOnly: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canInspectColor, handler: colorPreflight },
      "footage.conform": { destructive: true, undoable: true, idempotent: true, targetCapabilityProbe: true, minHostVersion: "25.6.0", probe: canConformFootage, handler: conformFootage },
      "sourceMonitor.state": { readOnly: true, minHostVersion: "25.6.0", probe: canInspectSourceMonitor, handler: sourceMonitorState },
      "sourceMonitor.open": { idempotent: true, conditionalWorkspace: true, minHostVersion: "25.6.0", probe: canOpenSourceMonitor, handler: openSourceMonitor },
      "sourceMonitor.play": { minHostVersion: "25.6.0", probe: canPlaySourceMonitor, handler: playSourceMonitor },
      "sourceMonitor.close": { idempotent: true, minHostVersion: "25.6.0", probe: canCloseSourceMonitor, handler: closeSourceMonitor },
      "storage.preflight": { readOnly: true, minHostVersion: "25.6.0", probe: canUseProjectSettings, handler: storagePreflight },
      "scratch.configure": { destructive: true, undoable: true, idempotent: true, minHostVersion: "25.6.0", probe: canConfigureScratch, handler: configureScratch },
      "workspace.status": { readOnly: true, minHostVersion: "25.6.0", probe: canReportWorkspace, handler: workspaceStatus }
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
      const project = await activeProject(requireTransactions);
      const sequence = await project.getActiveSequence();
      if (!sequence) throw commandError("UXP_NO_ACTIVE_SEQUENCE", "No active sequence");
      return { project, sequence };
    }

    async function resolveClipProjectItem(project, input) {
      const wantedId = input.projectItemId || "", wantedName = input.projectItemName || "";
      if (!wantedId && !wantedName) return selectedClipProjectItem(project);
      if (typeof project.getRootItem !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build cannot enumerate project items");
      const root = await project.getRootItem(), queue = root ? [root] : [], nameMatches = [];
      while (queue.length) {
        const folder = queue.shift();
        if (!folder || typeof folder.getItems !== "function") continue;
        const children = Array.from(await folder.getItems() || []);
        for (let index = 0; index < children.length; index += 1) {
          const item = children[index], itemId = await projectItemIdentifier(item);
          if (wantedId && itemId === wantedId) return castClipProjectItem(item);
          if (!wantedId && wantedName && String(item.name || "") === wantedName) {
            try { nameMatches.push(castClipProjectItem(item)); } catch (_) {}
          }
          if (isFolderItem(item)) queue.push(item);
        }
      }
      if (wantedId) throw commandError("UXP_TARGET_NOT_FOUND", "projectItemId was not found or is not a media clip");
      if (nameMatches.length > 1) throw commandError("UXP_AMBIGUOUS_TARGET", "projectItemName matched multiple media clips; use projectItemId");
      if (nameMatches.length === 1) return nameMatches[0];
      throw commandError("UXP_TARGET_NOT_FOUND", "projectItemName was not found or is not a media clip");
    }

    async function selectedClipProjectItem(project) {
      if (!ppro.ProjectUtils || typeof ppro.ProjectUtils.getSelection !== "function") {
        throw commandError("UXP_INVALID_ARGUMENT", "Pass projectItemId or projectItemName because Project panel selection is unavailable");
      }
      const selection = await ppro.ProjectUtils.getSelection(project), items = selection && await selection.getItems();
      if (!items || items.length !== 1) throw commandError("UXP_INVALID_ARGUMENT", "Select exactly one media project item, or pass projectItemId/projectItemName");
      return castClipProjectItem(items[0]);
    }

    function castClipProjectItem(item) {
      if (!ppro.ClipProjectItem || typeof ppro.ClipProjectItem.cast !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build cannot cast project items to media clips");
      }
      try {
        const clip = ppro.ClipProjectItem.cast(item);
        if (clip) return clip;
      } catch (_) {}
      throw commandError("UXP_TARGET_NOT_FOUND", "Resolved project item is not a media clip");
    }

    function castProjectItem(item) {
      if (!ppro.ProjectItem || typeof ppro.ProjectItem.cast !== "function") return item;
      try { return ppro.ProjectItem.cast(item) || item; } catch (_) { return item; }
    }

    function isFolderItem(item) {
      if (!ppro.FolderItem || typeof ppro.FolderItem.cast !== "function") return false;
      try { return !!ppro.FolderItem.cast(item); } catch (_) { return false; }
    }

    async function projectItemIdentifier(item) {
      const projectItem = castProjectItem(item);
      if (!projectItem || typeof projectItem.getId !== "function") return "";
      const id = await projectItem.getId();
      return id == null ? "" : String(id);
    }

    async function clipTarget(args, allowedKeys) {
      assertObject(args);
      assertOnlyKeys(args, allowedKeys);
      const target = validateProjectItemTarget(args);
      const project = await activeProject(false);
      return { project, clip: await resolveClipProjectItem(project, target), target };
    }

    async function trackItemAt(sequence, mediaType, trackIndex, clipIndex) {
      const title = mediaType === "video" ? "Video" : "Audio";
      const countMethod = "get" + title + "TrackCount", trackMethod = "get" + title + "Track";
      if (typeof sequence[countMethod] !== "function" || typeof sequence[trackMethod] !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build does not expose " + mediaType + " track APIs");
      }
      const count = await sequence[countMethod]();
      if (trackIndex >= count) throw commandError("UXP_TARGET_NOT_FOUND", mediaType + " trackIndex " + trackIndex + " is out of range");
      const track = await sequence[trackMethod](trackIndex), itemType = ppro.Constants && ppro.Constants.TrackItemType;
      if (!track || !itemType || itemType.CLIP == null || typeof track.getTrackItems !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere clip track-item APIs are unavailable");
      }
      const items = Array.from(await track.getTrackItems(itemType.CLIP, false) || []);
      if (!items[clipIndex]) throw commandError("UXP_TARGET_NOT_FOUND", "clipIndex " + clipIndex + " is out of range on " + mediaType + " track " + trackIndex);
      return items[clipIndex];
    }

    async function currentTrackItems(sequence, requireNonEmpty, enforceLimit) {
      if (typeof sequence.getSelection !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "This Premiere build cannot inspect the timeline selection");
      const selection = await sequence.getSelection();
      if (!selection || typeof selection.getTrackItems !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere did not return a track-item selection");
      const items = Array.from(await selection.getTrackItems() || []);
      if (requireNonEmpty && !items.length) throw commandError("UXP_EMPTY_SELECTION", "Select at least one clip in the active sequence");
      if (enforceLimit !== false && items.length > MAX_SELECTION_ITEMS) {
        throw commandError("UXP_SELECTION_TOO_LARGE", "Select at most " + MAX_SELECTION_ITEMS + " clips per compound operation");
      }
      return { selection, items };
    }

    async function selectedTrackItems(sequence) {
      return currentTrackItems(sequence, true);
    }

    async function classifySelection(sequence, selectedItems) {
      const cache = { video: new Map(), audio: new Map() }, classified = [];
      async function clipsAt(mediaType, trackIndex) {
        const values = cache[mediaType];
        if (values.has(trackIndex)) return values.get(trackIndex);
        const title = mediaType === "video" ? "Video" : "Audio", trackMethod = "get" + title + "Track";
        const itemType = ppro.Constants && ppro.Constants.TrackItemType;
        let items = [];
        try {
          const track = typeof sequence[trackMethod] === "function" ? await sequence[trackMethod](trackIndex) : null;
          if (track && itemType && itemType.CLIP != null && typeof track.getTrackItems === "function") {
            items = Array.from(await track.getTrackItems(itemType.CLIP, false) || []);
          }
        } catch (_) {}
        values.set(trackIndex, items);
        return items;
      }
      for (let selectionIndex = 0; selectionIndex < selectedItems.length; selectionIndex += 1) {
        const item = selectedItems[selectionIndex];
        let trackIndex = null, mediaType = "unknown", clipIndex = null;
        try { trackIndex = typeof item.getTrackIndex === "function" ? await item.getTrackIndex() : null; } catch (_) {}
        if (Number.isInteger(trackIndex) && trackIndex >= 0) {
          const video = await clipsAt("video", trackIndex), videoIndex = video.indexOf(item);
          if (videoIndex >= 0) { mediaType = "video"; clipIndex = videoIndex; }
          else {
            const audio = await clipsAt("audio", trackIndex), audioIndex = audio.indexOf(item);
            if (audioIndex >= 0) { mediaType = "audio"; clipIndex = audioIndex; }
          }
        }
        classified.push({ item, selectionIndex, mediaType, trackIndex, clipIndex });
      }
      return classified;
    }

    async function componentChain(item) {
      if (!item || typeof item.getComponentChain !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "The selected clip does not expose an effect component chain");
      const chain = await item.getComponentChain();
      if (!chain || typeof chain.getComponentCount !== "function" || typeof chain.getComponentAtIndex !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere did not return a documented effect component chain");
      }
      return chain;
    }

    async function componentInfo(component, index) {
      let matchName = "", displayName = "", parameterCount = null;
      try { if (component && typeof component.getMatchName === "function") matchName = String(await component.getMatchName() || ""); } catch (_) {}
      try { if (component && typeof component.getDisplayName === "function") displayName = String(await component.getDisplayName() || ""); } catch (_) {}
      try { if (component && typeof component.getParamCount === "function") parameterCount = component.getParamCount(); } catch (_) {}
      return { index, matchName, displayName, parameterCount };
    }

    async function chainSnapshot(chain) {
      const count = chain.getComponentCount(), components = [];
      for (let index = 0; index < count; index += 1) components.push(await componentInfo(chain.getComponentAtIndex(index), index));
      return { count, components };
    }

    async function effectCatalog(args) {
      assertObject(args); assertOnlyKeys(args, ["mediaType"]);
      const mediaType = args.mediaType == null ? "all" : enumValue(args.mediaType, "mediaType", ["video", "audio", "all"]);
      const result = {};
      if (mediaType === "video" || mediaType === "all") {
        if (!ppro.VideoFilterFactory || typeof ppro.VideoFilterFactory.getMatchNames !== "function" || typeof ppro.VideoFilterFactory.getDisplayNames !== "function") {
          if (mediaType === "video") throw commandError("UXP_COMMAND_UNAVAILABLE", "Video effect catalog APIs are unavailable");
        } else {
          result.video = {
            matchNames: Array.from(await ppro.VideoFilterFactory.getMatchNames() || []),
            displayNames: Array.from(await ppro.VideoFilterFactory.getDisplayNames() || [])
          };
        }
      }
      if (mediaType === "audio" || mediaType === "all") {
        if (!ppro.AudioFilterFactory || typeof ppro.AudioFilterFactory.getDisplayNames !== "function") {
          if (mediaType === "audio") throw commandError("UXP_COMMAND_UNAVAILABLE", "Audio effect catalog APIs are unavailable");
        } else result.audio = { displayNames: Array.from(await ppro.AudioFilterFactory.getDisplayNames() || []) };
      }
      return result;
    }

    async function effectChain(args) {
      const input = validateTrackTarget(args, ["mediaType", "trackIndex", "clipIndex"]), context = await activeContext(false);
      const item = await trackItemAt(context.sequence, input.mediaType, input.trackIndex, input.clipIndex);
      return { ...input, ...(await chainSnapshot(await componentChain(item))) };
    }

    async function createEffectComponent(mediaType, effectId, item) {
      if (mediaType === "video") {
        const available = Array.from(await ppro.VideoFilterFactory.getMatchNames() || []);
        if (!available.includes(effectId)) throw commandError("UXP_EFFECT_NOT_FOUND", "Unknown video effect matchName: " + effectId);
        const component = await ppro.VideoFilterFactory.createComponent(effectId);
        if (!component) throw commandError("UXP_EFFECT_NOT_FOUND", "Premiere could not create video effect: " + effectId);
        return component;
      }
      const available = Array.from(await ppro.AudioFilterFactory.getDisplayNames() || []);
      if (!available.includes(effectId)) throw commandError("UXP_EFFECT_NOT_FOUND", "Unknown audio effect display name: " + effectId);
      const component = await ppro.AudioFilterFactory.createComponentByDisplayName(effectId, item);
      if (!component) throw commandError("UXP_EFFECT_NOT_FOUND", "Premiere could not create audio effect: " + effectId);
      return component;
    }

    async function addEffect(args) {
      const input = validateEffectAdd(args, false), context = await activeContext(true);
      const item = await trackItemAt(context.sequence, input.mediaType, input.trackIndex, input.clipIndex);
      const chain = await componentChain(item), before = chain.getComponentCount();
      if (input.insertionIndex != null && input.insertionIndex > before) throw commandError("UXP_INVALID_ARGUMENT", "insertionIndex exceeds the component count");
      const component = await createEffectComponent(input.mediaType, input.effectId, item);
      let committed = false;
      context.project.lockedAccess(() => {
        const action = input.insertionIndex == null
          ? chain.createAppendComponentAction(component)
          : chain.createInsertComponentAction(component, input.insertionIndex);
        committed = context.project.executeTransaction((compoundAction) => {
          if (!action || compoundAction.addAction(action) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the effect action");
        }, "Add " + input.mediaType + " effect");
      });
      assertCommitted(committed, "effect addition");
      const after = await chainSnapshot(chain), verified = after.count === before + 1;
      return mutationResult(verified, {
        applied: true, mediaType: input.mediaType, trackIndex: input.trackIndex, clipIndex: input.clipIndex,
        effectId: input.effectId, insertionIndex: input.insertionIndex, beforeCount: before, after
      }, "effect_chain_count_readback", "Add " + input.mediaType + " effect");
    }

    async function removeEffect(args) {
      const input = validateEffectRemove(args, false), context = await activeContext(true);
      const item = await trackItemAt(context.sequence, input.mediaType, input.trackIndex, input.clipIndex);
      const chain = await componentChain(item), before = chain.getComponentCount();
      if (input.componentIndex >= before) throw commandError("UXP_TARGET_NOT_FOUND", "componentIndex is out of range");
      const component = chain.getComponentAtIndex(input.componentIndex);
      await assertExpectedComponent(component, input.expectedEffectId);
      let committed = false;
      context.project.lockedAccess(() => {
        const action = chain.createRemoveComponentAction(component);
        committed = context.project.executeTransaction((compoundAction) => {
          if (!action || compoundAction.addAction(action) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the effect removal action");
        }, "Remove " + input.mediaType + " effect");
      });
      assertCommitted(committed, "effect removal");
      const after = await chainSnapshot(chain), verified = after.count === before - 1;
      return mutationResult(verified, {
        removed: true, mediaType: input.mediaType, trackIndex: input.trackIndex, clipIndex: input.clipIndex,
        componentIndex: input.componentIndex, expectedEffectId: input.expectedEffectId, beforeCount: before, after
      }, "effect_chain_count_readback", "Remove " + input.mediaType + " effect");
    }

    async function inspectSelection(args) {
      assertObject(args); assertOnlyKeys(args, []);
      const context = await activeContext(false), selected = await currentTrackItems(context.sequence, false);
      const classified = await classifySelection(context.sequence, selected.items), items = [];
      for (const value of classified) items.push(await selectionFingerprintSnapshot(value, true));
      return { sequenceGuid: activeSequenceGuid(context.sequence), count: items.length, items };
    }

    async function inspectSelectionTargets(args) {
      const inputs = validateSelectionTargetInspectionArgs(args), context = await activeContext(false), items = [];
      for (let index = 0; index < inputs.length; index += 1) {
        const input = inputs[index], item = await trackItemAt(context.sequence, input.mediaType, input.trackIndex, input.clipIndex);
        const snapshot = await selectionFingerprintSnapshot({
          item, selectionIndex: index, mediaType: input.mediaType,
          trackIndex: input.trackIndex, clipIndex: input.clipIndex
        });
        items.push({
          targetIndex: index, mediaType: snapshot.mediaType, trackIndex: snapshot.trackIndex,
          clipIndex: snapshot.clipIndex, name: snapshot.name, startSeconds: snapshot.startSeconds,
          endSeconds: snapshot.endSeconds, projectItem: snapshot.projectItem
        });
      }
      return { sequenceGuid: activeSequenceGuid(context.sequence), count: items.length, items };
    }

    async function selectionFingerprintSnapshot(value, includeComponentCount) {
      const item = value.item;
      if (!item || typeof item.getProjectItem !== "function" ||
        typeof item.getStartTime !== "function" || typeof item.getEndTime !== "function") {
        throw commandError("UXP_SELECTION_FINGERPRINT_UNAVAILABLE", "Timeline item " + value.selectionIndex + " does not expose a complete mutation fingerprint");
      }
      let projectItem = null, projectItemId = "", startSeconds = null, endSeconds = null;
      try {
        projectItem = await item.getProjectItem();
        projectItemId = await projectItemIdentifier(projectItem);
        startSeconds = tickSeconds(await item.getStartTime());
        endSeconds = tickSeconds(await item.getEndTime());
      } catch (_) {
        throw commandError("UXP_SELECTION_FINGERPRINT_UNAVAILABLE", "Timeline item " + value.selectionIndex + " could not provide its project item and native timeline times");
      }
      if (!projectItemId || startSeconds == null || endSeconds == null) {
        throw commandError("UXP_SELECTION_FINGERPRINT_UNAVAILABLE", "Timeline item " + value.selectionIndex + " returned an incomplete mutation fingerprint");
      }
      let componentCount = null;
      if (includeComponentCount) {
        try { componentCount = (await componentChain(item)).getComponentCount(); } catch (_) {}
      }
      return {
        selectionIndex: value.selectionIndex, mediaType: value.mediaType, trackIndex: value.trackIndex,
        clipIndex: value.clipIndex, name: String(item.name || ""), startSeconds, endSeconds,
        componentCount, projectItem: { id: projectItemId, name: String(projectItem && projectItem.name || "") }
      };
    }

    async function updateSelection(args) {
      const input = validateSelectionUpdateArgs(args), context = await activeContext(false);
      const sequenceGuid = activeSequenceGuid(context.sequence);
      if (!sequenceGuid || input.expectedSequenceGuid !== sequenceGuid) {
        throw commandError("UXP_STALE_SEQUENCE", "The active sequence changed; inspect the timeline selection again before updating it");
      }

      await planSelectionUpdate(context.sequence, input);
      const mutationContext = await activeContext(false), mutationSequenceGuid = activeSequenceGuid(mutationContext.sequence);
      if (!mutationSequenceGuid || input.expectedSequenceGuid !== mutationSequenceGuid) {
        throw commandError("UXP_STALE_SEQUENCE", "The active sequence changed; inspect the timeline selection again before updating it");
      }
      const plan = await planSelectionUpdate(mutationContext.sequence, input);
      const beforeSelection = plan.beforeSelection, before = plan.before;
      const desiredItems = plan.desiredItems, desired = plan.desired;
      if (input.mode === "add" || input.mode === "remove") {
        const currentBase = await selectionSnapshot(mutationContext.sequence, false);
        const plannedKeys = before ? selectionSnapshotKeys(before.items) : [];
        if (!before || !sameStringArrays(plannedKeys, selectionSnapshotKeys(currentBase.items))) {
          throw commandError("UXP_STALE_SELECTION", "The current timeline selection changed while the update was being prepared; inspect it again before updating it");
        }
      }
      const commitContext = await activeContext(false), commitSequenceGuid = activeSequenceGuid(commitContext.sequence);
      if (!commitSequenceGuid || input.expectedSequenceGuid !== commitSequenceGuid) {
        throw commandError("UXP_STALE_SEQUENCE", "The active sequence changed; inspect the timeline selection again before updating it");
      }
      if (desiredItems.length) {
        const selection = createEmptyTrackItemSelection();
        for (const item of desiredItems) {
          if (selection.addItem(item, false) !== true) {
            throw commandError("UXP_SELECTION_REJECTED", "Premiere rejected a clip while constructing the timeline selection");
          }
        }
        const set = await hostBoolean(commitContext.sequence.setSelection(selection));
        if (!set) throw commandError("UXP_SELECTION_REJECTED", "Premiere did not accept the requested timeline selection");
      } else {
        const cleared = await hostBoolean(commitContext.sequence.clearSelection());
        if (!cleared) throw commandError("UXP_SELECTION_REJECTED", "Premiere did not clear the timeline selection");
      }

      const after = await selectionSnapshot(commitContext.sequence);
      assertClassifiedSelection(after.classified, "Premiere returned an unclassified timeline item after the selection update");
      const expectedKeys = selectionSnapshotKeys(desired.items), actualKeys = selectionSnapshotKeys(after.items);
      if (!sameStringArrays(expectedKeys, actualKeys)) {
        throw commandError("UXP_VERIFICATION_FAILED", "The timeline selection readback did not match the requested clips");
      }
      const beforeKeys = before ? selectionSnapshotKeys(before.items) : null;
      const changed = beforeKeys ? !sameStringArrays(beforeKeys, actualKeys) :
        input.mode === "clear" ? beforeSelection.items.length > 0 : true;
      return {
        updated: true, changed, mode: input.mode,
        sequenceGuid, count: after.items.length, items: after.items,
        outcome: "verified", verified: "timeline_selection_readback",
        verificationBoundary: "timeline_selection_readback",
        operation: operationSemantics({
          mutatesProject: false, verificationStatus: "verified", verificationBoundary: "timeline_selection_readback",
          verificationEvidence: [{ type: "timeline_selection", sequenceGuid, count: after.items.length }],
          cancellationSupported: true
        })
      };
    }

    async function planSelectionUpdate(sequence, input) {
      const beforeSelection = await currentTrackItems(sequence, false, false);
      let before = null;
      let desiredItems = [];
      if (input.mode !== "clear") {
        const resolved = await resolveSelectionTargets(sequence, input.items);
        if (input.mode === "replace") {
          desiredItems = resolved.map((value) => value.item);
          if (beforeSelection.items.length <= MAX_SELECTION_ITEMS) {
            before = await itemSelectionSnapshot(sequence, beforeSelection.items);
            assertClassifiedSelection(before.classified, "The current selection contains an item that cannot be addressed safely");
          }
        } else {
          if (input.mode === "add" && beforeSelection.items.length > MAX_SELECTION_ITEMS) {
            throw commandError("UXP_SELECTION_TOO_LARGE", "The updated selection would exceed " + MAX_SELECTION_ITEMS + " clips");
          }
          if (input.mode === "remove" && beforeSelection.items.length - resolved.length > MAX_SELECTION_ITEMS) {
            throw commandError("UXP_SELECTION_TOO_LARGE", "The updated selection would exceed " + MAX_SELECTION_ITEMS + " clips");
          }
          before = await itemSelectionSnapshot(sequence, beforeSelection.items);
          assertClassifiedSelection(before.classified, "The current selection contains an item that cannot be addressed safely");
          desiredItems = before.classified.map((value) => value.item);
          if (input.mode === "add") {
            const existing = new Set(before.classified.map(selectionCoordinateKey));
            for (const value of resolved) {
              const coordinate = selectionCoordinateKey(value.snapshot);
              if (!existing.has(coordinate)) { desiredItems.push(value.item); existing.add(coordinate); }
            }
            if (desiredItems.length > MAX_SELECTION_ITEMS) {
              throw commandError("UXP_SELECTION_TOO_LARGE", "The updated selection would exceed " + MAX_SELECTION_ITEMS + " clips");
            }
          } else {
            const removed = new Set(resolved.map((value) => selectionCoordinateKey(value.snapshot)));
            desiredItems = before.classified
              .filter((value) => !removed.has(selectionCoordinateKey(value)))
              .map((value) => value.item);
          }
        }
      }
      if (desiredItems.length > MAX_SELECTION_ITEMS) {
        throw commandError("UXP_SELECTION_TOO_LARGE", "The updated selection would exceed " + MAX_SELECTION_ITEMS + " clips");
      }

      const desired = await itemSelectionSnapshot(sequence, desiredItems);
      assertClassifiedSelection(desired.classified, "Premiere could not classify a requested timeline item");
      return { beforeSelection, before, desiredItems, desired };
    }

    async function resolveSelectionTargets(sequence, inputs) {
      const result = [];
      for (let index = 0; index < inputs.length; index += 1) {
        const input = inputs[index], item = await trackItemAt(sequence, input.mediaType, input.trackIndex, input.clipIndex);
        const snapshot = await selectionFingerprintSnapshot({
          item, selectionIndex: index, mediaType: input.mediaType,
          trackIndex: input.trackIndex, clipIndex: input.clipIndex
        });
        const projectItemId = snapshot.projectItem && snapshot.projectItem.id;
        if (projectItemId !== input.expectedProjectItemId ||
          !valuesEqual(snapshot.startSeconds, input.expectedStartSeconds) ||
          !valuesEqual(snapshot.endSeconds, input.expectedEndSeconds)) {
          throw commandError("UXP_STALE_SELECTION_TARGET", "Timeline item " + index + " changed; inspect the selection again before updating it");
        }
        result.push({ item, snapshot });
      }
      return result;
    }

    async function selectionSnapshot(sequence, enforceLimit) {
      const selected = await currentTrackItems(sequence, false, enforceLimit);
      return itemSelectionSnapshot(sequence, selected.items);
    }

    async function itemSelectionSnapshot(sequence, selectedItems) {
      const classified = await classifySelection(sequence, selectedItems), items = [];
      for (const value of classified) items.push(await selectionFingerprintSnapshot(value));
      return { classified, items };
    }

    function assertClassifiedSelection(classified, message) {
      if (classified.some((value) => value.mediaType !== "video" && value.mediaType !== "audio" ||
        !Number.isInteger(value.trackIndex) || !Number.isInteger(value.clipIndex))) {
        throw commandError("UXP_UNCLASSIFIED_SELECTION", message);
      }
    }

    function createEmptyTrackItemSelection() {
      let selection = null;
      const created = ppro.TrackItemSelection.createEmptySelection((value) => { selection = value; });
      if (created !== true || !selection || typeof selection.addItem !== "function") {
        throw commandError("UXP_SELECTION_REJECTED", "Premiere could not create an empty timeline selection");
      }
      return selection;
    }

    async function hostBoolean(value) {
      const resolved = value && typeof value.then === "function" ? await value : value;
      return resolved === true;
    }

    function activeSequenceGuid(sequence) {
      return sequence && sequence.guid != null ? String(sequence.guid) : "";
    }

    function selectionSnapshotKeys(items) {
      return items.map((item) => JSON.stringify([
        item.mediaType, item.trackIndex, item.clipIndex,
        item.projectItem && item.projectItem.id || "", item.startSeconds, item.endSeconds
      ])).sort();
    }

    function selectionCoordinateKey(item) {
      return item.mediaType + ":" + item.trackIndex + ":" + item.clipIndex;
    }

    function sameStringArrays(left, right) {
      return left.length === right.length && left.every((value, index) => value === right[index]);
    }

    async function selectedItemsForEffect(context, mediaType) {
      const selected = await selectedTrackItems(context.sequence), classified = await classifySelection(context.sequence, selected.items);
      const invalid = classified.filter((value) => value.mediaType !== mediaType);
      if (invalid.length) throw commandError("UXP_SELECTION_TYPE_MISMATCH", "Every selected item must be a " + mediaType + " clip for this compound operation");
      return classified;
    }

    async function addEffectToSelection(args) {
      const input = validateEffectAdd(args, true), context = await activeContext(true);
      const targets = await selectedItemsForEffect(context, input.mediaType), prepared = [];
      for (const target of targets) {
        const chain = await componentChain(target.item), before = chain.getComponentCount();
        if (input.insertionIndex != null && input.insertionIndex > before) throw commandError("UXP_INVALID_ARGUMENT", "insertionIndex exceeds a selected clip's component count");
        prepared.push({ target, chain, before, component: await createEffectComponent(input.mediaType, input.effectId, target.item) });
      }
      let committed = false;
      context.project.lockedAccess(() => {
        committed = context.project.executeTransaction((compoundAction) => {
          for (const value of prepared) {
            const action = input.insertionIndex == null
              ? value.chain.createAppendComponentAction(value.component)
              : value.chain.createInsertComponentAction(value.component, input.insertionIndex);
            if (!action || compoundAction.addAction(action) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected a selected effect action");
          }
        }, "Add effect to selected clips");
      });
      assertCommitted(committed, "selected effect addition");
      const evidence = [], verified = await verifyChainDeltas(prepared, 1, evidence);
      return mutationResult(verified, {
        applied: prepared.length, mediaType: input.mediaType, effectId: input.effectId,
        insertionIndex: input.insertionIndex, evidence
      }, "selected_effect_chain_count_readback", "Add effect to selected clips");
    }

    async function removeEffectFromSelection(args) {
      const input = validateEffectRemove(args, true), context = await activeContext(true);
      const targets = await selectedItemsForEffect(context, input.mediaType), prepared = [];
      for (const target of targets) {
        const chain = await componentChain(target.item), before = chain.getComponentCount();
        if (input.componentIndex >= before) throw commandError("UXP_TARGET_NOT_FOUND", "componentIndex is out of range on a selected clip");
        const component = chain.getComponentAtIndex(input.componentIndex);
        await assertExpectedComponent(component, input.expectedEffectId);
        prepared.push({ target, chain, before, component });
      }
      let committed = false;
      context.project.lockedAccess(() => {
        committed = context.project.executeTransaction((compoundAction) => {
          for (const value of prepared) {
            const action = value.chain.createRemoveComponentAction(value.component);
            if (!action || compoundAction.addAction(action) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected a selected effect removal action");
          }
        }, "Remove effect from selected clips");
      });
      assertCommitted(committed, "selected effect removal");
      const evidence = [], verified = await verifyChainDeltas(prepared, -1, evidence);
      return mutationResult(verified, {
        removed: prepared.length, mediaType: input.mediaType, componentIndex: input.componentIndex,
        expectedEffectId: input.expectedEffectId, evidence
      }, "selected_effect_chain_count_readback", "Remove effect from selected clips");
    }

    async function assertExpectedComponent(component, expectedEffectId) {
      const snapshot = await componentInfo(component, null);
      if (snapshot.matchName !== expectedEffectId && snapshot.displayName !== expectedEffectId) {
        throw commandError("UXP_STALE_EFFECT_CHAIN", "The component at componentIndex no longer matches expectedEffectId");
      }
    }

    async function verifyChainDeltas(prepared, delta, evidence) {
      let verified = true;
      for (const value of prepared) {
        const afterCount = value.chain.getComponentCount(), expected = value.before + delta;
        if (afterCount !== expected) verified = false;
        evidence.push({ selectionIndex: value.target.selectionIndex, beforeCount: value.before, afterCount, expected });
      }
      return verified;
    }

    async function detectScenes(args) {
      assertObject(args); assertOnlyKeys(args, ["mode", "operationId"]);
      const mode = enumValue(args.mode, "mode", ["applyCuts", "createMarkers", "createSubclips"]);
      const context = await activeContext(false), selected = await selectedTrackItems(context.sequence);
      const utils = ppro.SequenceUtils, names = {
        applyCuts: "SEQUENCE_OPERATION_APPLYCUT",
        createMarkers: "SEQUENCE_OPERATION_CREATEMARKER",
        createSubclips: "SEQUENCE_OPERATION_CREATESUBCLIP"
      };
      const operation = utils && utils[names[mode]];
      if (typeof operation !== "string" || !operation) throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere scene-edit operation constants are unavailable");
      const detected = await utils.performSceneEditDetectionOnSelection(operation, selected.selection);
      if (!detected) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not confirm scene-edit detection");
      return {
        detected: true, outcome: "committed_unverified", mode, selectedItemCount: selected.items.length,
        verificationBoundary: "sequence_utils_host_return",
        operation: operationSemantics({
          mutatesProject: true, verificationStatus: "not_verified", verificationBoundary: "sequence_utils_host_return",
          verificationEvidence: [{ type: "host_return", value: true }], undoSupported: false, cancellationSupported: true
        })
      };
    }

    async function proxySnapshot(clip) {
      const projectItem = castProjectItem(clip);
      const result = {
        projectItemId: await projectItemIdentifier(clip), name: String(clip.name || ""),
        canProxy: null, hasProxy: null, proxyPath: "", offline: null, mediaPath: ""
      };
      if (typeof clip.canProxy === "function") result.canProxy = !!await clip.canProxy();
      if (typeof clip.hasProxy === "function") result.hasProxy = !!await clip.hasProxy();
      if (typeof clip.getProxyPath === "function") result.proxyPath = String(await clip.getProxyPath() || "");
      if (typeof clip.isOffline === "function") result.offline = !!await clip.isOffline();
      if (projectItem && typeof projectItem.getMediaFilePath === "function") result.mediaPath = String(await projectItem.getMediaFilePath() || "");
      return result;
    }

    async function inspectProxy(args) {
      const context = await clipTarget(args, ["projectItemId", "projectItemName"]);
      return proxySnapshot(context.clip);
    }

    async function attachProxy(args) {
      assertObject(args);
      assertOnlyKeys(args, ["projectItemId", "projectItemName", "mediaPath", "isHiRes", "makeAlternateLinkInTeamProjects", "replaceExistingProxy", "confirmNonUndoable", "operationId"]);
      const target = validateProjectItemTarget(args);
      requireConfirmation(args.confirmNonUndoable, "Attaching proxy or high-resolution media is not undoable");
      const mediaPath = await allowedPath(args.mediaPath, "proxy mediaPath", "file");
      const isHiRes = optionalBoolean(args.isHiRes, false, "isHiRes");
      const alternate = optionalBoolean(args.makeAlternateLinkInTeamProjects, false, "makeAlternateLinkInTeamProjects");
      const replaceExistingProxy = optionalBoolean(args.replaceExistingProxy, false, "replaceExistingProxy");
      const project = await activeProject(false), clip = await resolveClipProjectItem(project, target), before = await proxySnapshot(clip);
      if (typeof clip.canProxy !== "function" || !await clip.canProxy()) throw commandError("UXP_TARGET_UNSUPPORTED", "The resolved clip cannot accept proxy media");
      if (!isHiRes && before.hasProxy && pathEqual(before.proxyPath, mediaPath)) {
        return { attached: false, unchanged: true, outcome: "verified", before, after: before, mediaPath, isHiRes };
      }
      if (!isHiRes && before.hasProxy && !replaceExistingProxy) {
        throw commandError("UXP_PROXY_ALREADY_ATTACHED", "A different proxy is already attached; inspect it and pass replaceExistingProxy=true to replace it");
      }
      const attached = await clip.attachProxy(mediaPath, isHiRes, alternate);
      if (!attached) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not confirm proxy attachment");
      const after = await proxySnapshot(clip);
      const verified = isHiRes ? false : after.hasProxy === true && pathEqual(after.proxyPath, mediaPath);
      return {
        attached: true, outcome: verified ? "verified" : "committed_unverified", before, after, mediaPath, isHiRes, replaceExistingProxy,
        verificationBoundary: verified ? "proxy_path_readback" : "attach_proxy_host_return",
        operation: operationSemantics({
          mutatesProject: true, verificationStatus: verified ? "verified" : "not_verified",
          verificationBoundary: verified ? "proxy_path_readback" : "attach_proxy_host_return",
          verificationEvidence: verified ? [{ type: "proxy_path", pathMatched: true }] : [{ type: "host_return", value: true }],
          undoSupported: false, cancellationSupported: true
        })
      };
    }

    async function ingestSnapshot(project) {
      const settings = await ppro.ProjectSettings.getIngestSettings(project);
      if (!settings || typeof settings.getIsIngestEnabled !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere did not return ingest settings");
      return { settings, enabled: !!await settings.getIsIngestEnabled() };
    }

    async function getIngest(args) {
      assertObject(args); assertOnlyKeys(args, []);
      const project = await activeProject(false), snapshot = await ingestSnapshot(project);
      return { enabled: snapshot.enabled };
    }

    async function configureIngest(args) {
      assertObject(args); assertOnlyKeys(args, ["enabled", "operationId"]);
      const enabled = requiredBoolean(args.enabled, "enabled"), project = await activeProject(true);
      const before = await ingestSnapshot(project);
      if (before.enabled === enabled) return { configured: false, unchanged: true, outcome: "verified", enabled };
      if (typeof before.settings.setIngestEnabled !== "function" || !await before.settings.setIngestEnabled(enabled)) {
        throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the ingest setting value");
      }
      let committed = false;
      project.lockedAccess(() => {
        const action = ppro.ProjectSettings.createSetIngestSettingsAction(project, before.settings);
        committed = project.executeTransaction((compoundAction) => {
          if (!action || compoundAction.addAction(action) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the ingest settings action");
        }, "Configure ingest");
      });
      assertCommitted(committed, "ingest settings update");
      const after = await ingestSnapshot(project), verified = after.enabled === enabled;
      return mutationResult(verified, { configured: true, before: before.enabled, enabled: after.enabled }, "ingest_settings_readback", "Configure ingest");
    }

    async function relinkMedia(args) {
      assertObject(args);
      assertOnlyKeys(args, ["projectItemId", "projectItemName", "newPath", "expectedCurrentPath", "overrideCompatibilityCheck", "requireOffline", "confirmNonUndoable", "operationId"]);
      const target = validateProjectItemTarget(args);
      requireConfirmation(args.confirmNonUndoable, "Changing a clip's media path is not undoable");
      const newPath = await allowedPath(args.newPath, "newPath", "file");
      const expectedCurrentPath = args.expectedCurrentPath == null ? null : boundedString(args.expectedCurrentPath, "expectedCurrentPath", 4096);
      const overrideCompatibilityCheck = optionalBoolean(args.overrideCompatibilityCheck, false, "overrideCompatibilityCheck");
      const requireOffline = optionalBoolean(args.requireOffline, true, "requireOffline");
      const project = await activeProject(false), clip = await resolveClipProjectItem(project, target), projectItem = castProjectItem(clip);
      if (typeof clip.canChangeMediaPath !== "function" || !await clip.canChangeMediaPath()) throw commandError("UXP_TARGET_UNSUPPORTED", "Premiere reports that this clip's media path cannot be changed");
      const before = await proxySnapshot(clip);
      if (expectedCurrentPath != null && !pathEqual(before.mediaPath, expectedCurrentPath)) {
        throw commandError("UXP_STALE_MEDIA_PATH", "The clip's current media path no longer matches expectedCurrentPath");
      }
      if (requireOffline && before.offline !== true) throw commandError("UXP_MEDIA_NOT_OFFLINE", "Safe relink defaults to offline clips; set requireOffline=false only after inspecting the target");
      if (pathEqual(before.mediaPath, newPath) && before.offline === false) {
        return { relinked: false, unchanged: true, outcome: "verified", before, after: before, newPath };
      }
      const changed = await clip.changeMediaFilePath(newPath, overrideCompatibilityCheck);
      if (!changed) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not confirm the media relink");
      if (typeof clip.refreshMedia === "function") await clip.refreshMedia();
      const after = await proxySnapshot(clip);
      if (!after.mediaPath && projectItem && typeof projectItem.getMediaFilePath === "function") after.mediaPath = String(await projectItem.getMediaFilePath() || "");
      const verified = pathEqual(after.mediaPath, newPath) && after.offline === false;
      return {
        relinked: true, outcome: verified ? "verified" : "committed_unverified", before, after, newPath,
        overrideCompatibilityCheck, verificationBoundary: verified ? "media_path_and_online_readback" : "change_media_file_path_host_return",
        operation: operationSemantics({
          mutatesProject: true, verificationStatus: verified ? "verified" : "not_verified",
          verificationBoundary: verified ? "media_path_and_online_readback" : "change_media_file_path_host_return",
          verificationEvidence: [{ type: "media_path", pathMatched: pathEqual(after.mediaPath, newPath), online: after.offline === false }],
          undoSupported: false, cancellationSupported: true
        })
      };
    }

    async function metadataSnapshot(clip) {
      const projectItem = castProjectItem(clip);
      const projectMetadata = String(await ppro.Metadata.getProjectMetadata(projectItem) || "");
      const xmpMetadata = String(await ppro.Metadata.getXMPMetadata(projectItem) || "");
      const result = { projectItemId: await projectItemIdentifier(projectItem), name: String(clip.name || ""), projectMetadata, xmpMetadata };
      if (projectMetadata.length > MAX_METADATA_CHARS || xmpMetadata.length > MAX_METADATA_CHARS ||
        utf8ByteLength(JSON.stringify(result)) > MAX_METADATA_RESULT_BYTES) {
        throw commandError("UXP_RESULT_TOO_LARGE", "Metadata exceeds the bridge's bounded result size");
      }
      return Protocol && typeof Protocol.assertResultSize === "function" ? Protocol.assertResultSize(result) : result;
    }

    async function getMetadata(args) {
      const context = await clipTarget(args, ["projectItemId", "projectItemName"]);
      return metadataSnapshot(context.clip);
    }

    async function updateMetadata(args) {
      assertObject(args);
      assertOnlyKeys(args, ["projectItemId", "projectItemName", "projectMetadata", "xmpMetadata", "updatedFields", "operationId"]);
      const target = validateProjectItemTarget(args), hasProject = args.projectMetadata != null, hasXmp = args.xmpMetadata != null;
      if (!hasProject && !hasXmp) throw commandError("UXP_INVALID_ARGUMENT", "At least one of projectMetadata or xmpMetadata is required");
      const projectMetadata = hasProject ? boundedStringAllowEmpty(args.projectMetadata, "projectMetadata", MAX_METADATA_CHARS) : null;
      const xmpMetadata = hasXmp ? boundedStringAllowEmpty(args.xmpMetadata, "xmpMetadata", MAX_METADATA_CHARS) : null;
      const updatedFields = validateUpdatedFields(args.updatedFields, hasProject);
      const project = await activeProject(true), clip = await resolveClipProjectItem(project, target), projectItem = castProjectItem(clip);
      const before = await metadataSnapshot(clip);
      if ((!hasProject || before.projectMetadata === projectMetadata) && (!hasXmp || before.xmpMetadata === xmpMetadata)) {
        return { updated: false, unchanged: true, outcome: "verified", metadata: before };
      }
      let committed = false;
      project.lockedAccess(() => {
        committed = project.executeTransaction((compoundAction) => {
          if (hasProject && before.projectMetadata !== projectMetadata) {
            const projectAction = ppro.Metadata.createSetProjectMetadataAction(projectItem, projectMetadata, updatedFields);
            if (!projectAction || compoundAction.addAction(projectAction) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the project metadata action");
          }
          if (hasXmp && before.xmpMetadata !== xmpMetadata) {
            const xmpAction = ppro.Metadata.createSetXMPMetadataAction(projectItem, xmpMetadata);
            if (!xmpAction || compoundAction.addAction(xmpAction) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the XMP metadata action");
          }
        }, "Update clip metadata");
      });
      assertCommitted(committed, "metadata update");
      const after = await metadataSnapshot(clip);
      const verified = (!hasProject || after.projectMetadata === projectMetadata) && (!hasXmp || after.xmpMetadata === xmpMetadata);
      return mutationResult(verified, { updated: true, updatedFields, metadata: after }, "metadata_readback", "Update clip metadata");
    }

    async function footageSnapshot(clip) {
      if (typeof clip.getFootageInterpretation !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "Footage interpretation APIs are unavailable for this clip");
      const interpretation = await clip.getFootageInterpretation();
      if (!interpretation) throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere did not return footage interpretation data");
      const values = {};
      const getters = {
        frameRate: "getFrameRate", pixelAspectRatio: "getPixelAspectRatio", fieldType: "getFieldType",
        removePullDown: "getRemovePullDown", alphaUsage: "getAlphaUsage", ignoreAlpha: "getIgnoreAlpha",
        invertAlpha: "getInvertAlpha", vrConform: "getVrConform", vrLayout: "getVrLayout",
        vrHorzView: "getVrHorzView", vrVertView: "getVrVertView", footageInputLutId: "getInputLUTID"
      };
      for (const key of Object.keys(getters)) {
        const method = getters[key];
        values[key] = typeof interpretation[method] === "function" ? interpretation[method]() : null;
      }
      values.inputLutId = typeof clip.getInputLUTID === "function" ? String(await clip.getInputLUTID() || "") : null;
      values.embeddedLutId = typeof clip.getEmbeddedLUTID === "function" ? String(await clip.getEmbeddedLUTID() || "") : null;
      return { interpretation, values };
    }

    async function colorPreflight(args) {
      const context = await clipTarget(args, ["projectItemId", "projectItemName"]);
      if (typeof context.project.getColorSettings !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "Project color settings are unavailable");
      const settings = await context.project.getColorSettings();
      if (!settings) throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere did not return project color settings");
      const footage = await footageSnapshot(context.clip);
      return {
        project: {
          graphicsWhiteLuminance: await settings.getGraphicsWhiteLuminance(),
          supportedGraphicsWhiteLuminances: Array.from(await settings.getSupportedGraphicsWhiteLuminances() || [])
        },
        clip: { projectItemId: await projectItemIdentifier(context.clip), name: String(context.clip.name || ""), ...footage.values }
      };
    }

    async function conformFootage(args) {
      const input = validateConformanceArgs(args), project = await activeProject(true);
      const clip = await resolveClipProjectItem(project, input), before = await footageSnapshot(clip);
      const setters = {
        frameRate: "setFrameRate", pixelAspectRatio: "setPixelAspectRatio", fieldType: "setFieldType",
        removePullDown: "setRemovePullDown", alphaUsage: "setAlphaUsage", ignoreAlpha: "setIgnoreAlpha",
        invertAlpha: "setInvertAlpha", vrConform: "setVrConform", vrLayout: "setVrLayout",
        vrHorzView: "setVrHorzView", vrVertView: "setVrVertView"
      };
      const interpretationKeys = Object.keys(setters).filter((key) => input[key] != null);
      for (const key of interpretationKeys) {
        const method = setters[key];
        if (typeof before.interpretation[method] !== "function" || before.interpretation[method](input[key]) !== true) {
          throw commandError("UXP_ACTION_REJECTED", "Premiere rejected footage interpretation field " + key);
        }
      }
      let committed = false;
      project.lockedAccess(() => {
        committed = project.executeTransaction((compoundAction) => {
          if (interpretationKeys.length) {
            const interpretationAction = clip.createSetFootageInterpretationAction(before.interpretation);
            if (!interpretationAction || compoundAction.addAction(interpretationAction) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the footage interpretation action");
          }
          if (input.inputLutId != null) {
            const lutAction = clip.createSetInputLUTIDAction(input.inputLutId);
            if (!lutAction || compoundAction.addAction(lutAction) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the input LUT action");
          }
        }, "Conform source footage");
      });
      assertCommitted(committed, "footage conformance update");
      const after = await footageSnapshot(clip), requested = { ...input };
      delete requested.projectItemId; delete requested.projectItemName; delete requested.operationId;
      const verified = Object.keys(requested).every((key) => valuesEqual(after.values[key], requested[key]));
      return mutationResult(verified, {
        conformed: true, projectItemId: await projectItemIdentifier(clip), requested, before: before.values, after: after.values
      }, "footage_interpretation_readback", "Conform source footage");
    }

    async function sourceMonitorState(args) {
      assertObject(args); assertOnlyKeys(args, []);
      const source = ppro.SourceMonitor, position = await source.getPosition();
      let projectItem = null;
      try {
        const item = await source.getProjectItem();
        if (item) projectItem = { id: await projectItemIdentifier(item), name: String(item.name || "") };
      } catch (_) {}
      return { open: !!projectItem, positionSeconds: tickSeconds(position), projectItem };
    }

    async function openSourceMonitor(args) {
      assertObject(args); assertOnlyKeys(args, ["projectItemId", "projectItemName", "filePath", "operationId"]);
      const hasFile = args.filePath != null;
      if (hasFile && (args.projectItemId != null || args.projectItemName != null)) throw commandError("UXP_INVALID_ARGUMENT", "filePath cannot be combined with a project-item selector");
      if (hasFile) {
        const filePath = await allowedPath(args.filePath, "Source Monitor filePath", "file");
        const opened = await ppro.SourceMonitor.openFilePath(filePath);
        if (!opened) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not confirm opening the file in Source Monitor");
        return {
          opened: true, source: "file", filePath, outcome: "committed_unverified",
          verificationBoundary: "source_monitor_open_file_host_return",
          operation: operationSemantics({ mutatesProject: false, verificationStatus: "not_verified", verificationBoundary: "source_monitor_open_file_host_return", verificationEvidence: [{ type: "host_return", value: true }] })
        };
      }
      const target = validateProjectItemTarget(args), project = await activeProject(false);
      const clip = await resolveClipProjectItem(project, target), projectItem = castProjectItem(clip), expectedId = await projectItemIdentifier(projectItem);
      const opened = await ppro.SourceMonitor.openProjectItem(projectItem);
      if (!opened) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not confirm opening the project item in Source Monitor");
      const readback = await ppro.SourceMonitor.getProjectItem(), readbackId = await projectItemIdentifier(readback);
      const verified = !!expectedId && readbackId === expectedId;
      return {
        opened: true, source: "projectItem", projectItemId: expectedId, name: String(clip.name || ""),
        outcome: verified ? "verified" : "committed_unverified", verificationBoundary: "source_monitor_project_item_readback",
        operation: operationSemantics({
          mutatesProject: false, verificationStatus: verified ? "verified" : "not_verified",
          verificationBoundary: "source_monitor_project_item_readback", verificationEvidence: [{ type: "project_item", expectedId, readbackId }]
        })
      };
    }

    async function playSourceMonitor(args) {
      assertObject(args); assertOnlyKeys(args, ["speed", "operationId"]);
      const speed = args.speed == null ? 1 : finiteNumber(args.speed, "speed", -16, 16);
      const played = await ppro.SourceMonitor.play(speed);
      if (!played) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not confirm Source Monitor playback");
      return { playing: true, speed, outcome: "committed_unverified", verificationBoundary: "source_monitor_play_host_return" };
    }

    async function closeSourceMonitor(args) {
      assertObject(args); assertOnlyKeys(args, ["all", "operationId"]);
      const all = optionalBoolean(args.all, false, "all");
      const closed = all ? await ppro.SourceMonitor.closeAllClips() : await ppro.SourceMonitor.closeClip();
      if (!closed) throw commandError("UXP_VERIFICATION_FAILED", "Premiere did not confirm closing Source Monitor media");
      let state = null;
      try { state = await sourceMonitorState({}); } catch (_) {}
      const verified = !!state && state.open === false;
      return {
        closed: true, all, outcome: verified ? "verified" : "committed_unverified", state,
        verificationBoundary: verified ? "source_monitor_state_readback" : "source_monitor_close_host_return"
      };
    }

    function scratchTypeTable() {
      const constants = ppro.Constants && ppro.Constants.ScratchDiskFolderType || {};
      return {
        capture: constants.CAPTURE, audioPreview: constants.AUDIO_PREVIEW, videoPreview: constants.VIDEO_PREVIEW,
        autoSave: constants.AUTO_SAVE, ccLibraries: constants.CCL_LIBRARIES, capsuleMedia: constants.CAPSULE_MEDIA
      };
    }

    function scratchSnapshot(settings) {
      const result = {}, table = scratchTypeTable();
      for (const key of Object.keys(table)) {
        if (table[key] == null) continue;
        try { result[key] = settings.getScratchDiskPath(table[key]); } catch (_) { result[key] = null; }
      }
      return result;
    }

    async function storagePreflight(args) {
      assertObject(args); assertOnlyKeys(args, []);
      const project = await activeProject(false), scratch = await ppro.ProjectSettings.getScratchDiskSettings(project);
      const ingest = await ingestSnapshot(project);
      let production = { apiAvailable: false, active: false, scratchDisks: null };
      if (ppro.PRProduction && typeof ppro.PRProduction.getActiveProduction === "function") {
        production.apiAvailable = true;
        try {
          const active = ppro.PRProduction.getActiveProduction();
          if (active) production = { apiAvailable: true, active: true, scratchDisks: scratchSnapshot(await active.getScratchDiskSettings()) };
        } catch (_) {}
      }
      return { project: { scratchDisks: scratchSnapshot(scratch), ingestEnabled: ingest.enabled }, production };
    }

    async function configureScratch(args) {
      assertObject(args); assertOnlyKeys(args, ["folderTypes", "destination", "operationId"]);
      const table = scratchTypeTable(), folderTypes = boundedEnumArray(args.folderTypes, "folderTypes", Object.keys(table), 6);
      const destination = enumValue(args.destination, "destination", ["sameAsProject", "myDocuments"]);
      const destinations = ppro.Constants && ppro.Constants.ScratchDiskFolder || {};
      const destinationValue = destination === "sameAsProject" ? destinations.SAME_AS_PROJECT : destinations.MY_DOCUMENTS;
      if (destinationValue == null) throw commandError("UXP_COMMAND_UNAVAILABLE", "Scratch disk destination constants are unavailable");
      const project = await activeProject(true), settings = await ppro.ProjectSettings.getScratchDiskSettings(project);
      const before = scratchSnapshot(settings);
      for (const key of folderTypes) {
        if (table[key] == null || settings.setScratchDiskPath(table[key], destinationValue) !== true) {
          throw commandError("UXP_ACTION_REJECTED", "Premiere rejected scratch disk folder type " + key);
        }
      }
      let committed = false;
      project.lockedAccess(() => {
        const action = ppro.ProjectSettings.createSetScratchDiskSettingsAction(project, settings);
        committed = project.executeTransaction((compoundAction) => {
          if (!action || compoundAction.addAction(action) === false) throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the scratch disk settings action");
        }, "Configure scratch disks");
      });
      assertCommitted(committed, "scratch disk update");
      const afterSettings = await ppro.ProjectSettings.getScratchDiskSettings(project), after = scratchSnapshot(afterSettings);
      return {
        configured: true, outcome: "committed_unverified", folderTypes, destination, before, after,
        verificationBoundary: "scratch_disk_settings_readback",
        operation: operationSemantics({
          mutatesProject: true, verificationStatus: "not_verified", verificationBoundary: "scratch_disk_settings_readback",
          verificationEvidence: [{ type: "scratch_disk_snapshot", folderTypes, destination }], undoSupported: true,
          undoLabel: "Configure scratch disks", transactionActionGroup: true, cancellationSupported: true
        })
      };
    }

    async function workspaceStatus(args) {
      assertObject(args); assertOnlyKeys(args, []);
      if (!workspace || typeof workspace.status !== "function") return { configured: false, accessMode: "unavailable", rootName: null, persistent: false, pathDisclosure: "redacted" };
      return workspace.status();
    }

    async function allowedPath(value, label, kind) {
      const path = boundedString(value, label, 4096);
      return workspace && typeof workspace.assertPathAllowed === "function"
        ? await workspace.assertPathAllowed(path, { label, kind })
        : path;
    }

    function operationSemantics(options) {
      return Protocol && typeof Protocol.operationSemantics === "function" ? Protocol.operationSemantics(options) : undefined;
    }

    function mutationResult(verified, values, boundary, undoLabel) {
      return {
        ...values, outcome: verified ? "verified" : "committed_unverified", verified,
        verificationBoundary: boundary,
        operation: operationSemantics({
          mutatesProject: true, verificationStatus: verified ? "verified" : "not_verified", verificationBoundary: boundary,
          verificationEvidence: [{ type: boundary, verified }], undoSupported: true, undoLabel,
          transactionActionGroup: true, cancellationSupported: true
        })
      };
    }

    function assertCommitted(committed, operation) {
      if (!committed) throw commandError("UXP_TRANSACTION_FAILED", "Premiere did not commit the " + operation + " transaction");
    }

    function canInspectProject() { return !!(ppro.Project && typeof ppro.Project.getActiveProject === "function"); }
    function canUseClipItems() { return canInspectProject() && !!(ppro.ClipProjectItem && typeof ppro.ClipProjectItem.cast === "function"); }
    function canUseVideoEffects() { return !!(ppro.VideoFilterFactory && typeof ppro.VideoFilterFactory.createComponent === "function" && typeof ppro.VideoFilterFactory.getMatchNames === "function"); }
    function canUseAudioEffects() { return !!(ppro.AudioFilterFactory && typeof ppro.AudioFilterFactory.createComponentByDisplayName === "function" && typeof ppro.AudioFilterFactory.getDisplayNames === "function"); }
    function canUseEffects() { return canInspectProject() && (canUseVideoEffects() || canUseAudioEffects()); }
    function canUseSelection() { return canInspectProject() && !!(ppro.Constants && ppro.Constants.TrackItemType); }
    async function canManageSelection() {
      if (!canUseSelection() || !ppro.TrackItemSelection || typeof ppro.TrackItemSelection.createEmptySelection !== "function") return false;
      try {
        const project = await ppro.Project.getActiveProject(), sequence = project && await project.getActiveSequence();
        return !!(sequence && typeof sequence.getSelection === "function" &&
          typeof sequence.setSelection === "function" && typeof sequence.clearSelection === "function");
      } catch (_) { return false; }
    }
    function canUseEffectsSelection() { return canUseEffects() && canUseSelection(); }
    function canDetectScenes() { return canUseSelection() && !!(ppro.SequenceUtils && typeof ppro.SequenceUtils.performSceneEditDetectionOnSelection === "function"); }
    function canAttachProxy() { return canUseClipItems(); }
    function canRelink() { return canUseClipItems(); }
    function canUseProjectSettings() { return canInspectProject() && !!(ppro.ProjectSettings && typeof ppro.ProjectSettings.getScratchDiskSettings === "function"); }
    function canUseIngest() { return canInspectProject() && !!(ppro.ProjectSettings && typeof ppro.ProjectSettings.getIngestSettings === "function" && typeof ppro.ProjectSettings.createSetIngestSettingsAction === "function"); }
    function canUseMetadata() { return canUseClipItems() && !!(ppro.Metadata && typeof ppro.Metadata.getProjectMetadata === "function" && typeof ppro.Metadata.getXMPMetadata === "function" && typeof ppro.Metadata.createSetProjectMetadataAction === "function" && typeof ppro.Metadata.createSetXMPMetadataAction === "function"); }
    function canInspectColor() { return canUseClipItems(); }
    function canConformFootage() { return canUseClipItems(); }
    function canInspectSourceMonitor() {
      return !!(ppro.SourceMonitor && typeof ppro.SourceMonitor.getPosition === "function" && typeof ppro.SourceMonitor.getProjectItem === "function");
    }
    function canOpenSourceMonitor() {
      return !!(ppro.SourceMonitor && typeof ppro.SourceMonitor.getProjectItem === "function" &&
        typeof ppro.SourceMonitor.openProjectItem === "function" && typeof ppro.SourceMonitor.openFilePath === "function");
    }
    function canPlaySourceMonitor() { return !!(ppro.SourceMonitor && typeof ppro.SourceMonitor.play === "function"); }
    function canCloseSourceMonitor() {
      return !!(ppro.SourceMonitor && typeof ppro.SourceMonitor.closeClip === "function" && typeof ppro.SourceMonitor.closeAllClips === "function");
    }
    function canConfigureScratch() { return canUseProjectSettings() && typeof ppro.ProjectSettings.createSetScratchDiskSettingsAction === "function"; }
    function canReportWorkspace() { return !!(workspace && typeof workspace.status === "function"); }

    return definitions;
  }

  function validateTrackTarget(args, allowedKeys) {
    assertObject(args); assertOnlyKeys(args, allowedKeys.concat(["operationId"]));
    return {
      mediaType: enumValue(args.mediaType, "mediaType", ["video", "audio"]),
      trackIndex: nonNegativeInt(args.trackIndex, "trackIndex"), clipIndex: nonNegativeInt(args.clipIndex, "clipIndex")
    };
  }

  function validateEffectAdd(args, selection) {
    const keys = selection ? ["mediaType", "effectId", "insertionIndex", "operationId"] : ["mediaType", "trackIndex", "clipIndex", "effectId", "insertionIndex", "operationId"];
    const target = selection ? (assertObject(args), assertOnlyKeys(args, keys), { mediaType: enumValue(args.mediaType, "mediaType", ["video", "audio"]) }) : validateTrackTarget(args, keys.filter((key) => key !== "operationId"));
    target.effectId = boundedString(args.effectId, "effectId", 256);
    target.insertionIndex = args.insertionIndex == null ? null : nonNegativeInt(args.insertionIndex, "insertionIndex");
    return target;
  }

  function validateEffectRemove(args, selection) {
    const keys = selection ? ["mediaType", "componentIndex", "expectedEffectId", "operationId"] : ["mediaType", "trackIndex", "clipIndex", "componentIndex", "expectedEffectId", "operationId"];
    const target = selection ? (assertObject(args), assertOnlyKeys(args, keys), { mediaType: enumValue(args.mediaType, "mediaType", ["video", "audio"]) }) : validateTrackTarget(args, keys.filter((key) => key !== "operationId"));
    target.componentIndex = nonNegativeInt(args.componentIndex, "componentIndex");
    target.expectedEffectId = boundedString(args.expectedEffectId, "expectedEffectId", 256);
    return target;
  }

  function validateSelectionUpdateArgs(args) {
    assertObject(args);
    assertOnlyKeys(args, ["mode", "expectedSequenceGuid", "items", "operationId"]);
    const mode = enumValue(args.mode, "mode", ["replace", "add", "remove", "clear"]);
    const expectedSequenceGuid = boundedString(args.expectedSequenceGuid, "expectedSequenceGuid", 512);
    if (mode === "clear") {
      if (args.items != null) throw commandError("UXP_INVALID_ARGUMENT", "items must be omitted when mode is clear");
      return { mode, expectedSequenceGuid, items: [] };
    }
    if (!Array.isArray(args.items) || !args.items.length || args.items.length > MAX_SELECTION_ITEMS) {
      throw commandError("UXP_INVALID_ARGUMENT", "items must contain 1-" + MAX_SELECTION_ITEMS + " timeline targets");
    }
    const coordinates = new Set(), items = args.items.map((raw, index) => {
      assertObject(raw);
      assertOnlyKeys(raw, [
        "mediaType", "trackIndex", "clipIndex", "expectedProjectItemId",
        "expectedStartSeconds", "expectedEndSeconds"
      ]);
      const item = {
        mediaType: enumValue(raw.mediaType, "items[" + index + "].mediaType", ["video", "audio"]),
        trackIndex: nonNegativeInt(raw.trackIndex, "items[" + index + "].trackIndex"),
        clipIndex: nonNegativeInt(raw.clipIndex, "items[" + index + "].clipIndex"),
        expectedProjectItemId: boundedString(raw.expectedProjectItemId, "items[" + index + "].expectedProjectItemId", 512),
        expectedStartSeconds: finiteNumber(raw.expectedStartSeconds, "items[" + index + "].expectedStartSeconds", 0, Number.MAX_SAFE_INTEGER),
        expectedEndSeconds: finiteNumber(raw.expectedEndSeconds, "items[" + index + "].expectedEndSeconds", 0, Number.MAX_SAFE_INTEGER)
      };
      if (item.expectedEndSeconds < item.expectedStartSeconds) {
        throw commandError("UXP_INVALID_ARGUMENT", "items[" + index + "].expectedEndSeconds must not be before expectedStartSeconds");
      }
      const coordinate = item.mediaType + ":" + item.trackIndex + ":" + item.clipIndex;
      if (coordinates.has(coordinate)) throw commandError("UXP_INVALID_ARGUMENT", "items must not contain duplicate timeline coordinates");
      coordinates.add(coordinate);
      return item;
    });
    return { mode, expectedSequenceGuid, items };
  }

  function validateSelectionTargetInspectionArgs(args) {
    assertObject(args);
    assertOnlyKeys(args, ["items"]);
    if (!Array.isArray(args.items) || !args.items.length || args.items.length > MAX_SELECTION_ITEMS) {
      throw commandError("UXP_INVALID_ARGUMENT", "items must contain 1-" + MAX_SELECTION_ITEMS + " timeline targets");
    }
    const coordinates = new Set();
    return args.items.map((raw, index) => {
      assertObject(raw);
      assertOnlyKeys(raw, ["mediaType", "trackIndex", "clipIndex"]);
      const item = {
        mediaType: enumValue(raw.mediaType, "items[" + index + "].mediaType", ["video", "audio"]),
        trackIndex: nonNegativeInt(raw.trackIndex, "items[" + index + "].trackIndex"),
        clipIndex: nonNegativeInt(raw.clipIndex, "items[" + index + "].clipIndex")
      };
      const coordinate = item.mediaType + ":" + item.trackIndex + ":" + item.clipIndex;
      if (coordinates.has(coordinate)) throw commandError("UXP_INVALID_ARGUMENT", "items must not contain duplicate timeline coordinates");
      coordinates.add(coordinate);
      return item;
    });
  }

  function validateProjectItemTarget(args) {
    const hasId = args.projectItemId != null, hasName = args.projectItemName != null;
    if (hasId && hasName) throw commandError("UXP_INVALID_ARGUMENT", "Pass either projectItemId or projectItemName, not both");
    const result = {};
    if (hasId) result.projectItemId = boundedString(args.projectItemId, "projectItemId", 512);
    if (hasName) result.projectItemName = boundedString(args.projectItemName, "projectItemName", 255);
    return result;
  }

  function validateUpdatedFields(value, required) {
    if (!required && value == null) return [];
    if (!Array.isArray(value) || !value.length || value.length > 128) throw commandError("UXP_INVALID_ARGUMENT", "updatedFields must contain 1-128 metadata field names");
    const fields = value.map((item, index) => boundedString(item, "updatedFields[" + index + "]", 512));
    if (new Set(fields).size !== fields.length) throw commandError("UXP_INVALID_ARGUMENT", "updatedFields must not contain duplicates");
    return fields;
  }

  function validateConformanceArgs(args) {
    assertObject(args);
    const keys = [
      "projectItemId", "projectItemName", "frameRate", "pixelAspectRatio", "fieldType", "removePullDown",
      "alphaUsage", "ignoreAlpha", "invertAlpha", "vrConform", "vrLayout", "vrHorzView", "vrVertView", "inputLutId", "operationId"
    ];
    assertOnlyKeys(args, keys);
    const result = validateProjectItemTarget(args), numericEnums = ["fieldType", "alphaUsage", "vrConform", "vrLayout"];
    if (args.frameRate != null) result.frameRate = finiteNumber(args.frameRate, "frameRate", 1, 240);
    if (args.pixelAspectRatio != null) result.pixelAspectRatio = finiteNumber(args.pixelAspectRatio, "pixelAspectRatio", 0.01, 100);
    for (const key of numericEnums) if (args[key] != null) result[key] = boundedInt(args[key], key, 0, 64);
    for (const key of ["removePullDown", "ignoreAlpha", "invertAlpha"]) if (args[key] != null) result[key] = requiredBoolean(args[key], key);
    if (args.vrHorzView != null) result.vrHorzView = finiteNumber(args.vrHorzView, "vrHorzView", 1, 360);
    if (args.vrVertView != null) result.vrVertView = finiteNumber(args.vrVertView, "vrVertView", 1, 180);
    if (args.inputLutId != null) result.inputLutId = boundedStringAllowEmpty(args.inputLutId, "inputLutId", 512);
    if (!Object.keys(result).some((key) => key !== "projectItemId" && key !== "projectItemName")) throw commandError("UXP_INVALID_ARGUMENT", "At least one conformance field is required");
    return result;
  }

  function assertObject(value) { if (!value || typeof value !== "object" || Array.isArray(value)) throw commandError("UXP_INVALID_ARGUMENT", "args must be an object"); }
  function assertOnlyKeys(value, allowed) { const unknown = Object.keys(value).filter((key) => !allowed.includes(key)); if (unknown.length) throw commandError("UXP_INVALID_ARGUMENT", "Unknown argument: " + unknown[0]); }
  function boundedString(value, name, maximum) { if (typeof value !== "string" || !value.trim() || value.length > maximum) throw commandError("UXP_INVALID_ARGUMENT", name + " must be a non-empty string of at most " + maximum + " characters"); return value; }
  function boundedStringAllowEmpty(value, name, maximum) { if (typeof value !== "string" || value.length > maximum) throw commandError("UXP_INVALID_ARGUMENT", name + " must be a string of at most " + maximum + " characters"); return value; }
  function nonNegativeInt(value, name) { if (!Number.isInteger(value) || value < 0) throw commandError("UXP_INVALID_ARGUMENT", name + " must be a non-negative integer"); return value; }
  function boundedInt(value, name, minimum, maximum) { if (!Number.isInteger(value) || value < minimum || value > maximum) throw commandError("UXP_INVALID_ARGUMENT", name + " must be an integer from " + minimum + " to " + maximum); return value; }
  function finiteNumber(value, name, minimum, maximum) { const number = Number(value); if (!Number.isFinite(number) || number < minimum || number > maximum) throw commandError("UXP_INVALID_ARGUMENT", name + " must be from " + minimum + " to " + maximum); return number; }
  function requiredBoolean(value, name) { if (typeof value !== "boolean") throw commandError("UXP_INVALID_ARGUMENT", name + " must be a boolean"); return value; }
  function optionalBoolean(value, fallback, name) { return value == null ? fallback : requiredBoolean(value, name); }
  function enumValue(value, name, allowed) { if (!allowed.includes(value)) throw commandError("UXP_INVALID_ARGUMENT", name + " must be one of " + allowed.join(", ")); return value; }
  function boundedEnumArray(value, name, allowed, maximum) {
    if (!Array.isArray(value) || !value.length || value.length > maximum) throw commandError("UXP_INVALID_ARGUMENT", name + " must contain 1-" + maximum + " values");
    const result = value.map((item, index) => enumValue(item, name + "[" + index + "]", allowed));
    if (new Set(result).size !== result.length) throw commandError("UXP_INVALID_ARGUMENT", name + " must not contain duplicates");
    return result;
  }
  function requireConfirmation(value, message) { if (value !== true) throw commandError("UXP_CONFIRMATION_REQUIRED", message + "; pass confirmNonUndoable=true after review"); }
  function tickSeconds(value) { const seconds = value && Number(value.seconds); return Number.isFinite(seconds) ? seconds : null; }
  function pathEqual(left, right) {
    if (typeof left !== "string" || typeof right !== "string") return false;
    const normalizedLeft = left.replace(/\\/g, "/").replace(/\/$/, "");
    const normalizedRight = right.replace(/\\/g, "/").replace(/\/$/, "");
    const windowsPaths = /^(?:[A-Za-z]:\/|\/\/)/.test(normalizedLeft) && /^(?:[A-Za-z]:\/|\/\/)/.test(normalizedRight);
    return windowsPaths ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase() : normalizedLeft === normalizedRight;
  }
  function valuesEqual(left, right) { return typeof right === "number" ? typeof left === "number" && Math.abs(left - right) < 0.000001 : left === right; }
  function commandError(code, message) { const error = new Error(message); error.code = code; return error; }

  return { createWorkflowDefinitions, commandError };
});
