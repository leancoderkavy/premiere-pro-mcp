# Project context engine

The project context engine reduces repeated clip, transcript, audio, and timeline
analysis without placing customer footage or an entire Premiere project in every
model prompt. It is an opt-in local index: no context is captured until an MCP
client calls `manage_project_context`.

## Storage and runtime compatibility

`PREMIERE_CONTEXT_BACKEND=auto` prefers Node's built-in SQLite store when the
runtime provides `node:sqlite`. Supported Node 20 environments fall back to an
atomic JSON store without adding a native package dependency. Operators can force
`sqlite`, `json`, or non-persistent `memory` behavior. `PREMIERE_CONTEXT_DIR`
overrides the OS application-data directory.

The store persists project names, hashed project/media-path identities, bounded
timeline metadata, and explicit enrichments. It does not persist native project or
media paths. Enrichment metadata keys that resemble paths, passwords, tokens,
secrets, or API keys are discarded.

## Recommended workflow

1. Call `manage_project_context` with `action: "capture"` while the intended
   sequence is active. Capture is bounded to 2,000 timeline items and returns the
   project, source, timeline, and combined context revisions.
2. Analyze only the required sources. Add transcript passages, shot descriptions,
   audio observations, or editor notes through `action: "enrich"`. Include the
   returned source revision to reject stale analysis.
3. Call `search_project_context` with the current editing intent and optional
   sequence/kind filters. Results contain evidence, stable Premiere identities,
   source time ranges, and revision provenance.
4. Call `create_context_edit_plan` for a non-mutating candidate scaffold. Review
   every candidate, capture again if the timeline changed, and resolve exact
   identities before building timeline operations.
5. Use `preview_edit_plan` before `apply_edit_plan`. The context plan is evidence,
   not mutation authority or proof that an editorial decision is correct.
6. Clear local project context when it is no longer required.

## Revision and invalidation model

Source and timeline state are deliberately separate:

- A source revision uses stable project-item identity plus a hashed media path and,
  when the local server can stat the media, file size and modification time.
- A timeline revision covers sequence identity, timeline-item identity, source
  in/out, sequence start/end, speed, media type, and track index.
- The context revision covers both revisions plus all enrichment content.

Moving or trimming a timeline item changes the timeline revision but retains
transcript, shot, and audio enrichments for unchanged source media. A changed or
relinked source invalidates enrichments tied to the prior source revision. Event
loss or an ambiguous state is recovered by capturing a fresh bounded snapshot.

## Analysis boundaries

Capture does not transcribe speech, infer speakers, detect shots, calculate
loudness, or send footage to a model. Those analyses are explicit enrichments so
operators can choose Premiere transcript export, local software, or an approved
provider. Premiere's documented transcript APIs support transcript import/export;
they do not expose a stable operation for starting Speech-to-Text.

Automated tests validate storage, privacy, invalidation, retrieval, and plan
contracts. They do not replace validation against a licensed Premiere host.
