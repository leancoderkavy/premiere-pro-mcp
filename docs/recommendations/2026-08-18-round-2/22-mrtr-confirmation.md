# Recommendation 22: MRTR confirmation for consequential edits

## Evidence

MCP 2026-07-28 introduces `InputRequiredResult` so a server can request user input during an active call and the client can retry with `inputResponses`.

- [MCP key changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [MCP release candidate details](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate)

## Proposed improvement

Use MRTR for overwrite, delete, relink, and export-overwrite confirmations when the client advertises support. Bind the response to a canonical operation digest, project revision, expiry, and authenticated principal.

## Acceptance criteria

- A changed plan, project revision, principal, or expired prompt invalidates the response.
- Clients without MRTR receive the existing explicit-token flow.
- Retries are idempotent before the host commit boundary.
- Tests cover approve, decline, replay, mismatch, and disconnect.

MRTR is a confirmation transport, not evidence that a human understood the edit.
