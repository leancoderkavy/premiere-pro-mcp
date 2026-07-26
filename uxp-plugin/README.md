# Premiere Pro MCP UXP bridge

Production-oriented UXP transport for Premiere Pro 25.6+. Set `PREMIERE_UXP_TOKEN` to a secret of at least 16 characters before starting the MCP server. Side-load `manifest.json` with UXP Developer Tool, open **Window → UXP Plugins → MCP Bridge**, enter the same secret in **Bridge token**, then connect to the MCP-side WebSocket endpoint (default `ws://127.0.0.1:7777/uxp`).

The bridge sends a versioned `hello`, subscribes to Premiere's documented global project and sequence events, emits `premiere.state.changed` notifications, and accepts `capabilities.get`, `state.get`, `frame.export`, and `operation.cancel` commands. A five-second deduplicated poll remains as a fallback for state such as playhead movement that has no matching documented event.

It also exposes documented Premiere 25.6+ video-transition and transcript workflows:

- `transition.video.list`, `transition.video.add`, and `transition.video.remove`
- `transcript.export`, `transcript.search`, `transcript.has`, and undoable `transcript.import`
- read-only `captions.inspect`

Transition names must come from `transition.video.list`. Transcript targets can be selected in the Project panel or addressed by project-item ID/name. Caption creation, text/timing mutation, and deletion remain explicitly unsupported because Premiere does not document those UXP APIs.

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
- Only future commands built from Premiere `Action` objects inside `Project.executeTransaction()` may claim a Premiere undo-history or transaction boundary.
- The bridge does not claim atomic rollback. Failed operations must be inspected using their verification metadata before retrying.

Example cancellation request:

```json
{"type":"command","requestId":"cancel-42","command":"operation.cancel","args":{"requestId":"42"}}
```

## CEP fallback contract

Capability discovery is authoritative per host session. Route a command to CEP only when the UXP capability is absent or explicitly `supported: false`. Never replay a failed UXP mutation through CEP automatically: the first attempt may have partially succeeded. CEP/QE results must identify `backend: "cep"`, and callers should treat QE-only behavior as compatibility mode rather than equivalent proof. UXP remains authoritative for supported frame export.

Loopback WebSocket support must still be verified on each supported OS/Premiere combination. Until that evidence exists, keep the existing file bridge available as the transport fallback; transport fallback does not change command-backend selection.

The event and transaction boundaries follow Adobe's documented [EventManager](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/eventmanager), [Project.executeTransaction](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project), and [CompoundAction](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/compoundaction) APIs.

## MCP-side transport

The server listener binds only to `127.0.0.1`, requires the token during the WebSocket upgrade, limits messages to 1 MiB, and requires a versioned UXP `hello` before accepting results. Requests are correlated by random IDs and fail on timeout or disconnect.

When `PREMIERE_UXP_TOKEN` is configured, the MCP server registers only commands implemented by this panel. These tools never silently replay a failed UXP request through CEP. `PREMIERE_UXP_PORT` changes the loopback port when `7777` is unavailable. The server adapter accepts protocol versions 1 and 2; this integrated panel emits protocol version 2.
