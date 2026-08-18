# Recommendation 10: cacheable discovery with invalidation

## Evidence

MCP 2026-07-28 adds `ttlMs` and `cacheScope` to list results. This server repeatedly
builds large tool catalogs whose contents vary with authority and UXP connection state.

- [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28)

## Proposed improvement

Return private cache metadata for tools, prompts, and resources when the installed SDK
supports it. Key caches by server version, authority profile, selected tool pack, UXP
protocol/capabilities, and connector state. Emit list-changed notifications only to
clients that negotiate them, coalescing connection churn.

## Acceptance

- Cache keys never cross authorization profiles.
- UXP connect/disconnect and pack changes invalidate discovery deterministically.
- Repeated list benchmarks show lower serialization work and bytes transferred.
- Older clients retain current behavior without unknown fields or notifications.

No cache may preserve tools after their authority is revoked.
