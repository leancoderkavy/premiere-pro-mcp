# Next ten stable Premiere UXP workflows

- **Research refresh:** 2026-08-15
- **Discovery:** Tavily-assisted searches restricted to official Adobe material
- **Primary verification:** official Premiere Pro UXP documentation and the installed
  `@adobe/premierepro@26.3.0` stable declarations
- **Prerelease policy:** the 26.5 beta declarations are excluded
- **Evidence:** automated contract tests pass; live Premiere verification has not run

## Scope

This expansion adds ten consolidated MCP tools backed by 42 smaller UXP commands.
It targets stable APIs that reduce full-project traversal, replace undocumented QE
calls, group compatible changes into Premiere action transactions, and expose a
clearer readback boundary. It does not remove the production CEP connector or retry
a failed UXP mutation through CEP.

| Improvement | Public MCP tool | Representative UXP commands | Verification boundary |
| --- | --- | --- | --- |
| Project-panel selection resolver | `inspect_project_selection_uxp` | `projectSelection.views`, `projectSelection.inspect` | Bounded selected-item snapshot from the active or named Project view |
| Native marker CRUD | `manage_markers_uxp` | `markers.inspect`, `markers.add`, `markers.update`, `markers.remove` | Marker GUID plus requested-field or absence readback |
| Transactional bin organizer | `organize_project_items_uxp` | `bins.inspect`, `bins.create`, `bins.createSmart`, `bins.rename`, `bins.move`, `bins.color`, `bins.remove` | Project-item identity, name, parent, color, or absence readback |
| Sequence settings profiles | `manage_sequence_settings_uxp` | `sequenceSettings.get`, `sequenceSettings.update` | Requested settings read back after one `createSetSettingsAction` transaction |
| Workspace-gated imports | `import_project_media_uxp` | `project.import` | New project-item or sequence identities when Premiere exposes them |
| Typed parameter/keyframe automation | `automate_effect_parameters_uxp` | `parameters.inspect`, `parameters.set`, `parameters.keyframeAdd`, `parameters.keyframeRemove`, `parameters.keyframeRemoveRange`, `parameters.keyframeInterpolation` | Parameter value, keyframe time, absence, or interpolation readback |
| Track-item transformations | `transform_track_item_uxp` | `trackItem.inspect`, `trackItem.update` | Start/end, source in/out, disabled state, and name readback |
| SequenceEditor timeline layer | `edit_timeline_uxp` | `timeline.insert`, `timeline.overwrite`, `timeline.cloneSelection`, `timeline.removeSelection`, `timeline.mogrtPath`, `timeline.mogrtLibrary` | Action transaction accepted; MOGRT calls return inserted items |
| Empty sequence creation | `create_empty_sequence_uxp` | `sequences.createEmpty` | New sequence identity from the post-call project collection |
| Sequence lifecycle and derivatives | `manage_sequences_uxp` | `sequences.inspect`, `sequences.createFromMedia`, `sequences.clone`, `sequences.subsequence`, `sequences.activate`, `sequences.open`, `sequences.close`, `sequences.delete` | Created/cloned identity, host return, or deleted-sequence absence |
| AME encode controller | `encode_media_uxp` | `encoder.preflight`, `encoder.sequence`, `encoder.projectItem`, `encoder.file` | AME host acceptance only; output-file completion remains unverified |

## Performance design

The resolver checks the current Project-panel selection before performing a bounded
breadth-first project lookup. Direct selection inspection is capped at 256 items,
the fallback traversal is capped at 4,096 project entries, timeline selection is
capped at 64 items, parameter readback is capped at 256 keyframes, marker lookup at
2,048 entries, sequence lookup at 1,024 entries, and immediate bin inspection at
1,024 children. These limits prevent one request from
accidentally walking or serializing an unbounded production project.

Compatible mutations create their Adobe `Action` objects synchronously inside
`Project.lockedAccess()` and consume them in one `Project.executeTransaction()`.
Marker field changes, multi-field track-item transforms, and settings profiles
therefore use one undo group per public request. Readback is performed after the
transaction. These are architectural reductions in traversal and transaction
overhead, not measured latency claims; p50/p95 numbers require a real-host benchmark.

## Resolver and stale-state rules

- Project items use stable IDs. If an ID is omitted where allowed, exactly one
  Project-panel item must be selected.
- Sequences use stable GUIDs. If a GUID is omitted where allowed, the active
  sequence is used.
- Marker updates and removals use marker GUIDs and optionally guard the expected
  marker name.
- Bin rename/remove, sequence deletion, effect parameter selection, and track-item
  timing accept expected-state fields. A mismatch fails before an action is made.
- Relative track-item movement verifies the result against the actual pre-action
  start and end, even when expected timing guards were omitted.

## Action transactions and direct host calls

The following mutations are action based and can report an Adobe undo boundary:

- marker add/update/remove;
- bin create/smart-create/rename/move/color/remove;
- sequence settings update;
- parameter value and keyframe changes;
- track-item timing/state changes;
- SequenceEditor insert, overwrite, clone, and remove;
- sequence clone.

Imports, MOGRT insertion, sequence creation/subsequence/deletion, and AME encoding
are documented direct host calls. They require explicit confirmation where they
can create a non-undoable project change or external file. They never claim atomic
rollback or an undo group.

`committed_unverified` is intentional when Premiere accepts a transaction but does
not expose a complete post-state identity, or when AME only confirms that a job was
accepted. Callers must not automatically retry these operations.

## Filesystem authority

All import sources, MOGRT paths, AME inputs, outputs, and preset files pass through
the existing operator-selected UXP workspace broker. Paths outside that root are
rejected before the relevant host call. Native paths and persistent folder tokens
remain inside the panel and are not returned by workspace status.

`import_project_media_uxp` requires `confirm_non_undoable: true` for every mode.
Path-based MOGRT insertion requires the same confirmation. Encode actions require
`confirm_external_write: true` because an output can be created or overwritten.

## Tool contracts

### `inspect_project_selection_uxp`

`views` lists at most 64 open Project views. `selection` uses either the active
project selection or `view_id`, returning at most 256 item snapshots. This is the
preferred fast resolver for subsequent stable-ID operations.

### `manage_markers_uxp`

`owner_type` is `sequence` or `project_item`. Add supports name, type, start,
duration, and comments. Update additionally supports color index and verifies every
requested field after the transaction. Remove verifies GUID absence.
The marker action APIs date to 25.6, but this stable-ID contract requires the marker
`guid` property Adobe added in 26.3.

### `organize_project_items_uxp`

Actions are `inspect_bin`, `create_bin`, `create_smart_bin`, `rename`, `move`,
`set_color`, and `remove`. Inspection is shallow by design. Mutations use folder or
project-item actions and report only evidence that Adobe exposes after the commit.

### `manage_sequence_settings_uxp`

`get` returns a bounded stable settings snapshot. `update` supports maximum bit
depth, maximum render quality, linear-color compositing, audio/video rates, field
type, pixel aspect ratio, editing/preview identifiers, and video dimensions. Only
named fields are changed and all named fields must match readback for `verified`.
Adobe marks video-frame-rate get/set as 26.2; the other profiled settings date to
25.6. Because the consolidated get/update contract includes those frame-rate fields,
both commands advertise a 26.2 minimum.

### `import_project_media_uxp`

Modes are `files`, `sequences`, `ae_comps`, and `all_ae_comps`. File batches are
capped at 100; sequence and composition lists at 64. After Effects modes fail early
when the host reports that After Effects is unavailable.

### `automate_effect_parameters_uxp`

The tool resolves one audio/video clip, component index, and parameter index. It
accepts only scalar number, string, or boolean values; point and color values remain
out of scope until the public schema can represent their Adobe types unambiguously.
Keyframe actions support add, remove, inclusive range removal, and interpolation.

### `transform_track_item_uxp`

One request can move or trim a clip, change source in/out, toggle disabled state,
and rename it in one transaction. `move_by_seconds` cannot be combined with absolute
timeline start/end fields.

### `edit_timeline_uxp`

Insert, overwrite, clone selection, and remove selection use documented
`SequenceEditor` actions. Path/library MOGRT insertion uses Adobe's documented
direct methods and reports the number of returned track items. Transaction-only
edits and direct MOGRT calls remain `committed_unverified` until a stable returned-item
identity or exact post-selection mapping is available.

### `create_empty_sequence_uxp`

The tool creates an empty/default sequence without requiring media selection or a
preset path. It requires `confirm_non_undoable: true` and `operation_id` so its
receipt can be replayed without creating a duplicate. It serializes the whole
project-sequence capacity snapshot, host call, and post-call list readback. It is
`verified` only when the newly returned sequence identity is present in that readback;
a host rejection, missing identity, or unreadable readback becomes an idempotently
replayable `committed_unverified` partial receipt.

### `manage_sequences_uxp`

The tool inspects all project sequences, creates from selected media IDs, clones,
derives a subsequence, activates, opens, closes, or deletes. Direct media create,
subsequence, and delete calls require `confirm_non_undoable: true`; deletion also
supports `expected_name` as a stale-target guard. Returned objects from direct
media-create/subsequence calls remain acceptance evidence only without an independent
project readback.
Adobe introduced `Project.closeSequence` in 26.2; the other lifecycle calls in this
tool date to 25.6 and remain individually capability gated.

### `encode_media_uxp`

`preflight` reports AME availability and can resolve the expected extension for a
workspace preset. `sequence`, `project_item`, and `file` dispatch documented AME
calls. A positive return means accepted/queued, not rendered, present on disk, or
checksum verified. Existing delivery verification tools should inspect the output
after AME completion.

## Automated evidence

- `tests/tools/uxp-advanced-workflows.test.ts` checks all ten closed schemas,
  snake-case argument translation, and rejection before transport.
- `tests/uxp/advanced-workflows.test.ts` uses a deterministic mock Premiere host to
  exercise all ten groups, action transactions, readback, workspace boundaries,
  and confirmations.
- `tests/security-capabilities.test.ts` verifies inspect, edit, filesystem, and
  export authority classification.
- `tests/adobe-uxp-coverage.test.ts` validates the stable official-source coverage
  entries and retains `liveHostVerificationStatus: not_run`.

These tests prove local contracts, not that Premiere loaded the panel or changed a
real project.

## Live-host gate

Before release promotion, package the UXP panel and run it on exact stable Premiere
versions for Windows and macOS. Record the host version, test project, and package
hash. At minimum:

1. Compare active-view and named-view selections in multi-project and Production
   layouts, including a project above the fallback traversal cap.
2. Add, update, move, recolor, and remove sequence and source-clip markers; verify
   field readback and one-step Undo.
3. Exercise every bin action, including duplicate names, smart-bin queries, nested
   moves, stale guards, and Undo.
4. Round-trip each sequence setting on representative SDR/HDR sequences and verify
   reopen persistence.
5. Import files, sequences, named AE comps, and all AE comps; confirm workspace
   rejection occurs before a host mutation.
6. Set representative scalar parameters and keyframes for video and audio effects;
   verify interpolation and Undo.
7. Move, trim, rename, and disable track items, including linked audio/video and
   collisions.
8. Run all SequenceEditor actions and both MOGRT paths, then inspect the exact
   resulting track items and Undo behavior.
9. Create, clone, derive, activate/open/close, and delete sequences with post-state
   inspection.
10. Queue sequence, project-item, and file encodes; wait for AME terminal events,
    then verify output existence and checksum separately.

## Primary Adobe references

- [Premiere UXP changelog](https://developer.adobe.com/premiere-pro/uxp/changelog/)
- [ProjectUtils](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/projectutils/)
- [Markers](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/markers/)
- [FolderItem](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/folderitem/)
- [SequenceSettings](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequencesettings/)
- [Project](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project/)
- [ComponentParam](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/componentparam/)
- [VideoClipTrackItem](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/videocliptrackitem/)
- [SequenceEditor](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequenceeditor/)
- [Sequence](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequence/)
- [EncoderManager](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/encodermanager/)
