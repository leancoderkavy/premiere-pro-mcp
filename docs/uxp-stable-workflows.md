# Stable Premiere UXP workflow expansion

- **Research refresh:** 2026-08-15
- **Research method:** Tavily discovery restricted to official Adobe sources, then
  checked against the installed stable declaration package
- **Declaration baseline:** `@adobe/premierepro@26.3.0`
- **Runtime policy:** method probes from the connected host are authoritative
- **Evidence:** automated contract tests complete; live Premiere verification not run

## Why these workflows

The existing MCP catalog already covers broad CEP and QE automation. This expansion
uses Adobe's documented stable UXP surface where it can improve transaction
discipline, selection performance, readback evidence, and filesystem authority.
It does not remove or silently replace the production CEP path. A failed UXP
mutation is returned to the caller and is never replayed automatically through CEP.

The public MCP surface adds consolidated tools. Each maps to smaller protocol
commands so `capabilities.get` can report the exact methods available in the running
Premiere build.

| Improvement | Public MCP tool | UXP commands | Host evidence |
| --- | --- | --- | --- |
| Native effects pipeline | `manage_clip_effects_uxp` | `effects.catalog`, `effects.chain.get`, `effects.chain.add`, `effects.chain.remove` | Effect catalog allowlist; component-chain count and component readback after an action transaction |
| Native track-item identity | `inspect_track_item_identity_uxp` | `trackItem.identity.inspect` | One bounded audio/video coordinate resolves documented match name, item/media type, track index, and selected state only after the active sequence identity is re-read |
| Guarded timeline source label | `manage_timeline_source_label_uxp` | `timeline.sourceLabel.inspect`, `timeline.sourceLabel.update` | A bounded active audio/video coordinate resolves its source `ClipProjectItem`; update requires the complete snapshot, confirmation, operation ID, per-source serialization, one transaction, and source-label readback. The label is project-global rather than timeline-instance state. |
| Selection compound batch | `batch_selected_clips_uxp` | `selection.inspect`, `effects.selection.add`, `effects.selection.remove` | Preflight all selected items, then commit one action group and read every chain count back |
| Deterministic timeline selection | `manage_timeline_selection_uxp` | `selection.fingerprints.inspect`, `selection.targets.inspect`, `selection.update` | Current or coordinate-resolved clips return active-sequence GUID and project-item/time fingerprints; mutations check them before one native selection update and exact readback |
| Scene-edit detection | `detect_scene_edits_uxp` | `sceneEdit.detect` | `createMarkers` requires selected project-item marker-GUID growth; cut/subclip modes return only Adobe's host result and selected-item count |
| Proxy and ingest controller | `manage_proxy_ingest_uxp` | `proxy.inspect`, `proxy.attach`, `ingest.get`, `ingest.configure` | Proxy path/attachment readback; ingest state readback after transaction |
| Offline relink repair | `relink_offline_media_uxp` | `media.relink` | Expected old path, offline default, capability check, then media-path and online-state readback |
| Transactional metadata | `manage_metadata_uxp` | `metadata.get`, `metadata.update` | Project metadata and XMP are committed together and read back; each payload is size bounded |
| Project-panel metadata inspection | `inspect_project_panel_metadata_uxp` | `metadata.columns.get`, `metadata.projectPanel.get` | Read one native item-column or active-project panel-metadata string, bounded to 350,000 characters and a 900,000-byte serialized result; no schema or metadata writes are exposed |
| Guarded Project-panel metadata replacement | `manage_project_panel_metadata_uxp` | `metadata.projectPanel.get`, `metadata.projectPanel.update` | Require the exact inspected project GUID and XML, confirmation, operation ID, local per-project serialization, then exact native readback; the direct setter is non-undoable and no atomic compare-and-set is claimed |
| Guarded Project metadata schema field creation | `create_project_metadata_field_uxp` | `metadata.projectSchema.inspect`, `metadata.projectSchema.create` | Require the exact inspected project GUID and bounded panel XML, typed name/label, confirmation, operation ID, and shared per-project serialization; native acceptance and panel-XML change are observable but Adobe exposes no atomic compare-and-set or field-level getter, so creation is always `committed_unverified` |
| Guarded app preferences | `manage_app_preferences_uxp` | `preferences.inspect`, `preferences.set` | Inspect only Adobe's three named application preferences; direct string writes require stale value, persistence, confirmation, operation ID, per-key serialization, and exact native-string readback; no transaction or Undo claim |
| Installed MOGRT-directory inspection | `inspect_installed_mogrt_directory_uxp` | `graphics.mogrtPath.inspect` | Return only documented installed-directory availability by default. A caller must explicitly request the bounded native path; the bridge does not enumerate it, read templates, or import MOGRTs. |
| Bounded Object Mask audit | `audit_object_masks_uxp` | `objectMask.audit` | Up to 64 exact sequences (or an entire project under that cap) are re-resolved with the active-project identity and every yes/no Object Mask result double-read before a response is returned. |
| Color and conformance | `manage_color_conformance_uxp` | `color.preflight`, `footage.conform` | Project graphics-white values, embedded/input LUT IDs, and requested footage fields read back |
| Source Monitor audition | `audition_source_monitor_uxp` | `sourceMonitor.state`, `sourceMonitor.open`, `sourceMonitor.position.set`, `sourceMonitor.play`, `sourceMonitor.close` | Project-item and position readback where Adobe exposes it; file open/play rely on explicit host returns |
| Productions and storage | `preflight_production_storage_uxp` | `storage.preflight`, `scratch.configure` | Project/Production scratch snapshots and project action-transaction result |
| Least-privilege workspace | `get_uxp_workspace_access` | `workspace.status` | Redacted persistent capability state; native path and token never cross the bridge |

## Performance and transaction design

- Selection batches use `Sequence.getSelection()` and `TrackItemSelection` instead
  of traversing the project tree. Classification reads only each selected item's
  reported track and caches repeated track lookups. Batches are capped at 64 clips
  and reject mixed or unclassified media types before creating any action.
- Selection management resolves every requested video/audio clip before changing
  host state, caps the resulting set at 64 clips, and rejects changed sequence,
  project-item, or timeline-time fingerprints. It accepts both the Promise form of
  `Sequence.setSelection()` in 25.6-26.2 and the synchronous boolean form in 26.3.
- Effect factories run during preflight. All component-chain actions are created
  synchronously inside `Project.lockedAccess()` and consumed by one
  `Project.executeTransaction()` call.
- Metadata project/XMP changes share one transaction. Footage interpretation and
  input-LUT actions also share one transaction.
- Proxy attachment, relink, scene detection, Source Monitor calls, and other direct
  host APIs are not described as atomic action transactions. Their result envelopes
  identify the narrower verification boundary.
- Completed mutating protocol calls may use `operation_id` replay protection for
  the current panel session. Inputs remain bounded before a host call.

These choices reduce redundant project traversal and transaction overhead by
construction. They are not a measured latency claim. A real Premiere benchmark is
still required before publishing p50 or p95 improvements.

## Non-undoable confirmations

`ClipProjectItem.attachProxy()` and `ClipProjectItem.changeMediaFilePath()` are
documented as non-undoable. Their MCP workflows require
`confirm_non_undoable: true`. Relink additionally defaults to
`require_offline: true` and supports `expected_current_path` as a stale-state guard.
Setting `override_compatibility_check` remains opt-in.

`SequenceUtils.performSceneEditDetectionOnSelection()` is also kept outside the
action-transaction claim. For `createMarkers`, the workflow snapshots each selected
item's project-item marker GUIDs and returns `verified` only when at least one GUID
is added. Cut and subclip modes return `committed_unverified` after Adobe's positive
host result because the API does not return the number or identities of created cuts
or subclips.

## Filesystem authority

The UXP manifest now declares `localFileSystem: "request"`, replacing
`"fullAccess"`. The operator chooses one root in the panel. The panel persists
Adobe's opaque folder token in plugin data and restores it with
`getEntryForPersistentToken()`.

The workspace broker applies these rules:

1. A file path must be absolute, at most 4096 characters, and free of NUL bytes.
2. `.` and `..` segments are normalized before containment is checked.
3. Windows drive and UNC paths compare case-insensitively; prefix-only siblings such
   as `Filmography` do not match an approved `Film` folder.
4. Windows device names, alternate-data-stream colons, and trailing dot/space
   aliases are rejected before containment checks.
5. Proxy, relink, Source Monitor file, frame, interchange, AAF, and preset paths are
   rejected outside the approved root.
6. The status command returns only folder display name, access mode, and persistence
   state. It never returns the native root or persistent token.

Containment is a bridge policy, not an operating-system sandbox. The broker does
not recursively enumerate the selected folder, so the live-host gate must confirm
how Premiere resolves symlinks and Windows reparse points. Operators should not put
links to unrelated data inside an approved workspace.

The panel's bridge URL is separately restricted to `ws://127.0.0.1:<port>/uxp` or
`ws://localhost:<port>/uxp`. The manifest uses Adobe's compatible `domains: "all"` declaration
because Premiere 26.3 rejects the narrower WebSocket list; the panel's runtime validator is the
loopback-only authority and rejects remote hosts, credentials, fragments, and non-`/uxp` paths.

## Public action contracts

### `manage_clip_effects_uxp`

- `catalog`: list video match names and display names or audio display names.
- `inspect`: require `media_type`, `track_index`, and `clip_index`.
- `add`: additionally require `effect_id`; optional `insertion_index`.
- `remove`: additionally require `component_index` and `expected_effect_id` from a
  recent inspection. The command rejects a stale or changed component chain.

Video additions accept only a match name returned by `VideoFilterFactory`.
Audio additions accept only a display name returned by `AudioFilterFactory`.

### `inspect_track_item_identity_uxp`

Require one `media_type`, `track_index`, and `clip_index`; callers may provide
`expected_sequence_guid` from a recent result. The read returns only the host's
track-item match name, numeric item type, media UUID, reported track index, and
selected state. It rejects a changed active sequence before returning. It neither
reads source paths nor effect values and is not visual, playback, persistence, or
licensed-host proof.

### `audit_object_masks_uxp`

This is a read-only bounded audit over documented `ObjectMaskUtils.hasObjectMask()`
calls. It accepts an optional active-project GUID and either one to 64 exact sequence
GUIDs or, if no selectors are supplied, audits the whole active project only when it
has at most 64 sequences. The bridge sorts stable sequence identities, reads the
project aggregate and every selected sequence boolean, resolves the same targets a
second time, and rejects any changed active project, sequence identity/name, aggregate
boolean, or per-sequence boolean rather than returning a mixed result.

Adobe's API exposes only presence. The audit does not return mask counts, locations,
selection, tracking state, editability, source items, render output, playback results,
or licensed-host evidence. The double read is not an atomic host snapshot: a change
that occurs and returns to the identical values between reads is outside this boundary.

### `inspect_installed_mogrt_directory_uxp`

The documented `SequenceEditor.getInstalledMogrtPath()` getter is called only
through the authenticated bridge. The result is a bounded string and stays
redacted unless `include_path: true`. The command never enumerates, reads, or
imports from that directory, so a returned path is not evidence of installed
templates, compatibility, successful insertion, rendering, or licensed-host
behavior.

### `batch_selected_clips_uxp`

- `inspect`: return up to 64 current selection entries.
- `add_effect`: require one media type and effect ID.
- `remove_effect`: require one media type, component index, and expected effect ID.

Every selection entry must resolve to the requested media type. Validation and
component creation complete before the single mutation transaction begins.

### `manage_timeline_selection_uxp`

- `inspect`: return the active sequence GUID and zero to 64 current video/audio
  selection entries, including track/clip coordinates, project-item ID, and start/end
  seconds.
- `inspect_targets`: resolve one to 64 unselected or selected video/audio
  `selection_targets` by track/clip coordinate and return the same mutation-ready
  fingerprints without changing selection.
- `replace`, `add`, and `remove`: require `expected_sequence_guid` plus one to 64
  `selection_items` copied from a recent `inspect` or `inspect_targets` result.
- `clear`: require `expected_sequence_guid` and omit `selection_items`.

All mutation targets are resolved and fingerprinted before the single native
selection call. The command rebuilds the desired selection with
`TrackItemSelection.createEmptySelection()` and `addItem()`, or calls
`Sequence.clearSelection()` for an empty result. It then reads the selected set back
and rejects mismatches. Timeline selection changes are not project mutations and do
not claim Premiere Undo support; mutation actions still require MCP `edit` authority
and may use `operation_id` replay protection.

### `detect_scene_edits_uxp`

`mode` is `apply_cuts`, `create_markers`, or `create_subclips`. The command passes
Adobe's corresponding `SequenceUtils` constant and the current native selection.

### `manage_proxy_ingest_uxp`

Actions are `inspect_proxy`, `attach_proxy`, `get_ingest`, and `set_ingest`.
Attaching media requires an approved path and explicit non-undoable confirmation.
Replacing a different existing proxy additionally requires
`replace_existing_proxy: true`.
Ingest updates use `ProjectSettings.createSetIngestSettingsAction()`.

### `manage_metadata_uxp`

Actions are `get` and `update`. Project metadata requires 1-128 exact
`updated_fields`. Project and XMP strings are each capped at 350,000 characters,
and their combined serialized UTF-8 readback is capped at 900,000 bytes so the
complete response remains below the bridge's 1 MiB frame limit.

### `inspect_project_panel_metadata_uxp`

Actions are `panel` and `item_columns`. `panel` returns the active project's
native Project-panel metadata; `item_columns` uses the established exact
project-item ID, name, or singleton-selection resolution rules, then returns that
item's native column metadata. Both strings may be empty but are capped at 350,000
characters and a 900,000-byte serialized result. This tool is read-only: it does
not create metadata schema fields or invoke `setProjectPanelMetadata()`, whose
documented setter has no project-targeted action or transaction boundary that
could truthfully guard it across an awaited call. The result is a current-host
read, not an atomic project revision, persistence, or licensed-host proof.

### `manage_project_panel_metadata_uxp`

`inspect` returns the same active-project panel metadata as the read-only tool.
`update` requires the exact `expected_project_guid` and
`expected_project_panel_metadata` returned by inspection, the complete replacement
`project_panel_metadata`, `confirm_update: true`, and a bounded `operation_id`.
Both XML strings are limited to 12 KiB UTF-8 at the host boundary because two exact
XML values can expand when serialized in the bridge request. The panel serializes
this bridge's updates per project and performs the final async snapshot/stale check
immediately before it starts the documented direct setter under `lockedAccess()`.
Premiere exposes no atomic compare-and-set and another extension or the user
interface may still race that direct call. The setter is non-undoable and has no
cancellation claim. The result is verified only if an active-project exact XML
readback matches; a completed call with another project or XML is
`committed_unverified`. Operation-ID replay is scoped to the connected panel
session. Automated contracts do not prove host acceptance, persistence, UI effects,
Undo, or licensed-host behavior.

### `manage_app_preferences_uxp`

`inspect` returns just the native string values of the documented
`auto_peak_generation`, `import_workspace`, and `show_quickstart_dialog` keys.
`set` accepts one allow-listed key plus the exact inspected string, a requested
string value (each capped at 1024 characters), explicit persistence, confirmation,
and an operation ID. The panel keeps all snapshot/stale-check/set/readback work for
that key within its per-key exclusion boundary. `AppPreference.setValue()` is a
direct application-state call rather than a project action, so this tool makes no
claim of a project transaction, cancellation, Undo, durable persistence, or
licensed-host validation.

### `manage_color_conformance_uxp`

`preflight` returns graphics-white support, LUT IDs, and footage interpretation.
`update` allowlists frame rate, pixel aspect ratio, field/alpha flags, VR layout and
view fields, and input LUT ID. Numeric values are finite and range bounded.

### `audition_source_monitor_uxp`

Actions are `state`, `open_project_item`, `open_file`, `set_position`, `play`,
`close`, and `close_all`. File open is workspace-contained. Playback speed is
bounded from -16 through 16.

### `preflight_production_storage_uxp`

`preflight` reads project scratch/ingest state and, on Premiere 26.2+, active
Production scratch state. `configure_project` changes only the active project's
documented scratch categories to `same_as_project` or `my_documents`; there is no
claim that UXP exposes an equivalent Production mutation API.

## Automated evidence

- `tests/uxp/stable-workflows.test.ts` exercises the workflow-module host paths against a
  deterministic mock Premiere surface, including transaction and readback behavior.
- `tests/uxp/workspace.test.ts` exercises token persistence, path normalization,
  containment, redaction, restore, and revoke behavior.
- `tests/tools/uxp-workflows.test.ts` checks the workflow-module public schemas and snake-case to
  protocol argument translation.
- `tests/uxp/commands.test.ts` exercises the command-registry AppPreference contract,
  including allowlisted keys, stale reads, direct-set rejection, exact readback,
  replay, and competing operation IDs.
- `tests/adobe-uxp-coverage.test.ts` keeps the official-source coverage manifest
  machine validated.

These tests do not prove that Premiere loaded the panel or performed a real edit.
All added coverage entries therefore retain `liveHostVerificationStatus: not_run`.

## Live-host gate

Before release promotion, run the packaged panel in exact Windows and macOS stable
Premiere versions and record the host version and artifact hash. At minimum:

1. Add, insert, and remove representative video and audio effects; inspect results
   and verify one Undo removes the whole selection batch.
2. Inspect an empty selection, then replace, add, remove, and clear mixed video/audio
   clip selections. Repeat on 25.6 and 26.3 to cover both `setSelection` return forms,
   and confirm stale sequence and clip fingerprints fail before changing selection.
3. Run every scene-detection mode on known footage and record created objects.
4. Attach proxy and high-resolution media, toggle ingest, and validate persistence
   across save/reopen.
5. Relink an intentionally offline item with and without compatibility override.
6. Round-trip representative project metadata and XMP, including Unicode and an
   unchanged-field case; verify Undo.
7. Conform frame rate, PAR, alpha/field settings, and input LUT; verify both
   readback and Undo.
8. Open project items and workspace files in Source Monitor, seek, play forward and
   reverse, and close them.
9. Exercise project scratch settings both inside and outside a Production and
   verify Undo and saved state.
10. Revoke the workspace token and confirm every path-based call fails before a host
   mutation; re-grant after restart and confirm restoration.

## Primary Adobe references

- [Premiere UXP changelog](https://developer.adobe.com/premiere-pro/uxp/changelog/)
- [Component and effect APIs](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/videocomponentchain/)
- [Sequence selection controls](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequence/)
- [TrackItemSelection](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/trackitemselection/)
- [SequenceUtils scene detection](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequenceutils/)
- [ClipProjectItem proxy, relink, LUT, and footage APIs](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/clipprojectitem/)
- [ProjectSettings](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/projectsettings/)
- [Metadata](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/metadata/)
- [ProjectColorSettings](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/projectcolorsettings/)
- [SourceMonitor](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sourcemonitor/)
- [PRProduction](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/prproduction/)
- [UXP filesystem operations](https://developer.adobe.com/premiere-pro/uxp/resources/recipes/filesystem-operations/)
