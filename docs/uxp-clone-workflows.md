# Guarded append-only track-item duplicates through stable UXP

`duplicate_track_item_uxp` is a bounded documented-UXP counterpart to a
timeline duplicate. It intentionally appends one duplicate after the final
clip item on the requested audio or video track; it does not offer a general
copy/paste surface.

## Authority and API boundary

The implementation uses stable Premiere UXP 25.6+ `SequenceEditor.getEditor()`
and `createCloneTrackItemAction()`, `TickTime.createWithSeconds()`, audio/video
TrackItem timing and source-item getters, plus `Project.lockedAccess()` and
`Project.executeTransaction()`. It does not use CEP, QE, raw evaluation, UI
automation, or a native SDK.

## Guarded flow

1. Call `action: "inspect"` with one bounded media type, track index, and final
   clip index. The command returns the active project/sequence identities, the
   complete source timing and source-project-item snapshot, and the clip count.
2. Call `action: "apply"` with that unchanged snapshot,
   `confirm_duplicate: true`, and a required `operation_id`.
3. The panel serializes duplicate requests with guarded slips and slides for the
   project/sequence/media-track key. Inside that lock it re-resolves the target,
   rejects every stale snapshot field, and makes exactly one documented clone
   action inside one locked undoable transaction.
4. It reads only the original coordinate and its deterministic successor, then
   verifies unchanged source data, one additional clip, the copied source item,
   and the appended timing range.

The source must be a positive-duration final clip item, have matching timeline
duration, and fit after itself within the documented 0–86,400 second bound. No
existing item can be overwritten because this public surface does not accept a
target time or vertical offset. It neither discovers media handles nor clones a
linked A/V pair.

## Proof boundary

Automated tests exercise closed schemas, stale/non-final rejection, operation-ID
replay, lock serialization, one-action transaction composition, and targeted
post-readback. They are mock/static contract evidence only. No licensed Premiere
host has validated media handles, linked A/V synchronization, rendered frames,
playback, persistence after reopening, or Undo. A verification failure can occur
after the host transaction commits; inspect the original and appended items
before another edit.
