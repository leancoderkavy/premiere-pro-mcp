# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
