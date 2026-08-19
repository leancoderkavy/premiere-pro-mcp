# Recommendation 38: metadata batch planner

## Evidence

Adobe’s production-style metadata sample supports column copy/exchange, batch prefix/suffix/numbering, metadata export, and clip-marker export.

- [Adobe Premiere UXP samples](https://github.com/AdobeDocs/uxp-premiere-pro-samples)

## Proposed improvement

Create a bounded metadata plan/preview/apply workflow with explicit namespaces, typed coercion, per-item expected values, conflict detection, and chunked transactions. Default to exporting a rollback artifact before changes.

## Acceptance criteria

- Preview identifies writable fields, collisions, truncation, and no-op edits.
- Apply requires exact project revision and plan digest.
- Partial batches return per-item certainty and never retry unknown commits.
- Sensitive metadata fields are excluded unless explicitly allowlisted.

Adobe’s sample demonstrates a workflow pattern; real project schemas still require host validation.
