# Recommendation 08: contained artifact resource links

## Evidence

MCP tool results can return resource links and embedded resources. Export, AAF, and
compatibility reports currently describe paths in ordinary result data, which is
hard for clients to consume safely.

- [MCP tool result content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [MCP resource security](https://modelcontextprotocol.io/specification/2026-07-28/server/resources)

## Proposed improvement

Create authorization-scoped artifact IDs and expose only registered, size-bounded
files under a dedicated URI scheme. Canonicalize paths, reject links/reparse points,
set short expirations, and never turn an arbitrary tool-supplied path into a resource.

## Acceptance

- Export/report results include a resource link only after artifact registration.
- Traversal, alternate separators, symlinks, oversized files, and expired IDs fail closed.
- Resource reads recheck authorization and MIME type.
- Existing text and structured results remain available to older clients.

Artifact existence still requires post-export verification.
