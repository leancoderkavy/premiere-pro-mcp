# Completed After Effects render → Premiere bin

This workflow connects the existing AE render-queue tools to a guarded Premiere
media import. It handles one completed single-file render into one existing bin.
It does not start rendering, launch applications, save projects, or place clips
on a timeline.

## Operator workflow

1. Open saved AE and Premiere projects inside the same operator-approved local
   workspace. Connect both CEP panels. Choose an existing destination bin by its
   Premiere node ID.
2. Use `preview_after_effects_render` and confirm `enqueue_after_effects_render`
   if a render is not already queued. Retain the returned `queueItemIndex`.
3. Render in After Effects and wait for completion. Leave that queue item present.
4. Call `preview_after_effects_render_handoff`:

   ```json
   {
     "approved_workspace_path": "D:/Editorial/Launch",
     "ae_project_path": "D:/Editorial/Launch/Titles.aep",
     "premiere_project_path": "D:/Editorial/Launch/Edit.prproj",
     "output_path": "D:/Editorial/Launch/renders/Title.mov",
     "queue_item_index": 1,
     "target_bin_id": "12345"
   }
   ```

5. Review the resolved paths, composition ID, project ID and bin name in `plan`.
   Call `apply_after_effects_render_handoff` with the returned `preview_token`
   and `confirm_import: true` only after approving that exact destination.
6. Inspect the imported `projectItemId` in Premiere. Decode/play the media and
   check duration, audio, color and representative frames before using it in an
   edit. Timeline placement uses separate editing tools and their approvals.

## Boundaries and recovery

- Preview requires `inspect,filesystem`; apply requires
  `inspect,edit,filesystem`. Preview reads both hosts but makes no host mutation.
- The source queue must be `RQItemStatus.DONE`, idle, and have exactly one output
  module whose file matches the approved output. Supported suffixes are `.mov`,
  `.mp4`, `.mxf`, `.avi`, `.wav`; image sequences are excluded.
- Real paths must stay inside the workspace, including through symlinks/junctions.
  Both project paths must exist as regular files. The media must be nonempty.
- Approval lasts ten minutes in this server process. Apply consumes it before
  dispatch, rechecks AE composition/output status and file metadata, then rechecks
  Premiere project identity and the exact bin ID/name within the import script.
- File identity uses device/inode, size, modification and change times. This is
  metadata drift detection, not a content hash, codec check or proof that AE
  produced those bytes. Files can still change after the last check; keep the
  workspace quiescent during handoff.
- Existing matching media in the target bin is rejected. Import success requires
  exactly one new node with the requested media path, not merely an API `true`.
- If import dispatch fails or readback is inconclusive, the receipt says
  `importMayHaveOccurred: true`. Inspect the bin before starting a new preview.
  The token cannot be replayed; no rollback or automatic retry is attempted.
- No render queue completion or mocked test establishes visual correctness.
  `visualVerified` remains false. Licensed AE/Premiere validation is still required.

## Evidence and provenance

Retrieved September 7, 2026. This implementation is original; no external source
code, documentation text or design assets were copied.

- Ecosystem signal: [Brainferno v0.3.0](https://github.com/Brainferno/brainferno-mcp-bridge/releases/tag/v0.3.0),
  repository commit `9d7c21f30848bbc7a0bf08d0fc821de010fa1b21`, Apache-2.0;
  release published September 6. It describes cross-app render/import pipelines.
  This PR implements only the completed-render handoff gap, using existing local
  connectors; its external live-host claims are not evidence for this project.
- [Adobe Project API reference](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project)
  documents file import into root/target bins. That is UXP API availability,
  **not** evidence that this CEP implementation ran in a licensed host.
- The maintained community [Premiere scripting reference](https://ppro-scripting.docsforadobe.dev/general/project/#projectimportfiles)
  describes the CEP/ExtendScript `importFiles` API used here and `documentID`.
- The maintained community [AE render queue reference](https://ae-scripting.docsforadobe.dev/renderqueue/renderqueueitem/#renderqueueitemstatus)
  describes `RQItemStatus.DONE`; the [output module reference](https://ae-scripting.docsforadobe.dev/renderqueue/outputmodule/#outputmodulefile)
  describes the output file. These are community documentation, not official
  Adobe API or licensed-host proof. References are linked only, not incorporated.
  Neither docsforadobe repository reported a license in GitHub metadata at
  retrieval; treat reuse rights as unclear and do not copy their contents.

Validation includes generated-script execution against host mocks and real local
filesystem tests. Before claiming host support verified, run the workflow with
disposable saved projects in licensed AE/Premiere, then test a changed target,
failed render, duplicate import and media playback. Record host versions and the
actual import receipt separately from static/CI results.
