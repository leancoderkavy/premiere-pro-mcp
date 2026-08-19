# Recommendation 24: per-request capability envelope

## Evidence

In stateless MCP, every request carries protocol version and client capabilities in `_meta`; servers publish their identity and capabilities through discovery and result metadata.

- [SEP-2575: Make MCP Stateless](https://modelcontextprotocol.io/seps/2575-stateless-mcp)
- [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28)

## Proposed improvement

Create one validated request envelope used by tool, prompt, and resource handlers. It should normalize protocol version, client capabilities, client identity, auth scope, request ID, and advertised response features before business logic runs.

## Acceptance criteria

- Missing required capabilities fail before any bridge call.
- Unknown optional capabilities are ignored and recorded with bounded cardinality.
- Result metadata reports the actual server version handling the call.
- Fuzz tests cover malformed and adversarial `_meta` objects.

Client metadata is self-asserted unless independently authenticated.
