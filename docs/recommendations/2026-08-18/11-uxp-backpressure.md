# Recommendation 11: UXP bridge backpressure

## Evidence

The authenticated UXP bridge bounds each WebSocket frame but its pending-request map
has no count limit. A burst can therefore allocate timers and request state faster
than a single interactive Premiere host can complete commands.

- [Adobe UXP network operations](https://developer.adobe.com/premiere-pro/uxp/resources/recipes/network)

## Proposed improvement

Add configurable pending and queued limits, reject excess work before generating a
request ID, and expose aggregate active/rejected counters. Coordinate with the future
operation scheduler so only one component owns mutation ordering.

## Acceptance

- Pending entries and timers never exceed the configured cap.
- Rejections have a stable `UXP_OVERLOADED` code and never reach the panel.
- Timeout, send failure, disconnect, replacement connection, and stop release capacity.
- Load tests demonstrate bounded heap and telemetry cardinality.

Backpressure does not imply that Adobe host calls are cancellable.
