# Recommendation 41: filtered MCP subscription stream

## Evidence

MCP 2026-07-28 replaces unsolicited change notifications and `resources/subscribe` with one client-opened `subscriptions/listen` stream. Servers must only send notification types and resource URIs accepted by the stream filter.

- [MCP subscriptions](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions)
- [TypeScript SDK 2026-07-28 migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28.html)

## Proposed improvement

Publish tool-catalog, workflow-resource, and privacy-safe project-context changes through a bounded subscription bus. Authorize every requested notification category and URI before acknowledging it, with an in-process default and an explicit multi-replica adapter.

## Acceptance criteria

- Unrequested notification types and URIs are never delivered.
- Slow consumers have bounded queues, coalescing, and explicit overflow semantics.
- Legacy notification behavior remains protocol-version gated.
- Disconnect, cancellation, reconnect, and multi-tenant isolation have contract tests.

The stream reports server-side change events; it does not prove Premiere applied an edit.
