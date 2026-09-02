# Guarded track-item slips through stable UXP

`slip_track_item_uxp` adds the documented source-only operation that maps to a
timeline slip: it offsets one audio or video item’s source in and out points
without moving that item’s sequence start or end.

## Authority and API boundary

The implementation is a stable Premiere UXP 25.6+ composition of
`AudioClipTrackItem`/`VideoClipTrackItem` timing getters,
`createSetInPointAction`, `createSetOutPointAction`, `Project.lockedAccess`,
and `Project.executeTransaction`. It does not use CEP, QE, raw evaluation, UI
automation, or a native SDK.

## Guarded flow

1. Call `action: "inspect"` with a bounded media type, track index, and clip
   index. The result includes the active project and sequence IDs, coordinates,
   timeline start/end/duration, source in/out/duration, speed, and reverse
   state.
2. Call `action: "apply"` with that complete snapshot,
   `confirm_slip: true`, a non-zero `slip_by_seconds` between -60 and 60, and
   a required `operation_id`.
3. The bridge serializes slips per project/sequence/track-item coordinate. It
   rereads the full target after entering that tail, rejects any stale field,
   then adds exactly the source-in and source-out actions to one transaction.
4. It resolves the target by coordinate again and verifies its project,
   sequence, coordinates, timeline start/end/duration, source duration, speed,
   reverse state, and exact shifted source points.

Only forward 1x items whose source and timeline durations agree are supported.
The command rejects a negative source in point and any requested source time
outside the documented 0–86,400 second bound. Premiere does not expose a
documented source-handle maximum through this target, so an out-point beyond
available media can still be rejected or normalized by the host; the final
readback then fails rather than claiming success.

## Proof boundary

Automated tests exercise the schema, stale checks, same-operation replay,
one-transaction composition, and deterministic different-operation-ID
serialization. They are mocked/static proof only. No licensed Premiere host has
validated the operation, its rendered frames, A/V link synchronization,
persistence after reopening, or Undo behavior. A readback failure can occur
after the host transaction commits; inspect the target before another edit.
