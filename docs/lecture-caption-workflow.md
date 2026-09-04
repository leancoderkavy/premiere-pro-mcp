# Guided lecture-caption workflow

## Status

`create_caption_track` now has a `plan_lecture_workflow` action that parses a
caller-provided SRT or VTT locally and returns a timing-correction preview plus
a review checklist. It does not write the artifact, upload it, import it into
Premiere, or call an AI/provider service.

Use this when a long lecture, interview, or training recording has an existing
caption artifact and an editor needs to distinguish a constant offset from a
duration mismatch before importing it.

## Plan a timing review

Provide the artifact content, its syntax, and only the timing observations an
editor has already made:

```json
{
  "action": "plan_lecture_workflow",
  "artifact_format": "srt",
  "caption_content": "<caller-owned SRT content>",
  "target_duration_seconds": 1620,
  "observed_offset_seconds": 0.4,
  "timing_tolerance_seconds": 0.25
}
```

`observed_offset_seconds` is positive when captions currently appear later
than intended. The response contains cue count, first/last timing, a beginning/
middle/end sample, and one of these review-only outcomes:

| Status | Meaning |
| --- | --- |
| `aligned` | No requested correction is needed within the tolerance. |
| `constant_offset` | A safe inverse shift is proposed from the editor-observed offset. |
| `proportional_drift` | A bounded scale preview is proposed only after the caller sets `allow_proportional_scaling: true`. |
| `review_required` | The artifact is invalid, its mismatch is ambiguous, its first cue is not safely anchored, or the proposed operation could create negative time. |

The tool rejects malformed timecodes, non-positive cue ranges, overlaps, more
than 10,000 cues, and overly large artifacts. It deliberately withholds a
proportional correction by default: a caption file ending before a sequence
does not prove drift, because a recording can contain intentional lead-in or
tail time.

## Apply only after review

The plan does not authorize a mutation. Follow its steps separately:

1. Work in a duplicate/test sequence. Use a documented UXP clone workflow only
   when the connected host advertises it; otherwise duplicate in Premiere and
   re-query its stable sequence ID.
2. Review the sampled ranges and update the caller-owned SRT/VTT outside this
   server if the editor accepts a correction.
3. Import the reviewed artifact into the project, then call
   `create_caption_track` with `action: "import"`, the imported `item_id`, and
   an intentional `start_seconds` value.
4. Call `read_sequence_captions` for structural track readback.
5. Review beginning/middle/end frames and play those ranges in Premiere.
6. Treat final rendered output review as a separate delivery gate.

## Evidence boundary

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| Local timing plan | SRT/VTT syntax, non-overlap, supplied timing assumptions, and a deterministic preview | That any caption file was changed or that Premiere agrees with the plan |
| Caption-track readback | A host-exposed structural track result | Synchronization in playback, line breaks, safe area, or accessibility quality |
| Review frames | A sampled visual artifact | Temporal playback behavior or exported delivery quality |
| Playback/render review | A human-reviewed output at its stated scope | General compatibility for all Premiere, client, or caption versions |

The workflow is a guide and returns `not_run` for structural, playback, and
rendered-output verification until the editor performs and records those steps
on the actual host.
