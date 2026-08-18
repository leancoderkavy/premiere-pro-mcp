# Recommendation 04: Premiere operation scheduler

## Evidence

Concurrent MCP requests can reach one interactive Premiere host. Adobe UXP mutations
are committed through project transactions, but that does not serialize independent
requests or make a timed-out mutation safe to replay.

- [Adobe Project.executeTransaction](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project/#executetransaction)
- [MCP cancellation](https://modelcontextprotocol.io/specification/2026-07-28/basic/utilities/cancellation)

## Proposed improvement

Introduce one FIFO mutation lane plus configurable safe-read concurrency. Classify
before enqueueing, bound queue length and wait time, attach operation IDs, and stop
queued work on disconnect. Never claim cancellation after the host commit boundary.

## Acceptance

- Mutations cannot overlap; explicitly safe reads demonstrate bounded parallelism.
- Queue overflow and expiry return stable overload errors without host calls.
- Tests cover fairness, disconnects, timeouts, and mutation/read classification.
- Metrics expose counts and timings only, never project or tool arguments.

Contract tests cannot replace a real-host concurrency run.
