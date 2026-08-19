# Recommendation 42: contextual prompt and resource completions

## Evidence

MCP completion lets servers suggest up to 100 values for prompt arguments and resource-template variables, optionally using already resolved arguments as context.

- [MCP completion](https://modelcontextprotocol.io/specification/draft/server/utilities/completion)
- [MCP TypeScript SDK completion](https://ts.sdk.modelcontextprotocol.io/v2/servers/completion.html)

## Proposed improvement

Add completions for workflow prompt names, safe operation profiles, project-context handles, and resource-template identifiers. Generate suggestions only from the caller's authorized, current capability view and never expose raw paths or transcript text.

## Acceptance criteria

- Results are prefix-bounded, deterministic, deduplicated, and capped at 100.
- Missing context returns an empty result rather than widening scope.
- Stale or unauthorized handles are omitted.
- Latency, cardinality, and cross-principal isolation are tested.

Completion values are usability hints and must still pass normal tool validation.
