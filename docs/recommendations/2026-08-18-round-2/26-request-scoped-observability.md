# Recommendation 26: request-scoped observability migration

## Evidence

MCP 2026-07-28 removes `logging/setLevel`; protocol logs become a per-request opt-in through `_meta`. The specification also formalizes deprecation of the older logging capability.

- [MCP stateless proposal](https://modelcontextprotocol.io/seps/2575-stateless-mcp)
- [Python SDK migration guide](https://py.sdk.modelcontextprotocol.io/migration)

## Proposed improvement

Separate client-visible diagnostic logs from server telemetry. Honor the negotiated request log level, correlate all records with operation and bridge IDs, and export privacy-filtered traces and metrics independently of MCP notifications.

## Acceptance criteria

- No protocol log is emitted without explicit per-request opt-in.
- Secrets, media paths, transcript text, and project names are redacted by default.
- Trace sampling and label cardinality are bounded.
- Legacy logging behavior is version-gated and removal-dated.

Telemetry can diagnose a call but cannot prove the visual result in Premiere.
