# Adobe Premiere UXP 26.3 coverage

This page records the Adobe 26.3 UXP surface targeted by this branch. It is a
capability plan and public-contract reference, not a claim that every supported
Premiere build has been exercised. The package must interrogate the connected
panel through `capabilities.get`; package version, static TypeScript declarations,
and unit tests are insufficient evidence that a particular host supports a command.

The later stable-API expansion is documented separately in the
[stable UXP workflow matrix](uxp-stable-workflows.md). Its coverage entries
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
| `manage_app_preferences_uxp` | `preferences.inspect`, `preferences.set` | `AppPreference.getValue()`, `setValue()`, the three documented preference keys, and persistence constants | Direct application-state update; no project-save, transaction, or Undo claim | Supported when all three named keys, both property-type constants, and the exact getter/setter probe true | Return three bounded native strings. A write accepts only one allow-listed key and string value, requires the exact inspected value, explicit persistence and confirmation, serializes competing writes to that key, and verifies exact native-string readback. This is not a licensed-host proof. |
| `inspect_sequence_timing_uxp` | `sequence.timing.inspect` | `Sequence.getFrameSize()`, `getTimebase()`, audio/video time-display getters, and `getProjectItem()` | Read-only timing and ownership snapshot | Supported when the active sequence exposes each listed getter; invocation then requires the returned ProjectItem to expose a valid ID | Return bounded native values and reject a different active sequence at read completion. This is not a locked atomic snapshot, does not detect a transient switch back to the same sequence, and is not licensed-host proof. |
| `manage_sequence_display_format_uxp` | `sequence.displayFormat.inspect`, `sequence.displayFormat.update` | `Sequence.getSettings()`, `createSetSettingsAction()`, and `SequenceSettings` audio/video display-format getters, setters, and constants | One undoable sequence-settings mutation | Supported when the getters, setters, documented constants, and transaction primitives probe true | Require the inspected sequence GUID and complete two-code snapshot, serialize all competing updates for that sequence, commit one native settings action, and read both codes back. Contract coverage is not licensed-host or Undo proof. |
| `manage_source_media_timing_uxp` | `source.mediaTiming.inspect`, `source.mediaTiming.setStart` | `ClipProjectItem.getMedia()`, stable `Media.start`/`duration`, `Media.createSetStartAction()`, `TickTime`, and Project transaction primitives | One undoable source-media start-time mutation | Supported when the resolved clip's media surface, TickTime factory, and transaction primitives probe true | Require the exact project-item ID and a complete start/duration snapshot, serialize competing updates for that clip, reject a changed synchronous timing snapshot under the action lock, then read back the requested start and unchanged duration. Contract coverage is not licensed-host, timecode-display, persistence, or Undo proof. |
| `manage_source_media_overrides_uxp` | `source.mediaOverrides.inspect`, `source.mediaOverrides.update` | `ClipProjectItem.getFootageInterpretation()`, `FootageInterpretation.getFrameRate()`, `getPixelAspectRatio()`, `createSetOverrideFrameRateAction()`, `createSetOverridePixelAspectRatioAction()`, and Project transaction primitives | One undoable explicit source-media interpretation-override mutation | Supported when the resolved clip, effective interpretation getters, dedicated override actions, and transaction primitives probe true | Require the exact project/item/effective-value snapshot, confirmation, and operation ID; serialize this protocol's competing source-media timing/override updates per item; construct requested actions under one lock and commit one transaction, then read both effective values back. Adobe exposes no explicit-override-presence or clear getter, so matching effective values do not prove persistence or distinguish an override from file-native interpretation. Contract coverage is not licensed-host or Undo proof. |
| `inspect_track_item_identity_uxp` | `trackItem.identity.inspect` | Audio/video `TrackItem.getMatchName()`, `getType()`, `getMediaType()`, `getTrackIndex()`, and `getIsSelected()` | Read-only single-track-item identity snapshot | Supported when the active sequence, requested track item, and every documented identity getter probe true | Require one bounded audio/video coordinate, optionally reject a stale expected sequence GUID, and re-read the active sequence identity before returning. It returns no paths, effect parameters, rendered output, or visual proof; a switch away and back to the same sequence during the call is not detected, and contract coverage is not licensed-host proof. |
| `slip_track_item_uxp` | `trackItem.slip.inspect`, `trackItem.slip` | Audio/video `TrackItem` timing getters, `createSetInPointAction()`, `createSetOutPointAction()`, and Project transaction primitives | One undoable source-only slip | Supported when the active sequence exposes the bounded requested clip and all required timing/action APIs | Require a complete reviewed snapshot, explicit confirmation, and operation ID; serialize competing slips per item, create exactly two source-point actions in one transaction, then verify unchanged timeline timing plus the exact shifted source range. It supports only forward 1x items and does not prove media-handle availability, rendered frames, linked-item sync, persistence, Undo, or licensed-host behavior. |
| `slide_track_item_uxp` | `trackItem.slide.inspect`, `trackItem.slide` | Audio/video `TrackItem` timing getters; `createMoveAction()`, timeline/source trim actions; and Project transaction primitives | One undoable contiguous three-item slide | Supported when the bounded requested center item has immediate contiguous same-track clip neighbours and every required action API probes true | Require a complete three-item snapshot, confirmation, and operation ID; serialize slides and slips on the track, create five actions in one transaction, then verify every source/timeline boundary and both retained cuts. Only forward 1x items with matching source/timeline durations are supported; media handles, linked A/V, rendering, playback, persistence, Undo, and licensed-host behavior remain unproven. |
| `create_empty_sequence_uxp` | `sequences.createEmpty` | `Project.createSequence()`, `Project.getSequences()`, and sequence identity accessors | Direct project mutation; no Undo or transaction claim | Supported when the active project exposes documented empty-sequence creation | Require explicit confirmation and an operation ID, serialize the complete project-sequence capacity snapshot through creation and post-call collection readback, and verify the returned identity. Contract coverage is not licensed-host proof. |
| `inspect_project_tree_uxp` | `projectTree.inspect` | `Project.getRootItem()`, `FolderItem.getItems()`, and project-item identity accessors | Read-only bounded Project-panel tree snapshot | Supported when the active project exposes a readable root folder and runtime folder casts | Return only stable IDs, names, types, parent IDs, bin state, and optional color-label indexes, capped at 512 items and depth 16. It omits media paths, metadata, and content; depth or item truncation is explicit, and this is not licensed-host proof. |
| `inspect_project_panel_metadata_uxp` | `metadata.columns.get`, `metadata.projectPanel.get` | `Metadata.getProjectColumnsMetadata()` and `Metadata.getProjectPanelMetadata()` | Read-only bounded Project-panel metadata snapshot | Supported when the exact documented accessor probes true; item columns additionally resolve one media item | Return one native metadata string capped at 350,000 characters and 900,000 serialized UTF-8 bytes. It intentionally offers no schema-creation or `setProjectPanelMetadata()` route because the documented setter has no project-targeted action/transaction boundary. This is not an atomic project snapshot or licensed-host proof. |
| `has_transcript_uxp` | `transcript.has` | `Transcript.hasTranscript()` | Read-only | Native 26.3 support is used when it probes true; the existing 25.6 transcript-export compatibility probe is labeled as a fallback | Return Adobe's native boolean when available; never infer transcript presence from names or transcript text. |
| `import_transcript_uxp` | `transcript.import` | `Transcript.hasTranscript()`, `exportToJSON()`, `importFromJSON()`, and `createImportTextSegmentsAction()` with Project transaction primitives | One undoable source-transcript replacement | Supported when the exact transcript, project-root traversal, clip-cast, and transaction APIs probe true | Require an exact project GUID, project-item ID, and current transcript SHA-256 (or `null` for an untranscribed clip), explicit confirmation, and an operation ID. Serialize competing imports for that clip; cap input at 24 KiB and snapshots at 1 MiB; re-snapshot before action creation; then require exact export-SHA readback. A committed readback failure is `committed_unverified`, not proof of the imported text, Undo, persistence, or licensed-host behavior. |
| `export_aaf_uxp` | `interchange.aaf.export` | `ProjectConverter.exportAAF()` and `AAFExportOptions` | Export side effect; no project undo claim | Supported when converter and option APIs probe true | Record Premiere's boolean result and, in a live host, confirm the intended AAF artifact exists and is usable. |

The 26.3 command-registry entries mark their documented status, 26.3 minimum,
read-only/destructive/undoable metadata, and an explicit reason if the host does
not expose the required API. `transcript.has` is a pre-existing protocol command:
its capability record identifies both its 25.6 export-probe compatibility path and
whether the 26.3 native check is present. A command failure is never retried
automatically through CEP or QE: a failed UXP mutation can already have changed
Premiere state. `transcript.import` is intentionally separate from the older 25.6
export/search compatibility path because its guarded target identity and native
`hasTranscript()` preflight require the stable 26.3 surface.

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
- `manage_app_preferences_uxp`: `inspect` returns only the native string values
  for Adobe's three documented named keys: `auto_peak_generation`,
  `import_workspace`, and `show_quickstart_dialog`. `set` requires one of those
  keys, its exact `expected_value` from inspection, a string `value` capped at
  1024 characters, an explicit `persistent` or `non_persistent` flag,
  `confirm_preference_change: true`, and a bounded `operation_id`. The panel
  serializes competing writes for the same key, rechecks the expected native
  string immediately before the direct setter, requires Adobe's boolean success,
  then requires exact native-string readback. Adobe exposes no project action,
  transaction, cancellation, or Undo boundary for this application state, so none
  is claimed; mock coverage is not licensed-host, persistence, or user-interface
  behavior proof.
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
- `manage_source_media_overrides_uxp`: `inspect` requires one
  `project_item_id` and returns its active project GUID, the ID, and bounded
  effective frame-rate and pixel-aspect-ratio values. `update` requires that
  complete `expected_overrides` snapshot, an explicit
  `confirm_media_interpretation: true`, a bounded `operation_id`, and one or both
  requested overrides. Frame rate is a finite 1 through 240 value; pixel aspect
  is a positive integer numerator/denominator pair whose resulting ratio is 0.01
  through 100. The panel serializes this protocol's source-media timing/override
  operations per project/item, rejects changed effective values before action
  creation, builds only the requested dedicated override actions under one
  `lockedAccess()` callback, commits exactly one transaction, and reads both
  effective values back. `getFootageInterpretation()` is asynchronous, so the
  effective snapshot is refreshed immediately before the lock rather than
  falsely claiming an in-lock getter recheck. Adobe provides no documented
  explicit-override presence or clear API: the tool cannot clear an override or
  distinguish a matching override from file-native interpretation. Mock and
  static contract coverage are not licensed-host, persistence, display, or Undo
  proof.
- `slip_track_item_uxp`: `inspect` returns a complete bounded active-project,
  sequence, coordinate, timeline/source timing, speed, and reverse snapshot for
  one audio or video clip. `apply` requires that exact snapshot,
  `confirm_slip: true`, a non-zero source offset from -60 to 60 seconds, and an
  `operation_id`. Slips are serialized per target through stale preflight,
  action creation, transaction, and readback. The panel creates only the
  documented source-in and source-out actions in one transaction and requires
  timeline start/end/duration to remain unchanged on the coordinate-resolved
  readback. It supports forward 1x items only; a host may reject or normalize a
  source point beyond available media because this API exposes no source-handle
  maximum. A readback failure can follow a committed transaction and is not
  rendered-frame, A/V-link, persistence, Undo, or licensed-host proof.
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
- `inspect_sequence_structure_uxp`: `include_source_project_items` is false by
  default. Setting it true returns each bounded timeline clip's stable source ID.
  `include_source_project_item_content_type: true` additionally requires that ID
  opt-in and returns only the documented broad source category `any`, `sequence`,
  or `media`; unavailable or unrecognized host values are `null`. It does not
  return a Project-panel type code, source name, media path, metadata, or tree
  state. `include_source_project_item_classification: true` additionally requires
  that ID opt-in and returns only documented source flags for sequence, merged-clip,
  multicam-clip, and offline status. A source unavailable to Premiere or an
  unavailable individual getter is represented as `null`; no source name, type,
  media path, Project-panel metadata, or project-tree traversal is read. Only when
  explicitly requested by
  `include_source_nested_sequence_identity: true`, which also requires both
  source-ID and classification opt-ins. When and only when `isSequence` is
  exactly `true`, it returns the linked nested sequence's documented GUID; a
  non-sequence or unavailable nested source is `null`. It neither inspects the
  nested sequence nor reads Project-panel state. This is a current bounded read,
  not an atomic source/timeline revision, playback proof,
  or licensed-host validation.
- `inspect_project_panel_metadata_uxp`: action `panel` reads the active project's
  native Project-panel metadata and `item_columns` resolves one media item using
  the existing ID/name/selection rules before reading its native column metadata.
  Each returned string may be empty but is capped at 350,000 characters and the
  complete serialized result at 900,000 UTF-8 bytes. No schema or metadata setter
  is exposed: `Metadata.setProjectPanelMetadata()` lacks a project-targeted
  action/transaction boundary, so an awaited write cannot truthfully be guarded
  against an active-project switch. This read is not a locked project revision,
  metadata-schema validation, persistence proof, or licensed-host validation.
- `has_transcript_uxp`: accepts at most one resolved `project_item_id` or
  `project_item_name`; omitting both requires exactly one Project-panel selection.
- `import_transcript_uxp`: requires exact `project_item_id`, `project_guid`, and
  `expected_transcript_revision` from a current transcript inspection; only an
  explicit `null` revision may create a transcript where `has_transcript_uxp`
  reports absence. It rejects stale project or transcript state before action
  creation, requires `confirm_destructive: true` and a bounded `operation_id`,
  accepts at most 24 KiB UTF-8 JSON, and does not accept a selected item or name
  as a mutation target. A successful transaction is still reported
  `committed_unverified` when the capped export readback is unavailable or differs.
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
   `.then()` chaining from callers. This change is independent of the guarded
   MCP commands but required for 26.3 compatibility.
5. Do not silently fall back after a UXP mutation error. Return backend,
   `operationId`, result envelope, and verification state so the caller can
   inspect the host before deliberately choosing another operation.

## Automated evidence and live-host gate

Automated tests may prove these properties:

- MCP tools/list exposes documented UXP tools only with a UXP bridge;
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
- transcript import rejects unknown/unbounded input, missing confirmation, stale
  project or transcript revisions, and oversized project traversal before it
  creates an action; it serializes distinct operation IDs for one clip, commits
  exactly one transaction, replays a completed operation ID, and reports only an
  exact capped transcript-export SHA-256 match as verified; and
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
