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

The public MCP surface adds ten consolidated tools. Each maps to smaller protocol
commands so `capabilities.get` can report the exact methods available in the running
Premiere build.

| Improvement | Public MCP tool | UXP commands | Host evidence |
| --- | --- | --- | --- |
| Native effects pipeline | `manage_clip_effects_uxp` | `effects.catalog`, `effects.chain.get`, `effects.chain.add`, `effects.chain.remove` | Effect catalog allowlist; component-chain count and component readback after an action transaction |
| Selection compound batch | `batch_selected_clips_uxp` | `selection.inspect`, `effects.selection.add`, `effects.selection.remove` | Preflight all selected items, then commit one action group and read every chain count back |
| Scene-edit detection | `detect_scene_edits_uxp` | `sceneEdit.detect` | Adobe host return plus selected-item count; no Undo or detection-count claim |
| Proxy and ingest controller | `manage_proxy_ingest_uxp` | `proxy.inspect`, `proxy.attach`, `ingest.get`, `ingest.configure` | Proxy path/attachment readback; ingest state readback after transaction |
| Offline relink repair | `relink_offline_media_uxp` | `media.relink` | Expected old path, offline default, capability check, then media-path and online-state readback |
| Transactional metadata | `manage_metadata_uxp` | `metadata.get`, `metadata.update` | Project metadata and XMP are committed together and read back; each payload is size bounded |
| Color and conformance | `manage_color_conformance_uxp` | `color.preflight`, `footage.conform` | Project graphics-white values, embedded/input LUT IDs, and requested footage fields read back |
| Source Monitor audition | `audition_source_monitor_uxp` | `sourceMonitor.state`, `sourceMonitor.open`, `sourceMonitor.position.set`, `sourceMonitor.play`, `sourceMonitor.close` | Project-item and position readback where Adobe exposes it; file open/play rely on explicit host returns |
| Productions and storage | `preflight_production_storage_uxp` | `storage.preflight`, `scratch.configure` | Project/Production scratch snapshots and project action-transaction result |
| Least-privilege workspace | `get_uxp_workspace_access` | `workspace.status` | Redacted persistent capability state; native path and token never cross the bridge |

## Performance and transaction design

- Selection batches use `Sequence.getSelection()` and `TrackItemSelection` instead
  of traversing the project tree. Classification reads only each selected item's
  reported track and caches repeated track lookups. Batches are capped at 64 clips
  and reject mixed or unclassified media types before creating any action.
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
action-transaction claim. The workflow returns `committed_unverified` after Adobe's
positive host result because the API does not return the number or identities of
created cuts, markers, or subclips.

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
`ws://localhost:<port>/uxp`, matching the manifest's loopback-only network policy.

## Public action contracts

### `manage_clip_effects_uxp`

- `catalog`: list video match names and display names or audio display names.
- `inspect`: require `media_type`, `track_index`, and `clip_index`.
- `add`: additionally require `effect_id`; optional `insertion_index`.
- `remove`: additionally require `component_index` and `expected_effect_id` from a
  recent inspection. The command rejects a stale or changed component chain.

Video additions accept only a match name returned by `VideoFilterFactory`.
Audio additions accept only a display name returned by `AudioFilterFactory`.

### `batch_selected_clips_uxp`

- `inspect`: return up to 64 current selection entries.
- `add_effect`: require one media type and effect ID.
- `remove_effect`: require one media type, component index, and expected effect ID.

Every selection entry must resolve to the requested media type. Validation and
component creation complete before the single mutation transaction begins.

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
`updated_fields`. Project and XMP strings are each capped at 350,000 characters so
the result remains below the bridge's 1 MiB frame limit.

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

- `tests/uxp/stable-workflows.test.ts` exercises all ten host workflows against a
  deterministic mock Premiere surface, including transaction and readback behavior.
- `tests/uxp/workspace.test.ts` exercises token persistence, path normalization,
  containment, redaction, restore, and revoke behavior.
- `tests/tools/uxp-workflows.test.ts` checks the ten public schemas and snake-case to
  protocol argument translation.
- `tests/adobe-uxp-coverage.test.ts` keeps the official-source coverage manifest
  machine validated.

These tests do not prove that Premiere loaded the panel or performed a real edit.
All added coverage entries therefore retain `liveHostVerificationStatus: not_run`.

## Live-host gate

Before release promotion, run the packaged panel in exact Windows and macOS stable
Premiere versions and record the host version and artifact hash. At minimum:

1. Add, insert, and remove representative video and audio effects; inspect results
   and verify one Undo removes the whole selection batch.
2. Run every scene-detection mode on known footage and record created objects.
3. Attach proxy and high-resolution media, toggle ingest, and validate persistence
   across save/reopen.
4. Relink an intentionally offline item with and without compatibility override.
5. Round-trip representative project metadata and XMP, including Unicode and an
   unchanged-field case; verify Undo.
6. Conform frame rate, PAR, alpha/field settings, and input LUT; verify both
   readback and Undo.
7. Open project items and workspace files in Source Monitor, seek, play forward and
   reverse, and close them.
8. Exercise project scratch settings both inside and outside a Production and
   verify Undo and saved state.
9. Revoke the workspace token and confirm every path-based call fails before a host
   mutation; re-grant after restart and confirm restoration.

## Primary Adobe references

- [Premiere UXP changelog](https://developer.adobe.com/premiere-pro/uxp/changelog/)
- [Component and effect APIs](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/videocomponentchain/)
- [TrackItemSelection](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/trackitemselection/)
- [SequenceUtils scene detection](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequenceutils/)
- [ClipProjectItem proxy, relink, LUT, and footage APIs](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/clipprojectitem/)
- [ProjectSettings](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/projectsettings/)
- [Metadata](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/metadata/)
- [ProjectColorSettings](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/projectcolorsettings/)
- [SourceMonitor](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sourcemonitor/)
- [PRProduction](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/prproduction/)
- [UXP filesystem operations](https://developer.adobe.com/premiere-pro/uxp/resources/recipes/filesystem-operations/)
