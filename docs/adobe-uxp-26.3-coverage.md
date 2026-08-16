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
| `list_markers_uxp` | `marker.list` | `Marker.guid` plus marker accessors | Read-only | Supported when sequence or clip marker APIs probe true | Return marker values and the stable 26.3 `guid`; no project mutation. |
| `set_source_monitor_position_uxp` | `sourceMonitor.position.set` | `SourceMonitor.setPosition()` | Source Monitor state mutation; no edit-history claim | Supported when `setPosition` and position read-back APIs probe true | Read `SourceMonitor.getPosition()` after setting the requested `TickTime`. |
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
  at most 16 marker-type strings, each at most 64 characters.
- `set_source_monitor_position_uxp`: `seconds` is finite and non-negative.
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
6. Check both a transcribed and non-transcribed clip with `transcript.has`.
7. Export an AAF with representative options; confirm the resulting artifact is
   present, opens in the intended downstream workflow, and any requested media
   side effects match the options.
8. Disconnect/reconnect the panel and exercise duplicate `operation_id` calls;
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
- [Transcript `hasTranscript`](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/transcript)
- [ProjectConverter `exportAAF`](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/projectconverter) and [AAFExportOptions](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/aafexportoptions)
- [Adobe official UXP samples](https://github.com/AdobeDocs/uxp-premiere-pro-samples)
