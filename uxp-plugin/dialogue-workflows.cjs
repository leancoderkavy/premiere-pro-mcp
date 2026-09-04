(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpDialogueWorkflows = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function createDialogueWorkflowDefinitions(deps) {
    const ppro = deps.ppro;
    return { "dialogue.deriveSequence": { destructive: true, undoable: false, idempotent: true, targetCapabilityProbe: true, minHostVersion: "26.3.0", probe: canDerive, handler: derive } };

    function canDerive() { return !!(ppro.Project && ppro.Project.getActiveProject && ppro.SequenceEditor && ppro.SequenceEditor.getEditor && ppro.TickTime && ppro.TickTime.createWithSeconds && ppro.ClipProjectItem && ppro.ClipProjectItem.cast); }
    async function derive(args) {
      only(args, ["plan", "operationId"]); text(args.operationId, "operationId", 128, /^[A-Za-z0-9._:-]+$/);
      const plan = validate(args.plan), project = await ppro.Project.getActiveProject();
      if (!project) fail("UXP_NO_ACTIVE_PROJECT", "No active project");
      if (!project.lockedAccess || !project.executeTransaction || !project.createSequenceFromMedia) fail("UXP_COMMAND_UNAVAILABLE", "Required sequence and Action APIs are unavailable");
      if (await id(project) !== plan.project_guid) fail("UXP_STALE_PROJECT", "The active project changed after preview");
      const items = new Map();
      for (const segment of plan.segments) items.set(segment.source_project_item_id, await find(project, segment.source_project_item_id));
      if (plan.master_audio_project_item_id) items.set(plan.master_audio_project_item_id, await find(project, plan.master_audio_project_item_id));
      for (const [itemId, item] of items) { const clip = asClip(item, itemId); if (clip.isMulticamClip && await clip.isMulticamClip()) fail("UXP_UNSUPPORTED_MULTICAM", "Native multicam sources are unsupported; use reviewed ordinary sources"); if (!clip.createSubClipAction) fail("UXP_COMMAND_UNAVAILABLE", "Source cannot create subclips: " + itemId); }
      const sequencesBefore = await sequences(project);
      if (sequencesBefore.some(function (entry) { return entry.name === plan.sequence_name; })) fail("UXP_NAME_CONFLICT", "The reviewed sequence name already exists");
      const target = plan.target_bin_id ? asFolder(await find(project, plan.target_bin_id), "target_bin_id") : undefined;
      const parents = new Map(), beforeIds = new Set();
      for (const [itemId, item] of items) {
        const parent = asFolder(await asClip(item, itemId).getParentBin(), "source parent");
        const parentId = await id(parent); parents.set(parentId || itemId, parent);
      }
      for (const parent of parents.values()) for (const item of Array.from(await parent.getItems() || [])) beforeIds.add(await id(item));
      const prefix = plan.sequence_name + " Segment"; let attempted = false;
      try {
        project.lockedAccess(function () {
          const actions = [];
          plan.segments.forEach(function (segment, index) {
            actions.push(asClip(items.get(segment.source_project_item_id), "source").createSubClipAction(prefix + " V" + (index + 1), tick(segment.source_start_seconds), tick(segment.source_end_seconds), true, plan.mode === "podcast" ? { takeVideo: true, takeAudio: false } : { takeVideo: true, takeAudio: true }));
            if (plan.mode === "podcast") actions.push(asClip(items.get(plan.master_audio_project_item_id), "master audio").createSubClipAction(prefix + " A" + (index + 1), tick(segment.master_audio_start_seconds), tick(segment.master_audio_end_seconds), true, { takeVideo: false, takeAudio: true }));
          });
          attempted = true; commit(project, "Create reviewed dialogue subclips", actions);
        });
      } catch (error) { if (!attempted) throw error; return partial("dialogue_subclip_transaction_receipt", [], null, []); }
      const added = []; for (const parent of parents.values()) for (const item of Array.from(await parent.getItems() || [])) if (!beforeIds.has(await id(item))) added.push(item);
      const videos = [], audios = [];
      for (let i = 0; i < plan.segments.length; i++) { videos.push(added.find(function (x) { return String(x.name || "") === prefix + " V" + (i + 1); })); if (plan.mode === "podcast") audios.push(added.find(function (x) { return String(x.name || "") === prefix + " A" + (i + 1); })); }
      if (videos.some(function (x) { return !x; }) || audios.some(function (x) { return !x; })) return partial("dialogue_subclip_identity_readback", added, null, []);
      let sequence; try { sequence = await project.createSequenceFromMedia(plan.sequence_name, [videos[0]], target); } catch (_) { sequence = await addedSequence(project, sequencesBefore); }
      if (!sequence) return partial("dialogue_sequence_host_return", added, null, []);
      const inserted = [await id(videos[0])];
      try {
        const editor = ppro.SequenceEditor.getEditor(sequence); if (!editor || !editor.createInsertProjectItemAction) throw new Error("SequenceEditor unavailable");
        let offset = 0;
        for (let i = 0; i < plan.segments.length; i++) {
          if (i) { project.lockedAccess(function () { commit(project, "Insert reviewed dialogue video", [editor.createInsertProjectItemAction(videos[i], tick(offset), 0, 0, false)]); }); inserted.push(await id(videos[i])); }
          if (plan.mode === "podcast") { project.lockedAccess(function () { commit(project, "Insert reviewed dialogue audio", [editor.createInsertProjectItemAction(audios[i], tick(offset), 0, 0, false)]); }); inserted.push(await id(audios[i])); }
          offset += plan.segments[i].source_end_seconds - plan.segments[i].source_start_seconds;
        }
      } catch (_) { return partial("dialogue_sequence_partial_insert_receipt", added, sequence, inserted); }
      return receipt({ created: true, partial: false, sequence: await snap(sequence), createdSubclips: await snaps(videos.concat(audios)), insertedProjectItemIds: inserted, mode: plan.mode, outputDurationSeconds: plan.output_duration_seconds, originalSourcesChanged: false, renderVerified: false }, "dialogue_sequence_structure_unverified");
    }
    function validate(value) {
      only(value, ["schema_version", "project_guid", "mode", "sequence_name", "target_bin_id", "master_audio_project_item_id", "segments", "output_duration_seconds", "original_sources_unchanged", "render_verified"]);
      if (value.schema_version !== 1 || ["talking_head", "podcast"].indexOf(value.mode) < 0) fail("UXP_INVALID_ARGUMENT", "Unsupported dialogue plan");
      text(value.project_guid, "project_guid", 512); text(value.sequence_name, "sequence_name", 255);
      if (!Array.isArray(value.segments) || !value.segments.length || value.segments.length > 64) fail("UXP_INVALID_ARGUMENT", "segments must contain 1-64 entries");
      if (value.original_sources_unchanged !== true || value.render_verified !== false) fail("UXP_INVALID_ARGUMENT", "Original-source and render boundaries are invalid");
      if (value.mode === "podcast") text(value.master_audio_project_item_id, "master_audio_project_item_id", 512);
      value.segments.forEach(function (s, i) { only(s, ["id", "source_project_item_id", "transcript_revision", "source_start_seconds", "source_end_seconds", "speaker_label", "master_audio_start_seconds", "master_audio_end_seconds"]); text(s.id, "id", 128); text(s.source_project_item_id, "source_project_item_id", 512); const a = secs(s.source_start_seconds), b = secs(s.source_end_seconds); if (b <= a) fail("UXP_INVALID_ARGUMENT", "Segment " + i + " has no duration"); if (value.mode === "podcast") { const c = secs(s.master_audio_start_seconds), d = secs(s.master_audio_end_seconds); if (d <= c || Math.abs((d-c)-(b-a)) > .001) fail("UXP_INVALID_ARGUMENT", "Podcast audio mismatch at segment " + i); } });
      return value;
    }
    async function find(project, wanted) { const queue = [await project.getRootItem()]; let count = 0; while (queue.length) { const item = queue.shift(); if (++count > 4096) fail("UXP_PROJECT_TOO_LARGE", "Project search exceeded 4096 items"); if (await id(item) === wanted) return item; if (item && item.getItems) queue.push.apply(queue, Array.from(await item.getItems() || [])); } fail("UXP_PROJECT_ITEM_NOT_FOUND", "Project item not found: " + wanted); }
    async function sequences(project) { const out = []; for (const item of Array.from(await project.getSequences() || [])) out.push(await snap(item)); return out; }
    async function addedSequence(project, before) { const known = new Set(before.map(function (x) { return x.id; })); for (const item of Array.from(await project.getSequences() || [])) if (!known.has(await id(item))) return item; return null; }
    function commit(project, label, actions) {
      // Callers construct actions and invoke this helper inside lockedAccess.
      // eslint-disable-next-line @adobe/premierepro/prefer-locked-access-wrapper
      const ok = project.executeTransaction(function (compound) { actions.forEach(function (action) { if (!action || compound.addAction(action) === false) fail("UXP_ACTION_REJECTED", "Premiere rejected " + label); }); }, label);
      if (!ok) fail("UXP_TRANSACTION_FAILED", "Premiere did not commit " + label);
    }
    function asClip(item, name) { try { const cast = ppro.ClipProjectItem.cast(item); if (cast) return cast; } catch (_) {} fail("UXP_INVALID_PROJECT_ITEM", name + " is not a clip"); }
    function asFolder(item, name) { if (ppro.FolderItem && ppro.FolderItem.cast) try { const cast = ppro.FolderItem.cast(item); if (cast) return cast; } catch (_) {} if (item && item.getItems) return item; fail("UXP_INVALID_PROJECT_ITEM", name + " is not a folder"); }
    function tick(value) { return ppro.TickTime.createWithSeconds(secs(value)); }
    async function id(item) { if (!item) return ""; if (item.getId) return String(await item.getId()); if (item.getGuid) return String(await item.getGuid()); return ""; }
    async function snap(item) { return item ? { id: await id(item), name: String(item.name || "") } : null; }
    async function snaps(items) { const out = []; for (const item of items) out.push(await snap(item)); return out; }
    function partial(boundary, items, sequence, inserted) { return Promise.all([snaps(items), snap(sequence)]).then(function (x) { return receipt({ created: !!sequence, partial: true, createdSubclips: x[0], sequence: x[1], insertedProjectItemIds: inserted, originalSourcesChanged: false, renderVerified: false }, boundary); }); }
    function receipt(values, boundary) { return Object.assign({ outcome: "committed_unverified", verified: false, verificationBoundary: boundary }, values); }
    function only(value, keys) { if (!value || typeof value !== "object" || Array.isArray(value)) fail("UXP_INVALID_ARGUMENT", "Arguments must be an object"); Object.keys(value).forEach(function (key) { if (keys.indexOf(key) < 0) fail("UXP_INVALID_ARGUMENT", "Unexpected argument: " + key); }); }
    function text(value, name, max, pattern) { if (typeof value !== "string" || !value || value.length > max || (pattern && !pattern.test(value))) fail("UXP_INVALID_ARGUMENT", name + " is invalid"); return value; }
    function secs(value) { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 86400) fail("UXP_INVALID_ARGUMENT", "Time must be 0-86400 seconds"); return value; }
    function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
  }
  return { createDialogueWorkflowDefinitions: createDialogueWorkflowDefinitions };
});
