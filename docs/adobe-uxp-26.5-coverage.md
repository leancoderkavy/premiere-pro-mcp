# Adobe Premiere UXP 26.5 coverage

Fetched 2026-09-23. This page compares Adobe's current public Premiere
developer documentation with this repository's source. It extends the
[26.3 coverage baseline](adobe-uxp-26.3-coverage.md). It is a source and
contract review only: no licensed Premiere host was exercised for this page,
and every entry below has `liveHostVerificationStatus: not_run`.

## Sources

| Source | What it established (fetched 2026-09-23) |
| --- | --- |
| [Premiere UXP changelog](https://developer.adobe.com/premiere-pro/uxp/changelog/) | Newest documented release is **Premiere 26.5.0**. Earlier entries: 26.3.0, 26.2.0, 25.6.0, 25.2.0. |
| [`@adobe/premierepro` on npm](https://www.npmjs.com/package/@adobe/premierepro) | `latest` = 26.5.0 (published 2026-09-08), `release-26.5` = 26.5.1 (2026-09-14), `beta` = 27.0.0-beta.57. |
| [Premiere ExtendScript reference](https://ppro-scripting.docsforadobe.dev/) | States ExtendScript integrations are planned to remain supported "through September 2026" and that third-party scripting transitioned to UXP in November 2025. |

The repository still pins declarations to stable `@adobe/premierepro@26.3.0`
and beta `@adobe/premierepro@26.5.0-beta.73`. Bumping the stable pin to 26.5.x
regenerates every `adobe-beta-*-drift` receipt and is tracked as a follow-up
below rather than mixed into this change. The 27.0 beta is not a runtime target.

## Premiere 26.5.0 API delta

Status meanings: **covered** = an MCP tool calls the documented API behind a
runtime capability probe; **not covered** = no tool yet; **excluded** = held
back deliberately, with the reason.

| Adobe 26.5 API | Status | MCP tool / reason |
| --- | --- | --- |
| `WorkAreaUtils.getWorkAreaInPoint` | covered | `manage_work_area_uxp` (`workArea.inspect`, min host 26.5.0) |
| `WorkAreaUtils.getWorkAreaOutPoint` | covered | `manage_work_area_uxp` (`workArea.inspect`) |
| `WorkAreaUtils.setWorkAreaInOutPoints` | covered | `manage_work_area_uxp` (`workArea.set`): requires the inspected sequence GUID and work area, keeps out within the sequence end, serializes per sequence, verifies native in/out readback. Direct call, not an undoable transaction. |
| `WorkAreaUtils.setWorkAreaInPoint`, `setWorkAreaOutPoint` | excluded | Redundant with the combined setter; single-sided updates can leave an inverted interim range. |
| `MediaManager.purgeMediaCache` | excluded | Global, non-undoable cache deletion with no documented readback. Needs a confirmation and receipt design before exposure. The legacy CEP path is unchanged. |
| `C2PAService.getManifest`, `Constants.C2PAManifestLocation` | not covered | Returns an unbounded manifest JSON string for an arbitrary file path. Needs a bounded, path-redacted contract under the filesystem capability first (see AGENTS.md metadata guidance). |
| `Media.getDuration`, `Media.getStart` (synchronous) | not covered | Existing tools read timing through other documented accessors. Adopt when the stable pin moves to 26.5.x. `Media.start` / `Media.duration` are deprecated by Adobe. |
| `Transcript.isLanguagePackAvailable`, `Transcript.transcribeClipProjectItem` | covered | Already mapped in the 26.3 baseline (`is_language_pack_available_uxp`, `transcribe_clip_uxp`); Adobe lists them again under 26.5. |
| `uxp.host.applicationPath`, `uxp.host.getBackgroundColor()` | not covered | UXP host surface, not `premierepro`. `applicationPath` discloses a local install path; low value for editing workflows. |
| `Constants.MarkerColor.MAGNETA` (deprecated) | not affected | Marker tools use the documented color index/RGBA paths. |

The 26.3.0 additions in the changelog (track rename actions, subclip action,
EncoderManager, `Marker.guid`, ObjectMaskUtils, preset sequence creation,
AAF export, Source Monitor positioning, transcript queries) remain covered as
described in the [26.3 page](adobe-uxp-26.3-coverage.md).

## Follow-ups

1. Move the stable declaration pin to `@adobe/premierepro@26.5.1`, regenerate
   `npm run adobe:api-inventory` and each `adobe:beta-*-drift` receipt, and turn
   the WorkAreaUtils manifest-only symbols into declared symbols.
2. Design a bounded C2PA manifest inspector (size cap, path redaction, no
   cloud fetch claim) before exposing `C2PAService.getManifest`.
3. Decide whether `MediaManager.purgeMediaCache` belongs in a confirmed
   maintenance tool with an explicit non-undoable receipt.
4. Track Adobe's ExtendScript support window (documented through September
   2026) for the CEP production path; no change in behavior is claimed here.
5. Run `manage_work_area_uxp` against a licensed Premiere 26.5 host before any
   compatibility claim.
