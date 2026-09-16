# Cinematic advertisement: You direct. You decide.

## Deliverables

- `landing/public/premiere-pro-mcp-ad-v3.mp4`: 30 seconds, 1920 × 1080, 30 fps.
- `landing/public/premiere-pro-mcp-ad-v3-vertical.mp4`: separately framed 1080 × 1920 version, same duration.
- H.264 picture, AAC stereo audio at 48 kHz / 256 kbps, fast-start metadata.
- Burned-in timed captions, separate WebVTT captions, 640/1280 WebP posters.
- Website playback begins with sound after the visitor clicks Play. Native volume controls remain available.

## Creative treatment

Coastal imagery opens the spot. Animated typography introduces a specific edit
request, followed by close-ups of the actual Premiere timeline and Program
Monitor. The final card gives the product name and website. Vertical framing
keeps essential copy inside x=180–900 and y=220–1420. The screen capture is
cropped and reframed for readability; request cards are editorial graphics.

The verified demonstration assembles three five-second clips, creates three
review markers, and saves an editable Premiere project. No time-saving statistic,
export success, customer endorsement, or Adobe affiliation is invented.

## Sound and provenance

The voice is an original generation using Runway's preset **Leslie** (professional female narration), not a
clone of a person. Generation ID: `f349ef44-2f7c-4648-9acd-ea82dfe95e66`.
The retained source is `landing/video-src/audio/premiere-ad-v3-narration.mp3`.
Delivery was slowed to 92 percent and begins 650 milliseconds into the cut.
Local speech recognition checked the words and supplied caption timing.

Music and transition effects are original, deterministic synthesis by
`compose-ad-score.py`: warm pads, a mallet arpeggio, restrained bass and percussion,
diffuse stereo ambience, and a closing two-note motif. No commercial song,
third-party sample, or artist imitation is used. Runway music generation was
unavailable on the connected plan; no upgrade was purchased.

The mix lowers the music under narration and fades to a clean ending. Measured
on the final AAC export: **−16.01 LUFS integrated, −2.42 dBTP**, 30 seconds.
Separate voice, music, effects, and lossless mix files live in the ignored
`artifacts/ad-production/` directory. Automated checks do not replace a human
listening review on the eventual playback device.

Runway's published [commercial-use guidance](https://help.runwayml.com/hc/en-us/articles/21668707517587-Can-I-use-the-content-I-made-in-Runway-for-commercial-purposes)
states that its generated content has no non-commercial restriction from Runway
(checked September 15, 2026). The visual source is the site's existing original
generated artwork and our live recording documented in `live-premiere-walkthrough.md`.

## Rebuild

1. Retain the raw recording and its success receipt under `artifacts/demo-recording/`.
2. Set `FFMPEG_PATH` to a build with libx264, libass, and the standard audio filters.
3. Run `compose-ad-score.py` with Python, NumPy, and SciPy.
4. Run `transcribe-ad-narration.py` to produce timing data. Its optional local
   faster-whisper packages and model cache live under `artifacts/ad-production/`.
5. From `landing`, run `npm run render:ad`.
6. Verify both picture and audio stream durations are 30 seconds, inspect each
   scene and captions, check loudness, then run the build and video playback test.

## Narration script

You see the story. Give it direction.

With M C P for Adobe Premiere Pro, turn a clear request into an edit you can review.

Assemble the shots. Add review markers. Inspect every cut.

A real timeline. An editable project. Your creative control.

You direct. You decide.

Explore Premiere Pro M C P.
