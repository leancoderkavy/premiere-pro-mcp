# Adobe Premiere UXP 26.3 coverage

This page records the Adobe 26.3 UXP surface targeted by this branch. It is a
capability plan and public-contract reference, not a claim that every supported
Premiere build has been exercised. The package must interrogate the connected
panel through `capabilities.get`; package version, static TypeScript declarations,
and unit tests are insufficient evidence that a particular host supports a command.

The later stable-API expansion is documented separately in the
[stable UXP workflow matrix](uxp-stable-workflows.md). Its eleven coverage entries
share this pinned 26.3 declaration baseline and the same pending live-host gate.

## Source and version policy

Adobe's [26.3 changelog](https://developer.adobe.com/premiere-pro/uxp/changelog/)
is the primary release baseline. It introduced the APIs below and tightened the
rule that `create*Action()` calls occur inside `project.lockedAccess()` before the
action is consumed by `project.executeTransaction()`.

Use the stable [`@adobe/premierepro` 26.3.0 package](https://www.npmjs.com/package/@adobe/premierepro)
for declarations. It contains types only; Premiere supplies the runtime module as
`require("premierepro")`. Adobe's npm `beta` channel is a preview of later work
(currently 26.5) and is not a supported runtime target for this MCP release. A
beta declaration or a beta sample may guide research, but it must not add a tool,
minimum-version claim, or production capability until Adobe ships the API in a
stable host and the live-host gate below passes.

Adobe's [TypeScript guidance](https://developer.adobe.com/premiere-pro/uxp/resources/fundamentals/typescript-support/)
and [ESLint guidance](https://developer.adobe.com/premiere-pro/uxp/resources/fundamentals/eslint-support/)
are part of the implementation baseline. In particular, the lint rules flag action
creation outside locks, asynchronous lock/transaction callbacks, and actions that
escape their lock scope.

## Command coverage

All entries in this table target Premiere 26.3+ and require a connected authenticated
local panel. `Supported` means the command has a documented API and an MCP contract;
the runtime probe can still return `supported: false` for an individual host. The
verification column describes the required evidence, not a completed test run.

| MCP tool | UXP protocol command | Adobe API | Operation | Capability state | Verification evidence |
| --- | --- | --- | --- | --- | --- |
| `rename_track_uxp` | `track.rename` | `AudioTrack`, `VideoTrack`, and `CaptionTrack` `createSetNameAction()` | Undoable project mutation | Supported when the selected track type and action APIs probe true | Read back the target track's name after the committed transaction; live host must also validate Undo. |
| `create_subclip_uxp` | `subclip.create` | `ClipProjectItem.createSubClipAction()` | Undoable project mutation | Supported when the resolved item is a clip and action APIs probe true | Return and re-resolve the created subclip identity; live host must validate hard boundaries and audio/video options. |
| `list_markers_uxp` | `marker.list` | `Marker.guid`, `getUrl()`, `getTarget()`, plus marker accessors | Read-only | Supported when sequence or clip marker APIs probe true | Return marker values and the stable 26.3 `guid`; optional web-link URL/target fields require explicit caller opt-in and do not mutate Premiere. |
| `set_source_monitor_position_uxp` | `sourceMonitor.position.set` | `SourceMonitor.setPosition()` | Source Monitor state mutation; no edit-history claim | Supported when `setPosition` and position read-back APIs probe true | Read `SourceMonitor.getPosition()` after setting the requested `TickTime`. |
| `manage_sequence_range_uxp` | `sequence.range.inspect`, `sequence.range.update` | `Sequence` range accessors plus `createSetInPointAction()`, `createSetOutPointAction()`, and `createSetZeroPointAction()` | Undoable sequence-range mutation | Supported when every accessor, action, `TickTime`, and transaction primitive probes true | Read the complete range after one transaction and require it to match the guarded request; live host must also validate Undo. |
| `manage_sequence_playhead_uxp` | `sequence.playhead.inspect`, `sequence.playhead.set` | `Sequence.getPlayerPosition()` and `Sequence.setPlayerPosition()` | Sequence player-state mutation; no project-save or Undo claim | Supported when the active sequence, `TickTime`, getter, and setter probe true | Require the inspected sequence GUID and exact current position, serialize competing setters, then read the player position back. |
| `inspect_sequence_timing_uxp` | `sequence.timing.inspect` | `Sequence.getFrameSize()`, `getTimebase()`, audio/video time-display getters, and `getProjectItem()` | Read-only timing and ownership snapshot | Supported when the active sequence exposes each listed getter; invocation then requires the returned ProjectItem to expose a valid ID | Return bounded native values and reject a different active sequence at read completion. This is not a locked atomic snapshot, does not detect a transient switch back to the same sequence, and is not licensed-host proof. |
| `manage_sequence_display_format_uxp` | `sequence.displayFormat.inspect`, `sequence.displayFormat.update` | `Sequence.getSettings()`, `createSetSettingsAction()`, and `SequenceSettings` audio/video display-format getters, setters, and constants | One undoable sequence-settings mutation | Supported when the getters, setters, documented constants, and transaction primitives probe true | Require the inspected sequence GUID and complete two-code snapshot, serialize all competing updates for that sequence, commit one native settings action, and read both codes back. Contract coverage is not licensed-host or Undo proof. |
| `manage_source_media_timing_uxp` | `source.mediaTiming.inspect`, `source.mediaTiming.setStart` | `ClipProjectItem.getMedia()`, stable `Media.start`/`duration`, `Media.createSetStartAction()`, `TickTime`, and Project transaction primitives | One undoable source-media start-time mutation | Supported when the resolved clip's media surface, TickTime factory, and transaction primitives probe true | Require the exact project-item ID and a complete start/duration snapshot, serialize competing updates for that clip, reject a changed synchronous timing snapshot under the action lock, then read back the requested start and unchanged duration. Contract coverage is not licensed-host, timecode-display, persistence, or Undo proof. |
| `create_empty_sequence_uxp` | `sequences.createEmpty` | `Project.createSequence()`, `Project.getSequences()`, and sequence identity accessors | Direct project mutation; no Undo or transaction claim | Supported when the active project exposes documented empty-sequence creation | Require explicit confirmation and an operation ID, serialize the complete project-sequence capacity snapshot through creation and post-call collection readback, and verify the returned identity. Contract coverage is not licensed-host proof. |
| `inspect_project_tree_uxp` | `projectTree.inspect` | `Project.getRootItem()`, `FolderItem.getItems()`, and project-item identity accessors | Read-only bounded Project-panel tree snapshot | Supported when the active project exposes a readable root folder and runtime folder casts | Return only stable IDs, names, types, parent IDs, bin state, and optional color-label indexes, capped at 512 items and depth 16. It omits media paths, metadata, and content; depth or item truncation is explicit, and this is not licensed-host proof. |
| `has_transcript_uxp` | `transcript.has` | `Transcript.hasTranscript()` | Read-only | Native 26.3 support is used when it probes true; the existing 25.6 transcript-export compatibility probe is labeled as a fallback | Return Adobe's native boolean when available; never infer transcript presence from names or transcript text. |
| `export_aaf_uxp` | `interchange.aaf.export` | `ProjectConverter.exportAAF()` and `AAFExportOptions` | Export side effect; no project undo claim | Supported when converter and option APIs probe true | Record Premiere's boolean result and, in a live host, confirm the intended AAF artifact exists and is usable. |

The 26.3 command-registry entries mark their documented status, 26.3 minimum,
read-only/destructive/undoable metadata, and an explicit reason if the host does
not expose the required API. `transcript.has` is a pre-existing protocol command:
its capability record identifies both its 25.6 export-probe compatibility path and
whether the 26.3 native check is present. A command failure is never retried
automatically through CEP or QE: a failed UXP mutation can already have changed
Premiere state.

## Public argument contract

The MCP layer uses snake_case arguments and converts them to the protocol's
camelCase form. Unknown protocol properties must be rejected. Numeric time inputs
are finite, non-negative seconds and are converted to `TickTime` inside the panel.
Track indices are zero-based non-negative integers. Mutations accept the existing
bounded `operation_id` replay key where applicable.

- `rename_track_uxp`: `track_type` is `video`, `audio`, or `caption`;
  `track_index` is zero-based; `name` is non-empty and at most 255 characters.
- `create_subclip_uxp`: `name` is non-empty and at most 255 characters;
  `start_seconds` is finite and non-negative; `end_seconds` is finite and strictly
  greater than `start_seconds`. Supply at most one `project_item_id` (512
  characters maximum) or `project_item_name` (255 maximum); omitting both uses
  exactly one Project-panel selection. `hard_boundaries` defaults to `false`;
  `take_video` and `take_audio` each default to `true`.
- `list_markers_uxp`: `scope` defaults to `sequence` and may be `project_item`.
  The latter accepts one item selector as above. `filters` is an optional list of
  at most 16 marker-type strings, each at most 64 characters. Web-link `url` and
  `target` fields are omitted unless `include_web_links=true`, because a URL can
  contain sensitive query data. When opted in, a host that does not expose an
  individual documented accessor returns `null` for that field; this is a marker
  metadata snapshot, not a link reachability, browser-navigation, or licensed-host
  validation claim.
- `set_source_monitor_position_uxp`: `seconds` is finite and non-negative.
- `manage_sequence_range_uxp`: `inspect` returns the active sequence GUID and its
  complete in/out/zero-point/end snapshot. `update` requires that GUID and the
  complete `expected_range` from `inspect`, plus one or more bounded updates.
  Stale snapshots, unknown fields, and a final range outside `0 <= in <= out <= end`
  are rejected before any Premiere action is created. Zero point is independently
  bounded but is not conflated with the sequence in/out export range.
- `manage_sequence_playhead_uxp`: `inspect` returns the active sequence GUID and
  current player position. `set` requires both exact values plus a requested
  position, each finite and within 0 through 86400 seconds. A changed sequence or
  position outside a one-microsecond tolerance rejects before the setter is called;
  accepted requests require boolean host confirmation and player-position readback
  within that same tolerance. It controls UI player
  state only, so it does not claim a project save or Undo entry.
- `inspect_sequence_timing_uxp`: accepts no arguments and returns the active
  sequence GUID/name, positive integral native frame dimensions, a positive
  bounded decimal timebase, non-negative integral
  audio/video `TimeDisplay.type` codes, and backing Project-item ID/name. Every
  field is bounded and validated. The panel re-resolves the active sequence
  after the asynchronous getter set and fails when its GUID no longer matches
  the sequence captured at request start. Adobe does not expose an atomic
  snapshot or activation revision here, so a transient switch back to the same
  sequence is not detectable. It performs no mutation, transaction, or
  operation replay.
- `manage_sequence_display_format_uxp`: `inspect` returns the resolved sequence
  GUID, a complete `displayFormats` snapshot containing both native
  `audio_display_format` and `video_display_format` codes, and the exact
  `SequenceSettings` constants supported by that host. `update` requires the
  inspected GUID, both expected codes, at least one requested code from that
  returned list, and an `operation_id`. The panel serializes the entire
  resolve/snapshot/stale-check/setter/action/readback flow per sequence,
  including different operation IDs; it rejects stale codes before either
  setter or action construction, executes one `createSetSettingsAction()`
  transaction, and verifies both requested codes through a new settings read.
  Completed duplicate operation IDs replay through the command registry.
  Cancellation is explicitly unsupported, and the mock contract does not prove
  host acceptance, persistence, or Undo behavior.
- `manage_source_media_timing_uxp`: `inspect` requires one `project_item_id` and
  returns that ID plus finite non-negative `start_seconds` and `duration_seconds`.
  `set_start` requires the same ID, the complete `expected_timing` snapshot, a
  bounded finite non-negative `start_seconds`, `confirm_set_start: true`, and an
  optional `operation_id`. The panel serializes the full preflight/action/readback
  boundary per project and item, rechecks the stable synchronous timing properties
  inside `lockedAccess`, commits exactly one native action in one transaction, and
  verifies the requested start and unchanged duration afterward. It neither uses
  beta-only `Media` getters nor accepts a beta Promise-shaped timing property as a
  mutation fallback.
- `create_empty_sequence_uxp`: requires a non-empty `name`,
  `confirm_non_undoable: true`, and a bounded non-empty `operation_id`. It performs
  no sequence action or transaction because Adobe exposes this as a direct
  `Project.createSequence()` call. The panel serializes the full project-sequence
  capacity preflight, creation call, and identity readback. A host rejection after a
  detected creation, missing identity, or unreadable readback returns a replayable
  `committed_unverified` partial receipt; it does not claim Undo or cancellation.
- `inspect_project_tree_uxp`: accepts optional `max_items` from 1 through 512
  (default 256) and `max_depth` from 0 through 16 (default 6). The root item is
  returned separately; only non-root entries count toward `max_items`. Children
  retain Premiere's returned order and include their depth and known parent ID.
  `itemLimitReached` and `depthLimitApplied` explicitly mark a partial traversal.
  This is a read-only structural snapshot, not an atomic project revision,
  media-path/metadata inventory, playback proof, or licensed-host validation.
- `has_transcript_uxp`: accepts at most one resolved `project_item_id` or
  `project_item_name`; omitting both requires exactly one Project-panel selection.
- `export_aaf_uxp`: `output_file_path` is non-empty and at most 4096 characters.
  Its optional allow-listed `options` fields are boolean `mixdown_video`,
  `explode_to_mono`, `embed_audio`, `trim_sources`, `render_audio_effects`,
  `interleave_without_effects`, and `preserve_parent_folder`; `sample_rate` one
  of 32000, 44100, 48000, 88200, or 96000; `bits_per_sample` one of 16, 24, or
  32; `audio_file_format` `aiff` or `wav`; `handle_frames` an integer from 0 to
  10000; and `video_mixdown_preset_path` at most 4096 characters.

The exact schemas are exercised by the repository's `tests/tools/adobe-26-3-uxp-catalog.test.ts`
and `tests/uxp/adobe-26-3-commands.test.ts` contract tests. These are interface
tests with a mock UXP host, not host integration tests.

## Migration guidance

1. Keep existing CEP tools for their documented compatibility range. UXP is the
   preferred backend only when the exact UXP command is advertised as supported.
2. Do not select a backend based only on `host.minVersion`; inspect the live
   capability response for the active project and installed Premiere build.
3. For action mutations, create and add the action synchronously inside the
   `lockedAccess`/`executeTransaction` boundary. Do not await inside either
   callback or return an action for later use.
4. Treat `Sequence.setSelection()` as synchronous in 26.3; remove `await` or
   `.then()` chaining from callers. This change is independent of the six new
   MCP commands but required for 26.3 compatibility.
5. Do not silently fall back after a UXP mutation error. Return backend,
   `operationId`, result envelope, and verification state so the caller can
   inspect the host before deliberately choosing another operation.

## Automated evidence and live-host gate

Automated tests may prove these properties:

- MCP tools/list exposes the six tools only with a UXP bridge;
- public schemas reject invalid shapes and translate into the documented protocol
  command names and camelCase arguments;
- capability probes report unavailable APIs without optimistic version guessing and
  distinguish the 26.3 native transcript check from its older export-probe fallback;
- sequence-range updates require the complete read snapshot, place all requested
  actions in one transaction, and reject a changed sequence or range before action
  construction;
- sequence-playhead requests reject stale sequence or position snapshots, serialize
  concurrent setters per sequence, and require boolean acceptance plus position
  readback;
- sequence-timing inspection probes every required getter, accepts only positive
  integral `RectF` values within [Premiere's documented 10,240x8,192 sequence
  maximum](https://helpx.adobe.com/premiere/desktop/edit-projects/change-clip-sequence/sequence-settings-reference.html)
  and non-negative integral `TimeDisplay.type` codes, bounds Project-item
  identity values, and rejects an active sequence mismatch at read completion; it
  does not prove detection of a
  transient switch back to the same sequence; and
- sequence-display-format updates require a complete two-code snapshot and
  sequence GUID, reject stale values within the same per-sequence exclusion
  boundary, accept only runtime-advertised official constants, commit one
  settings action, replay a completed operation ID, and verify native readback;
  and
- source-media timing updates require confirmation plus a complete timing snapshot,
  serialize conflicting requests per project-item ID, reject an old snapshot before
  action construction, commit one action in one transaction, replay completed
  operation IDs, and require start/duration readback; and
- action commands preserve lock/transaction boundaries and operation replay
  behavior in a contract host; and
- AAF options are bounded before a call reaches the host adapter.

They do not prove an Adobe host loaded the panel, accepted a transaction, wrote an
AAF, or produced a usable Undo entry. Before release, validate on a real Premiere
26.3+ installation with the UXP Developer Tool and an authenticated bridge:

1. Confirm `capabilities.get` reports all intended commands supported.
2. Rename video, audio, and caption tracks; read each name back and Undo it.
3. Create video-only, audio-only, and combined subclips; inspect item identity,
   media inclusion, in/out points, and hard-boundary behavior; then Undo.
4. List existing markers twice and confirm their GUIDs are stable for the same
   project state.
5. Set the Source Monitor position and read the position back with a sensible
   time tolerance.
6. Inspect a sequence range, change one field and all three fields, verify the
   returned values, and Undo each update. Confirm stale range snapshots fail before
   changing the sequence.
7. Inspect sequence timing, switch to another active sequence before readback
   completes, and confirm the command rejects the final mismatch. For an
   unchanged sequence, compare frame size, timebase, both time-display codes, and
   the backing Project-item identity with the Premiere UI. A transient switch that
   returns to the same sequence is outside this command's proof boundary.
8. Inspect display formats, change audio and video codes separately and together,
   confirm both codes read back, repeat an `operation_id` without a second
   transaction, confirm a stale full snapshot is rejected, and Undo each accepted
   update.
9. Inspect one source clip's media timing, update its start from the returned
   snapshot, confirm the requested start and unchanged duration read back, retry the
   same `operation_id`, exercise a stale snapshot, and Undo the accepted action.
10. Check both a transcribed and non-transcribed clip with `transcript.has`.
11. Export an AAF with representative options; confirm the resulting artifact is
   present, opens in the intended downstream workflow, and any requested media
   side effects match the options.
12. Disconnect/reconnect the panel and exercise duplicate `operation_id` calls;
   confirm that a completed mutation is replayed rather than repeated in the
   same panel session.

Only this final evidence can change a command's release status from
`committed_unverified` or `supported_pending_live_host` to `verified` for a
specific Premiere version and platform.

## Primary references

- [Premiere Pro UXP 26.3 changelog](https://developer.adobe.com/premiere-pro/uxp/changelog/)
- [AudioTrack `createSetNameAction`](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/audiotrack), with matching `VideoTrack` and `CaptionTrack` methods
- [ClipProjectItem `createSubClipAction`](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/clipprojectitem)
- [Marker `guid`](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/marker)
- [SourceMonitor `setPosition`](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sourcemonitor)
- [Sequence range actions, timing accessors, and display formats](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequence)
- [ClipProjectItem and Media timing/start actions](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/media)
- [Transcript `hasTranscript`](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/transcript)
- [ProjectConverter `exportAAF`](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/projectconverter) and [AAFExportOptions](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/aafexportoptions)
- [Adobe official UXP samples](https://github.com/AdobeDocs/uxp-premiere-pro-samples)
