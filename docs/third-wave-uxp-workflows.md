# Third-wave stable Premiere UXP workflows

- **Implementation baseline:** `@adobe/premierepro@26.3.0`
- **Prerelease policy:** APIs found only in 26.5 beta declarations remain excluded
- **Host policy:** capability probes from the connected Premiere process are authoritative
- **Evidence:** automated contracts are separate from real Premiere host verification

## PR 1 — Bounded host-event journal

`inspect_premiere_events_uxp` lists or briefly waits for redacted event receipts from
Adobe's documented `EventManager` surface. Project and sequence events continue to
invalidate the compact state snapshot. Encoder progress and operation-completion
events enter a separate 512-entry journal so noisy progress does not force a complete
project snapshot on every callback.

The journal provides monotonic revisions, category/name filters, a 256-result response
cap, a 60-second maximum wait, consecutive progress coalescing, and explicit overflow
signaling. Raw Adobe event objects never cross the bridge; only allowlisted scalar
state and progress fields can appear in a receipt.

Automated tests cover overflow, progress coalescing, filtering, timeouts, shutdown,
capability discovery, and the public MCP schema. They do not establish that a real
Premiere build emits every declared event. Windows and macOS host runs must record
the exact event names and payload shapes before downstream workflows treat them as
completion evidence.

## PR 2 — AME terminal receipts

`encode_media_uxp` now returns a bounded local job receipt when it submits a sequence,
project item, or file encode. Its `jobs` and `wait` actions expose queue, progress,
complete, error, and cancellation events without claiming that the requested file
exists or has the expected checksum.

Adobe's stable declarations expose encoder event names but no durable event-to-job
identifier. The bridge therefore attributes an event only when exactly one tracked
encode is non-terminal. With multiple active jobs the receipt is explicitly
unattributed and no job moves to a terminal state. An `operation_id` becomes the
preferred local job ID; otherwise the panel generates a session-local ID.

The existing delivery verifier remains the authority for output existence, size,
format, and checksum after an attributed terminal event. Live-host validation must
exercise overlapping AME and in-app queue jobs before event attribution can be
described as more than conservative single-job correlation.

## PR 3 — Host readiness gates

`wait_for_host_readiness_uxp` separates three phases that callers previously had to
approximate with polling:

- `snapshot` captures the current event revision and sequence analysis state before
  a host operation is dispatched;
- `analysis` performs bounded, adaptive readback through
  `Sequence.isDoneAnalyzingForVideoEffects()` with a stale-sequence guard; and
- `operation` waits after the captured revision for one import, export, effect-drop,
  or generative-extend completion receipt.

Operation receipts report Adobe's success, cancellation, failure, or unknown state,
but remain event evidence rather than proof that the intended target changed. A wait
timeout returns a pending result and never retries the original operation. Analysis
waits cap at 60 seconds and back off from a minimum 100 ms interval to a maximum
configured interval.

## PR 4 — Safe multi-project sessions and branch copies

`manage_project_sessions_uxp` targets open projects by documented GUID instead of
assuming that the active Project view is the intended project. Listing is capped at
64 views, deduplicates projects, and redacts paths unless the caller explicitly asks
for them. Create, open, Save As, and branch destinations must pass the approved UXP
workspace's canonical-path check.

Every external write requires explicit confirmation. Existing Premiere project
destinations require a separate overwrite confirmation. Because Adobe documents that
`Project.saveAs()` retargets the current project handle, `branch_copies` saves one
copy at a time, verifies the new path, closes that saved view, and reopens the source
before continuing. Closing defaults to a confirmed save; discarding changes requires
an additional confirmation and is never inferred from a missing option.

Automated contracts cover path redaction, GUID targeting, confirmation gates, and
path readback. They do not replace Windows and macOS host tests for dialog behavior,
dirty-project prompts, Productions projects, or concurrent Project views.

## PR 5 — Lease-based growing-media control

`manage_growing_media_uxp` wraps `Project.pauseGrowing()` in an explicit pause lease
rather than exposing an indefinite toggle. A pause requires confirmation, defaults
to 60 seconds, and cannot exceed ten minutes. The panel records only the project GUID
and expiration time, schedules an automatic resume, and also attempts a resume when
the bridge disconnects or the panel is destroyed.

A small persistent recovery marker lets the next panel startup retry a resume after
an abnormal process exit. The marker is cleared only after Premiere returns success.
Adobe exposes no getter for the growing-media pause state, so status is clearly
labeled panel-local and both pause and resume stop at the host-return boundary. Real
host validation must still exercise growing files, crash recovery, project switching,
and both operating systems before this can be treated as state readback.

## Primary Adobe references

- [EventManager](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/eventmanager/)
- [Premiere UXP constants](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/constants/)
- [EncoderManager](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/encodermanager/)
- [Project](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project/)
- [ProjectUtils](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/projectutils/)
