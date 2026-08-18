# Recommendation 03: authorization-scoped throttling

## Evidence

Authentication establishes who may call tools but does not bound request rate. MCP
security guidance recommends defense in depth for exposed authorization boundaries.

- [MCP authorization security](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)

## Proposed improvement

Add a bounded token-bucket limiter keyed by a one-way credential fingerprint, with
trusted-proxy-aware IP fallback only when explicitly configured. Reject before MCP
server construction, cap key cardinality, expire idle buckets, and emit aggregate
telemetry without tokens, IP addresses, arguments, or project data.

## Acceptance

- Burst and sustained limits have deterministic `429` behavior and `Retry-After`.
- Different credentials do not consume each other's budgets.
- Memory remains bounded under rotating identifiers and process restart semantics are documented.
- Fly/edge limits remain recommended because one-process counters are not account-wide.

This control supplements authentication; it does not replace it.
