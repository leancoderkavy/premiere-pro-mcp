# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- Registered tools accept optional request-scoped `expected_project_path`; generated CEP commands refuse a different, missing or unsaved active project before the tool body. UXP and After Effects refuse this CEP-only guard. Omitting the guard preserves existing behavior.

- `unnest_sequence` now refuses, before removing the nested clip, any inner item that also carries the other media type. Premiere 26.5.2's `Track.overwriteClip` places that media on the matching track and overwrites the clips there. Same guard as `replace_clip`. Unnest a nest of video-only or audio-only items, or use Premiere's Unnest command.
- Shared project-item mark restore after `replace_clip`, `unnest_sequence`, and other `Track.overwriteClip` helpers now writes the quarter-frame-biased seconds from `__itemMarksForRestore`. Writing the exact tick boundary as seconds can floor one media frame early on Premiere 26.5.2 (a soft-subclip Out of `00:00:29:22` stored as `00:00:29:21`), shrinking the source item. `duplicate_clip` and `set_item_in_out` already used those seconds.
- `__setItemMarks` now writes the same quarter-grid-biased seconds when applying a temporary overwrite range. Premiere 26.5.2 can floor exact tick-boundary seconds one media frame early, so `unnest_sequence` (16-tick default tolerance) refused a valid nest, or `replace_clip` placed a clip one frame short after the original was already removed. `replace_clip` also pulls a placed end that overshoots the original span by less than one media frame back onto that span.
- `export_sequence` without `preset_path` no longer exports at proxy resolution when Media Encoder is not installed. Preset discovery only searched Premiere's `Settings/IngestPresets`, so the default became `IngestPresets/Proxy/00_1024x540 H.264.epr` and a 1080x1920 sequence was exported at 1024x540 while reporting `verified: true` (Premiere 24.0, macOS). Preset discovery now also searches Premiere's own `MediaIO/systempresets` when no Media Encoder presets exist, and the default never comes from `IngestPresets`; if no other H.264 preset is found, the tool asks for `preset_path`.

## [1.22.0] - 2026-10-08

### Fixed

- The Windows private-directory ACL check waits up to 30 seconds for `powershell.exe` instead of 5, in the server and in both CEP panels. On a loaded machine (including CI runners with coverage) PowerShell could take longer than 5 seconds to start, which made the check throw and blocked the bridge. A timeout still fails closed: the directory is not used unless the ACL check succeeds.
- Effect writes, stabilization, smart-bin creation, proxy detachment, folder imports, sequence creation, marker deletion and clip selection now distinguish requested edits from host readback, report ignored writes as failures and unreadable results as `committed_unverified`. Selection counts describe applied states; stabilization does not claim a completed analysis. CEP selected-clip removal refuses ripple requests before deleting because clip absence cannot verify gap closure.
- `set_sequence_display_format` writes Premiere's display codes (video 100-113, audio 200-201) and maps the older 0-11 / 0-1 inputs onto them. Premiere 26.5.2 stores and reads back any number, so the old values "verified" but did not select the format (2 formatted as non-drop timecode, 102 as drop-frame). `set_sequence_frame_rate` now reports the clips Premiere re-snaps to the new frame grid (`clipsMoved`, `maxShiftSeconds`, `movedClips`) with a warning that changing back does not restore them.
- `create_subclip` now returns the new subclip's `nodeId` and reads its stored range back. On Premiere 26.5.2 a soft-boundary subclip's `getInPoint`/`getOutPoint` read the whole media, so the range is read from the subclip's project metadata (`VideoInPoint`/`VideoOutPoint` timecode and frame rate). The result reports requested and observed in/out seconds, with `outcome: "verified"` when both are within one media frame of the request and `committed_unverified` otherwise or when the metadata cannot be read.
- `add_title` reports the start Premiere stored for the placed graphic. Premiere snaps it to the frame grid (a requested 5 s lands at 5.005 s at 29.97 fps), so `startSeconds` and the new `appliedStartSeconds` come from the placed clip, and the request is kept as `requestedStartSeconds`.
- `update_marker` reports the stored marker start as `timeSeconds` (for example 7.5075 s rather than the requested 7.5 s) and adds `requestedSeconds`.
- `manage_proxies` with `action: "toggle"` can set a known proxy display state. The action changes Premiere's application-wide proxy display (`app.setEnableProxies`), not the given item, and it only flipped the current state, so on Premiere 26.5.2 an agent could not ask for proxies on or off and two calls undid each other. It now accepts `enabled: true | false`, writes only when the state differs, and verifies by reading `app.getEnableProxies()` back; a host that ignores the write is reported as a failure. Omitting `enabled` still flips the state. Results report `previousEnabled`, `proxiesEnabled`, `changed` and `mode` (`set` or `flip`), and the description now says the action is application-wide.
- Still-image mark clearing now identifies unreadable still duration explicitly; `set_clip_start_time` shares the verified implementation of `set_start_time` and is documented as its alias. Colour selection states that it uses the source project item label because CEP has no timeline clip-label getter. Baked title-cache cleanup retains the newest 50 matching files and leaves unrelated directory entries untouched.

## [1.21.0] - 2026-10-07

### Fixed

- Effect-property lookup errors now list up to 25 non-empty display names; repeated names include their `property_index`, helping identify controls such as Gaussian Blur's `Amount` without guessing.

- `add_to_render_queue` now asks Media Encoder to render the active sequence's In/Out range instead of the entire sequence.
- `set_frame_blend` and `set_time_interpolation` report `committed_unverified` because Premiere exposes no readback for those QE writes; thrown writes warn that the mutation outcome is unknown.

- UXP inspect snapshots now include every expected guard needed by their matching apply or update action, including sequence identity, selection, display-format, work-area, playhead, and parameter animation state. Sequence-range inspection treats Premiere's negative In/Out sentinels as unset and returns explicit set flags so an unset range can be reviewed and updated safely.

- CEP `set_work_area` turns on a disabled work-area bar through the public Sequence API before writing, and checks the bar state and stored points afterwards. Premiere 26.5.2 ignores the CEP work-area point setters; when the points read back unchanged, the tool now fails, turns the bar back off if it turned it on, and points to the UXP `set_work_area`. Unreadable or partial writes still report `committed_unverified`. Work-area reads keep an unreadable bar state as unknown instead of treating it as disabled.
- `slide_edit` accepts source/timeline duration drift up to half a sequence frame or exactly one frame of host rounding, reports the signed drift, and continues to refuse larger or intermediate mismatches. Neighbour source and cut readback checks remain exact.

- `lift_selection` and `extract_selection` no longer cut one extra frame. Premiere 26.5.2 stores sequence marks floored to the 48 kHz sample grid, so at 29.97 an In on a frame was stored just before it: video lost the frame before the range and Extract rippled one frame short. Inexact marks are re-written on their exact frame through QE first (`marksRewritten`), and coverage and ripple checks now allow half a frame instead of a full frame, so a lost frame is reported instead of verified.
- `set_sequence_in_out_points` writes each mark on the first audio sample at or after its frame start. Premiere 26.5.2 stores sequence marks floored to the 48 kHz sample grid and renders an In/Out export from the frame holding the In to the frame holding the Out, so at 29.97 an export of a marked range started and ended one frame early on four of every five frames.

- `clear_sequence_in_out` now writes Premiere's unset value, so cleared points read back as unset like a new sequence, instead of writing 0 and the sequence end. On 26.5.2 the old method failed its own readback because the Out point is stored rounded to an audio sample. It reports each point after the change and leaves the point it was not asked to clear unchanged.

- `replace_clip` checks, before removing the original clip, that the replacement accepts the source range, and refuses an item that also carries the other media type, because Premiere 26.5.2's `Track.overwriteClip` also places that media on the matching track and overwrites the clips there. A replacement at another frame rate now fills the span: item marks may land up to one media frame early, and the placed end is extended to the original end (`endCorrected`). `unnest_sequence` runs the same source-range check before removing the nested clip.

- `link_selection` and `unlink_selection` read the clip links back instead of always reporting success. On Premiere 26.5.2 `unlinkSelection()` returns false and changes nothing unless every clip of the linked group is selected; `unlink_selection` now refuses such a selection before calling Premiere and names the partner clips to add. An already-unlinked selection is reported as `alreadyUnlinked`, and `link_selection` needs at least two selected clips.

- `set_item_in_out` verifies a mark within one media frame and reports the requested and applied seconds. Premiere 26.5.2 snaps project-item video marks to the media's own frame grid, so 0.5 s on 23.976 media (applied 0.4588 s) used to fail with a partial-state error. `clear_item_in_out` now reads MediaDuration as nominal-rate timecode ("23.98 fps" is 24000/1001, and 29.97 media can use drop-frame `;` timecode), so clearing 23.976 and 29.97 media verifies instead of returning `committed_unverified`. `set_source_in_out` gets the same media-frame tolerance and reports applied seconds.

- `add_transition` snaps `cut_point_seconds` to the sequence frame grid and uses the nearest clip edge within half a frame. It used to require the edge within one tick, so a cut point given to a few decimals (22.5892 s for the cut at 22.5892333 s at 29.97) was refused. The result reports the requested and applied cut seconds.

- `set_zero_point` writes the frame-snapped zero point and reads it back instead of always returning `set: true`. It reports the requested, applied, and previous seconds, and refuses a negative or non-finite `start_seconds` before contacting Premiere.

- Temporary project-item mark writes and failed source-mark updates preserve soft-subclip ranges using private metadata when the DOM reports the whole media. Restore reads support fractional and drop-frame video timecodes and audio sample timecodes; unreadable ranges refuse before a write.

- `duplicate_clip` now copies clips whose media frame rate differs from the sequence's. Premiere floors project-item marks to the media's own frame grid, so on Premiere 26.5.2 a 23.976 fps clip in a 29.97 fps sequence was copied with its source in one sequence frame early (19.9533 s instead of 19.9866 s) and reported `committed_unverified`. The tool now writes each mark a quarter media frame late, slips a copy whose source in is still less than one media frame off back to the original's source in, and accepts a mixed-rate source in within half a media frame. Results add `sourceIn` with the requested and applied seconds, `corrected` and `snappedToMediaFrame`. Same-rate clips are unchanged. Covered by unit tests with a fake host.

- The Claude Desktop extension starts when optional settings are left blank. Desktop can pass an unset `user_config` field through as the literal `${user_config.name}`; `PREMIERE_MCP_PROTOCOL_MODE` and `PREMIERE_UXP_TOKEN` now treat that, and blank values, as unset instead of failing startup with `PREMIERE_MCP_PROTOCOL_MODE must be either auto or legacy` (#828).

- The UXP loopback port binds on the first request other than `server/discover`, so Desktop's disposable discover-only probe copy no longer takes port 7777 and pushes the real server to CEP-only tools. A busy port is retried every 3 seconds instead of abandoned, a non-port UXP startup failure is reported without taking the CEP tools down, and the server exits when the client closes stdin (#828).

- A UXP bridge token with surrounding whitespace or a trailing newline (for example from `pbcopy`) is trimmed in the server and in the UXP panel instead of failing with an unexplained HTTP 401 (#828).

- `--diagnose-cep` repair inside the `.mcpb` bundle, which omits `scripts/`, now says so and points to the signed `MCPBridgeCEP.zxp` or `npx -y premiere-pro-mcp --install-cep` instead of failing on a missing script (#828).

## [1.20.0] - 2026-10-06

### Added

- `ripple_remove_timeline_ranges` previews and then applies a multi-range ripple removal (up to 50 sorted ranges) across unlocked, sync-locked tracks. Apply needs a single-use preview confirmation token and the `edit` capability, cuts on Premiere's own sequence timecode, and verifies every resulting clip by readback. It uses the experimental QE razor; a timeout after Premiere accepts the edit is reported as `mutationOutcome: "unknown"`. Live Premiere verification was reported by the contributor on 25.2.3 and 26.5.2; it was not re-run for this release.

- `set_footage_interpretation` accepts `field_type` (0 progressive, 1 upper field first, 2 lower field first) and reads it back (#806).
- `import_folder` accepts `target_bin` and skips `Thumbs.db`, `desktop.ini` and `.DS_Store` (#807).
- `get_encoder_presets` accepts `limit` and `offset`; the result adds `total` and `offset` (#808).
- `import_fcp_xml` accepts `mode: "into_open_project"` (with optional `target_bin`) to import into the open project; it succeeds only when the sequence count grew, and `project_path` is required only in the default `new_project` mode (#811).

### Fixed

- UXP tools on Premiere 26.5.2, found live on macOS:
  - **Project-item IDs.** The project root and some folders return no `getId` until cast with `ProjectItem.cast`. `inspect_project_tree_uxp` and `inspect_unique_object_identity_uxp` failed, and bin listings reported empty IDs. The advanced-workflow and unique-identity helpers now cast, as the other helpers already did.
  - **Slip, slide and split edits.** Premiere 26.5 applies TrackItem start/end and in/out actions like trims, so each edge action also moves its source point.
    - `slip_track_item_uxp` landed as a move. It now restores the timeline position with a second, measured move (two undo steps).
    - `slide_track_item_uxp` trimmed both neighbours twice. It now sends only the edge actions and writes source points afterwards only when they did not follow.
    - `make_split_edit_uxp` extended the audio twice, and it never checked whether the extension was free. An L-cut into the next audio clip left two items over the same range, and Premiere crashed (heap corruption) while drawing them. It now refuses when the extension would overlap another item on the same track, and it applies the source point only when needed.
  - **`ripple_delete_track_item_uxp`** deleted without rippling when another track had an item over the deleted range, such as a linked audio partner or a spanning adjustment layer. It now refuses before any change and names those items.
  - **Capabilities.** The bridge re-reads the panel's live capabilities before refusing a command that the connect-time handshake marked unsupported, and `get_uxp_capabilities` reports the live list. A panel that connected before a project was open or a workspace was approved hid 25 of 192 commands for the session.
  - **Markers.** `manage_markers_uxp` `add` now forwards and applies `color_index` and verifies every requested field. Previously the colour was dropped while the add reported verified.
  - **Frame export.** `export_frame_uxp` retries with the file extension when Premiere rejects an extension-less name ("File Format is not supported"). It also waits up to 15 s for the PNG, which 26.5.2 writes after the call returns, and it checks for the file by walking the approved workspace folder: a plugin with request-only file access cannot open arbitrary `file:` URLs, so the old check reported a written frame as missing.
  - **Media health.** `maintain_media_health_uxp` treats a single `project_item_id` as a one-item list for inspect, refresh and set_offline.

- `import_media` no longer reports an error when an `.xml`, `.aaf`, `.edl` or `.prproj` file imports correctly. Interchange files create sequences and bins rather than an item with the file's path, so they now return `outcome: "committed_unverified"` with `interchange: true`, which stops retries from duplicating the sequence (#805).

- `duplicate_clip` no longer places a copy one frame short. Premiere can snap the source out point a frame early, so on Premiere 26.5.2 a 677-frame clip was copied as 676 frames, and the tool still reported `verified` because it allowed two frames of drift. It now trims each placed copy, and its linked partner, back to the original end, reports `endCorrected`, and verifies start, end and source in-point to within half a frame.

- Effect parameter reads and writes use Premiere's lossless colour API for static colour controls, returning `[alpha, red, green, blue]` instead of a packed number. CEP refuses keyframed colour operations that cannot be read or written losslessly. Effect tools now refuse repeated property names with candidate indices or accept `property_index`; this applies to parameter reads, writes, keyframe operations, colour correction and built-in property workflows that resolve names.

- `razor_all_tracks` and `split_clip` cut on the requested frame in drop-frame sequences. They built a non-drop `HH:MM:SS:FF` string, which Premiere reads as drop-frame timecode on 29.97/59.94 DF sequences, so cuts landed early by the dropped-frame count (2 frames after the first minute, 28 frames at 16 minutes, measured on 25.2.3) and `razor_all_tracks` still reported `verified: true`. Both now let Premiere format the timecode in the sequence's display format, snap the cut to a frame, and verify the new boundary within half a frame; `razor_all_tracks` reports a misplaced cut as `committed_unverified`.
- Batched ripple-range previews now cap clip samples at 50 while retaining per-track counts and a confirmation fingerprint for the complete plan. Razor track spans are computed from one initial clip snapshot; cuts use Premiere's sequence-display timecode for fractional and drop-frame rates and refuse any resulting boundary more than half a frame from the snapped range edge. Frame-exact decimal ranges no longer appear as adjustments, and mutation receipts use the shared QE undo-stack reader.

- `add_audio_keyframes` and `setup_ducking` can add the first keyframe to a clip again. On Premiere 25.2.3 a property with no keyframes returns `undefined` from `getKeys()` (with `isTimeVarying()` false), which the audio and shared keyframe readers treated as unreadable storage, so both tools refused every clip without existing Volume keys. That state now reads as an empty key list; `null`, malformed lists, and `undefined` on a time-varying property still refuse.

- `detect_beats` no longer snaps tempo to a coarse grid or lets the beat grid drift. It decoded audio at 200 Hz and built a 20 Hz onset envelope, so periods could only take 50 ms steps (73 BPM reported as 75, 146 as 150) and the returned beat times drifted by about 0.4 s after 30 beats. It now decodes at 4 kHz, uses a 100 Hz envelope, and refines the period to a fraction of a sample across the whole file. On 3-minute click tracks from 60 to 174 BPM, tempo is exact and every beat time is within 20 ms.

- `detect_repeated_takes` no longer groups a short sentence with a much longer, different one because they share a few words. Similarity used bag-of-words containment, so on a real interview transcript "We have new city projects" (5 words) scored 0.8 against a 20-word sentence mentioning "different new city projects", and the default `keep: "last"` proposed removing 7.9 s of real content. When one sentence is under 60% of the other's length, containment now only counts a false start that matches the start of the longer sentence in order; similar-length retakes behave as before.

- `map_source_ranges_to_timeline` now treats `getSpeed() === 100` as normal speed on older Premiere hosts while continuing to refuse retimed or reversed clips.

- `set_sequence_frame_rate` sets exact NTSC timebases. It divided by the rounded decimal (`TICKS_PER_SECOND / 29.97`), giving 8475675676 ticks per frame for 29.97 and 10594594595 for 23.976, which are near-NTSC rates that drift against camera media and differ from Premiere's own presets (8475667200 and 10594584000). Requests within 0.005 fps of 23.976, 29.97, 47.952, 59.94 or 119.88 now use the exact `nominal × 1000/1001` timebase, and the receipt reports `ntsc` and `exactFrameRate`.

- Timeline edits for playhead, clip placement/duration/trim, sequence marks and sequence markers snap requested times to the active sequence frame grid, verify stored boundaries within 1/1000 frame, and report changed requested/applied values.

- `navigate_playhead` now reports timecode using Premiere's sequence display format, including drop-frame punctuation.

- Guarded UXP inspect results for slip, slide, ripple-delete, duplicate, sequence range, work area, preview frame, source label, marker removal, display formats, static effect values, keyframe times, media timing and overrides, selection, and video transitions now include schema-shaped expected objects accepted unchanged by apply. The converter maps panel camelCase values to the apply schema.
- UXP playhead, work-area, sequence-range, timeline insert/overwrite, selected-item clone, track-item move, slip/slide, split-edit, sequence and beat markers, MOGRT, and frame-export time inputs snap to the active sequence timebase using exact ticks per frame. Results report requested and applied values, and timeline readback accepts at most half a frame.

- Transition receipts distinguish verified placement from handle-limited duration, mark each deviating placement, and count duration deviations. Premiere-built title copies report their application-support location and are documented as user-managed files that must not be removed while any project references them.
- Filler-removal guidance explains that hesitation sounds require transcripts that preserve disfluencies; Whisper's default output omits them.

- FCP XML export receipts parse Premiere's BOM-prefixed Translation Report issue lines, bound effect details while reporting truncation, and wait for the XML size and modification time to stabilize before reporting its size.
- CEP command timeouts cancel still-unclaimed work when another recent busy marker or connector heartbeat shows Premiere is blocked; mutating commands report `not_applied`, while claimed work with a fresh busy marker continues waiting.

- `paste_clip_attributes` and `copy_effect_values` copy colour parameters (such as Lumetri White Balance) with `getColorValue()` / `setColorValue()`. `getValue()` returns these as one packed number above 2^53, so writing it back stored a different colour. On Premiere 25.2.3 a grey white balance came back as transparent blue. Keyframed colour parameters are reported as not copied instead of being written.
- `copy_effect_values` matches properties by position, then by unique display name. Lumetri Color repeats names such as Saturation and Intensity across sections, and the first-name match wrote values into the wrong controls. On 25.2.3 this left a correctly graded clip with the wrong Saturation and Intensity. Values that already match and unreadable section headers are no longer rewritten, and a failed copy now names the properties it skipped or could not verify.

- `copy_effects_between_clips` now copies and reads back effect parameter values and keyframes, updates an existing target effect instead of stacking a default instance, and refuses when the requested source effect is missing.

- Corrected the still-capture guidance from #771. Premiere's QE PNG stills are not wrong about keyframes. They are RGBA with straight alpha, so a fading clip keeps its colours and carries the fade only in alpha. On Premiere 26.5.2 macOS, stills composited over black matched an actual H.264 export (58.0 against 58.4 YAVG at mid-fade), and linear, hold and bezier gave different alpha (168, 255 and 189) at the same instant. The earlier "QE stills hold opacity" note came from measuring stills without their alpha channel. `export_frame` and `capture_frame` now report `hasAlpha` from the PNG header with a compositing note, and the client instructions, skills, interpolation receipts and review-frame scopes say to composite stills over black before comparing them with a video export.

- UXP tools on Premiere 26.5.2, found live on macOS:
  - **Project-item IDs.** The project root and some folders return no `getId` until cast with `ProjectItem.cast`. `inspect_project_tree_uxp` and `inspect_unique_object_identity_uxp` failed, and bin listings reported empty IDs. The advanced-workflow and unique-identity helpers now cast, as the other helpers already did.
  - **Slip, slide and split edits.** Premiere 26.5 applies TrackItem start/end and in/out actions like trims, so each edge action also moves its source point.
    - `slip_track_item_uxp` landed as a move. It now restores the timeline position with a second, measured move (two undo steps).
    - `slide_track_item_uxp` trimmed both neighbours twice. It now sends only the edge actions and writes source points afterwards only when they did not follow.
    - `make_split_edit_uxp` extended the audio twice, and it never checked whether the extension was free. An L-cut into the next audio clip left two items over the same range, and Premiere crashed (heap corruption) while drawing them. It now refuses when the extension would overlap another item on the same track, and it applies the source point only when needed.
  - **`ripple_delete_track_item_uxp`** deleted without rippling when another track had an item over the deleted range, such as a linked audio partner or a spanning adjustment layer. It now refuses before any change and names those items.
  - **Snapshots.** Slip, slide, ripple-delete and duplicate `inspect` results now include a snake_case `expected_snapshot` that `apply` accepts unchanged. Previously the camelCase inspect output was rejected by the apply schema.
  - **Capabilities.** The bridge re-reads the panel's live capabilities before refusing a command that the connect-time handshake marked unsupported, and `get_uxp_capabilities` reports the live list. A panel that connected before a project was open or a workspace was approved hid 25 of 192 commands for the session.
  - **Markers.** `manage_markers_uxp` `add` now forwards and applies `color_index` and verifies every requested field. Previously the colour was dropped while the add reported verified.
  - **Frame export.** `export_frame_uxp` retries with the file extension when Premiere rejects an extension-less name ("File Format is not supported"). It also waits up to 15 s for the PNG, which 26.5.2 writes after the call returns, and it checks for the file by walking the approved workspace folder: a plugin with request-only file access cannot open arbitrary `file:` URLs, so the old check reported a written frame as missing.
  - **Media health.** `maintain_media_health_uxp` treats a single `project_item_id` as a one-item list for inspect, refresh and set_offline.

### Changed

- Long-host receipts detect FCP Translation Report modals and report written XML/OMF as committed_unverified after host timeout; export preflight reports composite black/dead-air intervals within sequence In/Out with optional paged per-track details; media, ripple, and marker readbacks include generated-no-file classification, 1-based track labels, marker GUID and color. Queued commands now cancel atomically behind a fresh busy operation when possible, distinguishing not_applied from unknown mutation outcomes.

## [1.19.1] - 2026-10-04

### Fixed

- Sequence inspection reads now return bounded clip/gap pages, track counts and continuation offsets, with track/time filters and a response budget (#769).
- Transcription start tolerates unavailable optional ClipProjectItem identity access while preserving target resolution and replay guards (#772).
- CEP/UXP interpolation and still-capture receipts separate stored values and file existence from temporal animation. The 26.5.2 Windows capture report remains unresolved; contributor 25.2.3 macOS evidence distinguishes a QE still artifact from correctly encoded video curves (#771).
- Save As refuses unverified destination existence without overwrite confirmation. Committed duplicate, slide and slip edits retain replayable partial receipts when readback fails.
- Transcript import permits host-attached empty transcripts, creates TextSegments inside lockedAccess and compares full canonical JSON content when Adobe reformats the export. Nonempty transcript overwrite remains refused (#773).
- Transition duration arguments use frame-grid timecode. Direct MOGRT import refuses malformed ZIP/JSON templates before host dispatch (#773).

- `clear_item_in_out` verifies a cleared Out mark against the item's `MediaDuration` and `MediaTimebase` (frames for video, samples for audio), so audio items verify too, and reports the In and Out results separately. Live on Premiere 25.2.3: a cleared Out reads the full media length, and `MediaTimebase` is `48000 Hz` for audio and `25.00 fps` for video. (#696)
- An empty Source Monitor returns `undefined`, not `null`, on Premiere 25.2.3. The close and playback tools now treat a getter that returns `null` or `undefined` without throwing as an empty monitor; only a throwing getter is unreadable. Previously `close_all_source_clips` reported a genuinely empty monitor as `committed_unverified`. (#694)
- `add_to_timeline` counts only clips that match the inserted source and start at the insertion time as inserted, and reports split remainders separately (`splitRemainders`). A same-source mid-clip insert on 25.2.3 previously reported `insertedTrackItems: 2` for one inserted clip. (#680)
- Mutating bridge commands that time out after Premiere accepts them can report `mutationOutcome: unknown` and `timelineChanged: null`, with guidance to inspect before retrying.
- `encode_project_item`, `encode_file`, and `manage_proxies` `create` no longer call `app.encoder.startBatch()` after queueing. That API starts every ready Adobe Media Encoder job, including unrelated jobs already in the queue. Batch start is now opt-in with `start_batch: true`, matching `add_to_render_queue`. Use `start_batch_encode` to start the queue later.
- `ripple_delete`, ripple removal in `remove_from_timeline`, and rippling `apply_edit_plan` removals shift clips with `TrackItem.move()` and single-pass per-track lookups. The contributor measured one pause cut on Premiere 25.2.3 macOS dropping from about 31 minutes to about 3 on a 2-hour, 1,490-clip podcast sequence. Ripples that would move more than 400 clips refuse before mutation with a count and time estimate unless `allow_large_ripple` is set, host waits scale with the work without shortening a longer configured timeout, and an edit that times out after Premiere accepted it reports an unknown timeline state instead of a plain failure.
- `trim_clip`, `set_clip_duration`, `slip_edit`, `roll_edit`, and `slide_edit` no longer refuse every unlinked clip by default. On Premiere 25.2.3 `getLinkedItems()` returns `null` (without throwing) for a clip with no linked partner, which these tools treated as unreadable linkage; it now means "no partners", while throwing or malformed collections still refuse. `roll_edit` and `slide_edit` also accept the numeric `0` that `isSpeedReversed()` returns for a forward clip on that host (`1`/`true` still refuse), so they no longer refuse every clip there.

### Added

- `ripple_remove_timeline_ranges` previews up to 50 frame-snapped pause ranges, then removes them in one guarded pass across unlocked sync-locked tracks, shifting each surviving clip once with a verified receipt.

## [1.19.0] - 2026-10-02

### Added

- EXPERIMENTAL (QE DOM): `undo`, `redo`, and `multiple_undo` step Premiere's undo stack and verify each step against `undoStackIndex`. They stop when the stack stops moving, refuse on a host without `undoStackIndex`, and refuse when the stack has moved past `expected_undo_stack_index`. A step that moves the stack unexpectedly or leaves the index unreadable is reported as `committed_unverified` with a "Do not retry" warning. (#654)
- `list_stock_titles` lists Premiere's bundled title templates, and `add_title` places a stock title with the text baked into a copy of the template, reading each line back from its own layer. (#648)

### Changed

- `undo`, `redo`, and `multiple_undo` now require `expected_undo_stack_index` and refuse if the host cannot read it. `rename_clip` rejects blank names, `set_playhead_position` rejects negative or nonfinite times and clamps excessive times to the readable sequence end. `set_clip_volume` reports the stored level and applied dB (or an unverified write when readback fails) instead of echoing the requested dB. Edit-plan previews bind tokens to stable project, sequence and target identities; apply rejects changed identities before sequence activation or mutation. Enum validation errors list allowed values. (#725)
- QE and UXP effect-add receipts, plus UXP effect-removal receipts, now explicitly set `renderVerified: false`. A verified component readback does not establish that Premiere rendered the effect; confirm playback or exported output before delivery (#735).
- Timeline clip-property writes, splits, and duplicates validate and read back their results. Unreadable requested property state returns `committed_unverified`, lists unverified fields, and reports an unknown timeline-change state instead of claiming nothing was applied (#702).
- Legacy CEP inserts verify the requested source and insertion time for every media stream, and retain actual placement and undo data when Premiere diverts a stream to another track (#680).
- Blend modes use the contributor-measured Premiere 25.2.3 index order and verify stored values; keyframe times convert clip-relative seconds through the source in-point, reject retimed clips, and preserve unreadable removal outcomes (#683, #693).
- Audio level, mute, track lock, and video visibility writes validate arguments and read stored state back. Invalid or unreadable numeric/boolean states cannot certify success (#700, #705).
- Marker receipts flag unreadable requested colors, and CEP/After Effects string escaping preserves control characters and lone UTF-16 surrogates (#688).
- Effect removal recognizes the measured Spanish built-in component names and English/Spanish Balance names while retaining the refusal for unconfirmed locales (#692).
- Experimental QE adjustment-layer creation verifies a new public adjustment-layer clip at the playhead and never retries after a throwing insert. Still-frame imports, edit navigation, and project-item markers read back results; unknown marker colors stay unverified and preserve the persistent undo barrier (#698).
- Timeline marker requests refuse unsupported clip collections with source-time guidance only when the clip clock is known. Batch markers verify requested fields, keep unknown color state unverified, preserve partial writes and persistent undo guards, and retain uncertainty after a first throwing write (#699).
- Playhead and sequence marks validate bounds before writing and read back observed positions. Source Monitor edits verify the displayed clip, preserve unreadable post-write outcomes, and detect replacement timing when the same source is overwritten at the same cut (#694).
- Clip parameter, track rename, selected-clip removal, and project bin moves verify stored results. Numeric property reads retain unreadable outcomes, English and measured Spanish lookups remain supported, and clearing an Out mark cannot be certified without independent full-media duration evidence (#696).
- Media imports confirm new items for every requested path; labels, footage interpretation, bin names, graphics white luminance, and bin moves read back stored results. Invalid numeric interpretation reads cannot certify writes. CEP relink retains its default refusal and unverified unsafe opt-in (#697).
- Tools that declare parameters now reject unknown top-level arguments instead of ignoring them. A misspelled or renamed argument (for example `item_ID` for `item_id`, or `time_seconds` for `start_seconds`) used to be dropped silently, and the tool ran with its default. The call now fails before anything is sent to Premiere, and the error names the unknown arguments and lists the ones the tool accepts. Clients or saved prompts that send extra or renamed fields must be updated. Tools whose schema already sets `additionalProperties` or `patternProperties` are unchanged, and UXP tools already rejected unknown properties. Tools that declare no parameters (for example `ping` or `save_project`) still ignore extra arguments. A catalog test fails if a handler reads an argument its schema does not declare.
- CEP tools that change the project report `undoSteps` and `undoStackIndex` when Premiere recorded undo entries for the call, so an agent can reverse exactly that call. Tracking covers every non-inspect call, never reads the stack for inspect-only tools, and is reset across project switches. UXP tools and multi-command workflows are not counted; the undo descriptions say so and recommend `expected_undo_stack_index`. `has_proxy`, `is_work_area_enabled`, `verify_premiere_connection`, and `match_frame` are classed as inspect. (#654)
- `export_sequence` refuses an `output_path` that already exists unless `overwrite: true`, checks that the preset's extension matches the output file (the default H.264 preset writes `.mov`), supports in/out ranges, and verifies a non-empty file was written. (#648)
- `apply_lut` refuses instead of reporting `lutApplied: true`: Premiere 25.2.3 did not render a LUT set by path, and the old result had no readback. (#648)
- `delete_project_item` removes items through a temporary bin. It refuses when the item is used in a sequence unless `confirm_remove_from_sequences: true`, refuses when a bin with the temporary name exists, and reads back that both are gone. `organize_project_items_uxp` remove is named as the preferred route. (#648)
- A CEP command whose busy file stops changing now fails with "CEP panel appears stuck; reload it in Premiere" once its timeout passes; the busy file is never deleted automatically. (#648)

### Fixed

- UXP point and color parameter reads normalize host arrays and native objects before guarded inspection and write readback. RGB arrays use opaque alpha; absent values report `UXP_VALUE_UNAVAILABLE`, while scalar and malformed values fail with type-specific host errors. Client write/snapshot schemas remain strict objects (#765).
- CEP enabled-state readers use the TrackItem `disabled` property with a legacy method fallback; this release includes the source fix absent from npm 1.18.6 (#764).

- `trim_clip` and `slip_edit` now require physical media-duration evidence from ffprobe before changing source ranges, reject out-of-media edits, and refuse unknown duration or linked partners with different unprobed media. Editable project In/Out marks are not used as media boundaries (#712).
- CEP marker add, update, and delete attempts protect a project-document-ID undo boundary even when the QE index moves or cannot be read. Undo/redo calls refuse a count that crosses it before stepping; `acknowledge_untracked_markers: true` explicitly permits prior non-marker actions. Barriers persist in the CEP engine through MCP server/helper reloads, but do not account for unobserved UXP/manual UI/other-client marker writes or survive engine resets (#733).

- Ingest-transcode, timeline-tab closure, and Creative Cloud Library MOGRT import receipts now distinguish a host request from independent verification. Native errors preserve possible mutation and Library failures include Premiere's error text and actionable causes (#641).
- `save_project` now refuses an untitled project (no saved path) before calling Premiere, which would otherwise open a blocking Save dialog, and fails when the `.prproj` is missing or empty after `save()`. Verification requires fresh file size or modification evidence; an unchanged existing file or unreadable disk evidence reports `committed_unverified` with `saved: null`.
- `export_sequence` `range: "work_area"` now fails closed unless the enabled state is readable and true, and finite work-area bounds cover only part of the sequence within its readable duration. Unset or full-sequence work areas previously still called `ENCODE_WORKAREA` and could write the entire timeline as a verified work-area export.
- `import_media` now rejects missing paths before calling Premiere, avoiding a blocking host dialog that can wedge the CEP bridge (#713).
- Audio keyframes, ducking, and spot scale motion convert clip-relative offsets through the source in-point and refuse speed-changed clips; audio Level keys use the measured +15 dB-normalized mapping (0 dB = 0.1778, maximum +15 dB = 1), and key readback no longer accepts missing or nonfinite values as verified. (#693, #701)
- Transition edits validate inputs before dispatch, read stored placements and durations, distinguish partial writes from no-ops, and preserve mutation evidence if native writes or later readback throw. QE transition edits remain experimental. (#704)

- `apply_edit_plan` confirmation tokens are now random, issued only by `preview_edit_plan`, valid for 30 minutes, and consumed before the host edit. The private bridge directory retains token state across server restarts, so an applied token cannot be replayed after Undo or a restart (#728).
- `color_correct` requires Lumetri component and every requested property to read back before reporting success. Missing catalog entries, ignored QE insertion, localized or missing controls, and ignored setters fail honestly; receipts explicitly leave rendered output unverified (#720).
- `roll_edit` and `slide_edit` require physical source-duration evidence for every affected clip, bind edits to inspected placement/media, and reject invalid source windows or unknown duration before mutation. Slide readback checks exact placement and preserved source windows. Failures after a linked edit starts return `committed_unverified` and warn against retrying (#718, #719).

- Audio volume tools now recognize Premiere's Spanish `Volumen` and `Nivel` labels and locale-independent `Internal Volume` component match names, including bulk track volume changes and `setup_ducking` (#710).
- Legacy CEP `relink_media` now refuses by default because `changeMediaPath` can wedge Premiere on a valid file. Its explicit unsafe opt-in preflights the file and reports only `committed_unverified`; use `relink_offline_media_uxp` for capability checks and media-path/online readback (#729).
- `add_to_render_queue` can request AME batch start with `start_batch: true` after queueing. This starts all ready AME jobs, including unrelated jobs, so the default remains enqueue only. The receipt reports whether batch start was requested, rejected, or unavailable; it does not claim output creation (#687).
- `remove_all_effects` and `remove_effect_by_name` keep a graphic's Shape layers by their `AE.ADBE Shape` match name (confirmed on Premiere 25.2.3 with a stock lower third). A localized Shape layer still counts as proof of a localized host, so those hosts still refuse while the Time Remapping and Panner match names are unconfirmed. (#674)
- `apply_effect` and `apply_audio_effect` verify added components instead of trusting QE; missing readback returns `committed_unverified` with a warning to inspect the clip before retrying. An unchanged component count and undo index report `not_applied`, for example `Time Remapping`, which QE accepts but never adds. (#674)
- `create_sequence` and `create_sequence_from_preset` normalize `preset_path` to native separators before the QE call and report a missing preset file precisely (#691, #714): QE `newSequence` silently ignores forward-slash paths on Windows, which used to surface as a bare "Failed to create sequence from preset" error.
- `add_to_timeline_batch` now reads each inserted placement again after all later sync-locked inserts. If a later insert moves or splits an earlier clip, the result reports the final observed span as `committed_unverified` instead of retaining an earlier `verified: true` receipt (#721). Automated tests cover same-track stability and cross-track drift; live Premiere behavior remains to be checked.
- `create_sequence_from_preset` no longer reports `created: true` when QE `newSequence` leaves the already-active same-name sequence in place. It now snapshots sequence IDs first, the same way `create_sequence` does, and fails closed unless a new ID appears in the project collection.
- The four dedicated video Motion/Opacity setters recognize the measured Spanish (es-ES) built-in component and property names. Position and Scale retain readback, and Rotation and Opacity now read the stored value back before reporting verified success (#722). Automated tests do not establish live host compatibility.
- `get_export_file_extension` uses the existing AME preset-folder format map to infer an extension when Premiere returns none, but only for an existing .epr in a recognized folder; its receipt marks the inference as unconfirmed. `set_metadata` rejects unqualified project column names before a write. `add_keyframe` warns when the stored keyframe is outside the clip's visible span (#734).
- Insert helpers now make an experimental QE pre-razor attempt for a target clip that spans the insertion point before calling `Sequence.insertClip`. Required QE routes and the frame boundary are checked before mutation; the existing adjacent-tail readback still refuses false success if a host displaces a tail (#730). This workaround has only been exercised in automated host fakes and needs live Premiere verification.
- Marker add, update, and delete receipts now report whether Premiere recorded an undo step. On hosts where marker writes leave the undo index unchanged, `undoTracked: false` warns that Undo would reverse an earlier action instead of the marker (#733).
- `add_to_timeline` and `insert_from_source` detect a target-track split tail that Premiere moved away from the insert point. They report the changed timeline as `committed_unverified`, including the observed tail position, instead of claiming the insert was verified. The edit still needs inspection or Undo on affected hosts. (#730)
- Dialogue UXP apply accepts the documented Project/Sequence `guid` property when identity methods are unavailable, while still refusing changed or unreadable project identities before mutation (#685).
- AME queue handoff normalizes output/preset paths to native separators and checks both host paths before launching the encoder (#711). A job ID remains an unverified handoff.
- Export preflight and standard-DOM effect enumeration now state their verification limits: passing timeline checks does not verify exporter initialization, and omitted QE effects do not prove absence (#687, #690).

- Effect removal classifies built-in components by match name, which is the same in every host language: `AE.ADBE Opacity`, `AE.ADBE Motion`, a graphic's `AE.ADBE Graphic Group`, `AE.ADBE Text`, and `AE.ADBE Shape`, and the `Internal Volume …` / `Internal Channel Volume …` audio intrinsics (seen live on Premiere 25.2.3). #654 refused on every mono clip, because mono clips have Volume but no Channel Volume; that is fixed. A built-in picked by index or name is refused whatever its language. Hosts with localized component names still refuse, now detected by a confirmed built-in match name showing a non-English name, because the match names of Time Remapping and Panner are not confirmed and an unknown one could be removed. (#674, #679)
- EXPERIMENTAL (QE DOM): `remove_effect`, `remove_effect_by_name`, and `remove_all_effects` could not remove anything on Premiere 25.2, which has no DOM `Component.remove()`. They now fall back to QE removal, resolve every target's removal path before removing anything, never remove built-in components (Motion, Opacity, Volume, Channel Volume), and verify the result against the clip's component list. On hosts whose built-in component names are localized they refuse with nothing removed (#674). (#654)
- `stop_playback` accepts `target: "timeline" | "source"`. Premiere's ExtendScript and UXP APIs have no documented call that stops only the Source Monitor, so `target: "source"` now returns an error and stops nothing, instead of the argument being ignored and the timeline stopped. (#642)
- `export_as_project` and `export_as_fcp_xml` no longer report `exported: true` after a host call that writes no file. They require a real parent directory, then fail when the output is missing, empty, or identical to a pre-existing file. (#673)
- `save_project_as` no longer reports `saved: true` when Premiere leaves a pre-existing `.prproj` unchanged. It snapshots size and modification time first, requires a real parent directory, and fails closed if the file is missing, empty, or identical to the snapshot.
- User text containing U+2028, U+2029 or other control characters (for example a clip or marker name pasted from a document) no longer breaks the generated ExtendScript. ES3 treats U+2028/U+2029 as line terminators, so Premiere rejected the whole script with "EvalScript error"; `escapeForExtendScript` now writes them as `\uXXXX` escapes.
- `add_marker` and `update_marker` read the marker's name, comments, color and duration back and report `verified`; when Premiere ignores part of the request the error says the marker was still created or changed (`timelineChanged`). Marker times, durations and color indexes (0-7) are validated before a script is built.
- `remove_from_timeline` and edit plans ripple through Premiere's sync-locked ripple instead of `TrackItem.remove(true, …)`, which never rippled and left gaps and stray audio while reporting success. Every linked partner is checked for locks before anything is removed. (#648)
- Linked audio and video stay in sync across razor, trim, slip, roll, slide, and duration edits: partner positions are snapshotted before any write, and a trim or duration change applies the main clip's offset to each partner from that snapshot. (#648)
- `lift_selection` used a QE method that does not exist; `delete_track` now identifies default track names in any language; `consolidate_and_transfer`, both scratch-disk setters, `import_fcp_xml`, the proxy toggle, `encode_file`, and the After Effects MOGRT export work on 25.2. (#648)
- `normalize_loudness_file` uses two-pass linear loudnorm at the source sample rate instead of single-pass, which missed its target by 1.6 LU and resampled to 96 kHz. (#648)
- Two regexes in generated ExtendScript lost their `\s` escapes, so a clip's own frame size was never read (anchor points on a 4K clip in a 1080p sequence used the sequence size) and default track-name matching was loose. `set_clip_properties_batch` also writes Scale Width when Uniform Scale is off, so scaling no longer stretches the picture. (#648 review)

## [1.18.6] - 2026-09-29

### Fixed

- `set_scale_width_height` never set the height. It wrote to a "Scale Height" property that Premiere's Motion effect does not have, then reported success. With Uniform Scale off, Premiere keeps the height in Motion > Scale. The tool now writes the width to Scale Width and the height to Scale, reads all three values back, fails when any does not match, and rejects values outside 0-10000 before building a script. (#642)

### Changed

- The website moved to its own repository, [leancoderkavy/premiere-pro-mcp-site](https://github.com/leancoderkavy/premiere-pro-mcp-site), and is served at `https://premiere-pro-mcp.com`. It reads versions and tool counts from the published npm package and syncs them on its own, so releases here no longer update website files.
- The HTTP transport no longer serves website pages, the homepage experiment, or `/api/landing-events`. It answers `/mcp`, `/health`, and OAuth protected-resource metadata only. Other `GET` and `HEAD` paths on `premiere-pro-mcp.fly.dev` or a `*.premiere-pro-mcp.com` host redirect (`308`) to the same path on `https://premiere-pro-mcp.com`; any other host gets a JSON `404`. Its Content Security Policy is now deny-all, `/health` reports the running package `version`, and the `MCP_MAX_CONCURRENT_LANDING_DOCUMENTS`, `MCP_LANDING_MAX_HTML_BYTES`, and `MCP_LANDING_HTML_CACHE_BYTES` settings are gone. The Docker image no longer builds the site.

### Verification scope

- Automated checks validate package behavior. The `set_scale_width_height` fix follows a live report from Premiere 26.5.1 but has not been re-verified on a licensed Premiere host. The website move was verified live: premiere-pro-mcp.com serves from Vercel, and the Fly deployment answers `/health` and redirects other paths to the website.

## [1.18.5] - 2026-09-28

### Fixed

- `unnest_sequence` refuses before any change when the nest is trimmed, speed-changed or reversed, a target track is locked, or the target range already holds a clip. It now overwrites each nested clip's exact source range in place instead of inserting it, which pushed later clips down the track and ignored each clip's in and out. It reads every clip back afterwards and reports "The timeline changed … Use Undo" on any mismatch. Effects, keyframes, and transitions inside the nest are not carried over; the description says so. (#642)
- `move_clip_to_track` refuses before calling QE when either track is locked or the target range is occupied, finds the moved clip even when its node ID changes, and reports a copy left on the original track or a changed start, length, or in/out. It is now marked EXPERIMENTAL (QE) and rejects non-integer track numbers. (#642)
- `replace_clip` overwrites exactly the old clip's start and end instead of inserting the new item, which pushed later clips down the track and used the new item's full length. It verifies the span, that the old clip is gone, and that track clip counts are unchanged, and refuses on a locked track. The old clip's linked partner is left in place; the description says so. (#642)
- `export_frame_uxp` checks that the PNG exists after Premiere's exporter returns. It fails when no file was written, reports the real path when the host names the file differently (with or without the `.png` extension), and reports `committed_unverified` when UXP storage cannot check or the file already existed before the export. The panel's direct frame-export path now uses the same handler. (#642)
- `encode_media_uxp` results for jobs sent to Adobe Media Encoder carry `ameQueueStarted: "unknown"` and a note. Premiere 26.5.1 accepted UXP encodes into the Media Encoder queue without starting it. The tool does not start the queue through CEP; the note points to Media Encoder or `start_batch_encode`. (#642)
- `organize_project_items_uxp` remove verifies absence by walking the project tree instead of checking the Project panel selection first, which could still hold the removed item and turned a successful removal into `committed_unverified`. Remove now requires `project_item_id` and never falls back to the selection. (#642)
- `refresh_media` reads the interpreted frame rate before and after the refresh. When the refresh leaves an implausible rate (reported on stills as 29.97 becoming 2.75e-8), it restores the previous rate, reads it back, and reports `repaired: true`; if the restore does not stick, it fails with the manual fix. A real rate change from the source file is kept. (#642)
- `edit_timeline_uxp` MOGRT inserts (`insert_mogrt_path`, `insert_mogrt_library`) read the placement back instead of reporting the SequenceEditor return value. The result is `verified` when a returned item starts at the requested time, within one frame, on the requested video track. It fails with `UXP_VERIFICATION_FAILED` when nothing is there, and stays `committed_unverified` when the track cannot be read. Results include `sequenceId`, `requested`, and up to 16 `placements`. (#642)
- `set_sequence_pixel_aspect_ratio` compares the read-back ratio as a number, so a host that formats it as `1`, `1:1`, or `1.42222` no longer fails a correct update. A real mismatch reports the value Premiere read back. (#642)
- `play_source_monitor` fails with "No clip is loaded in the Source Monitor" instead of reporting a playback request that does nothing, names the loaded clip, and rejects a `speed` that is zero, not finite, or outside -64 to 64 before building a script. (#642)
- `create_bars_and_tone` takes an optional `bin_id`. The bin is resolved before anything is created, the new item is moved there, and its location is read back; the result is `committed_unverified` when the move cannot be confirmed. (#642)
- `get_unused_media` and `get_duplicate_media` page their output with `offset`, `limit` (1-500, default 100), and a case-insensitive `contains` name filter, and return `total`, `returned`, `truncated`, and `nextOffset`. Large projects no longer return unbounded lists. (#642)
- `get_duplicate_media` no longer groups different After Effects compositions imported from the same `.aep` or `.aepx` as duplicates. The same composition imported twice is still reported. (#642)
- `get_project_panel_metadata` caps the returned XML at `max_chars` (256-200000, default 20000) and reports `truncated` and `totalChars`. Truncated XML is marked as unsafe to pass back to `set_project_panel_metadata`. (#642)

### Verification scope

- Automated checks validate package behavior. These changes follow live reports from Premiere 26.5.1 but have not been re-verified on a licensed Premiere host. The `unnest_sequence` and `replace_clip` overwrite path (`Track.overwriteClip` with source In/Out marks) has only been exercised against test fakes; its readback reports any host difference as a failure.

## [1.18.4] - 2026-09-28

### Fixed

- `import_transcript_uxp` refuses to import over an existing transcript (`UXP_TRANSCRIPT_OVERWRITE_REFUSED`). On Premiere 26.5.1 a failed import cleared an existing transcript that could not be restored. (#642)
- UXP commands larger than the panel's 64 KiB frame limit are refused by the server with `UXP_COMMAND_TOO_LARGE` instead of timing out after 30 seconds. (#642)
- `manage_metadata_uxp` update and field update fail with `UXP_METADATA_NOT_APPLIED` when Premiere commits the transaction but the metadata reads back unchanged, instead of reporting `updated: true`. (#642)
- UXP project Save As, create, and branch copies ask for `confirmOverwrite` only when the destination file exists. Premiere 26.5.1's `Project.isProject` reports true for any `.prproj` path. (#642)
- CEP tools that act on a timeline clip through the QE DOM no longer pass the DOM clip index to `qeTrack.getItemAt()`. QE counts gaps as track items, so on a track with a leading or intermediate gap these tools renamed, re-effected, or retimed the wrong clip. `rename_clip`, `remove_all_effects`, `set_frame_blend`, `set_time_interpolation`, `apply_effect`, `apply_audio_effect`, `color_correct`, `apply_lut`, `stabilize_clip`, `copy_effects_between_clips`, `batch_rename_clips`, and `get_qe_clip_info` now match the QE clip by timeline start and fail before any change when no clip matches. `copy_effects_between_clips` reports each effect as verified, committed_unverified, or failed from a readback of the target's components instead of silently dropping errors. `apply_effect` and `apply_audio_effect` also no longer emit a malformed error string that stopped the generated script from parsing. (#642)

### Verification scope

- Automated checks validate package behavior. These changes follow live reports from Premiere 26.5.1 but have not been re-verified on a licensed Premiere host. The QE clip lookup change has not been verified on a licensed Premiere host either.

## [1.18.3] - 2026-09-28

### Security

- UXP path arguments are now checked in the MCP server process before a command is sent. Any absolute path that goes through a symbolic link or directory junction is refused with `UXP_PATH_SYMLINK_REFUSED`. Premiere 26.5 UXP reports a link's own path and cannot `lstat`, so the panel's workspace check could be bypassed through a link inside the approved folder. (#640)

### Fixed

- `get_work_area` now reads work-area points as seconds, as live Premiere 25.2 and 26.5.1 hosts return them. It had divided them by ticks-per-second and reported values near zero. `set_work_area` writes seconds and reads the result back; it fails honestly when a build ignores the write. (#642)
- `export_sequence` now fails when Premiere rejects the render or writes no file. (#647)
- UXP source-media timing reads Premiere 26.5's documented synchronous `Media.getStart()` / `getDuration()` before the deprecated Promise-returning `start` / `duration` properties, so `manage_source_media_timing_uxp` can set a start time on 26.5 hosts instead of reporting the command unavailable.

### Verification scope

- Automated checks validate package behavior. The UXP media timing change and the server-side symlink guard have not been verified on a licensed Premiere host.

## [1.18.2] - 2026-09-26

### Added

- Documented Premiere 26.5 WorkAreaUtils coverage with a capability-gated UXP tool. (#637)

### Fixed

- Prevented inspect tools from evaluating unescaped ExtendScript. (#639)

### Documentation

- Clarified the independent Adobe Premiere Pro MCP search presentation on GitHub and the project site. (#643)

### Verification scope

- Automated checks validate package behavior. The new UXP operation has not been verified on a licensed Premiere host in this release.

## [1.18.1] - 2026-09-23

### Fixed

- `manage_proxies` create and `add_to_render_queue` pass a Boolean
  `removeUponCompletion` to Adobe Media Encoder, fixing "Illegal Parameter type"
  on those handoffs. (#630)

### Documentation

- Client guides for GPT-6 Sol and GPT-6 Luna (Codex) and Claude Opus 5.5
  (Claude Code, Claude Desktop, Cursor). (#631)

### Verification scope

- The fix is covered by mocked automated tests only; it is not verified on a
  licensed Premiere host.

## [1.18.0] - 2026-09-23

### Added

- MOGRT text recipes default to `text_controls: "full"`: each text layer exposes
  Font Size, Stroke Width, Fill Color, and Stroke Color controls plus named
  Position, Scale, Rotation, Anchor Point, and Opacity Essential Graphics
  controls. The create result reads back source-comp controller names.
  `text_only` keeps the previous behavior. Font-family editing is not scriptable
  and is reported as a known gap. (#618)
- `media_placeholder` MOGRT recipe imports a workspace-contained PNG, JPEG, MOV,
  or MP4, requests a replaceable Essential Graphics media slot, and exposes its
  transform controls. Not verified on a live After Effects or Premiere host.
  (#619)
- `import_mogrt` accepts `text_values`, writes each named text control after
  insertion (replacing only the text value so styling is kept), and reports
  `verified`, `mismatch`, `missing_property`, or `committed_unverified` per
  field. `get_mogrt_component` returns `textValue` for every parameter and an
  optional `expected_values` audit that flags stale Headline text. (#617)

### Fixed

- `encode_file` and `encode_project_item` pass natively typed arguments (String
  paths, Boolean removal flag, Time in/out), fixing "Illegal Parameter type";
  `encode_file` fails early when the preset file is missing. (#615)
- `set_xmp_metadata` passes numeric `XMPConst` options to
  `XMPUtils.appendProperties`, fixing "Bad argument list". (#611)
- `manage_proxies` auto-discovery skips "Same as Project" proxy presets whose
  output never reached `output_path`, and asks for `preset_path` when no safe
  preset exists. (#610)
- `manage_metadata_uxp` and `create_subclip_uxp` find items inside nested bins.
  (#612, #613)
- `set_scale_to_frame_size` accepts timeline clip IDs and reports `verified` or
  `committed_unverified`. (#614)

### Known limitations

- The Essential Graphics panel can display a stale Headline after a MOGRT text
  write. The tools read stored values and cannot refresh the host panel (#616
  remains open).
- These fixes are covered by mocked automated tests only; they are not verified
  on a licensed Premiere or After Effects host.

## [1.17.0] - 2026-09-21

### Added

- `paste_clip_attributes` copies a source clip's effect stack, values, and
  keyframes onto a target clip with per-property readback. Masks and a differing
  Blend Mode are reported as not copied because no documented scripting surface
  exposes them. (#595)
- `compute_mask_fit_motion` computes Motion Scale/Position that place a still's
  subject inside an existing Rounded Crop, Crop, or similar mask. Inspect only.
  (#594)
- `set_clip_duration` sets a placed timeline clip's duration or absolute end by
  moving only `TrackItem.end`, so still images can be extended past their import
  length. It refuses overlaps with the next clip, guards effect keyframes when
  shortening, reads start/end back, and restores the original end when Premiere
  clamps the write. (#592)

### Changed

- Clip speed messaging is consistent across `speed_change`, `set_clip_speed_qe`,
  `set_clip_properties`, agent instructions, docs, and skills: documented
  ExtendScript and UXP (through 26.3) expose only speed getters, the QE setter
  stays unused, and `set_clip_duration` is the supported timing alternative. (#593)

### Fixed

- `set_target_track` targets exclusively by default (`exclusive: false` keeps
  other tracks targeted) and reads every track back; `get_target_tracks` lists
  every targeted track and unreadable tracks. (#587)
- `create_bars_and_tone` returns the created item's name, node ID, and tree path.
  (#588)
- `get_bin_contents` resolves nested bins by node ID with guarded child access and
  clean errors instead of a raw TypeError. (#589)
- `manage_timeline_source_label_uxp` accepts `sequence_id` and resolves it by GUID,
  failing closed instead of targeting the active sequence. (#590)
- `create_bin` honors `parent_bin_id` and reads back the new bin's parent. (#591)
- Windows bridge-directory ACL checks ignore capability and app-container SIDs
  (`S-1-15-*`), so the default location under `%LOCALAPPDATA%` no longer fails at
  startup; the ancestry error names each offending path and SID. (#581)

## [1.16.4] - 2026-09-20

### Added

- Claude Fable 5.1 client workflow guidance for Cursor and other compatible MCP
  clients, covering model selection, data-retention opt-in, tool discovery, and
  serialized Premiere verification. (#576)
- Named Premiere metadata field inspect and update through existing CEP and UXP
  tools, with field readback instead of requiring complete packet dumps. (#577)

### Changed

- Shared `AGENTS.md` as the canonical repo map for IDE and coding-agent stubs,
  and pin client CEP install commands to the published package. (#582)

### Fixed

- `set_item_in_out` and `set_source_in_out` pass seconds, not ticks, to
  `ProjectItem.setInPoint`/`setOutPoint` and verify tick readback. A Source
  Monitor readback mismatch restores original marks when possible and otherwise
  reports a partial state. The ExtendScript reference documents those setter
  arguments as seconds. (#579)
- CEP `create_subsequence` verifies the new sequence without ES5
  `Array.indexOf`, which ExtendScript does not provide. (#579)
- `ripple_delete` now fails closed when QE sync-lock state cannot be read,
  instead of omitting neighbours and reporting a verified ripple. (#578)
- Still-image `capture_frame` / `export_frame` AME fallback restores sequence
  in/out only after those marks can be read, so a failed restore cannot leave
  the sequence pinned to one frame. (#580)

Automated checks do not establish licensed Premiere or After Effects playback or
rendered-output verification.

## [1.16.3] - 2026-09-18

### Changed

- Changelog landing intro no longer stacks a large vertical pad on the shared
  public-content main padding.
- npm minor and patch updates: `@posthog/core` 1.54.2, `@posthog/types` 1.412.1,
  `posthog-node` 5.52.4, `zod` 4.6.5, and `@types/node` 26.6.1.

Automated checks do not establish licensed Premiere or After Effects playback or
rendered-output verification.

## [1.16.2] - 2026-09-18

### Fixed

- Direct UXP `.ccx` packages now use a plugin-id bundle root and Unix 644/755
  permission bits so Creative Cloud / UPI can extract plugin metadata. (#566)
- Path-based UXP commands now resolve native paths through the granted
  workspace folder instead of advertising them as unsupported on every host.
  (#567)

Automated checks do not establish licensed Premiere or After Effects playback or
rendered-output verification.

## [1.16.1] - 2026-09-17

### Added

- Editor-request tools on the production CEP bridge, each with preflight and
  readback: `add_markers_batch` (up to 200 verified sequence or clip markers per
  call for beat grids, chapters, silence reviews, and client notes),
  `select_clips_by_pattern` (every-Nth selection with offset, name/regex,
  duration, range, track, and enabled filters), `navigate_playhead`
  (start/end/in/out/work-area/edit/marker/frame stepping),
  `create_sequence_checkpoint` and `list_sequence_checkpoints` (named
  `[checkpoint]` sequence clones plus a diff-ready snapshot), and
  `export_sequence_edl` (CMX 3600 EDL generated from timeline readback with
  drop-frame support, reel mapping, M2 motion lines, and self-validation through
  the existing CMX parser, returned inline or written inside an approved
  workspace).
- Local review planners: `plan_client_notes_checklist` turns pasted reviewer
  feedback into a categorized, prioritized checklist with timecodes, ranges,
  approvals, questions, and an `add_markers_batch` payload;
  `plan_multicam_angle_switches` plans active-speaker angle cuts for stacked
  camera tracks with minimum holds, crosstalk cover shots, lead-in cuts,
  periodic cutaways, razor times, per-camera enable ranges, and markers.
- The `essential`, `inspection`, `delivery`, and `assistant-edit` tool packs
  include the relevant new tools; both planners are classified as `inspect`
  authority. See [docs/editor-requests.md](docs/editor-requests.md) for the
  community and competitor evidence and verification boundaries.

### Fixed

- `insert_from_source`, `add_to_timeline`, `add_to_timeline_batch`, and
  `apply_edit_plan` insert operations no longer report success after
  `Sequence.insertClip` ripples only the named tracks. The public DOM has no
  sync-lock API; these tools now read QE `isSyncLocked()`, razor spanning clips
  on locked neighbours, shift later clips with `__writeClipSpan`, and verify
  the result. Mid-clip inserts on a target track are treated as a
  split-plus-insert (two new items), not a failure. Default `scope` is
  `sync_locked` and requires the target sequence to be active so QE razors the
  same timeline. A razor that does not split a spanning neighbour fails closed.
  Pass `target_tracks` to opt in to the old target-only ripple; that path still
  verifies the named pair, honors DOM `Track.isLocked()`, and warns that other
  tracks may desync. If QE or lock state is unavailable the sync-locked path
  refuses before mutating. `apply_spot_workflow_plan` uses `target_tracks`
  because it inserts then trims to the planned duration; a sync-locked ripple
  would shift overlays and music beds by the untrimmed source length. (#562)
- `ripple_delete` now closes the gap on the clip's own track and every QE
  sync-locked track, and refuses when a locked neighbour would be left
  straddling the hole. (#561)

Automated checks do not establish licensed Premiere or After Effects playback or
rendered-output verification.

## [1.16.0] - 2026-09-16

### Added

- Local reaction-Shorts planners: `plan_reaction_captions` stacks overlapping
  speaker colors without guessing unknown speakers, `plan_short_subscribe_cta`
  places a mid-video subscribe overlay, and `plan_short_export_folder` names a
  series folder to create before export. Different labeled speakers may now
  overlap in a word timeline. (#543)
- Guarded Speech-to-Text start, caption style guidance, and UXP transcription
  language options. (#513, #515)
- Install collision-defense identity output for `--version` and `--doctor`, plus
  a verified npm installation guide and package-identity checks. (#516, #533,
  #534)
- Recorded workflow evidence and a source-linked Premiere MCP comparison. (#532)
- Interactive cinematic landing: 3D timeline, draggable trims, a program
  monitor, public-page styling, studio install/Name-check callout, Ahrefs
  verification, and a female-narration advertisement. (#517–#521, #524–#531,
  #546)
- Bounded Fly landing events now go to PostHog as well as Google Analytics,
  without autocapture, session replay, or person profiles. (#522)

### Fixed

- Host-reported tool crashes and false verification for clip markers, MOGRT JSON
  values, first transcript import, FCP XML destination checks, and UXP tree
  IDs. (#544)
- Security audit findings: HTTP and filesystem work is bounded, and bridge
  directories fail closed when ownership, symlinks, or ancestor replacement
  rights are untrusted. (#545)
- AME handoff tools require a saved project so Same as Project preset
  destinations cannot resolve against a scratch folder. (#535)
- Homepage overflow and cinematic timeline replay after the landing merge.
  (#523)

### Changed

- Creating a UXP preset sequence now requires explicit confirmation. (#542)
- The Claude Desktop bundle no longer requires a UXP token for CEP-only setups.
- Homepage experiment assignment is exposed at first paint. (#514)
- Removed the throwaway `uxp-spike` directory. (#520)

Automated checks do not establish licensed Premiere or After Effects playback or
rendered-output verification.

## [1.15.2] - 2026-09-14

### Fixed

- `trim_clip` now rolls back source metadata to prevent clip corruption when a partial write occurs (source points changed but timeline edge didn't move). Previously these clips entered a permanently-stuck state. (#509, #503)
- `export_frame`, `capture_frame`, `freeze_frame`, and the `export_sequence_*_review_frames` tools now write the requested frame on macOS Premiere Pro 26.5 / 27 beta. QE still exporters take `(timecodeString, pathWithoutExtension)`; the previous `(path, width, height)` call returned `false` without writing a file, so every frame export fell through to the Media Encoder fallback. Frame time is now formatted with `Time.getFormatted()` in the sequence's display format (drop-frame included), the editor's playhead is no longer moved, and the result reports the timecode and frame index that were rendered. (#510)
- Preset discovery (`get_encoder_presets`, the default `export_sequence` preset, proxy ingest presets, and the still-image fallback) now looks inside the `.app` bundle that lives one level below `/Applications/Adobe Media Encoder <version>/` on macOS. Previously only the user's own presets under `~/Documents/Adobe/Adobe Media Encoder/*/Presets` were found. (#510)
- `verify_premiere_connection` now aligns panel and active sequence identity checks. (#501)
- `create_mogrt_recipe` now exposes composition parameter controls correctly. (#504)
- `apply_mogrt` now surfaces buildToolScript and importMGT error details. (#505)
- `inspect_color_value` argument unwrapping no longer fails. (#506)

### Changed

- Removed orphaned chat-plugin directory and build scripts. (#502)
- Pinned Adobe type definitions at 26.3 until drift receipts are rewritten for stable 26.5. (#508)

## [1.15.1] - 2026-09-11

### Fixed

- Use a null destination for UXP project-root file imports, matching the Premiere API contract.
- Consolidate exported page aliases with permanent redirects and improve homepage accessibility, image delivery, and installation journeys.

### Changed

- Add a searchable tool reference, precise client configuration, and clearer competitive evaluation guidance.
- Refresh the homepage experiment with Premiere artwork and gallery layouts, with end-to-end journey coverage.
- Update landing dependencies and comparable GitHub search measurement.

Automated checks do not establish licensed Premiere or After Effects playback or rendered-output verification.

## [1.15.0] - 2026-09-08

### Added

- Added film editorial evidence, cross-app workflow planning, and verified After Effects render handoff workflows.
- Improved setup discovery, troubleshooting documentation, and MCP Registry publication validation.

- Added timeline QA: `diff_sequence_snapshots` compares two sequence
  snapshots (normalized, `get_sequence_structure`, or
  `inspect_sequence_structure_uxp` shapes) into added, removed, moved,
  trimmed, retimed, renamed, and enabled changes with frame deltas and
  EDL-like timecode lines, and `audit_timeline_health` scores a snapshot for
  flash frames, gaps, overlaps, disabled clips, repeated shots, missing
  audio or video coverage, overlength, extreme speed, invalid times, and
  leading or trailing black with review-frame suggestions. Media paths are
  reduced to a basename and hash in every output.
- Added speaker layout planning: `plan_speaker_checkerboard` turns
  speaker-labelled words into frame-snapped per-speaker segments, split
  points, and track assignments for checkerboarded dialogue, and
  `plan_active_speaker_reframe` computes per-speaker crop, Scale, and
  Position framings for a vertical target with hold or eased keyframes at
  each speaker switch, or static stacked and side-by-side two-speaker
  layouts. Both route to existing track, razor, transform, crop, and keyframe
  tools and fall back to `auto_reframe_sequence`.
- Added rhythm planning: `plan_emphasis_zoom_keyframes` turns sentence
  starts, emphasis words, a fixed interval, or supplied trigger times into
  Motion Scale and subject-anchored Position keyframes with easing, hold,
  cooldown, and alternate-return options, shaped for `add_keyframe` and
  `automate_effect_parameters_uxp`. `plan_beat_montage` carves a detected beat
  grid into shots every N beats, assigns clips in order, priority, or
  round-robin, and returns `add_to_timeline_batch` chunks, a trim plan, and
  beat markers.
- Added shorts intelligence: `rank_short_form_candidates` scores
  sentence-aligned windows of a word timeline with explainable hook,
  completeness, density, evidence, keyword, duration-fit, and
  speaker-consistency components, suppresses overlapping candidates, and
  routes to the existing subclip, derived-sequence, reframe, and caption
  tools. `plan_chapter_markers` segments a transcript into chapters with
  TextTiling-style lexical cohesion, titles each chapter from distinctive
  terms, and returns YouTube timestamps and ready `add_marker` payloads.
- Added dynamic caption authoring: `build_caption_artifact` turns a word
  timeline into an SRT or VTT artifact with per-cue word grouping, line
  wrapping, minimum and maximum cue durations, flicker-suppressing merge gaps,
  optional VTT karaoke word timestamps, emphasis markup, speaker prefixes, and
  documented style presets, written only inside an approved workspace or
  returned inline. `check_caption_safe_zone` reports overlaps between caption
  or graphic rectangles and approximate TikTok, Reels, Shorts, feed, YouTube,
  LinkedIn, and X interface zones with a suggested clear position.
- Added word-level transcript cleanup planning from a revision-bound word
  timeline: `plan_filler_word_removal`, `plan_pause_tightening`,
  `plan_word_mute_ranges` (mute or bleep listed words with ready audio
  keyframes and redacted text), and `detect_repeated_takes`. Plans return
  frame-snapped removal and keep ranges and route to the existing derived
  dialogue sequence preview/apply tools; nothing is applied.
- Added local platform-delivery planning: `plan_platform_delivery_matrix`
  turns one source sequence into per-platform sequence settings, exact
  fit/fill reframe math, duration and file-size fit, caption safe zones, and
  an ordered route through existing clone, reframe, caption, export, and
  delivery-verification tools. `validate_platform_publish_package` checks a
  rendered file plus title, description, hashtags, and content flags against
  approximate TikTok, Reels, Shorts, YouTube, LinkedIn, X, and Facebook limits.
  Both are read-only and never change Premiere.

### Fixed

- `inspect_video_transition_uxp` now resolves the documented
  `VideoClipTrackItem` surface through `VideoClipTrackItem.cast()` before
  reporting a capability gap, so it returns a target snapshot again on
  Premiere 26.3 and `add_video_transition_uxp` / `remove_video_transition_uxp`
  are reachable. A genuine gap now names the missing methods. (#454)
- `ripple_delete_track_item_uxp` and `slip_track_item_uxp` no longer report a
  bare failure after the host has already committed the transaction. A
  divergent result now fails with `UXP_COMMITTED_UNVERIFIED`, states that the
  project has already changed, describes what actually landed (for example a
  delete that left a gap instead of rippling), and tells the caller not to
  retry. (#455)
- `inspect_source_proxy_uxp`, `manage_timeline_source_label_uxp`, and
  `inspect_source_media_provenance_uxp` now read project-item identity through
  the documented `ProjectItem.cast()` and await it, instead of failing
  universally with "Premiere does not expose getId for this target". Bins that
  expose no readable ID are traversed rather than rejected. (#456)
- `roll_edit` now moves the source out point and the incoming clip's in point
  with the visible cut and verifies all four values, so the timeline and the
  clips' in/out metadata can no longer disagree after a reported success. (#457)
- `import_fcp_xml` now passes both arguments `app.openFCPXML(path, projPath)`
  requires. It takes a new required `project_path`, checks that the XML exists,
  refuses to overwrite an existing project, and verifies the destination
  project was created. (#458)
- `manage_sequences_uxp` now forwards only the parameters each action accepts
  instead of blanket-forwarding every documented field, and explains locally
  which parameters an action takes when given one it does not. (#459)
- `attach_custom_property` now reads the sequence project item's XMP packet
  before and after the write and fails when the property never lands in XMP,
  instead of reporting an unverified success. (#460)
- `undo` and `redo` now fail closed with a named capability error, matching the
  fix already shipped for `multiple_undo`. `undo` no longer throws
  `ReferenceError: app.project.undo is not a function`, and `redo` no longer
  reports an unverifiable success. (#462)
- `set_effect_property` now accepts array values for 2D vector properties such
  as Motion > Position and Anchor Point, and verifies an array readback
  component by component instead of with strict equality. (#463)
- `import_ae_comps` now fails closed when the `.aep` file does not exist and
  when the target bin gains no items, instead of reporting success for a
  nonexistent path. (#464)
- `add_tracks` now fingerprints every existing track before the call and
  locates those fingerprints afterwards, so it reports explicitly when QE
  inserted the new tracks at index 0 and shifted every existing track up. A
  matching total count alone no longer implies success. (#465)
- `get_render_queue_status` now returns a capability error naming
  `app.encoder.isRunning` when the host does not expose it, instead of an
  `isRunning: "unknown"` string that reads as a legitimate status. (#466)

## [1.14.9] - 2026-09-04

### Added

- Expanded the separate After Effects CEP bridge into a guarded MOGRT studio.
  Five deterministic title, callout, quote, and social recipes run only in an
  already saved, workspace-contained After Effects project and export to an
  existing approved directory.
- Added optional brand-kit constraints, bounded JSON/CSV batch previews,
  immutable workspace-contained version libraries, source inspection,
  queue-only renders, and an explicit empty-track Premiere handoff that
  verifies insertion and exposed-control descriptors.
- Added capability-aware assistant-editor workflows and GPT-6 Astra discovery
  guidance so clients can inspect the current, authorized tool surface before
  proposing an editing workflow.

### Changed

- Hardened the MCP transport's bounded bridge-command backlog and refreshed
  public tool counts, workflow documentation, registry metadata, and the
  landing's machine-readable release references.

### Safety

- MOGRT workflows never accept arbitrary script text, create or switch After
  Effects projects, overwrite artifacts, start a render queue, or treat host
  acceptance, a ZIP header, or an import descriptor as rendered-frame or
  visual proof.
- Capability discovery and workflow guidance describe the current host surface;
  they do not grant authority or establish licensed-host, playback, render, or
  marketplace verification.

## [1.14.8] - 2026-09-04

### Added

- Added a separate After Effects CEP bridge and four approval-gated MOGRT
  authoring tools. The initial `lower_third` recipe only runs in an already
  saved, workspace-contained AE project and exports to an existing approved
  directory.
- Added one-time preview tokens, explicit export confirmation, isolated AE
  bridge helpers/temp directory, and local ZIP-header artifact verification.
- Added a local SRT/VTT timing-review plan for lecture and interview captions,
  including bounded correction previews and a separate structural/playback/
  rendered-output verification checklist.
- Added revision-bound, opt-in editorial evidence import for caller-supplied
  transcript, shot, audio, note, and opaque frame-reference data; it remains
  local and rejects stale source or timeline revisions.
- Added no-write `premiere-pro-mcp --doctor --plan-fixes` repair guidance and a
  narrowly scoped, confirmation-gated local connector recovery path.
- Added a generated public workflow manifest, workflow-proof receipt/runbook,
  and a universal client setup guide with explicit distribution boundaries.

### Changed

- Added an in-panel global npm/CEP connector update handoff for Windows. It
  requires confirmation, waits for Premiere to close without forcing it, and
  uses the published-package update path.
- Reused immutable MCP registration descriptors and JSON Schema adapters across
  stateless server construction, while retaining per-request context, telemetry,
  and UXP state. Concurrent CEP commands now share a response-directory watcher
  with polling retained as the correctness fallback.
- Refined the public landing for mobile and reduced motion, removed the deferred
  3D dependency path, and refreshed its facts, structured data, sitemap, public
  crawl policy, and machine-readable reference files.

### Safety

- MOGRT authoring never accepts arbitrary script text, creates or switches AE
  projects, creates output directories, overwrites artifacts, or treats host
  acceptance/a ZIP header as import, rendered-frame, or visual proof.
- Caption timing plans, editorial evidence import, doctor repair plans, and
  public workflow materials remain distinct from licensed-host, playback,
  rendered-output, provider, or marketplace verification.

## [1.14.7] - 2026-09-02

### Added

- Added bounded UXP source-proxy readiness inspection, with explicit opt-in
  disclosure for an attached proxy path, and read-only animated PointF
  endpoint-displacement inspection.

### Fixed

- Added an explicit `PREMIERE_MCP_PROTOCOL_MODE=legacy` fallback for desktop
  clients whose stdio protocol negotiation cannot use the modern server mode;
  the default remains the current automatic mode and invalid values fail fast.
- Updated the affected `@humanfs/node`, `fast-uri`, and `qs` dependency paths.

## [1.14.6] - 2026-09-02

### Added

- Added `create_editorial_context_pack`, a review-only, revision-aware Markdown
  reading view for explicitly captured transcript, shot, audio, source,
  timeline, and editor-note context. It is bounded by entry and character
  limits and never invokes a provider, Premiere bridge, or project mutation.
- Added guarded UXP workflows for sequence playhead and range updates, marker
  batch removal, native transition application, caption-track inventory,
  silence-cut stringouts, atomic split edits, and beat-grid markers.
- Added local-only delivery conformance, sampled video scopes and motion
  analysis, Warp Stabilizer status inspection, and shot-match planning.
- Added source-backed inventories for documented UXP, CEP, ExtendScript, and
  native SDK integration surfaces.

### Fixed

- Made unsupported sequence pixel-aspect ratios, partial transitions,
  unavailable media timing readback, and incomplete delivery probes fail
  closed instead of reporting unverified success.
- Corrected marker, encoder, duplicate-media, caption, and capability
  inference contracts, with expanded mutation verification coverage.

## [1.14.5] - 2026-08-31

### Added

- Added safe user update commands for global npm installations and guarded
  source check/update scripts. Global updates refresh the CEP connector after
  npm succeeds; source updates require a clean fast-forwardable checkout.

### Fixed

- Corrected macOS bridge-directory handling when `TMPDIR` is set and made QE
  transition writes target the intended clip on current Premiere builds.

## [1.14.4] - 2026-08-29

### Fixed

- Corrected QE razor operations to pass sequence timecode rather than ticks and
  added regression coverage for both split and all-track cuts.
- Made batch effect application preflight every target, match QE clips without
  assuming gap-free indexes, and require post-application component readback.
- Replaced false playback-success claims with explicit request-only results and
  polling guidance when the legacy API cannot provide same-call verification.
- Added direct QE by-name effect probes when Premiere exposes an empty effect
  catalog, while labelling bounded fallback lists as partial.
- Made an empty or unavailable QE audio-transition catalog fail closed instead
  of appearing as a usable transition list.

## [1.14.3] - 2026-08-29

### Added

- Added an optional, fail-closed OAuth resource-server mode with RFC 9728
  protected-resource metadata, remote JWKS verification, exact issuer and
  audience validation, required scopes, and an explicit trusted-subject
  allowlist for operator-managed HTTP deployments.

### Security

- Added an IP-keyed admission gate before JWT verification and isolated
  authenticated rate-limit identities behind random process-local keys.
- Made partial or mixed OAuth/shared-token configuration fail startup, kept the
  shared token as an operator-only compatibility mode, and removed internal
  admission counters from the public health response.
- Kept public desktop routing deliberately disabled: OAuth does not claim
  user-to-device pairing or access to a user's local Premiere process.

## [1.14.2] - 2026-08-28

### Added

- Added dual-era MCP serving with the stable TypeScript SDK v2: modern
  `2026-07-28` discovery and stateless request handling over HTTP and stdio,
  with legacy protocol compatibility through `2025-11-25`.
- Added validated modern routing headers, cache hints, subscription-listen
  support, a formal Premiere extension capability, and a machine-readable MCP
  protocol report in `get_capabilities`.
- Added an evidence-backed capability matrix covering implemented, SDK-ready,
  external-boundary, deprecated, and intentionally unsupported MCP surfaces.

### Changed

- Migrated tool, resource, prompt, client, stdio, and Node HTTP integrations
  from `@modelcontextprotocol/sdk` v1 to the split v2 packages and Standard
  Schema registration APIs.

### Fixed

- Restored strict JSON Schema 2020-12 tool compatibility and corrected legacy
  CEP argument contracts, Premiere Time units, Adobe Media Encoder output
  paths, active-sequence verification, metadata readback, XMP patch merging,
  and single-extension UXP frame exports.
- Replaced false-success responses for structural edits, duplicate
  consolidation, effect copying, nesting, deletion, and other host mutations
  with verified outcomes or explicit fail-closed errors.
- Added bounded UXP selection lift and native transition adapters while keeping
  unavailable track-management and global-redo capabilities explicit.

### Safety

- Live Premiere resources remain private and uncached, and tool discovery is
  private-cache scoped. The tasks extension and OAuth discovery are not
  advertised without the durable storage and authorization infrastructure they
  require.

## [1.14.1] - 2026-08-27

### Fixed

- Made npm package verification isolate its temporary tarball and select the
  package matching `package.json`, avoiding a current npm CLI packaging
  regression before publication.

## [1.14.0] - 2026-08-27

### Added

- Added focused `essential`, `inspection`, `delivery`, and `captions` tool packs
  so compatible MCP clients can begin with a smaller task-specific catalog.
- Added `inspect_sequence_review_report`, a read-only, handoff-oriented sequence
  report, and explicit MCP output schemas for every registered tool.

### Safety

- Tool packs change discoverability, not authority. Review reports redact media
  paths by default and include marker comments only with explicit opt-in.
- Package and response-contract checks remain distinct from licensed Premiere
  host verification.

## [1.13.0] - 2026-08-22

### Added

- Added `preview_project_intake`, a bounded, inspect-only project intake tool
  that evaluates Premiere project organization against a facility-supplied
  template and returns redacted findings plus proposed actions without changing
  the project.
- Added a deterministic intake rules engine, a guided workflow entry, a public
  facts page, and design-partner/security pilot contracts for human-supervised
  assistant-editor adoption.

### Safety

- File paths remain redacted unless explicitly requested, recursive capture and
  outputs are bounded, and the intake workflow does not mutate or persist
  project data. Automated tests passed, while licensed-host execution remains a
  separate gate because Premiere 2026 hung before the CEP panel could open.

## [1.12.2] - 2026-08-22

### Fixed

- `set_effect_property` now accepts safely serialized string values as well as
  numbers, unlocking MOGRT and graphic parameters that Premiere exposes as
  JSON strings. Responses report parameter readback separately from render
  verification.
- An empty legacy QE effect catalog now returns a clear no-mutation capability
  response rather than incorrectly reporting a requested effect as missing.
  When connected, the documented UXP effect catalog and transaction workflow is
  the supported alternative.

## [1.12.1] - 2026-08-22

### Fixed

- Allowed Google Analytics collection requests to `www.google.com` in the
  restrictive Content Security Policy, matching the current Google tag client.

## [1.12.0] - 2026-08-22

### Added

- Added local-first editorial planning for organization, stringout, rough-cut,
  caption-review, and platform-cutdown workflows. Plans are non-mutating and
  can be previewed against captured local project context.
- Added a guarded UXP organization apply route with stable source and parent
  guards, structured bin/move/color readback requirements, partial-outcome
  reporting, and a licensed-host validation runbook.
- Added a canonical product-claims registry and regression coverage for
  release-backed claims and unsupported endorsement language.

### Fixed

- Editorial-plan preview and apply now accept only exact server-issued plans
  with opaque confirmation tokens. Client-modified plans and duplicate source
  guards are rejected before any UXP mutation.
- Unverified UXP attempts are no longer reported as applied or committed.

## [1.11.5] - 2026-08-19

### Fixed

- macOS Adobe Media Encoder preset discovery now scans application-bundle resources under
  `Contents/MediaIO/systempresets`, and preset filtering normalizes names such as `H.264` and
  `H264`.
- `add_to_timeline` now validates its arguments and verifies that a single requested item landed
  on each affected target track, returning an error instead of a false success when Premiere
  creates an unexpected residual fragment at an exact insert boundary.
- Removed calls to unsupported or incorrectly signed speed and raw-text caption APIs. Speed
  requests and `add_text_overlay` now return actionable errors before mutating Premiere.
- `add_keyframe` now verifies stored parameter readback and explicitly labels render output as
  unverified; `create_caption_track` likewise labels its result as structural rather than
  render verification.

### Changed

- Published ten research-backed implementation recommendations covering MCP subscription streams,
  contextual completions, workspace boundaries, resource annotations and canonical URIs, prompt and
  resource-injection defenses, layered end-to-end health checks, experimental C2PA inspection,
  UXP external-launch safeguards, and semantic keyframe verification.

## [1.11.4] - 2026-08-19

### Fixed

- The Claude Desktop MCPB now prompts for a sensitive Premiere UXP token and maps it to
  `PREMIERE_UXP_TOKEN` in the bundled server process, allowing the authenticated loopback UXP
  listener to start when Claude Desktop does not inherit login-shell environment variables.

## [1.11.3] - 2026-08-18

### Added

- Added a revision-locked `plan_transcript_rough_cut_uxp` workflow that maps native transcript
  deletion ranges to verified 1x sequence placements, orders cut instructions from the end of the
  timeline, and requires duplicate-sequence and post-mutation verification safeguards.

### Fixed

- Premiere Pro 26.3 can reject a manifest list of loopback WebSocket domains with `Manifest entry
  not found`. The UXP package now uses Adobe's compatible network permission while the panel keeps
  enforcing the exact loopback-only `/uxp` endpoint at runtime.

## [1.11.2] - 2026-08-18

### Added

- Added a durable local project-context engine with active-sequence capture,
  transcript/shot/audio/note enrichment, bounded retrieval, and non-mutating
  edit-plan scaffolds. Source-media and timeline revisions are tracked
  independently so ordinary timeline changes do not repeat expensive source
  analysis.
- Added a context-aware rough-cut prompt and `config://premiere-project-context`
  resource documenting privacy, invalidation, retrieval, and preview requirements.

### Fixed

- `add_track` and QE-backed `add_tracks` now validate their inputs and return success
  only after the active sequence reports the exact requested track-count increase. The
  single-track call uses a bounded QE fallback only when the public DOM call made no
  change, and never retries a partially applied call.
- `overwrite_clip` now rejects invalid video and audio track indices before invoking
  Premiere and confirms the requested source item appears at the requested frame. A
  no-op or an unverifiable repeat placement returns an error instead of false success.
- `trim_clip` now proves the requested source point also produced the expected visible timeline
  edge and duration. It refuses retimed clips and, by default, trims that would strand effect
  keyframes instead of treating source-metadata-only changes as success on Premiere Pro 26.x.
- `split_clip` now verifies that a clip spans the requested cut and that QE produced each expected
  left/right segment, rather than accepting any increase in track clip count. QE keyframe
  redistribution remains explicitly unverified.
- `remove_effect` and `remove_effect_by_name` now preflight `Component.remove()` support before
  mutation. Unsupported Premiere 26.x components such as Essential Sound's Amplify return an
  actionable capability error without crashing or partially removing matched effects.

### Security

- Native media paths are hashed before persistence, credential-like enrichment
  metadata is discarded, stale source/timeline enrichments are rejected, and
  context clearing remains an explicit filesystem-authorized action.

### Validation

- Added fail-closed CEP/QE contract coverage for trim, split, track creation, overwrite placement,
  and component removal. Licensed Premiere Pro 26.x host confirmation remains a separate gate.

## [1.11.1] - 2026-08-16

### Fixed

- Extensionless landing routes such as `/changelog` now resolve to their
  exported `index.html` file instead of attempting to stream a directory. The
  previous behavior emitted an unhandled `EISDIR` error on Linux and restarted
  the remote HTTP process.
- Static asset candidates are required to remain inside the landing directory
  and resolve to regular files, and read-stream failures are handled without
  terminating the server.

### Validation

- Added regression coverage for extensionless exported routes and asynchronous
  static-file read failures. The complete release gates remain distinct from
  validation inside a licensed Premiere host.

## [1.11.0] - 2026-08-16

### Fixed

- `set_clip_volume` passed decibels straight into Premiere's `Volume > Level`
  property, which is a normalised 0..1 value where 1.0 is +15 dB, not a dB
  value. Every negative dB clamped to 0 (silence) and every positive dB clamped
  to 1.0 (+15 dB), and Premiere reports no error either way, so the failure was
  silent - a whole timeline could be muted with the tool reporting success.
  Levels are now converted with `10^((dB-15)/20)`.

### Added

- `get_clip_volume` reads a clip's level back in dB, so a level change can be
  verified rather than assumed.
- `set_clips_volume` applies a level to every clip on an audio track (or a
  chosen subset) in one call. Setting levels across an 80-clip sequence
  previously meant 80 round trips.
- Added eight capability-gated third-wave UXP tools for bounded host events, AME
  terminal receipts, host readiness, safe multi-project sessions, growing-media
  leases, transactional checkpoints, media health, caption-aware track state,
  source-clip trim and framing, and hybrid-acceleration evidence.
- Added a generated supported-actions catalog covering all 282 core tools, the
  default profile, resources, prompts, and connected UXP actions with explicit
  backend and verification boundaries.
- Added a schema-backed hybrid benchmark evidence template and a fail-closed
  verifier so accelerated paths cannot be advertised without matching host,
  dataset, correctness, latency, and provenance evidence.

### Changed

- Expanded the authenticated UXP surface from 40 to 48 capability-gated tools,
  bringing the connected default profile from 318 to 328 tools while keeping
  CEP as the production-compatible bridge.
- Bounded event and readiness history, reported eviction and pending states,
  and preserved host timeout budgets with a response-delivery buffer.
- Required explicit confirmation and readback for external project writes,
  destructive track or source mutations, and pause leases; failed UXP commands
  are never replayed automatically through CEP.

### Validation

- The merged release tree passes 1,490 automated tests across 53 files with
  91.26% branch coverage, generated-document checks, landing lint/build, and
  package-content validation.
- Real Premiere host validation remains not run; mock and contract evidence does
  not establish behavior inside a licensed Premiere installation.

## [1.10.0] - 2026-08-16

### Added

- Added 21 consolidated, capability-gated UXP tools across two stable workflow
  groups, expanding the connected surface from 297 to 318 tools while retaining
  CEP as the production-compatible bridge.
- Added native effects, selection batches, deterministic timeline selection,
  scene detection, proxy and ingest control, offline relinking, transactional
  metadata, color conformance, Source Monitor audition, Productions storage
  preflight, and an operator-selected workspace broker.
- Added project-panel selection, marker CRUD, bin organization, sequence settings,
  workspace-gated imports, typed parameter and keyframe automation, track-item
  transforms, SequenceEditor operations, sequence lifecycle controls, and Adobe
  Media Encoder submission.

### Changed

- Bounded selection, project, marker, sequence, bin, and keyframe inspection so a
  request cannot accidentally traverse or serialize an unbounded production project.
- Grouped compatible mutations into Adobe action transactions with stale-state
  guards, replay protection, and post-commit readback. A failed UXP mutation is
  returned to the caller and is never silently retried through CEP.
- Replaced UXP filesystem full access with operator-selected folder access and kept
  native paths and persistent tokens inside the panel.

### Security

- Updated vulnerable transitive dependencies and refreshed the validated package
  lockfiles used by the server and landing build.

### Validation

- Automated unit, contract, distribution, and coverage gates exercise the expanded
  UXP surface. Real Premiere host verification and latency benchmarking remain
  pending and are not implied by this release.

## [1.9.3] - 2026-08-12

### Added

- Added the Premiere Pro MCP cinematic intro video to the landing assets.
- Added the dated security best-practices audit report for repository reference.

### Changed

- Simplified the README release overview to show only the latest release and link
  to the complete GitHub release notes.

### Security

- Updated the landing build's transitive `nanoid` dependency to a patched version.

## [1.9.2] - 2026-08-04

### Fixed

- Changed the CEP Premiere host declaration to a minimum-only supported version
  so Adobe Developer Distribution does not reject the signed ZXP for claiming
  an unsupported future maximum.
- Updated transitive URL, HTTP middleware, and IP-address parsing dependencies
  to patched versions after newly disclosed security advisories.

### Added

- Added a public privacy policy covering local media processing, optional MCP
  operational telemetry, website analytics, retention, and user choices.

## [1.9.1] - 2026-08-02

### Security

- Added a production HTTP header baseline for the landing site, health route,
  and remote MCP responses: CSP, HSTS, MIME sniffing protection, frame denial,
  referrer and permissions policies, and cross-origin opener isolation.
- Restricted the browser connection policy to the application, configured
  analytics endpoints, and the bounded PostHog host.

## [1.9.0] - 2026-08-02

### Added

- Added a read-only `verify_premiere_connection` tool, human-readable `--doctor`
  diagnostics, and a privacy-sanitized `--support-bundle` for guided recovery.
- Added an accessible in-panel Connection Center and native Windows/macOS CEP
  installer pipelines that require trusted platform signing for production use.
- Added deterministic direct and Marketplace-channel UXP CCX packaging with
  explicit Adobe identity and live-host verification gates.

### Changed

- Reworked onboarding around the AI assistant an editor already uses, with the
  Claude Desktop MCPB route first and npm/JSON configuration under Advanced.
- Upgraded the Claude Desktop bundle manifest to MCPB v0.4 and stopped emitting
  an unsupported `.dxt` copy of the same bytes.
- Registered 280 core tools, exposed 278 under the default profile, and exposed
  297 tools when the 19 capability-gated UXP tools are connected.

### Validation

- Automated checks cover distribution schemas, deterministic CCX packaging,
  support-bundle privacy, installer path containment, production signing gates,
  and connection evidence states. Real Premiere host verification and external
  Adobe/Anthropic approvals remain separate release gates.

## [1.8.0] - 2026-08-01

### Added

- Added three read-only, capability-gated UXP transcript tools: native transcript
  export, native transcript search, and revision-locked transcript edit previews.
- Added a deterministic SHA-256 transcript revision and confirmation token so a
  proposed edit cannot be confused with a regenerated transcript.

### Changed

- Expanded the connected UXP surface from 16 to 19 tools while keeping automatic
  transcript-to-timeline application unavailable pending real-host validation.
- Added repository Copilot instructions and a deterministic Node 24 setup workflow.

### Validation

- Automated tests cover transcript range validation, revision locking, capability
  registration, and the MCP catalog. A real Premiere 25.6 or 26.3 host still must
  validate transcript semantics before any apply operation is introduced.

## [1.7.0] - 2026-08-01

### Added

- Added six capability-gated Premiere 26.3+ UXP tools: `rename_track_uxp`,
  `create_subclip_uxp`, `list_markers_uxp`, `set_source_monitor_position_uxp`,
  `has_transcript_uxp`, and `export_aaf_uxp`.
- Added Adobe 26.3 coverage documentation and contract tests for the public MCP
  schemas, protocol commands, and live-host verification gate.

### Changed

- Documented the stable 26.3 baseline separately from Adobe's 26.5 beta type
  declarations. Beta-only APIs are not advertised as supported.

### Validation

- Automated contract tests validate catalog exposure, argument translation, host
  capability probes, and result envelopes. A real Premiere 26.3+ host still must
  validate each mutation and export before it can be called live-host verified.

## [1.6.0] - 2026-07-31

### Added

- Added a capability-aware UXP foundation for revisioned project inspection, verified saves,
  preset-based sequence creation, OTIO/FCP XML interchange, transcript-language discovery,
  Object Mask detection, and Adobe Media Encoder controls on compatible Premiere hosts.
- Added explicit UXP operation outcomes and bounded operation-ID replay protection so a client retry
  does not repeat a completed command within the same panel session.

### Changed

- Documented the 10 UXP MCP tools that become available when an authenticated local panel is
  connected, including their host-version and live-verification boundaries.
- Updated the MCP SDK and Node type dependencies and GitHub Actions artifact actions.

### Fixed

- `create_project` now rejects directory paths and verifies that Premiere switched to the exact
  requested `.prproj` path before reporting success, preventing edits from continuing in a
  previously open project after a failed creation attempt.
- Claude Desktop bundle packaging now invokes npm through the active Node executable so the
  release build works on Windows where `npm` is exposed as a command shim.

## [1.5.0] - 2026-07-30

### Added

- Added `detect_silence` for finding dead air in local source media with FFmpeg, including
  Docker support and clear local-install guidance.
- Added anonymous, opt-out PostHog usage telemetry with prompt flushing for low-volume servers.
- Added an immersive editorial landing-page experience, product demo video, changelog page, and
  a 30-day launch plan.

### Changed

- Expanded the MCP surface to 279 tools and limited advertised tools to those allowed by the
  active capability profile.
- Documented capability-filtered discovery, remote media-path constraints, and the difference
  between the 279 registered tools and the 277 tools available to the default profile.

### Fixed

- Structural timeline tools now verify razor, ripple-delete, transition, and track-targeting
  mutations instead of reporting success when Premiere applied only part or none of an edit.
- Server metadata now reports the package version rather than a stale hard-coded value.
- Resolved CodeQL findings in HTTP authentication and filesystem-path handling.

## [1.4.0] - 2026-07-26

### Added

- Added in-panel connector update discovery and trusted downloads from GitHub Releases.
- Added authenticated MCP-to-UXP WebSocket transport, transcript and caption inspection, event-driven
  state reporting, operation semantics, and supported video-transition workflows.
- Added recovery diagnostics, export verification, AV inspection, capability reporting, and
  collaboration/AI feature eligibility discovery.
- Added installable Codex, Claude Code, and Claude Desktop distributions.

### Changed

- Expanded the MCP surface to 278 tools and aligned documentation, plugin metadata, and distribution
  manifests with the new release.
- Added automated signed CEP connector assets and Claude Desktop bundles to GitHub releases.

## [1.3.1] - 2026-07-25

### Fixed

- Fixed `set_sequence_frame_rate` to convert frames per second into Premiere's required
  ticks-per-frame `Time` value and verify the applied setting instead of assigning a numeric frame
  period that could corrupt the sequence timebase. ([#37](https://github.com/leancoderkavy/premiere-pro-mcp/issues/37))

## [1.3.0] - 2026-07-25

### Added

- Added a Windows release workflow that builds and verifies a signed CEP ZXP with Adobe's pinned
  `ZXPSignCmd`, includes it in the npm package, and installs it ahead of the unsigned development
  bundle.
- Added `--diagnose-cep` to verify installation metadata, debug-key types, and recent Premiere
  signature failures.

### Changed

- Upgraded the toolchain to TypeScript 7, Vitest 4, Zod 4, `@types/node` 26, and
  `@modelcontextprotocol/sdk` 1.29.
- Updated the landing app to Next.js 16.2.12 and patched production transitive dependencies.
- Raised the supported Node.js floor to 20.19 and expanded CI through Node.js 24.

### Fixed

- Added explicit Node types for TypeScript 7 and updated Zod 4 JSON-schema conversion.
- Fixed Windows installations that require a signed CEP extension instead of the debug-mode raw
  folder used by development builds. ([#36](https://github.com/leancoderkavy/premiere-pro-mcp/issues/36))

## [1.2.3] - 2026-07-23

### Changed

- Improved npm and GitHub discovery metadata, added explicit TypeScript and public-registry package
  configuration, and added automated dependency update configuration.

## [1.2.2] - 2026-07-23

### Fixed

- Corrected obsolete repository links in the npm README and republished package metadata so the
  repository, homepage, and issue links point to the maintained project.

### Added

- Added `npm run publish:npm`, `npm run publish:npm:dry-run`, and a manual GitHub Actions npm
  publish workflow that validates builds, tests, packed files, duplicate versions, and uses
  token-free OIDC trusted publishing with automatic provenance.

## [1.2.1] - 2026-07-21

### Added

- Added `get_capabilities` for machine-readable Windows/macOS runtime, CEP/UXP backend,
  authority-profile, and live-host verification reporting.
- Added GitHub Actions build, test, and package validation on Windows and macOS with Node 18 and 22.

### Fixed

- Audio-level writes now convert dB to Premiere's amplitude value and verify the applied value.
- Audio keyframes now use Premiere `Time` objects and verify each written value.
- Ripple delete, razor, and native transition tools now verify host state and return actionable
  errors instead of false success on affected Premiere Pro 26.3 installations. ([#21](https://github.com/leancoderkavy/premiere-pro-mcp/issues/21))
- Capability profiles now enforce `inspect` and `edit` across the complete tool surface and treat
  expression evaluation as unsafe scripting instead of allowing unclassified tools through.
- The npm CLI now copies the CEP plugin on macOS, verifies installation metadata, rejects unsupported
  host operating systems, and avoids platform-specific `/tmp` configuration in cross-platform examples.

### Performance

- Prefer event-driven bridge response notification with a conservative polling fallback, reducing
  idle filesystem checks while preserving compatibility with filesystems where watching is
  unavailable or unreliable.
- Cache immutable tool catalogs and converted Zod schemas across stateless HTTP server instances.
  A local 100-iteration benchmark reduced average repeated server construction from 5.87 ms to
  2.21 ms (62.4%).

## [1.2.0] - 2026-07-20

### Added

- Added preview/apply edit plans with strict operation validation, SHA-256 confirmation binding,
  operation IDs, and structured audit events.
- Added capability profiles. Raw ExtendScript tools now require explicit `unsafe-script` authority.
- Added structured MCP tool results, safety annotations, four guided workflow prompts, and the
  `config://premiere-workflows` resource.
- Added a packaged Premiere 25.6+ UXP bridge preview with capability discovery, state-change
  events, reconnecting WebSocket transport, and supported frame export with file verification.

### Validation

- TypeScript build passes, all 333 automated tests pass in a single-worker run, and the npm dry-run
  package contains both CEP and UXP bundles. Live Premiere verification of the UXP host API and
  loopback transport remains outstanding.

## [1.1.7] - 2026-07-20

### Changed

- Redesigned the Premiere Pro CEP bridge panel with clearer connection status, responsive
  controls, improved directory configuration, and a larger live activity monitor.
- Added accessible labels, focus states, reduced-motion support, and consistent status details
  without changing the bridge command workflow.

### Validation

- TypeScript build and 315 automated tests pass. The panel was also rendered at a 500 x 700 CEP
  viewport and visually checked against the approved design concept.

## [1.1.6] - 2026-07-20

### Fixed

- **Frame capture's Media Encoder fallback now exports exactly one frame.** The fallback passed
  tick values to sequence in/out methods that require seconds, producing an invalid export range
  when the undocumented QE frame-export method wrote no file. The range and its saved state are
  now converted to seconds. ([#9](https://github.com/leancoderkavy/premiere-pro-mcp/issues/9))

- **Windows CEP installation now enables unsigned-extension discovery correctly.** The CLI uses a
  native PowerShell installer on Windows and creates `PlayerDebugMode` as the `REG_SZ` value Adobe
  requires. Previous instructions incorrectly specified a DWORD, and the Bash installer never
  enabled Windows debug mode. ([#14](https://github.com/leancoderkavy/premiere-pro-mcp/issues/14))

- CEP bundle and extension versions now match the npm package version, with regression coverage to
  prevent future drift.

### Validation

- TypeScript build and 315 automated tests pass. The corrected Premiere runtime paths still require
  live confirmation on a machine with Premiere Pro installed.

## [1.1.2] - 2026-07-11

The headline of this release is that the CEP 12 bridge fix from
[#1](https://github.com/leancoderkavy/premiere-pro-mcp/pull/1) finally ships to npm. It has been on
`main` since March but was never published, so everyone who installed with `npm install -g` still
got a bridge that returned `null` for every tool call. If that was your symptom, upgrading is the
whole fix.

### Fixed

- **The bridge returns data again on Premiere Pro 2023+ / CEP 12.** The published `CSInterface.js`
  shim called `__adobe_cep__.evalScript(script)` without forwarding the callback. CEP 9+ is
  async-only, so every result was silently discarded and every tool answered
  `{"success":true,"data":null}` while the panel cheerfully logged "Result: OK". The manifest was
  also missing `--enable-nodejs`, leaving `require("fs")` undefined in the panel.
  ([#2](https://github.com/leancoderkavy/premiere-pro-mcp/issues/2),
  [#5](https://github.com/leancoderkavy/premiere-pro-mcp/issues/5),
  [#8](https://github.com/leancoderkavy/premiere-pro-mcp/issues/8))

- **Markers landed at wildly wrong times.** `createMarker()` takes seconds, but was being handed
  ticks — a marker requested at 2.0s was placed roughly 508 billion seconds down the timeline,
  far past the end of any real sequence. `marker.end` had the same bug, and `list_markers` read
  back nonsense as a result. ([#6](https://github.com/leancoderkavy/premiere-pro-mcp/issues/6))

- **`manage_proxies` and `get_encoder_presets` called ExtendScript methods that do not exist.**
  `ProjectItem` has no `createProxy()` and `EncoderManager` has no `getFormatList()`, so both threw
  every time. `manage_proxies` with `action: "create"` now queues a real proxy encode through Media
  Encoder instead of reporting "Proxy creation started" for work that never happened, and
  `get_encoder_presets` discovers presets by scanning the `.epr` files Adobe ships on disk, returning
  each preset's path so it can be passed straight to `export_sequence`.
  ([#7](https://github.com/leancoderkavy/premiere-pro-mcp/issues/7))

- **`capture_frame`, `export_frame`, and `freeze_frame` threw on every call.** `exportFramePNG`
  exists only on the QE DOM sequence, not the public DOM one. These tools now go through the QE
  sequence, and — because QE's return value is unreliable — decide success by checking that a file
  actually exists on disk, falling back to a one-frame Media Encoder export. They can no longer
  report success having written nothing.
  ([#9](https://github.com/leancoderkavy/premiere-pro-mcp/issues/9))

- **Six tools repaired for Premiere Pro 2026** via
  [#3](https://github.com/leancoderkavy/premiere-pro-mcp/pull/3): `add_audio_keyframes` (used a
  nonexistent `Property.addKeyframe`, and wrote dB into a property that stores amplitude),
  `color_correct` (one unsettable Lumetri property aborted the whole script and lost every other
  change), `add_transition` and friends (`getVideoTransitionList()` returns empty on 2026 even
  though by-name lookup works), `add_adjustment_layer` (`qeSeq.addAdjustmentLayer` was removed in
  2026), `export_sequence` (defaulted to a hardcoded macOS-only preset path), and `add_text_overlay`
  (called `createCaptionTrack` with the wrong signature).

- `manage_proxies` with `action: "toggle"` reported the inverse of the state it had just set.

- The README described this repository as "a temporary fork" of itself — a fork banner that rode in
  with the [#1](https://github.com/leancoderkavy/premiere-pro-mcp/pull/1) merge.

### Notes

- The frame-export and proxy-create paths are fixed against the documented API and covered by
  regression tests, but have not yet been live-verified against a running Premiere Pro. If you can
  test them, reports on
  [#7](https://github.com/leancoderkavy/premiere-pro-mcp/issues/7) and
  [#9](https://github.com/leancoderkavy/premiere-pro-mcp/issues/9) are very welcome.
- Windows users on CEP 12 may additionally need to sign the extension (`ZXPSignCmd -sign`) — see
  [#2](https://github.com/leancoderkavy/premiere-pro-mcp/issues/2) for details. That is an Adobe
  signature-verification requirement, not a bug in this package.

## [1.0.0] - 2025-02-26

### Added

- **269 tools** across **28 modules** covering nearly the entire Premiere Pro ExtendScript and QE DOM API surface
- File-based IPC bridge for reliable communication between Node.js MCP server and CEP plugin
- CEP plugin with panel UI for bridge status monitoring and configuration
- Cross-platform support (macOS and Windows)
- Two MCP resources for LLM context: `premiere-instructions` and `extendscript-reference`
- Security validation for generated scripts (blocks eval, new Function, System.callSystem)
- Automated CEP plugin installer script

#### Tool Modules

- **discovery** (10) — Project info, item listing, clip queries
- **project** (26) — Save/open, import, bins, AE comps, bars & tone, scratch disks
- **media** (16) — Proxy management, offline, frame rate override, XMP, color space
- **sequence** (11) — Create, duplicate, delete, settings, auto-reframe, unnest, captions
- **timeline** (10) — Add/remove/move/trim/split clips, properties, replace
- **effects** (8) — Apply/remove effects, color correction, LUTs, stabilization
- **transitions** (5) — Add transitions by name (QE DOM)
- **audio** (3) — Levels, keyframes, mute
- **text** (3) — Text overlays, MOGRTs
- **markers** (4) — Add/delete/update/list markers
- **tracks** (4) — Add/delete/lock/visibility
- **playhead** (6) — Position, work area, in/out points
- **metadata** (9) — XMP, project metadata, color labels, footage interpretation
- **export** (14) — Sequence export, frame capture (base64), FCP XML, AAF, OMF, encoding
- **advanced** (27) — QE DOM: ripple delete, roll/slide/slip edits, speed, reverse, frame blend
- **keyframes** (8) — Full CRUD: add, get, remove, range remove, interpolation, value at time
- **scripting** (6) — Execute arbitrary ExtendScript, expression eval, DOM inspection
- **inspection** (10) — Deep project/sequence/clip analysis, timeline gaps, media reports
- **selection** (7) — Select by name, range, color; invert; select disabled
- **clipboard** (6) — Copy effects, batch apply, replace media, blend modes
- **source-monitor** (7) — Open/close, in/out points, insert/overwrite from source
- **track-targeting** (31) — Target tracks, motion/transform properties, audio properties
- **utility** (29) — Batch rename, enable/disable, project analysis, navigation
- **health** (1) — Connectivity ping
- **workspace** (2) — Get/set workspace layouts
- **captions** (1) — Create caption tracks
- **playback** (4) — Timeline and source monitor playback control
- **project-manager** (1) — Project consolidation and transfer
