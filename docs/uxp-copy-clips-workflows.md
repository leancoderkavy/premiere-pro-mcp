# Copying clips between sequences through stable UXP

`copy_clips_between_sequences_uxp` copies every clip in a time range of one
sequence into another sequence, or to another place in the same sequence, the
way an editor's copy and paste does: each clip is cloned with
`SequenceEditor.createCloneTrackItemAction()`, so the copy keeps its effects,
keyframes, enabled state and source range.

## Why a UXP route

ExtendScript has no way to copy a timeline clip between sequences. The CEP
tools can only re-place a clip from its project item with `Track.overwriteClip`,
which drops everything applied to the clip on the timeline (Motion, Opacity,
Lumetri including curves and LUTs, other effects, keyframes). Some of that data
is not even readable from ExtendScript, so it cannot be copied across
afterwards.

A UXP clone takes the source track item itself. A track item from one sequence
can be cloned into another sequence's editor at a chosen time, and the clone
keeps what the original had.

## Guarded flow

1. Call `action: "inspect"` with the source and destination sequence GUIDs, the
   source range and the destination start. Each time is given either in ticks
   or in seconds; seconds snap to the nearest frame of the sequence they are
   measured on, so a range edge never splits a frame. Choose which source
   tracks to copy (default: every track of each media type) and an optional
   track offset per media type. The relative layout of the clips is kept.
2. The panel plans one placement per clip that overlaps the range. A clip wholly
   inside the range is cloned straight to its destination. A clip that crosses
   an edge is planned with a head or tail trim to the range. Inspect returns the
   plan: every clip's media type, source track and clip index, destination
   track, project item, tick-exact start and end, source in and out, trim, and
   enabled state.
3. Inspect refuses, changing nothing, when a source or destination track does
   not exist, when the range holds no clips on the chosen tracks, when a
   planned time is off the frame grid or the two sequences have different
   frame rates (Premiere snaps a clone to the destination's grid, so a copy
   between rates would drift), when a clip that crosses a range edge is
   retimed or reversed (its trim could not be planned exactly; widen the range
   to take it whole), when a destination start would place a clip before zero,
   and when any destination range is occupied by another clip. Nothing is ever
   overwritten.
4. Call `action: "apply"` with that unchanged plan, `confirm_copy: true` and a
   required `operation_id`. The panel recomputes the plan and rejects any
   difference. Inside one `Project.lockedAccess()` it builds a clone action per
   clip and commits them in one `executeTransaction()`. Whole clips land at
   their destination. Clips that need a trim are cloned whole to a parking spot
   past the last clip on every destination track the copy touches, so their
   untrimmed length cannot overwrite a neighbour.
5. If any clip was parked, two more transactions follow: one trims every parked
   clone to the range with `createSetStartAction()` and `createSetEndAction()`
   (each is a full edge trim that moves the timeline edge and the source point
   together; on Premiere 26.0.2 `createSetInPointAction()` and
   `createSetOutPointAction()` do the same thing again, so only one action per
   edge is used), and one moves each trimmed clone into place with
   `createMoveAction()`. The result's `undo_steps` says how many Premiere Undos
   remove the copy: one for a copy with no trims, three otherwise.
6. It reads back every copy (project item, exact start and end ticks, source
   in/out, enabled state) and checks that no clone was left at its parking
   position. A readback mismatch after a committed transaction is reported as
   `committed_unverified` with the undo count, not success.

Transitions and the link between a clip's picture and sound are not copied.

## Proof boundary

Automated tests exercise the plan, whole-clip and edge-trimmed copies, track
offsets, same-sequence copies, frame snapping of seconds, every refusal, the
confirmation and operation-ID requirements, stale-plan rejection, and both
readback failures (a mismatched copy and a clone left parked), against a mocked
host whose trim actions model the measured edge-trim semantics.

The same panel module was also run against Premiere Pro 26.0.2 on macOS
through a side-loaded test panel. A 12-second range of a podcast multicamera
backup sequence (six clips across three camera tracks, a screen-recording
insert and two audio tracks, every one of them crossing a range edge and so
trimmed) was copied into another sequence of the same project: the result read
back as verified with six clips copied, six trimmed and three undo steps, and
five frames exported from the copy matched the same moments of the source with
a mean pixel difference of 0.000/255 on every channel. That run did not go
through the authenticated bridge transport, and rendering of every frame,
playback, Undo, and persistence after reopening were not checked.
