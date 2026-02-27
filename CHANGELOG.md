# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
