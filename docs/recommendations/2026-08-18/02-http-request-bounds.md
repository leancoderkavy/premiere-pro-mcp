# Recommendation 02: bound HTTP requests and sockets

## Evidence

Remote MCP requests can currently consume an unbounded body and inherit Node's
generic timeout behavior. MCP tools can drive Premiere, so parsing and socket limits
must apply before a transport or host operation is allocated.

- [MCP security best practices](https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices)
- [Node HTTP server timeouts](https://nodejs.org/api/http.html#class-httpserver)

## Proposed improvement

Add validated environment settings for maximum body bytes, headers timeout, request
timeout, keep-alive timeout, and maximum requests per socket. Count bytes while the
request streams and return deterministic `408` or `413` responses before MCP parsing.

## Acceptance

- Oversized and slow requests never invoke `createServer` or a Premiere bridge.
- Invalid configuration fails startup instead of silently disabling a limit.
- Boundary tests cover chunked bodies, declared lengths, disconnects, and exact limits.

This is remote-transport containment, not proof of host cancellation.
