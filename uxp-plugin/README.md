# Premiere Pro MCP UXP bridge

Production-oriented UXP transport for Premiere Pro 25.6+. Side-load `manifest.json` with UXP Developer Tool, open **Window → UXP Plugins → MCP Bridge**, then point it at the MCP-side WebSocket endpoint (default `ws://127.0.0.1:7777/uxp`).

The bridge sends a versioned `hello`, emits `premiere.state.changed` events, and accepts capability, state, frame-export, and video-transition commands. `frame.export` uses Adobe's supported `Exporter.exportSequenceFrame()` and verifies the file exists before reporting success.

## Video transition commands

Premiere Pro 25.6+ exposes documented UXP APIs for video transitions. Capability discovery reports each command separately:

- `transition.video.list` returns installed transition match names.
- `transition.video.add` targets a clip by zero-based video-track and clip index, and supports start/end placement, duration, single-sided behavior, and the host's numeric alignment value.
- `transition.video.remove` removes the start or end transition from a targeted clip.

Mutations are created and committed inside `Project.lockedAccess()` and `Project.executeTransaction()`, producing one Premiere undo-history entry. A successful response verifies that Premiere accepted the transaction; it does not claim visual or rendered-output verification.

```json
{"protocolVersion":1,"type":"command","requestId":"42","command":"transition.video.add","args":{"videoTrackIndex":0,"clipIndex":1,"matchName":"CrossDissolve","position":"start","durationSeconds":0.5,"forceSingleSided":false}}
```

Use `transition.video.list` rather than guessing localized display names: add operations require an exact match name returned by the active host. Audio-transition creation is not advertised because Adobe's documented UXP `TransitionFactory` currently exposes video transitions only.

## Transcript and caption commands

Premiere Pro 25.6+ exposes `transcript.export`, `transcript.search`,
`transcript.has`, and the undoable `transcript.import`. These commands target a
project item by ID, name, or exactly one selected media item. Transcript JSON is
validated and inbound payloads are limited to 5 MB.

`captions.inspect` reports caption-track names, IDs, mute state, and item counts.
Caption text or timing mutation remains on the CEP fallback because Premiere UXP
does not document those operations.

Frame export example:

```json
{"type":"command","requestId":"42","command":"frame.export","args":{"outputDirectory":"C:/temp","filename":"frame.png"}}
```

## CEP fallback contract

Capability discovery is authoritative per host session. Route a command to CEP only when the UXP capability is absent or explicitly `supported: false`. Never replay a failed UXP mutation through CEP automatically: the first attempt may have partially succeeded. CEP/QE results must identify `backend: "cep"`, and callers should treat QE-only behavior as compatibility mode rather than equivalent proof. UXP remains authoritative for supported frame export.

Loopback WebSocket support must still be verified on each supported OS/Premiere combination. Until that evidence exists, keep the existing file bridge available as the transport fallback; transport fallback does not change command-backend selection.
