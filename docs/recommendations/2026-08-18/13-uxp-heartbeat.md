# Recommendation 13: UXP connection liveness

## Evidence

A TCP/WebSocket connection can remain open while Premiere is modal, suspended, or no
longer processing panel messages. Current state reports connected until socket closure
or a command timeout, delaying diagnosis and tying up pending work.

- [Adobe UXP WebSocket guidance](https://developer.adobe.com/premiere-pro/uxp/resources/recipes/network)

## Proposed improvement

Add protocol-level heartbeat sequence numbers and bounded round-trip measurements.
Classify `connected`, `degraded`, and `stale`; stop admitting new mutations when stale,
but never replay a timed-out mutation after reconnection.

## Acceptance

- Heartbeats are authenticated, size-bounded, and excluded from tool telemetry.
- Miss thresholds tolerate short event-loop stalls without reconnect storms.
- Stale connections reject new work and settle pending requests deterministically.
- Diagnostics distinguish socket liveness from successful Premiere host execution.

Live-host tests must cover modal dialogs, sleep/wake, panel reload, and Premiere exit.
