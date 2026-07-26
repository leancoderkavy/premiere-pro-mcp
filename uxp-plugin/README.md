# Premiere Pro MCP UXP bridge

Production-oriented UXP transport for Premiere Pro 25.6+. Side-load `manifest.json` with UXP Developer Tool, open **Window → UXP Plugins → MCP Bridge**, then point it at the MCP-side WebSocket endpoint (default `ws://127.0.0.1:7777/uxp`).

The bridge sends a versioned `hello`, emits `premiere.state.changed` events, and accepts:

- `capabilities.get`, `state.get`, and `frame.export`
- `transcript.export`, `transcript.search`, `transcript.has`, and the undoable `transcript.import`
- `captions.inspect` for caption-track names, IDs, mute state, and item counts

Transcript commands target `projectItemId`, then `projectItemName`, or exactly one
selected Project panel media item. The JSON payload is Premiere's native transcript
format; the bridge validates it and limits inbound payloads to 5 MB.

`frame.export` uses Adobe's supported `Exporter.exportSequenceFrame()` and verifies the file exists before reporting success. Example:

```json
{"type":"command","requestId":"42","command":"frame.export","args":{"outputDirectory":"C:/temp","filename":"frame.png"}}
```

```json
{"type":"command","requestId":"43","command":"transcript.search","args":{"projectItemId":"abc","query":"launch date","maxResults":25}}
```

```json
{"type":"command","requestId":"44","command":"transcript.import","args":{"projectItemId":"abc","json":"{\"segments\":[]}"}}
```

## Caption API boundary

Premiere UXP 25.6 documents caption-track inspection, but not caption text/timing
creation, update, or deletion. Capability discovery therefore reports
`captions.create`, `captions.update`, and `captions.delete` as unsupported instead
of claiming a mutation succeeded. The existing CEP `create_caption_track` tool
continues to create a track from an imported SRT/VTT project item.

## CEP fallback contract

Capability discovery is authoritative per host session. Route a command to CEP only when the UXP capability is absent or explicitly `supported: false`. Never replay a failed UXP mutation through CEP automatically: the first attempt may have partially succeeded. CEP/QE results must identify `backend: "cep"`, and callers should treat QE-only behavior as compatibility mode rather than equivalent proof. UXP remains authoritative for supported frame export.

Loopback WebSocket support must still be verified on each supported OS/Premiere combination. Until that evidence exists, keep the existing file bridge available as the transport fallback; transport fallback does not change command-backend selection.
