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

## Primary Adobe references

- [EventManager](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/eventmanager/)
- [Premiere UXP constants](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/constants/)
- [EncoderManager](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/encodermanager/)
