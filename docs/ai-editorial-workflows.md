# Local-first AI editorial workflows

## Status

This document describes the review-only editorial-plan foundation in the current
source tree. It does not claim a callable Adobe AI Assistant,
Media Intelligence, Generative Media Tool, Generative Extend, caption
translation, Speech-to-Text, Enhance Speech, or Remix API.

`create_editorial_context_pack`, `create_editorial_plan`, and
`preview_editorial_plan` are local planning tools. They do not call an LLM,
read a private Adobe index, upload media, send a provider request, create a
bin, create a sequence, or change the active Premiere project.

## Workflow

1. Inspect the intended project and sequence, then call
   `manage_project_context` with `action: "capture"`.
2. Add only explicit local evidence through `manage_project_context` with
   `action: "enrich"`: Premiere transcript passages, operator-authored shot
   notes, audio observations, or approved analysis results. Do not put secrets,
   native paths, or unrelated customer content in an enrichment.
3. When a model needs a compact reading surface, call
   `create_editorial_context_pack` with the editorial intent. It returns only
   matching, bounded local evidence as Markdown, together with stable evidence
   IDs and captured revisions.
4. Call `create_editorial_plan` with an editorial intent and one workflow:
   `organize`, `stringout`, `rough_cut`, `caption_review`, or
   `platform_cutdown`.
5. Call `preview_editorial_plan` with the unchanged plan returned by
   `create_editorial_plan` from the current server instance. It rejects a plan
   when its saved context or timeline revision is stale and returns an opaque
   review receipt when it is current.
6. Re-capture context immediately before a mutation. Resolve stable Premiere
   identities and use the route stated by the recommendation, for example
   `apply_editorial_organization_plan`, `manage_sequences_uxp`,
   `preview_transcript_edit_uxp`, or `create_caption_track`.
6. Apply the individual supported operation under its normal authority,
   idempotency, transaction, and verification contract. Inspect the final
   project state and verify playback/rendered delivery separately where needed.

The confirmation token is an opaque review receipt for the exact server-issued
local plan; it is not permission for an unchecked host mutation and cannot
bypass the routed tool's own confirmation or capability requirements.

## Transcript-first context packs

`create_editorial_context_pack` is an opt-in, bounded reading view inspired by
transcript-first editorial workflows. It retrieves only previously captured
local evidence that matches the supplied intent and emits compact Markdown
alongside the exact evidence IDs, time ranges, and captured context/source/
timeline revisions. It is useful for reviewing a long interview without making
an agent inspect every frame or receive a large, unstructured project dump.

The tool does not transcribe media, infer speakers, parse an undocumented
Premiere transcript schema, create an edit plan, or grant authority to mutate.
Transcript passages, shot notes, and audio observations remain explicit local
enrichments supplied through `manage_project_context`. A returned revision only
identifies the saved context state; re-capture immediately before mutation and
keep the routed tool's existing confirmation and readback requirements.

## Organization plans

Organization plans require caller-supplied `organization_rules`. Each rule has a
proposed bin name, one or more keywords, and an optional color index. The server
matches these rules only against stored local context records. It deliberately
does not infer bins from filenames, claim semantic understanding, or create a
destination bin automatically.

With an authenticated compatible UXP bridge, the unchanged server-issued,
reviewed plan can be supplied to `apply_editorial_organization_plan` with its
opaque preview confirmation token, one selected recommendation per operation,
stable source IDs, and required expected-parent guards. A source evidence ID or
project-item ID may appear only once in the complete batch. If no destination
bin ID is supplied, the tool creates the proposed bin with a documented UXP
transaction, resolves the returned bin ID, then performs individually guarded
move/color transactions.

The operation is intentionally UXP-only: it never falls back to CEP or QE.
Cross-command rollback is not possible because Premiere returns a newly created
bin ID only after the first transaction. If a later transaction fails, the tool
reports already verified completed actions as `partial`, tells the editor to
inspect them, and never implies that Premiere rolled them back. If no action
has a verified postcondition, the tool returns a failure that identifies the
unverified attempted action and instructs the editor to inspect Premiere before
retrying; it never calls that attempt a commit. `verified` means every host
response supplied the required command-specific UXP readback (created bin ID,
destination parent, or color label) with matching verification metadata. A
bare successful or `verified` bridge response is rejected and stops the
remaining batch. This is structured panel-response validation, not proof of
behavior in a licensed Premiere host; it is not playback, render, or
visual-quality verification.

Use the [licensed-host validation runbook](editorial-workflow-host-validation.md)
to record the real Premiere evidence required before widening support claims.

## Platform cutdowns

`platform_cutdown` accepts one to eight explicit target dimensions and plans a
separate derived sequence for each one. Every recommendation names the captured
source sequence, proposed derivative name, target width and height, and the
review order: clone the source sequence, re-query the stable derivative ID,
review Auto Reframe, optionally review captions, inspect structure, then export.

This is local planning only. It does not create a sequence, invoke Auto Reframe,
change captions, relabel clips, render/export media, query Adobe Media
Intelligence, or call an AI/provider service. Every later host mutation keeps
its own capability, confirmation, and verification boundary.

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

For an existing lecture or interview SRT/VTT, the `plan_lecture_workflow`
action of `create_caption_track` creates a local-only timing preview and guided
review checklist before import. It detects malformed/overlapping cues and can
show a safe constant-offset proposal from an editor-supplied observation. A
proportional correction is withheld unless explicitly authorized, because a
caption artifact ending before a sequence may be intentional. See the
[guided lecture-caption workflow](lecture-caption-workflow.md) for the separate
duplicate-sequence, structural-readback, playback, and rendered-output steps.

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
