# Recommendation 45: prompt and resource injection boundary

## Evidence

The MCP prompt specification requires implementations to validate prompt inputs and outputs to prevent injection and unauthorized resource access. Premiere metadata and transcripts are untrusted project content.

- [MCP prompts security](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts)

## Proposed improvement

Represent project-derived text as labeled data blocks with provenance, size limits, and escaping rather than concatenating it into trusted workflow instructions. Separate server-authored instructions, user arguments, and Premiere-derived content in every prompt renderer.

## Acceptance criteria

- Adversarial clip names, markers, metadata, and transcripts cannot add server instructions.
- Resource links are independently authorized before rendering.
- Truncation preserves provenance and cannot splice delimiters ambiguously.
- A corpus tests injection, Unicode controls, nested markup, and oversized content.

Containment reduces instruction confusion but cannot guarantee model behavior.
