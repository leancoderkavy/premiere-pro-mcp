# MCP 2026-07-28 capability report

Last researched: 2026-08-27

This repository targets the current Model Context Protocol revision, `2026-07-28`, through the stable TypeScript SDK v2 packages. The same server factory continues to serve legacy MCP clients (`2024-10-07` through `2025-11-25`) so existing Premiere integrations do not need a flag-day upgrade.

## Implemented protocol surface

| Capability | Status | Repository behavior |
| --- | --- | --- |
| Stateless protocol core | Implemented | HTTP uses `createMcpHandler`; every modern request receives a fresh MCP server instance and can land on any process instance. |
| `server/discover` | Implemented | HTTP and stdio use the v2 serving entries and advertise `2026-07-28`; modern clients can probe before selecting an era. |
| Per-request `_meta` envelope | Implemented | Validated and exposed by the SDK on modern calls; no hidden MCP session state is required. |
| Dual-era serving | Implemented | One factory serves modern and legacy clients over both Streamable HTTP and stdio. For a stdio client that cannot complete `server/discover`, the explicit `PREMIERE_MCP_PROTOCOL_MODE=legacy` fallback serves the legacy initialization handshake only. |
| `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` routing headers | Implemented | The modern HTTP entry validates required headers and agreement with the JSON-RPC body before dispatch. |
| `Mcp-Param-*` schema headers | Available | The v2 entry validates parameters declared with `x-mcp-header`; no current Premiere tool duplicates an argument into a routing header. |
| Cacheable list/read results | Implemented | `tools/list` is private for 30 seconds; `prompts/list` is public for 5 minutes; `resources/list` is private for 1 minute; live `resources/read` results are private and uncached. |
| Deterministic tool, prompt, and resource lists | Implemented | Registries are built in stable catalog order and v2 emits the modern cache fields. |
| `subscriptions/listen` | Implemented by serving entries | Modern change streams are handled by the v2 HTTP/stdio entries. The current registries are static during a process lifetime, so they do not emit application-driven list changes. |
| Multi Round-Trip Requests (MRTR) | SDK-ready | The server can return `input_required`, including elicitation, sampling, or roots requests. Current Premiere workflows use explicit preview/apply tools and do not yet require an interactive mid-call round trip. |
| Required result discriminators | Implemented by serving entries | SDK v2 emits `resultType: "complete"` for ordinary modern-era results and preserves the legacy codec for older clients. |
| Extension capability framework | Implemented | Discovery advertises `io.github.leancoderkavy/premiere-pro` with the protocol revision, transports, dual-era posture, and CEP/UXP bridge backends. |
| Cancellation | Implemented by serving entries | Modern HTTP cancellation closes the request response stream; stdio and legacy clients retain their era-appropriate cancellation behavior. Premiere host calls remain cooperatively cancellable only where the Adobe API exposes a safe cancellation point. |
| Progress notifications | Protocol-supported, not currently emitted | The serving entries accept request-scoped progress tokens. Existing Premiere tools return bounded final receipts and do not claim granular progress that the CEP/UXP host cannot prove. |
| OpenTelemetry trace context | Transport pass-through | SDK v2 preserves the standard `traceparent`, `tracestate`, and `baggage` `_meta` keys. Application telemetry remains privacy-bounded and does not record tool arguments, results, media names, or paths. |
| JSON Schema 2020-12 inputs and outputs | Implemented | Tool inputs use typed Zod schemas and every registered tool declares a validated output schema with structured content. No custom `x-mcp-header` parameters are currently required. |
| Structured tool results | Implemented | Every tool declares one output schema and returns stable `structuredContent` plus human-readable content; frame capture can also return an image block. |
| Tool annotations | Implemented | Read-only, destructive, idempotent, open-world, and title hints are derived per tool. |
| Resources | Implemented | Four static guidance resources and ten bounded, path-redacted live Premiere context resources are registered. |
| Prompts | Implemented | Eleven safety-oriented Premiere workflow prompts are registered with typed arguments. |
| Tool discovery controls | Implemented | Capability profiles remove unauthorized tools from `tools/list`; optional workflow packs reduce context without expanding authority. |
| Cursor pagination | Supported, not currently needed | The SDK accepts cursor-bearing list requests. The current bounded registries fit in one deterministic page and therefore return no `nextCursor`. |
| Resource templates | Not currently exposed | All current resources have stable, bounded URIs. A template would create no repository-fit benefit until an authorized parameterized resource family exists. |
| Completions | Not currently exposed | Current prompt arguments are free-form goals/constraints and resources are fixed URIs, so the server does not advertise low-value or path-leaking suggestions. |
| Resource subscriptions and list-change events | Available, currently quiescent | `subscriptions/listen` is served, but the registered catalogs are immutable for a process lifetime and live Premiere resources are read on demand. No false change events are emitted. |
| Embedded resources and resource links | Supported result types, selectively unused | The result codec supports them. Local Premiere artifacts are not converted into links until a contained, authorization-scoped artifact registry can guarantee access and expiry. |
| Text, image, audio, and binary content blocks | Partially used | Text and structured content are standard; verified frame capture may return image content. The server does not synthesize audio or expose arbitrary local binary blobs. |

## Deliberate boundaries

| Surface | Status | Reason |
| --- | --- | --- |
| Tasks extension (`io.modelcontextprotocol/tasks`) | Not implemented | Current bridge calls are bounded request/response operations. Advertising durable tasks without durable, authorization-scoped storage, TTL cleanup, cancellation, and result recovery would be misleading. |
| OAuth resource-server authorization | Implemented for trusted operators, externally provisioned | HTTP validates signed access tokens by exact issuer, canonical audience, lifetime, allowlisted subject, and scope and publishes RFC 9728 protected-resource metadata. A separately configured authorization server owns login, consent, token issuance, and MCP client registration; this repository does not issue tokens or route public users to their own desktops. |
| OAuth Client ID Metadata Documents | Authorization-server responsibility | The resource server advertises its configured authorization server. That external service must support the registration mechanism required by the connecting MCP clients; this repository does not claim to operate CIMD or client registration. |
| Enterprise Managed Authorization | Not implemented | No enterprise identity-policy provider is configured in this repository. |
| MCP Apps | Not implemented | Premiere UI is delivered through CEP/UXP, not an MCP App resource. |
| Skills over MCP | Experimental, not advertised | The repository ships client-specific local skills, but the Skills over MCP working group is still defining interoperable discovery and distribution. Local skill packaging is not claimed as protocol support. |
| Sampling, roots, and protocol logging capabilities | Not advertised | These legacy server/client capabilities are deprecated in `2026-07-28`. The server avoids introducing new dependencies on them; MRTR is the supported path if a future workflow needs client input. |
| Dynamic Client Registration | Not implemented | DCR is deprecated in the current protocol revision. |
| Server Card / `.well-known` discovery | Experimental roadmap item | The Server Card working group has not finalized a stable metadata contract. The existing MCP Registry manifest remains the public machine-readable discovery surface. |

## Complete 2026-07-28 change checklist

The release-specific implementation audit covers every normative change category in
the official changelog:

- **State and lifecycle:** no modern handshake, no protocol sessions, no
  `Mcp-Session-Id`, per-request version/capability metadata, and `server/discover`.
- **Transport:** Streamable HTTP POST responses, no modern GET/SSE control channel,
  no modern SSE resume IDs, validated `Mcp-Method`/`Mcp-Name`, and optional
  `Mcp-Param-*` support through schema declarations.
- **Results and interactivity:** required result discriminators, MRTR-capable codecs,
  request-scoped progress/cancellation, and `subscriptions/listen`.
- **Discovery and schemas:** deterministic lists, `ttlMs`/`cacheScope`, cursor-ready
  list operations, JSON Schema 2020-12 inputs/outputs, annotations, and structured
  content.
- **Extensions:** a declared Premiere extension plus explicit non-advertisement of
  Tasks, MCP Apps, enterprise authorization, and experimental Skills/Server Card
  surfaces that the product does not safely implement.
- **Authorization and deprecations:** HTTP supports either controlled operator-token
  authentication or fail-closed OAuth resource-server validation and RFC 9728
  discovery; login, consent, token issuance, and CIMD remain the configured external
  authorization server's responsibility; new Roots, Sampling, Logging, DCR, or HTTP+SSE dependencies are not
  introduced.

## Product capability surface

The MCP protocol upgrade does not manufacture new Adobe host APIs. The product surface remains the registered catalog reported by `get_capabilities`, with authority, backend, minimum Premiere version, support status, and verification boundary for every tool. CEP/ExtendScript is the production bridge; UXP remains capability-aware preview coverage where documented. Contract tests do not replace licensed-Premiere host evidence.

Call `get_capabilities` to retrieve the current machine-readable MCP protocol posture, cache policy, active tool packs, complete registered-tool report, bridge coverage, authority profile, and host-verification requirements.

## Authoritative research sources

- [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28)
- [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [Official TypeScript SDK v2](https://github.com/modelcontextprotocol/typescript-sdk)
- [TypeScript SDK protocol-era guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md)
