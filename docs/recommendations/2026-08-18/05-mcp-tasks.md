# Recommendation 05: negotiated MCP Tasks

## Evidence

The 2026-07-28 MCP release adds standardized long-running task semantics. Premiere
exports, proxy generation, transcription, and analysis can exceed an interactive
request, while Adobe APIs may offer no mid-call cancellation point.

- [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28)
- [MCP Tasks extension](https://modelcontextprotocol.io/seps/2663-tasks-extension)

## Proposed improvement

Negotiate Tasks and initially wrap exports only. Use authorization-scoped random
IDs, bounded retention, progress, expiry, and precise queued/running/committed states.
Keep the synchronous path for clients without support and persist no project args or
results containing media data.

## Acceptance

- Compatible clients can start, inspect, cancel, and retrieve an export result.
- Incompatible clients never receive an unknown task handle.
- Restart and cancellation tests define recoverable states and commit boundaries.
- Task count, retention bytes, and telemetry cardinality are capped.

Tasks do not make a blocking Adobe export API cancellable.
