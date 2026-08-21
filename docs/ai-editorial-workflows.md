# Local-first AI editorial workflows

## Status

This document describes the review-only editorial-plan foundation in the current
source tree. It does not claim a callable Adobe AI Assistant,
Media Intelligence, Generative Media Tool, Generative Extend, caption
translation, Speech-to-Text, Enhance Speech, or Remix API.

`create_editorial_plan` and `preview_editorial_plan` are local planning tools.
They do not call an LLM, read a private Adobe index, upload media, send a
provider request, create a bin, create a sequence, or change the active
Premiere project.

## Workflow

1. Inspect the intended project and sequence, then call
   `manage_project_context` with `action: "capture"`.
2. Add only explicit local evidence through `manage_project_context` with
   `action: "enrich"`: Premiere transcript passages, operator-authored shot
   notes, audio observations, or approved analysis results. Do not put secrets,
   native paths, or unrelated customer content in an enrichment.
3. Call `create_editorial_plan` with an editorial intent and one workflow:
   `organize`, `stringout`, `rough_cut`, or `caption_review`.
4. Call `preview_editorial_plan`. It rejects a plan when its saved context or
   timeline revision is stale and returns a review receipt when it is current.
5. Re-capture context immediately before a mutation. Resolve stable Premiere
   identities and use the route stated by the recommendation, for example
   `organize_project_items_uxp`, `manage_sequences_uxp`,
   `preview_transcript_edit_uxp`, or `create_caption_track`.
6. Apply the individual supported operation under its normal authority,
   idempotency, transaction, and verification contract. Inspect the final
   project state and verify playback/rendered delivery separately where needed.

The confirmation token is a review receipt for the exact local plan; it is not
permission for an unchecked host mutation and cannot bypass the routed tool's
own confirmation or capability requirements.

## Organization plans

Organization plans require caller-supplied `organization_rules`. Each rule has a
proposed bin name, one or more keywords, and an optional color index. The server
matches these rules only against stored local context records. It deliberately
does not infer bins from filenames, claim semantic understanding, or create a
destination bin automatically.

After review, create or resolve the destination bin through the documented UXP
workflow and move only stable project-item IDs with expected-parent guards.
Because a newly created bin receives its identity from Premiere, a new plan or
explicit ID-resolution step is required before moves.

## Rough cuts and captions

`rough_cut` plans route to the native transcript preview flow. They never treat
a text match as permission to remove timeline media. A transcript-to-timeline
application is limited to the source/time mapping cases proven in a licensed
Premiere host, defaults to a duplicate sequence, and must retain its separate
revision-locked confirmation.

`caption_review` plans route to an already imported caption artifact. The
supported CEP path creates a caption track from an SRT or VTT item and reports
structural acceptance only. Verify playback or exported frames before delivery.
There is no supported raw-caption, translation, or transcription invocation in
this MCP server.

## Adobe and provider boundaries

`get_advanced_feature_support` now reports an explicit access mode:

| Access mode | Meaning |
| --- | --- |
| `direct` | Documented MCP/API operation with its own runtime capability and verification boundary. |
| `observable-only` | A bounded host event or ordinary-result inspection is available, but MCP cannot invoke the feature. |
| `artifact-import` | A reviewed local artifact can enter an existing supported Premiere workflow. |
| `external-provider` | A separate authenticated service is required. |
| `user-assisted` | The editor must run the feature in Premiere. |
| `planned` / `unavailable` | No current MCP operation is advertised. |

The UXP bridge can wait for a bounded Generative Extend completion receipt after
the editor starts that feature. The receipt is not evidence of target identity,
generation provenance, visual quality, or rendered output. Real-host validation
is required before treating even the event shape as production evidence.

A future local semantic index must be a separately implemented, workspace-scoped
and opt-in worker. It must never be presented as a query of Adobe Media
Intelligence. Cloud transcription, translation, dubbing, and media generation
remain disabled until a provider, data-transfer/retention terms, credential
boundary, exact cost approval, quarantine flow, and licensed-host artifact
import/verification plan are approved.

## Verification matrix

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| Unit/contract tests | Plan validation, revision rejection, tool registration, and output shape | Premiere host behavior |
| UXP capability handshake | Whether the connected host advertises a documented command | Rendered visual/audio result |
| UXP event receipt | Host reported a bounded event after the supplied revision | Generated target identity, provenance, or delivery quality |
| Project/timeline readback | Structural postcondition exposed by Premiere | Playback and export quality |
| Playback/export verification | Reviewed delivery output | Editorial correctness or legal/provider suitability |
