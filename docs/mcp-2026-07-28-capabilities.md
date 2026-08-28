# MCP 2026-07-28 capability report

Last researched: 2026-08-27

This repository targets the current Model Context Protocol revision, `2026-07-28`, through the stable TypeScript SDK v2 packages. The same server factory continues to serve legacy MCP clients (`2024-10-07` through `2025-11-25`) so existing Premiere integrations do not need a flag-day upgrade.

## Implemented protocol surface

| Capability | Status | Repository behavior |
| --- | --- | --- |
| Stateless protocol core | Implemented | HTTP uses `createMcpHandler`; every modern request receives a fresh MCP server instance and can land on any process instance. |
| `server/discover` | Implemented | HTTP and stdio use the v2 serving entries and advertise `2026-07-28`; modern clients can probe before selecting an era. |
| Per-request `_meta` envelope | Implemented | Validated and exposed by the SDK on modern calls; no hidden MCP session state is required. |
| Dual-era serving | Implemented | One factory serves modern and legacy clients over both Streamable HTTP and stdio. |
| `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` routing headers | Implemented | The modern HTTP entry validates required headers and agreement with the JSON-RPC body before dispatch. |
| `Mcp-Param-*` schema headers | Available | The v2 entry validates parameters declared with `x-mcp-header`; no current Premiere tool duplicates an argument into a routing header. |
| Cacheable list/read results | Implemented | `tools/list` is private for 30 seconds; `prompts/list` is public for 5 minutes; `resources/list` is private for 1 minute; live `resources/read` results are private and uncached. |
| Deterministic tool, prompt, and resource lists | Implemented | Registries are built in stable catalog order and v2 emits the modern cache fields. |
| `subscriptions/listen` | Implemented by serving entries | Modern change streams are handled by the v2 HTTP/stdio entries. The current registries are static during a process lifetime, so they do not emit application-driven list changes. |
| Multi Round-Trip Requests (MRTR) | SDK-ready | The server can return `input_required`, including elicitation, sampling, or roots requests. Current Premiere workflows use explicit preview/apply tools and do not yet require an interactive mid-call round trip. |
| Extension capability framework | Implemented | Discovery advertises `io.github.leancoderkavy/premiere-pro` with the protocol revision, transports, dual-era posture, and CEP/UXP bridge backends. |
| Structured tool results | Implemented | Every tool declares one output schema and returns stable `structuredContent` plus human-readable content; frame capture can also return an image block. |
| Tool annotations | Implemented | Read-only, destructive, idempotent, open-world, and title hints are derived per tool. |
| Resources | Implemented | Four static guidance resources and ten bounded, path-redacted live Premiere context resources are registered. |
| Prompts | Implemented | Eleven safety-oriented Premiere workflow prompts are registered with typed arguments. |
| Tool discovery controls | Implemented | Capability profiles remove unauthorized tools from `tools/list`; optional workflow packs reduce context without expanding authority. |

## Deliberate boundaries

| Surface | Status | Reason |
| --- | --- | --- |
| Tasks extension (`io.modelcontextprotocol/tasks`) | Not implemented | Current bridge calls are bounded request/response operations. Advertising durable tasks without durable, authorization-scoped storage, TTL cleanup, cancellation, and result recovery would be misleading. |
| OAuth Client ID Metadata Documents and issuer validation | External authorization boundary | The hosted endpoint currently uses a fail-closed operator bearer token. It does not operate an OAuth authorization server and therefore does not advertise OAuth discovery it cannot complete. |
| Enterprise Managed Authorization | Not implemented | No enterprise identity-policy provider is configured in this repository. |
| MCP Apps | Not implemented | Premiere UI is delivered through CEP/UXP, not an MCP App resource. |
| Sampling, roots, and protocol logging capabilities | Not advertised | These legacy server/client capabilities are deprecated in `2026-07-28`. The server avoids introducing new dependencies on them; MRTR is the supported path if a future workflow needs client input. |
| Dynamic Client Registration | Not implemented | DCR is deprecated in the current protocol revision. |

## Product capability surface

The MCP protocol upgrade does not manufacture new Adobe host APIs. The product surface remains the registered catalog reported by `get_capabilities`, with authority, backend, minimum Premiere version, support status, and verification boundary for every tool. CEP/ExtendScript is the production bridge; UXP remains capability-aware preview coverage where documented. Contract tests do not replace licensed-Premiere host evidence.

Call `get_capabilities` to retrieve the current machine-readable MCP protocol posture, cache policy, active tool packs, complete registered-tool report, bridge coverage, authority profile, and host-verification requirements.

## Authoritative research sources

- [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28)
- [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [Official TypeScript SDK v2](https://github.com/modelcontextprotocol/typescript-sdk)
- [TypeScript SDK protocol-era guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md)
