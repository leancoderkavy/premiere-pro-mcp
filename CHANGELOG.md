# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Added `get_capabilities` for machine-readable Windows/macOS runtime, CEP/UXP backend,
  authority-profile, and live-host verification reporting.
- Added GitHub Actions build, test, and package validation on Windows and macOS with Node 18 and 22.

### Fixed

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
