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

## Primary Adobe references

- [EventManager](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/eventmanager/)
- [Premiere UXP constants](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/constants/)
- [EncoderManager](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/encodermanager/)
