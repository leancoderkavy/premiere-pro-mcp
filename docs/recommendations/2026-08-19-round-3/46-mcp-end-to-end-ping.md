# Recommendation 46: layered MCP end-to-end ping

## Evidence

MCP clients and servers can use `ping()` to verify that the protocol peer still answers independently of application operations.

- [MCP TypeScript client calls](https://ts.sdk.modelcontextprotocol.io/v2/clients/calling.html)

## Proposed improvement

Expose separate transport, authenticated-server, UXP-panel, and Premiere-readiness liveness levels. Use MCP ping only for the first two levels and keep bounded Adobe read probes behind explicit diagnostics.

## Acceptance criteria

- Ping performs no project mutation and returns no project content.
- Timeouts distinguish network, server event-loop, bridge, modal-host, and no-project states.
- Rate limits prevent ping amplification or telemetry-cardinality abuse.
- Tests prove a successful MCP ping cannot mark the Premiere host ready.

This complements the UXP heartbeat; the two signals measure different hops.
