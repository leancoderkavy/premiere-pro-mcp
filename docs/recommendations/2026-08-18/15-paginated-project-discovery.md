# Recommendation 15: paginated project discovery

## Evidence

Large Premiere projects can contain thousands of items. Returning an entire tree in
one tool response increases host traversal time, MCP payload size, and model context.
Adobe's Project API provides stable items; MCP tools can expose bounded cursors.

- [Adobe Premiere UXP Project API](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project)

## Proposed improvement

Add cursor-based, revision-locked project-item discovery with explicit page and field
limits. Cursors should be opaque, authorization-scoped, short-lived, and invalidated
when the project-index revision changes. Default fields exclude native paths.

## Acceptance

- Page size, response bytes, traversal time, and cursor count are bounded.
- Changed projects return `refresh_required` rather than mixed-revision pages.
- Duplicate names retain stable IDs and parent identity.
- Tests cover expired, forged, cross-project, and cross-credential cursors.

Pagination depends on stable identity but not on undocumented QE behavior.
