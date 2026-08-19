# Recommendation 47: canonical MCP resource URI policy

## Evidence

MCP resources require valid unique URIs and may use standard or custom schemes. Resource templates and subscriptions make URI identity part of authorization, caching, and notification routing.

- [MCP resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources)
- [MCP subscriptions](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions)

## Proposed improvement

Define canonical custom URIs for project contexts, operation receipts, compatibility reports, and artifacts. Normalize and validate scheme, authority, encoding, path segments, identifiers, and query fields before lookup or authorization.

## Acceptance criteria

- Equivalent encodings cannot create cache or authorization aliases.
- File URIs never bypass the existing path containment policy.
- Unknown schemes and duplicate canonical identities fail deterministically.
- Subscription and read authorization use the same canonicalizer.

A canonical URI identifies a server resource; it does not establish filesystem safety by itself.
