# Recommendation 21: stateless MCP 2026-07-28 migration

## Evidence

MCP 2026-07-28 removes the initialization handshake and protocol session. Each request carries its protocol version and client capabilities, while discovery moves to `server/discover`.

- [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28)
- [MCP stateless proposal](https://modelcontextprotocol.io/seps/2575-stateless-mcp)

## Proposed improvement

Add a negotiated 2026-07-28 HTTP path while preserving the current legacy path. Make every request independently validate version, client capabilities, authentication, and server identity; remove any hidden dependency on transport affinity.

## Acceptance criteria

- Tests distribute consecutive requests across fresh server instances without losing application handles.
- Legacy clients negotiate the existing protocol rather than receiving partial 2026 behavior.
- Unsupported versions fail with the specified typed error.
- A migration document identifies every session-derived assumption.

Stateless transport does not make Premiere project state stateless or prove host execution.
