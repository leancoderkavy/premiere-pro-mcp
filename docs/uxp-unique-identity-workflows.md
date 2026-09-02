# Unique serializable identity inspection

`inspect_unique_object_identity_uxp` exposes the documented
`UniqueSerializeable.cast()` / `getUniqueID()` read surface through the UXP
bridge command `object.uniqueIdentity.inspect`.

The caller must provide exactly one exact locator: a `project_item_id` or a
`sequence_guid`. Project-item lookup is breadth-first from the active project's
root and stops at 512 visited items. Sequence lookup uses the requested GUID
without activating the sequence. The result contains only the active project
GUID, the selected locator, and Premiere's opaque unique identity.

The bridge reads a complete target snapshot twice. It rejects a changed active
project, locator, or native identity as `UXP_STALE_UNIQUE_IDENTITY`, rather
than returning a mixed snapshot. Optional `expected_project_guid` and
`expected_unique_id` are stale preconditions for the first snapshot.

This is a read-only inspection surface. It does not expose media paths,
metadata, project content, timing, editability, or a route to mutate the
resolved object. The identity is returned only for the current bridge request;
the command does not retain it or promise it is stable across Premiere sessions,
project copies, or later edits. Unit and bridge-contract tests do not prove a
licensed Premiere host, persistence, rendered output, playback, or UI behavior.
