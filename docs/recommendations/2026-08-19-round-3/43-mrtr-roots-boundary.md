# Recommendation 43: MRTR roots as an explicit workspace boundary

## Evidence

MCP roots let clients expose selected file or directory URIs. In MCP 2026-07-28, a server obtains roots during a request through an MRTR `ListRootsRequest` and the client must advertise the roots capability.

- [MCP roots](https://modelcontextprotocol.io/specification/2026-07-28/client/roots)
- [MCP multi-round-trip requests](https://py.sdk.modelcontextprotocol.io/handlers/multi-round-trip)

## Proposed improvement

For workspace import, preset, interchange, and export operations, intersect configured server policy with client-provided roots. Bind the canonical root set to the operation digest and revalidate it immediately before filesystem access.

## Acceptance criteria

- Unsupported clients retain the existing explicit-path policy without silent widening.
- Symlink, junction, case, encoding, and parent-traversal tests fail closed.
- Changed roots invalidate pending confirmation and application handles.
- Root names and paths are redacted from default telemetry.

Client-provided roots describe intended scope; operating-system permissions remain authoritative.
