# Guarded track-item slides through stable UXP

`slide_track_item_uxp` is a bounded documented-UXP composition for a familiar
three-item timeline slide: it moves the center clip while trimming only its
immediate same-track neighbours to retain both adjacent cuts.

## Authority and API boundary

The implementation uses stable Premiere UXP 25.6+ audio/video TrackItem timing
getters; `createMoveAction`, `createSetStartAction`, `createSetEndAction`,
`createSetInPointAction`, and `createSetOutPointAction`; plus
`Project.lockedAccess` and `Project.executeTransaction`. It does not use CEP,
QE, raw evaluation, UI automation, or a native SDK.

## Guarded flow

1. Call `action: "inspect"` for a bounded media type, track index, and center
   clip index. The command returns the active project/sequence IDs and complete
   timing/source/speed snapshots for the previous, center, and following clips.
2. Call `action: "apply"` with that unchanged complete snapshot,
   `confirm_slide: true`, a non-zero `slide_by_seconds` in -60 through 60, and
   a required `operation_id`.
3. The panel serializes slides and source-only slips per project/sequence/media
   track. It re-resolves the complete triplet after entering that tail, rejects
   every stale field, then creates five documented actions in one transaction:
   center move, previous timeline/source extension, and following
   timeline/source trim.
4. It resolves the same coordinates again and verifies each source/timeline
   endpoint, duration, speed, reverse state, and both contiguous cuts.

Only immediate contiguous forward 1x clip items whose source and timeline
durations agree are supported. The requested slide must leave both neighbours
with positive source and timeline durations within the documented 0–86,400
second bound. The command neither discovers source handles nor changes clips on
other tracks.

## Proof boundary

Automated tests exercise closed schemas, complete-triplet stale checks,
same-operation replay, one-transaction action composition, post-readback, and
deterministic serialization against a concurrent slip. They are mock/static
contract evidence only. No licensed Premiere host has validated media handles,
linked A/V synchronization, rendered frames, playback, persistence after
reopening, or Undo. A verification failure can occur after the host transaction
commits; inspect all three items before another edit.
