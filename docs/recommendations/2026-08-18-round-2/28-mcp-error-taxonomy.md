# Recommendation 28: MCP error taxonomy and allocation

## Evidence

MCP 2026-07-28 reserves JSON-RPC server error codes `-32020` through `-32099` for the specification and defines typed errors for header mismatch, missing capability, and unsupported version.

- [MCP key changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog)

## Proposed improvement

Create a central error registry that keeps protocol-reserved errors separate from Premiere, bridge, validation, authentication, and internal failures. Map errors to retryability, mutation certainty, safe client text, and telemetry class.

## Acceptance criteria

- No implementation-defined error uses the protocol-reserved range.
- Every bridge failure states whether a host mutation may have committed.
- Stack traces and private paths never reach clients.
- Snapshot tests lock codes, shapes, and backward-compatible text fallbacks.

A structured error reports uncertainty; it must not convert unknown host state into failure or success.
