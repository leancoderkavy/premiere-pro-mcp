# Recommendation 23: MCP routing-header integrity

## Evidence

MCP 2026-07-28 adds `Mcp-Method` and `Mcp-Name` headers for routing without parsing request bodies and defines `HeaderMismatchError` when they disagree with the JSON-RPC payload.

- [MCP key changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [MCP SDK release overview](https://blog.modelcontextprotocol.io/posts/sdk-betas-2026-07-28)

## Proposed improvement

Validate routing headers against the parsed body before authentication scope selection or dispatch. Treat headers as bounded routing hints, never as independent authorization facts, and redact sensitive resource names from access logs.

## Acceptance criteria

- Missing, duplicate, oversized, and mismatched headers have deterministic outcomes.
- Proxies cannot authorize one tool while dispatching another.
- Header values use strict byte and character limits.
- Compatibility tests cover clients from both protocol generations.

This complements exact HTTP route admission; it addresses semantic routing after admission.
