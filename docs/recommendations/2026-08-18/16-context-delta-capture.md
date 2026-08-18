# Recommendation 16: project-context delta capture

## Evidence

The durable context engine correctly separates source and timeline revisions, but a
capture still rebuilds a bounded active-sequence snapshot. Documented project events
and stable identities can reduce repeated work if event loss fails closed.

- [Adobe UXP events](https://developer.adobe.com/premiere-pro/uxp/resources/fundamentals/events)

## Proposed improvement

Accept an optional prior revision and return added, changed, removed, and retained
record IDs. Coalesce event hints, re-read affected records, and force a full capture
when event continuity, project identity, truncation, or schema compatibility is uncertain.

## Acceptance

- Applying a delta to its exact base equals a fresh full snapshot.
- Wrong/stale bases return `full_refresh_required` without partial persistence.
- Deltas and event queues are count/byte/time bounded.
- Source enrichments survive timeline-only changes and invalidate on source revision changes.

Events are hints; correctness continues to come from bounded readback.
