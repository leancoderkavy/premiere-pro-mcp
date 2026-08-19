# Recommendation 36: privacy-safe context retention policy

## Evidence

Stateless MCP permits explicit application handles for state that must survive calls; it does not require indefinite application storage.

- [MCP stateless release candidate](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate)

## Proposed improvement

Add per-project TTL, byte quota, transcript opt-in, field-level redaction, compaction receipts, and delete/export controls to the project-context store. Keep operational state separate from model-ready summaries.

## Acceptance criteria

- Raw transcript text is disabled by default for persistent context.
- Quota enforcement is deterministic and never evicts an active write silently.
- Delete removes primary and derived records with an audit receipt that contains no content.
- Tests cover crash recovery, clock skew, corruption, and concurrent compaction.

Retention policy reduces stored data; it does not make model inference private by itself.
