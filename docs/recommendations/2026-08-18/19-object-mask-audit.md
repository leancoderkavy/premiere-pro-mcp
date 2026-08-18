# Recommendation 19: bounded Object Mask audit

## Evidence

Premiere 26.3 exposes `ObjectMaskUtils`, while the public surface currently supports
inspection rather than object selection, mask creation, tracking, or parameter edits.
The repository correctly exposes a single-target check but not a project-wide audit.

- [Adobe Premiere UXP changelog](https://developer.adobe.com/premiere-pro/uxp/changelog)

## Proposed improvement

Add a read-only, paginated audit over explicit sequence/project-item identities using
only documented `hasObjectMask` probes. Reuse the revisioned index, cap host calls per
page, return per-item errors, and do not infer mask quality, tracking state, or editability.

## Acceptance

- Inputs require stable IDs; duplicate names never choose a target.
- Page size, host calls, duration, response bytes, and error count are bounded.
- Stale project revisions require refresh.
- Capability reports continue to label creation/tracking/editing unsupported.

Live Premiere validation must confirm which documented item types the probe accepts.
