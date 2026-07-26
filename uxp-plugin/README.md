# Premiere Pro MCP UXP bridge

Production-oriented UXP transport for Premiere Pro 25.6+. Set `PREMIERE_UXP_TOKEN` to a secret of at least 16 characters before starting the MCP server. Side-load `manifest.json` with UXP Developer Tool, open **Window → UXP Plugins → MCP Bridge**, enter the same secret in **Bridge token**, then connect to the MCP-side WebSocket endpoint (default `ws://127.0.0.1:7777/uxp`).

The bridge sends a versioned `hello`, emits `premiere.state.changed` events, and accepts `capabilities.get`, `state.get`, and `frame.export` commands. `frame.export` uses Adobe's supported `Exporter.exportSequenceFrame()` and verifies the file exists before reporting success. Example:

```json
{"type":"command","requestId":"42","command":"frame.export","args":{"outputDirectory":"C:/temp","filename":"frame.png"}}
```

## CEP fallback contract

Capability discovery is authoritative per host session. Route a command to CEP only when the UXP capability is absent or explicitly `supported: false`. Never replay a failed UXP mutation through CEP automatically: the first attempt may have partially succeeded. CEP/QE results must identify `backend: "cep"`, and callers should treat QE-only behavior as compatibility mode rather than equivalent proof. UXP remains authoritative for supported frame export.

Loopback WebSocket support must still be verified on each supported OS/Premiere combination. Until that evidence exists, keep the existing file bridge available as the transport fallback; transport fallback does not change command-backend selection.

## MCP-side transport

The server listener binds only to `127.0.0.1`, requires the token during the WebSocket upgrade, limits messages to 1 MiB, and requires a versioned UXP `hello` before accepting results. Requests are correlated by random IDs and fail on timeout or disconnect.

When `PREMIERE_UXP_TOKEN` is configured, the MCP server registers only the commands currently implemented by this panel:

- `get_uxp_capabilities`
- `get_uxp_state`
- `export_frame_uxp`

These tools never silently replay a failed UXP request through CEP. `PREMIERE_UXP_PORT` changes the loopback port when `7777` is unavailable.

### Related UXP lifecycle work

This transport accepts protocol versions 1 and 2. PR #47 upgrades the panel protocol to version 2 with event-driven state and operation lifecycle semantics. Merge this transport first, then rebase PR #47; its panel-side `index.cjs` changes should retain the authenticated URL construction added here. The server adapter itself already accepts both versions.
