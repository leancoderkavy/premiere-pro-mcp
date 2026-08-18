# Recommendation 01: exact HTTP route admission

## Evidence

The MCP HTTP transport is a security boundary. The current server accepts any URL
whose text starts with `/mcp`, so `/mcp-typo` reaches the authenticated transport.
The latest MCP transport guidance expects one configured endpoint, and the existing
roadmap already requires rejection before server construction.

- [MCP 2026-07-28 transport specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)

## Proposed improvement

Parse the request URL once and admit only the exact `/mcp` pathname. Allow only the
methods supported by Streamable HTTP, return `404` for other paths and `405` with an
`Allow` header for other methods, and do this before authentication telemetry or MCP
server allocation.

## Acceptance

- `/mcp`, `/mcp?client=x`, and the health route retain documented behavior.
- `/mcp-typo`, encoded separator variants, and unsupported methods never construct a server.
- Unit tests cover malformed URLs without exposing request headers or tokens.

This is transport hardening only; it does not validate a live Premiere host.
