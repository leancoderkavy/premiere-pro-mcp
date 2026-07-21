# Performance notes

## July 2026 audit

The bridge used synchronous existence checks every 100 ms for every in-flight command. Node's
filesystem documentation recommends `fs.watch()` over stat polling when possible, while warning
that watching can be unreliable on some network and virtualized filesystems. The bridge therefore
uses event notification as the low-latency path and retains a 100 ms initial / 250 ms subsequent
polling fallback for correctness.

The Streamable HTTP endpoint intentionally remains stateless. The MCP transport specification
permits servers without session management, but this means each request constructs a new
`McpServer`. Tool definitions and converted Zod schemas are immutable for a given bridge and
capability configuration, so they are cached while each request still receives an independent MCP
server and transport.

Research sources:

- [Node.js filesystem API](https://nodejs.org/api/fs.html#fswatchfilename-options-listener)
- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [Adobe Premiere UXP ESLint and transaction guidance](https://developer.adobe.com/premiere-pro/uxp/resources/fundamentals/eslint-support/)

## Local benchmark

Windows, Node.js 22, 100 `createServer()` calls:

| Path | Average |
|---|---:|
| Cache bypassed with unique bridge configurations | 5.873 ms |
| Reused bridge configuration | 2.208 ms |

This is a 62.4% reduction in repeated server-construction time. It does not measure Premiere host
execution time or claim equivalent end-to-end editing latency. Bridge watcher behavior is covered
by unit tests; live CEP latency remains dependent on Premiere and the host filesystem.
