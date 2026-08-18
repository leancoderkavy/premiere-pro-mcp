# Recommendation 06: strict tool output schemas

## Evidence

MCP 2026-07-28 tools may advertise `outputSchema`. The server returns structured
results but does not publish or validate per-tool output contracts, leaving clients
unable to distinguish schema drift from host failures.

- [MCP tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)

## Proposed improvement

Add shared success/error/verification schemas and migrate read-only diagnostics first.
Validate `structuredContent` before return, preserve the text block for compatibility,
and maintain a machine-readable waiver list for unmigrated tools.

## Acceptance

- Every migrated tool publishes valid JSON Schema 2020-12 output.
- Representative success and failure paths reject schema drift in CI.
- Error codes, operation semantics, and verification boundaries are typed.
- Schema failure never converts an ambiguous host mutation into a retry.

Start with read-only tools; mutation migration needs separate host evidence.
