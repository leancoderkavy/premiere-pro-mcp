# Recommendation 14: revisioned in-panel project index

## Evidence

Several UXP commands traverse the complete project tree to resolve items. Adobe exposes
stable project/item identities and project events; repeated breadth-first traversal
scales poorly and duplicate names must not resolve silently.

- [Adobe Premiere UXP Project API](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project)
- [Adobe UXP events](https://developer.adobe.com/premiere-pro/uxp/resources/fundamentals/events)

## Proposed improvement

Maintain a bounded index by item GUID, exact name, normalized path hash, type, and
parent identity. Increment revisions from documented events and successful commands;
when event evidence is incomplete, mark stale and rebuild instead of guessing.

## Acceptance

- Duplicate names return bounded matches or require a stable identity.
- Entry count/memory are capped and cleared on project close or disconnect.
- Lost/coalesced event tests prove a full rebuild restores correctness.
- Large fixtures improve p50/p95 lookup without changing command results.

Mock benchmarks are not live-host performance evidence.
