# Recommendation 09: workflow-scoped tool packs

## Evidence

The server advertises 285 core tools. Large discovery payloads consume client context
and make correct-tool selection harder. MCP discovery is capability-driven, and the
2026-07-28 release adds cache metadata for list results.

- [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28)

## Proposed improvement

Define versioned essential, rough-cut, audio, captions, color, delivery, inspection,
and advanced packs. Operator selection controls visibility only; authority checks
remain separate and direct calls to hidden unauthorized tools stay denied.

## Acceptance

- Every tool belongs to at least one pack and retains an authority classification.
- Essential completes diagnosis, inspection, safe preview, save, and delivery.
- Full-catalog mode remains available through a documented compatibility window.
- Benchmarks measure list bytes, schema time, prompt tokens, and correct-tool selection.

Tool packs are context optimization, not an authorization mechanism.
