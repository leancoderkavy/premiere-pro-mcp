# Recommendation 27: protocol deprecation ledger

## Evidence

The 2026-07-28 MCP revision removes the initialization handshake, protocol sessions, `logging/setLevel`, and top-level `roots/list`, while establishing a formal deprecation policy.

- [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [SEP-2575](https://modelcontextprotocol.io/seps/2575-stateless-mcp)

## Proposed improvement

Maintain a machine-readable ledger for every deprecated protocol behavior: first warning version, replacement, telemetry signal, planned removal, compatibility tests, and operator override.

## Acceptance criteria

- CI fails when deprecated code lacks an owner or removal condition.
- Release notes are generated from the ledger without overstating compatibility.
- Usage telemetry is aggregate and privacy-safe.
- Removing a path requires zero observed use or an explicit breaking release decision.

The ledger governs server compatibility, not Adobe API deprecations unless separately listed.
