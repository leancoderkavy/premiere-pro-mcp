# Film editorial coverage and handoff

`inspect_film_editorial_workflow` turns an explicit film manifest into deterministic,
revision-bound review artifacts. It reads the same local repository as
`manage_project_context`. It makes no Premiere calls, writes no project or files,
and does not invoke a model. Available in the full and assistant-edit tool packs
under inspect authority.

The implementation follows the configurable workflows described in
[research PR #476](https://github.com/leancoderkavy/premiere-pro-mcp/pull/476):
Cross-style source markers, line comparisons, complete stringouts and overlapping
beat sections are selectable representations of one coverage graph. These are
configurable patterns, not replicas of private film project templates.

## Use

1. Capture scoped source and timeline records with `manage_project_context`.
   Read back the project, context, source and timeline revisions. Use actual
   source evidence IDs and timeline occurrence IDs from that capture.
   `sources[].sourceRevision` and `occurrences[].timelineRevision` are the
   individual record revisions, distinct from the aggregate top-level revisions.
2. Supply a manifest shaped like [the synthetic example](film-editorial-workflows.example.json).
   Replace every fixture identity, revision, source duration, channel and range.
   The example has no associated real Premiere project.
3. Call `inspect_film_editorial_workflow` with that JSON object as arguments.
4. Review `exceptions`, `sceneCoverage`, `reviewArtifacts`, independent picture
   and audio preferences, notes, VFX state, viewing settings and turnover entries.
5. Save the returned packet in the client if desired. Pass its `snapshot` as
   `previous` after the next capture to compare occurrence changes.
6. Use existing `create_editorial_plan` → `preview_editorial_plan` →
   `apply_editorial_organization_plan` for supported organization. The apply tool
   still requires its own issued unchanged plan, token, approval and live UXP
   checks. A film packet cannot be passed to an apply tool as authorization.

All frame ranges are half-open `[inFrame, outFrame)` in the stated rational
timebase. Handles and beat overlap are source frames; 24 frames are not exactly
one second at 24000/1001 fps. Source and timeline timebases remain separate.
Declared 1x durations must match exactly using integer arithmetic. Retime
declarations produce a manual-review exception rather than invented mappings.

## Implemented behavior

| Area | Local artifact and checks |
| --- | --- |
| Profiles | Named review mode, source overlap and explicit video/audio track roles; duplicate track assignments rejected |
| Coverage | Source-range to multiple script scenes; scene/setup coverage, unreviewed sources and omitted captured records; no favorites-only filtering |
| Review | Deduplicated source markers; complete scene stringouts; separate line/beat comparison groups; source-bounded beat handles; caller order retained |
| Preferences | Independent picture and audio ranks with reviewer, revision and reason; no algorithmic selection or sorting |
| Screening | Notes retain original sequence, revision and frame; stale/unknown references require human remapping; addressed and accepted remain separate |
| Change impact | Added, removed, changed and reel-moved occurrences; conservative sound/color/VFX notification list; conflicting same-revision snapshots rejected |
| Viewing | Explicit burn-in, rough-VFX and temp-audio declarations plus required rendered-output checks |
| Turnover | Source and occurrence IDs, channels, source/timeline ranges and timebases, available handles, explicit department/format/settings, readiness exceptions |
| VFX | Separate creative and delivery states, prior version identity and receipt requirement for sent/acknowledged/reconciled declarations; replacement never authorized |
| Story | Source-fragment cards, dependency order, missing references and cycle rejection |

`packetId` is a deterministic SHA-256 content fingerprint, **not** an authentication
token or persisted audit receipt. The tool never silently truncates arrays: limits
are 200 sources/scenes, 500 coverage ranges/occurrences, 200 notes/VFX shots and
100 story cards per request. Larger projects need deliberately scoped packets;
omitted captured records are reported as exceptions.

## Evidence and remaining execution work

Identity/revision checks establish consistency with captured context, not that
Premiere is still in that state. Source durations, sync status, channel layouts,
range mappings, notes, preferences and delivery receipts are caller declarations.
They do not become observed host facts by appearing in a packet. Arbitrary
captured record metadata and media paths are not copied into the output.

This implements the shared coverage model and local artifacts across the research
work packages. The following execution adapters remain unfinished:

- Materializing markers and derivative review timelines with live readback and
  approval-bound previews, including mixed timebases and preferred track layouts.
- Persistent collaboration history and authoritative vendor acknowledgement
  reconciliation. A caller-supplied receipt string is not vendor verification.
- Automated source-mapped VFX version replacement with recovery evidence.
- Applying viewing profiles and checking rendered images/audio.
- Department exports and round-trip checks against actual AAF/XML/EDL support,
  nests, multicam, merged clips, effects, retimes and media availability.

`readyForHostPreflight` means no local exceptions were found; it never means
ready to deliver. `applied`, `hostVerified`, viewing `verified`, and turnover
`exported` remain false. No licensed-host execution was verified by the local
tests. Keep existing manual/guarded host routes until the adapters have their
own live validation.

Validation: `npm run build`, `npx vitest run tests/film-editorial.test.ts`, then
`npm run check`. The test suite includes an actual in-memory MCP request through
the registered server and synthetic captured context; no Premiere host is used.
