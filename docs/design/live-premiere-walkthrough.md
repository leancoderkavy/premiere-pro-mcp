# Live Premiere walkthrough

The September 15, 2026 replacement for “From a request to a reviewable result”
is a 34-second, silent, captioned 1920 × 1080 recording at 30 fps. The dedicated
`/demo/` page uses `premiere-pro-mcp-demo-live-v2.mp4`. Homepage players use the
30-second cinematic edit described in `cinematic-ad-v3.md`.

## What is real

Premiere Pro 26.5.0 performed the operations through this repository's CEP tool
handlers: `import_media`, `create_sequence_from_clips`, `add_marker`, and
`set_playhead_position`. An independent bridge readback confirmed clips spanning
0–5, 5–10, and 10–15 seconds, markers at 0, 5, and 10 seconds, and project save.
The video shows the native timeline and Program Monitor. Request and step text
are editorial overlays, not a captured AI chat. No export or color-grade claim
is made. The clips are pans across the site's existing generated coastal artwork,
not customer footage. The final hold extends the recorded review frame.

## Local production files

The ignored `artifacts/demo-recording/` directory contains the raw capture,
generated sample clips, dedicated Premiere project, and `receipts.json`.
No unrelated project was open when preparing the original demo. Retakes were
saved and closed before the final recording to remove duplicate timeline tabs.

## Re-record on Windows

1. Build the root project with `npm run build`.
2. Use an FFmpeg build supporting the `gfxcapture` source (check
   `ffmpeg -h filter=gfxcapture`). GDI capture omits GPU-rendered monitor footage;
   Windows Graphics Capture includes it. FFmpeg's official download page links
   Windows builds: <https://ffmpeg.org/download.html>.
3. Open a new, empty project inside `artifacts/demo-recording/`. Close other
   demo projects first; never close or overwrite an unrelated edit.
4. Set `FFMPEG_PATH` to the executable, `PREMIERE_DEMO_HWND` to the observed
   Premiere window handle, and `DEMO_PROJECT_NAME` to that project's filename.
   Use the captured 1904 × 1020 editor layout; the editorial overlay positions
   assume that layout. The recorder rejects nonempty or mismatched projects.
5. Run `npm run record:demo-live` from `landing`, then `npm run render:demo-live`.
6. Review the video before shipping. Confirm no unexpected dialogs, private
   content, missing monitor frames, overlapping captions, or stale timeline tabs.
   The renderer requires a successful live receipt; it does not simulate success.
7. Run the landing build and existing video playback test. Keep the VTT timings
   and player duration label aligned if changing the edit.

The renderer uses Windows Segoe UI fonts, exports H.264 with fast-start metadata,
and generates 640/1280 WebP posters. New asset URLs avoid stale cached animation.
