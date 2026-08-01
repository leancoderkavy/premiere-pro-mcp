# Premiere Pro MCP UXP bridge

Production-oriented UXP transport for Premiere Pro 25.6+. Set `PREMIERE_UXP_TOKEN` to a secret of at least 16 characters before starting the MCP server. Side-load `manifest.json` with UXP Developer Tool, open **Window → UXP Plugins → MCP Bridge**, enter the same secret in **Bridge token**, then connect to the MCP-side WebSocket endpoint (default `ws://127.0.0.1:7777/uxp`).

The bridge sends a versioned `hello`, subscribes to Premiere's documented global project and sequence events, emits `premiere.state.changed` notifications, and accepts only commands that its runtime capability probe declares supported. A five-second deduplicated poll remains as a fallback for state such as playhead movement that has no matching documented event.

It also exposes documented Premiere 25.6+ video-transition and transcript workflows:

- `transition.video.list`, `transition.video.add`, and `transition.video.remove`
- `transcript.export`, `transcript.search`, `transcript.has`, and undoable `transcript.import`
- read-only `captions.inspect`

Transition names must come from `transition.video.list`. Transcript targets can be selected in the Project panel or addressed by project-item ID/name. Caption creation, text/timing mutation, and deletion remain explicitly unsupported because Premiere does not document those UXP APIs.

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
  stable marker `guid` introduced in 26.3. It is read-only.
- `sourceMonitor.position.set` — set the Source Monitor using a `TickTime` and
  read the position back. It changes monitor state, not project edit history.
- `transcript.has` — report whether a resolved `ClipProjectItem` has a
  transcript. It is read-only and does not start Speech-to-Text.
- `interchange.aaf.export` — export the active sequence through
  `ProjectConverter.exportAAF` with a bounded, documented `AAFExportOptions`
  schema. Premiere's boolean result is recorded, but output-file inspection must
  still be completed by the host gate.

These map to MCP tools `rename_track_uxp`, `create_subclip_uxp`,
`list_markers_uxp`, `set_source_monitor_position_uxp`, `has_transcript_uxp`, and
`export_aaf_uxp`. See [the 26.3 coverage matrix](../docs/adobe-uxp-26.3-coverage.md)
for command arguments, support states, and primary Adobe references.

`frame.export` uses Adobe's supported `Exporter.exportSequenceFrame()` and verifies the file exists before reporting success. Example:

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
