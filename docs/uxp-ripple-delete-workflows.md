# Guarded contiguous track-item ripple delete through stable UXP

`ripple_delete_track_item_uxp` is a narrow documented-UXP counterpart to the
pinned antipaster `ripple_delete` competitor command. It deletes exactly one
audio or video clip item only when its immediate following same-track clip is
contiguous, allowing a bounded successor readback to prove the closed cut.

## Authority and API boundary

The implementation uses stable Premiere UXP 25.6+ `SequenceEditor.getEditor()`
and `createRemoveItemsAction()`, `TrackItemSelection.createEmptySelection()`
and `addItem()`, the documented `Constants.MediaType` values, audio/video
TrackItem timing and source-item getters, and `Project.lockedAccess()` plus
`Project.executeTransaction()`. It does not use CEP, QE, raw evaluation, UI
automation, or a native SDK.

## Guarded flow

1. Call `action: "inspect"` with one bounded media type, track index, and clip
   index. The command returns the active project/sequence identities, count,
   and complete target and immediate-successor snapshots.
2. Call `action: "apply"` with that unchanged snapshot,
   `confirm_ripple_delete: true`, and a required `operation_id`.
3. The panel serializes requests with guarded slips, slides, and append
   duplicates for the project/sequence/media-track key. Within that lock it
   re-resolves both coordinates, rejects any stale snapshot or changed
   successor, creates exactly one single-item selection and documented remove
   action with `ripple: true`, then commits one locked undoable transaction.
4. It reads only the successor at the removed coordinate, confirms the track
   count decreased by one, and confirms that successor retained its source
   identity/data while its timeline range shifted left by the deleted item's
   timeline duration.

The selected item and successor must both have positive duration and meet at
one exact cut. This command refuses final items, gaps, another track, or a
linked A/V pair. It has no general selection, range, or cross-track ripple
surface.

## Proof boundary

Automated tests cover closed schemas, missing authority, stale/final/gap
rejection, replay, per-track serialization, one action inside one transaction,
and a poisoned unrelated-item getter proving preflight and post-readback stay
bounded to the target/successor. They are mock/static contract evidence only.
No licensed Premiere host has validated media handles, linked A/V
synchronization, rendered frames, playback, persistence after reopening, or
Undo. A verification failure can occur after the host transaction commits;
inspect the affected successor before another edit.
