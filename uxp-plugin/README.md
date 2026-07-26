# Premiere Pro MCP UXP bridge

Production-oriented UXP transport for Premiere Pro 25.6+. Side-load `manifest.json` with UXP Developer Tool, open **Window → UXP Plugins → MCP Bridge**, then point it at the MCP-side WebSocket endpoint (default `ws://127.0.0.1:7777/uxp`).

The bridge sends a versioned `hello`, subscribes to Premiere's documented global project and sequence events, emits `premiere.state.changed` notifications, and accepts `capabilities.get`, `state.get`, `frame.export`, and `operation.cancel` commands. A five-second deduplicated poll remains as a fallback for state such as playhead movement that has no matching documented event.

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
