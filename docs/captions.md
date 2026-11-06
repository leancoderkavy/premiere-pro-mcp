# Captions to a standard

How the caption tools fit together, what Premiere can and cannot do, and where the rules come from.

## Workflow

1. **Transcript.** Use Premiere's own Speech to Text (`prepare_transcript_workflow`, then
   `get_clip_transcript_uxp`), an existing SRT/VTT, or `transcribe_audio` (ElevenLabs Scribe; an
   audio or video file is uploaded to a third party, and the picture is uploaded too when the source
   is a video file, so it needs `confirm_upload: true`). A sequence source that cannot use its single
   media file is exported first, with an audio-only Adobe Media Encoder system preset when one is
   installed (WAV first, then AAC, MP3 or AIFF; found under the AME install's
   `MediaIO/systempresets`, on Windows and macOS, and accepted only when the preset itself says
   `DoVideo` false and `DoAudio` true), so only sound is uploaded. The result's
   `export_preset_used` names the preset (`source` is `export_preset_path`, `audio_only_default` or
   `h264_default`). Only when no such preset exists does the export fall back to the H.264 preset,
   which writes picture and sound: the picture is then uploaded too and a warning says so. Pass your
   own audio-only `export_preset_path` to choose the format. The result names the exported file left in
   the workspace (`exported_file_left_in_workspace`); `delete_export_after_upload: true` deletes
   that one file after a successful transcription. Every `transcribe_audio` call, `media_path`
   included, needs the `inspect`, `export` and `filesystem` authority, because a local file leaves
   the machine.
2. **Plan.** `plan_captions` groups words into captions to a standard and fixes what breaks it. Pass
   the sequence frame rate (`frame_rate`, or `sequence_timebase_ticks` from `get_sequence_settings`),
   `cut_times` from `detect_scene_edits`, and `offset` / `from_s` / `to_s` when the transcript is of a
   source clip. Pass `end_s` (the sequence end, in sequence seconds) to keep captions inside the
   media: no caption ends past it, one that would start at or after it is dropped, and a sound or
   linger extension never passes it (changes with rule `sequence_end`). A JSON transcript that
   states its own media duration (Whisper `duration`, ElevenLabs `audio_duration_secs`) clamps to
   that duration plus `offset` as well. Save the plan with `plan_output_path`.
3. **Output.** Either or both:
   - Native caption track: `create_caption_track` with `action: "import_plan"` and `plan_path`.
   - Burned-in graphics: `add_caption_graphics` with `plan_path`, a `.mogrt` and its text fields.
     The `.mogrt` is opened first and nothing is sent to Premiere when it is refused: a template
     built in Premiere (definition.json `authorApp` `ppro`, such as Premiere's own Captions and
     Subtitles templates) is refused, because Premiere does not expose a Premiere-built graphic's
     text to scripts, so use an After Effects-built MOGRT (the chroma-ae MCP's `ae_captions`
     `make_template` then `ae_export_mogrt`, or this server's `preview_mogrt_recipe` then
     `create_mogrt_recipe`); and every name in `text_fields` and `color_field` must be a text
     (type 6) or colour (type 4) control of the template, with the available names listed when one
     is not. A template with fewer `line_fields` than the plan has lines shows at most that many
     lines: each caption is re-broken from its text into the field count (grammar-aware, listed in
     `fit.rebreaks`, shrunk by the usual fit or reported in `fit.refits` / `outside_safe` when it
     still does not fit), never joined into the last field.
     At most 2000 clips per call. For a longer transcript caption it in parts with `from_s` / `to_s`
     and give **each part its own `name_prefix`** (for example `Caption A`, `Caption B`):
     `replace_existing` removes only clips named exactly `<name_prefix> NNN`, so a second part with
     the same prefix would delete the first. Parts must not overlap in time on the track.
4. **Check.** `check_captions` on the plan, the written SRT/VTT, or cues read back with
   `read_sequence_captions`. Verify on screen with playback or a short export: still frames can
   omit caption tracks.
5. **Deliver.** `plan_captions` `export` writes SRT, WebVTT (with cue settings) or TTML (IMSC 1.1
   text profile).

## Standards

| id | Reading speed | Characters per line | Lines | Duration | Close gaps under |
| --- | --- | --- | --- | --- | --- |
| `netflix_adult` | 20 cps | 42 | 2 | 5/6 s to 7 s | 0.5 s |
| `netflix_kids` | 17 cps | 42 | 2 | 5/6 s to 7 s | 0.5 s |
| `bbc` | 180 wpm | 37 | 2 | 0.8 s to 7 s | 1 s |
| `dcmp` | 160 wpm | 32 | 2 | 40 frames to 6 s | 0.5 s |
| `social_9x16` | 20 cps | 25 | 3 | 0.5 s to 5 s | 0.5 s |

`get_caption_style_guidance` with `standard` returns the exact numbers the planner uses. With a
standard, gaps are at least 2 frames, and shorter gaps than the last column close to that minimum.

## What Premiere cannot do, and what the tools do instead

- **Style a caption track.** There is no scripting API for caption Track Styles, so `import_plan`
  writes plain text and speaker colour becomes a label or hyphen. For colour use
  `add_caption_graphics` with a template colour control, or style the track by hand
  (`get_caption_style_guidance`).
- **Measure rendered text.** There is no equivalent of After Effects' `sourceRectAtTime`, so the
  safe-area fit in `add_caption_graphics` and `check_captions` is an estimate from character counts,
  font size and an average glyph width (`char_width_ratio`). Check the result on screen.
- **Colour single words inside one text field.** `add_caption_graphics` offers `word_mode: "single"`
  (one clip per word) and `"accumulate"` (words build up). Highlight looks such as a moving pill or a
  colour sweep need After Effects: build the look there and export a MOGRT.
- **Read caption text back.** Most CEP builds expose no caption text, so export from the plan file
  or the SRT that `import_plan` wrote. `read_sequence_captions` exports only when the host returns
  text and timing for every caption. It returns the cues per track (`cues_by_track`) and a flat
  `cues` list only when the sequence has exactly one caption track and it is readable; an
  `export.track_index` that matches no caption track is refused with its own message.
- **Remove a caption track.** CEP cannot delete or hide caption tracks; a re-run of `import_plan`
  adds another track. `add_caption_graphics` does replace its own numbered clips on re-run.
- **Place an MOGRT's audio on its own track.** `add_caption_graphics` calls `importMGT` with the
  same index for the video and the audio track, so a template that carries audio places it on the
  audio track with the same index as `track_index`. The tool does not move or remove that audio.
- **Tell how long the template really is.** `importMGT` places the template's default length before
  the tool trims it. The tool refuses to place a chunk (and reports what it has placed) when a
  clip of another kind starts on the track inside that default length after the chunk's last
  caption.

## Captions and the end of the sequence

`create_caption_track` `import_plan` and `add_caption_graphics` know the sequence end (for
`import_plan`, the end minus `start_seconds`) and clamp the plan to it, a transcript or a saved
plan alike: an out-time past the end moves to the last whole frame at or before it, a caption that
would start at or after it is dropped, and each is a change with rule `sequence_end` (action
`shortened` or `dropped`; `plan.sequence_end_changes` lists them all and `plan.sequence_end` is the
limit). Without this a sound event that runs past the media (an outro jingle) stretches the
sequence when the captions are imported. A clamped caption that now breaks the standard's minimum
duration or reading speed is added to the violations.

## Line breaks and names

Lines are broken with the planner's grammar-aware breaker. A break inside a name of capitalised
words ("Land Rover Defender", "Sarah Jones") costs extra when the whole name fits a line, every
split into the fewest lines is weighed, and the breaker may use one more line, up to `max_lines`,
when only that keeps the name whole. A capital that merely starts a sentence ("Today", "So") is not
a name. When no layout within the line length keeps a name whole (the name cannot share a line
with the words around it), the split is reported as a `grammar` violation instead of being hidden.

## Safe areas

`reels_9_16` is the box clear on TikTok, Instagram Reels and YouTube Shorts at once: x 120-888,
y 288-1248 at 1080x1920 (scaled to other frame sizes). The per-app boxes are approximate, from ad
specs and third-party templates; re-check them yearly. 16:9 uses a 5% title-safe box.

## Sources and credits

- The numbers come from the published guides: Netflix Timed Text Style Guide and timing
  guidelines, BBC Subtitle Guidelines, DCMP Captioning Key, and W3C WCAG 2.2.
- The planner, QA, export and transcription code was contributed by Chroma (chroma.london), ported
  from its After Effects MCP.
- Ideas, not code: linting captions per standard and fixing timing before rewording, after
  [github/awesome-copilot](https://github.com/github/awesome-copilot) `skills/caption-qa` (MIT);
  social caption look families, after [vargHQ/skills](https://github.com/vargHQ/skills)
  `caption-styles` (MIT); caption workflow ideas, after
  [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes) (Apache-2.0). No code or text
  was copied from these projects.
