# Editor requests: markers, selection, checkpoints, navigation, EDL, review planning

- **Status:** Implemented in source; automated contract tests only
- **Updated:** 2026-09-16
- **Host evidence:** none yet. Every CEP tool below follows the existing
  preflight-then-readback contract, but no licensed-host run has been recorded
  for these tools. Treat them like every other unverified host operation.

## Why these eight tools

The tools in `src/tools/editor-requests.ts` and `src/tools/review-plans.ts`
close gaps that show up repeatedly in two places: the feature lists of other
Premiere MCP servers, and what editors say they actually want an assistant to
do. The sources below were reviewed on 2026-09-16; they are evidence of demand
and of competitor scope, not proof that any implementation works in a host.

| Tool | Demand or competitor evidence | Boundary |
| --- | --- | --- |
| `add_markers_batch` | Editors ask for beat/peak markers "even on a black video track" as a snappable grid ([r/premiere](https://www.reddit.com/r/premiere/comments/1l1nx8h/whats_something_editors_desperately_need_right_now/)); CaYatur/PremiereProMCP adds markers one at a time; this repository already produces marker lists from `detect_beats`, `plan_chapter_markers`, and `plan_silence_review_markers` but only the UXP bridge could apply them in bulk. | Marker-collection readback only. Colors are requested values; Premiere's DOM does not read them back. |
| `select_clips_by_pattern` | "A shortcut that'll select every other clip on the timeline" ([r/premiere](https://www.reddit.com/r/premiere/comments/1l1nx8h/whats_something_editors_desperately_need_right_now/)). | `isSelected()` readback. Selection only; nothing is moved or deleted. |
| `navigate_playhead` | antipaster/adobe-premiere-pro-mcp exposes `step_forward`, `go_to_next_edit`, `go_to_in_point`, and similar navigation; this repository had `set_playhead_position` and `move_playhead_to_edit` only. | Player-position readback within one frame. |
| `create_sequence_checkpoint` / `list_sequence_checkpoints` | CaYatur/PremiereProMCP advertises "checkpoints: snapshot / restore project before risky edits"; editors ask for "versioning across big projects" ([r/premiere](https://www.reddit.com/r/premiere/comments/1l1nx8h/whats_something_editors_desperately_need_right_now/)). Only `manage_workflow_checkpoints_uxp` existed here. | `Sequence.clone()` plus track and clip-count comparison. Premiere exposes no API that replaces a sequence's contents, so restore is a human step: open, duplicate, or copy from the checkpoint. |
| `export_sequence_edl` | antipaster/adobe-premiere-pro-mcp lists `export_edl`; hetpatel-11/Adobe_Premiere_Pro_MCP lists EDL import; colorists and conform tools still ask for CMX 3600. | Timeline readback → local generation → self-validation with `parseCmx3600Edl`/`validateCmx3600Edl`. One track, cuts only, `M2` lines for retimed clips, source timecode from `projectItem.startTime()` when readable. Not a Premiere-native export; not proof that a conform target accepts the list. |
| `plan_client_notes_checklist` | "Turning client notes into a checklist" is one of the concrete time savers editors report ([r/premiere](https://www.reddit.com/r/premiere/comments/1ts8nw9/how_are_you_using_ai_in_your_editing_workflow/)). | Deterministic lexical classification. Categories and priorities come from a fixed lexicon and must be reviewed by a person. No model call. |
| `plan_multicam_angle_switches` | Multicam active-speaker switching is a headline feature of commercial Premiere AI plugins (AutoEdit "AI detects active speakers and automatically switches camera angles") and a recurring podcast-editor request. | Plan only, for synced clips stacked on separate video tracks. Premiere exposes no scripting API for angle switching inside a multicam source sequence. Applied through `razor_all_tracks`, `select_clips_in_range`, `batch_enable_disable`, and `add_markers_batch` on a checkpointed sequence. |

Competitor repositories reviewed: hetpatel-11/Adobe_Premiere_Pro_MCP (283
tools), ayushozha/AdobePremiereProMCP (1,064 schemas, 72 default),
CaYatur/PremiereProMCP (277 tools, 109 default), antipaster/adobe-premiere-pro-mcp
(170+ tools), mikechambers/adb-mcp, and IsaiahDupree/premiere-pro-mcp (a fork of
this project). Their catalogs were compared against `docs/supported-actions.md`;
features already present here (ducking, razor-all-tracks, undo/redo, nesting,
lift/extract, export readiness, unused-media reports, batch placement, product-spot
assembly, silence detection, filler-word and repeated-take planning, caption
authoring, platform delivery matrices) were not duplicated.

## Deliberately not added

- **Paid provider integrations** (for example ElevenLabs voiceover in
  antipaster/adobe-premiere-pro-mcp). This project stays local-first and does
  not call external providers.
- **`tool_invoke`-style passthrough** that runs tools outside the advertised
  catalog. The capability guard remains the only authority boundary.
- **Native multicam angle switching, caption text CRUD, track solo/volume,
  default-transition changes, and cache flushing.** Premiere's CEP/ExtendScript
  surface does not expose them; listing them would repeat the unverifiable
  claims this repository avoids.

## Typical flows

**Client notes → markers → review frames**

1. `plan_client_notes_checklist` with the pasted feedback, `frame_rate`, and
   `sequence_duration_seconds`.
2. Review `checklist_markdown`; correct any category or priority.
3. `add_markers_batch` with the returned `markers`.
4. `export_sequence_marker_review_frames` to collect evidence per note.

**Podcast multicam**

1. `create_sequence_checkpoint` on the synced, stacked sequence.
2. Produce speaker segments (transcript, diarization, or
   `plan_speaker_checkerboard` turns) and map cameras to speakers.
3. `plan_multicam_angle_switches`; adjust `min_hold_seconds`,
   `lead_switch_seconds`, `cutaway_every_seconds`.
4. Apply `apply_steps`: `razor_all_tracks` at `switch_times_seconds`, then
   `select_clips_in_range` + `batch_enable_disable` per camera track, then
   `add_markers_batch`.
5. `get_sequence_structure` and `diff_sequence_snapshots` against the
   checkpoint snapshot.

**Conform handoff**

1. `export_sequence_edl` with `track_type: "video"`, `track_index: 0`,
   `output_path`, and `approved_workspace_path`.
2. Hand the `.edl` to the colorist; `inspect_cmx3600_edl` and
   `compare_cmx3600_edls` remain available for later revisions.
