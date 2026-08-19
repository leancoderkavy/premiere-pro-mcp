# Recommendation 25: formal MCP extension negotiation

## Evidence

MCP 2026-07-28 establishes a formal extensions framework so optional features can evolve without silently changing the protocol core.

- [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28)
- [MCP release candidate](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate)

## Proposed improvement

Add a single extension registry describing supported versions, stability, required client capabilities, configuration gates, and fallback behavior. Route Tasks and future UI integrations through it instead of scattered feature flags.

## Acceptance criteria

- Unknown or incompatible extensions never alter core tool behavior.
- Experimental extensions are disabled by default and labeled in discovery.
- Registry snapshots are contract-tested across releases.
- Each extension documents downgrade and removal behavior.

Advertising an extension means protocol support only, not Premiere host support.
