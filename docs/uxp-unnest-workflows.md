# Clone-based unnest through stable UXP

`unnest_sequence_uxp` replaces a nested sequence clip in the active sequence
with the nested sequence's own clips, at the same timeline positions, by
cloning them with `SequenceEditor.createCloneTrackItemAction()`.

## Why a UXP route

The legacy CEP `unnest_sequence` can only re-place each nested clip from its
project item with `Track.overwriteClip`. That loses everything applied to the
clip on the timeline (Motion, Opacity, Lumetri, other effects, keyframes), and
it refuses a nest dropped with both picture and sound. ExtendScript has no way
to copy a timeline clip between sequences, and some Lumetri data (curves) is
not readable there at all, so the CEP route cannot be made faithful by copying
parameter values afterwards.

A UXP clone takes the source track item itself. A track item from the nested
sequence can be cloned into the parent sequence's editor, and the clone keeps
its effects, keyframes, enabled state, and source range.

## Guarded flow

1. Call `action: "inspect"` with the media type, track index, and clip index of
   the nest clip (either half of a picture-and-sound nest). The panel resolves
   the nested sequence through `ClipProjectItem.isSequence()`/`getSequence()`,
   finds every clip of that nest at exactly the same position (at most one
   video and one audio reference), and returns the plan: the references, the
   tick offset from nested time to parent time, and every clone with its source
   track, destination track (reference track plus nested track index), project
   item, tick-exact start/end, source in/out, and enabled state.
2. Inspect refuses, changing nothing, when the nest is retimed or reversed,
   when its video and audio references play different ranges, when it is
   trimmed (it plays less than its content, so unnesting would change what
   plays), when two references of one media type share the position, when a
   destination track does not exist, or when any destination range is occupied
   by a clip other than the nest itself.
3. Call `action: "apply"` with that unchanged plan, `confirm_unnest: true`, and
   a required `operation_id`. The panel recomputes the plan, rejects any
   difference, then in one `Project.lockedAccess()` builds a remove action per
   reference and a clone action per nested clip and commits them in one
   `executeTransaction()`. One Premiere Undo restores the nest.
4. It reads back every clone (project item, exact start and end ticks, source
   in/out, enabled state) and checks that no nest reference remains. A readback
   mismatch after a committed transaction is reported as
   `committed_unverified`, not success.

Only media types with a reference are cloned: a video-only nest clones the
nested video tracks and leaves the nested audio out, matching what played.

## Proof boundary

Automated tests exercise the plan, every refusal, the single transaction,
stale-plan rejection, operation-ID replay, and readback failure, against a
mocked host. The same panel module was also run against Premiere Pro 26.0.2 on
macOS through a side-loaded test panel: eight nests (picture and sound pairs,
7 to 39 clips each, mixed 23.976 fps camera and 60 fps screen-recording
sources, Lumetri with input LUTs and curves) were unnested, every readback
verified, and exported frames across each unnested range matched the nested
original with a mean pixel difference of 0.00/255. That run did not go through
the authenticated bridge transport, and rendering of every frame, playback, and
persistence after reopening were not checked.
