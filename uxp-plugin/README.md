# MCP for Adobe Premiere Pro UXP bridge

Production-oriented UXP transport for Premiere Pro 25.6+. Set `PREMIERE_UXP_TOKEN` to a secret of at least 16 characters before starting the MCP server. Side-load `manifest.json` with UXP Developer Tool during development, open **Window → UXP Plugins → MCP for Adobe Premiere Pro**, enter the same secret in **Bridge token**, then connect to the MCP-side WebSocket endpoint (default `ws://127.0.0.1:7777/uxp`). For end-user direct distribution, use the `.ccx` workflow in [DISTRIBUTION.md](./DISTRIBUTION.md) instead of asking users to load a development folder.

Before using a path-based command, choose one **Approved workspace** folder in the
panel. The manifest uses requested filesystem access, and the panel restores only
Adobe's opaque persistent folder token. Proxy, relink, preset, interchange, AAF,
frame-export, and Source Monitor file paths must remain inside that folder. The
token and native root path are never sent to the MCP server.

The bridge sends a versioned `hello`, subscribes to Premiere's documented global project and sequence events, emits `premiere.state.changed` notifications, and accepts only commands that its runtime capability probe declares supported. A five-second deduplicated poll remains as a fallback for state such as playhead movement that has no matching documented event.

It also exposes documented Premiere 25.6+ video-transition and transcript workflows:

- `timeline.selection.lift` removes the current timeline selection without ripple through one undoable transaction; the committed transaction is not a timeline readback
- `transition.video.list`, `transition.video.add`, and `transition.video.remove`
- `transcript.export`, `transcript.search`, `transcript.has`, and guarded undoable `transcript.import`
- read-only `captions.inspect`

Transition names must come from `transition.video.list`. Transcript inspection targets can be selected in the Project panel or addressed by project-item ID/name. Transcript import is stricter: it requires an exact project GUID and project-item ID plus a current transcript SHA-256 (or an explicit absent-transcript precondition), confirmation, and an operation ID; it never uses selection or a name to mutate. Caption creation, text/timing mutation, and deletion remain explicitly unsupported because Premiere does not document those UXP APIs.

The MCP adapter exposes `transcript.export` as `get_clip_transcript_uxp` and adds a
SHA-256 revision to the result. `search_clip_transcript_uxp` maps to the existing
read-only search command. `preview_transcript_edit_uxp` re-exports the transcript,
rejects stale revisions, validates and merges selected source-time deletion ranges,
and returns a confirmation token. It never changes the transcript or timeline;
automatic transcript-to-timeline application remains a live-host validation gate.
`import_transcript_uxp` is the guarded MCP facade for `transcript.import`: it
caps the replacement JSON at 24 KiB UTF-8, serializes import requests per source
clip, commits one native transaction, and only calls the result verified after a
bounded native export has the exact requested SHA-256. A failed post-commit
readback remains `committed_unverified`; static tests do not prove host acceptance,
persistence, Undo, or licensed-host behavior.

## Premiere 26.3 commands

The following commands use APIs Adobe introduced in Premiere 26.3. They are
available only when the connected host advertises them through `capabilities.get`:

- `track.rename` — rename one `video`, `audio`, or `caption` track using an
  undoable `createSetNameAction` transaction. The post-transaction read-back is
  the verification evidence.
- `subclip.create` — create a subclip from a clip project item with non-negative,
  ordered in/out points, hard-boundary selection, and optional audio/video
  inclusion. It is an undoable action and must return the created item identity.
- `marker.list` — return sequence or resolved project-item markers, including the
  stable marker `guid` introduced in 26.3. It is read-only; documented web links
  and raw RGBA color components are opt-in, and raw color values make no
  color-profile or rendered-appearance claim.
- `sourceMonitor.position.set` — set the Source Monitor using a `TickTime` and
  read the position back. It changes monitor state, not project edit history.
- `transcript.has` — report whether a resolved `ClipProjectItem` has a
  transcript. It is read-only and does not start Speech-to-Text.
- `transcript.import` — replace one exact clip transcript through a revision-locked,
  explicitly confirmed 26.3+ transaction with bounded export readback.
- `interchange.aaf.export` — export the active sequence through
  `ProjectConverter.exportAAF` with a bounded, documented `AAFExportOptions`
  schema. Premiere's boolean result is recorded, but output-file inspection must
  still be completed by the host gate.

These map to MCP tools `rename_track_uxp`, `create_subclip_uxp`,
`list_markers_uxp`, `set_source_monitor_position_uxp`, `has_transcript_uxp`, and
`import_transcript_uxp`, and `export_aaf_uxp`. See [the 26.3 coverage matrix](../docs/adobe-uxp-26.3-coverage.md)
for command arguments, support states, and primary Adobe references.

## Stable workflow commands

The panel also exposes runtime-probed commands for native audio/video component
chains, deterministic timeline selection, compound effect batches over the current
timeline selection, scene-edit
detection, proxy and ingest state, guarded offline relink, transactional project/XMP
metadata, footage interpretation and LUTs, Source Monitor audition, and
project/Production scratch-disk preflight. They map to eleven consolidated MCP tools;
see [the stable workflow matrix](../docs/uxp-stable-workflows.md) for exact commands,
arguments, confirmation requirements, and the pending live-host gate.

A second stable expansion adds Project-view selection, native marker CRUD, bin
organization, sequence settings profiles, workspace-gated imports, typed parameter,
keyframe, and animation-mode automation, track-item transformations, documented SequenceEditor
edits, sequence lifecycle management, and AME encoding. These map to another ten
consolidated MCP tools and 45 capability-probed panel commands. See [the next-ten
workflow matrix](../docs/uxp-next-ten-workflows.md). Automated contract evidence is
complete; live Premiere verification remains pending.

The third-wave command surface adds bounded event and AME receipts, readiness waits,
safe multi-project sessions, a growing-media pause lease, workflow checkpoints,
media-health maintenance, caption-aware track state, and transactional source
trim/framing. See [the third-wave workflow matrix](../docs/third-wave-uxp-workflows.md)
for the verification boundary of every operation.

`hybrid-benchmark.cjs` is a dormant developer benchmark. The production manifest
does not request `enableAddon`, declare an addon, or ship a native binary. A future
native-acceleration change must first pass the documented Windows x64, macOS x64,
and macOS arm64 Release evidence gate; see
[the hybrid benchmark procedure](../docs/uxp-hybrid-benchmark.md).

`frame.export` uses Adobe's supported `Exporter.exportSequenceFrame()`. The public request and returned path include one `.png` extension; the panel passes the bare stem to Premiere because its exporter appends the extension. Premiere must confirm the export request before a path is reported. A licensed-host file check remains required to prove the artifact exists on disk. Example:

```json
{"type":"command","requestId":"42","command":"frame.export","args":{"outputDirectory":"C:/temp","filename":"frame.png"}}
```

## Operation lifecycle and guarantees

Commands emit correlated lifecycle events:

- `premiere.operation.started`
- `premiere.operation.progress`
- `premiere.operation.completed`
- `premiere.operation.failed`
- `premiere.operation.cancelled`

Each result includes structured operation metadata covering project mutation, verification evidence, undo, transaction, and cancellation boundaries. These fields describe evidence, not intent:

- Frame export is not a project mutation, is not undoable, and verifies success by checking the output file.
- `operation.cancel` is cooperative during preflight. Once a Premiere host call begins, the bridge reports `host_call_not_cancellable` and does not claim interruption.
- Action-based commands use `project.lockedAccess()` to create the action and
  `project.executeTransaction()` to consume it without asynchronous work or an
  escaped action object. Only those commands may claim a Premiere undo-history or
  transaction boundary.
- The bridge does not claim atomic rollback. Failed operations must be inspected using their verification metadata before retrying.

Example cancellation request:

```json
{"type":"command","requestId":"cancel-42","command":"operation.cancel","args":{"requestId":"42"}}
```

## CEP fallback contract

Capability discovery is authoritative per host session. Route a command to CEP only when the UXP capability is absent or explicitly `supported: false`. Never replay a failed UXP mutation through CEP automatically: the first attempt may have partially succeeded. CEP/QE results must identify `backend: "cep"`, and callers should treat QE-only behavior as compatibility mode rather than equivalent proof. UXP remains authoritative for supported frame export.

Loopback WebSocket support must still be verified on each supported OS/Premiere combination. Until that evidence exists, keep the existing file bridge available as the transport fallback; transport fallback does not change command-backend selection.

The event and transaction boundaries follow Adobe's documented [EventManager](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/eventmanager), [Project.executeTransaction](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project), and [CompoundAction](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/compoundaction) APIs.

Adobe's published [`@adobe/premierepro`](https://www.npmjs.com/package/@adobe/premierepro)
26.3.0 package is the stable declaration baseline for this bridge. The `beta` tag
(currently a 26.5 prerelease) is deliberately excluded from capability claims and
release support until Adobe ships a stable host API and this panel passes the same
live-host gate. The official [Premiere UXP ESLint rules](https://developer.adobe.com/premiere-pro/uxp/resources/fundamentals/eslint-support/)
are the intended static guard against lock, transaction, async-callback, and
action-lifetime violations; static lint and unit tests are not Premiere-host proof.

## MCP-side transport

The server listener binds only to `127.0.0.1`, requires the token during the WebSocket upgrade, limits messages to 1 MiB, and requires a versioned UXP `hello` before accepting results. Requests are correlated by random IDs and fail on timeout or disconnect.

When `PREMIERE_UXP_TOKEN` is configured, the MCP server registers only commands implemented by this panel. These tools never silently replay a failed UXP request through CEP. `PREMIERE_UXP_PORT` changes the loopback port when `7777` is unavailable. The server adapter accepts protocol versions 1 and 2; this integrated panel emits protocol version 2.
