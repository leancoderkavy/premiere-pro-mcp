# Recommendation 44: resource annotations and context budgets

## Evidence

MCP resources and content blocks may declare `audience`, `priority`, and `lastModified` annotations so clients can filter, rank, and reason about freshness.

- [MCP resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources)
- [MCP tools and embedded resources](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)

## Proposed improvement

Annotate supported-actions, workflow, diagnostics, and project-context resources from a centralized policy. Pair annotations with explicit byte/token budgets, deterministic truncation, and freshness derived from revisioned source data.

## Acceptance criteria

- Priority is policy-defined and cannot be raised by project content.
- `lastModified` reflects the source revision rather than response generation time.
- Audience filtering never substitutes for authorization.
- Budget and truncation behavior is stable across pagination and cache hits.

Annotations are client hints, not mandatory context inclusion or a security boundary.
