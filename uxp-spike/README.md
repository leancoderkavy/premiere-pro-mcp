# UXP Spike

A throwaway UXP plugin that answers two questions we cannot answer from the docs. It is not part
of the MCP server and nothing depends on it.

## Why

**1. Is issue #9 fixable?**

Documented ExtendScript has **no frame-export method at all**. `Sequence` exposes only
`exportAsMediaDirect`, `exportAsProject`, and `exportAsFinalCutProXML` — there is no
`exportFramePNG`. That is why `capture_frame` reaches into the undocumented QE DOM, and why
[#9](https://github.com/leancoderkavy/premiere-pro-mcp/issues/9) reports it returning `false` and
writing nothing on **both** PPro 2025 and 2026. It isn't a bug we can fix; it's a hole in the API.

UXP has a supported `Exporter.exportSequenceFrame()`. **Probe A** finds out whether it works.

Frame capture is the only tool that gives an agent *visual* evidence of the timeline. Without it
there is no way to verify a color grade, a transition, or a title actually landed. It's worth a
spike on its own.

**2. Can we drop the temp-file bridge?**

Today the CEP panel polls a temp directory every 200ms for `.jsx` files. UXP has `WebSocket` and
`fetch`, which would be a strict upgrade. But:

- Adobe's UXP docs **never mention `localhost` or `127.0.0.1`** — not once, anywhere.
- UXP WebSockets are **client-only**: a plugin "cannot host or accept incoming connections", so
  the MCP server must be the server. (Fine — that's the direction we want anyway.)
- macOS is documented to restrict `http://`. Whether that extends to `ws://` is **unstated**.
- `wss://` with a self-signed cert is **explicitly broken on macOS** per Adobe's known-issues page.

So both obvious loopback options sit in undocumented-or-blocked territory. **Probes B–E** find out
what actually connects. This determines our entire transport, so it's worth knowing before we
commit to a port rather than after.

## Running it

You need Premiere Pro **25.6 or newer** (that's when UXP went GA) and the
[UXP Developer Tool](https://developer.adobe.com/premiere-pro/uxp/plugins/) 2.2+.

**1. Start the spike server.** Zero dependencies, so there is nothing to install:

```bash
node uxp-spike/server.mjs        # listens on 127.0.0.1:7777
```

**2. Enable Premiere's developer mode.** Settings → Plugins → *Enable developer mode*, then
**restart Premiere**.

**3. Side-load the plugin.** In UXP Developer Tool: **Add Plugin** → select
`uxp-spike/manifest.json` → **Load & Watch**.

**4. Open a project with a sequence**, put the playhead somewhere with visible picture, and open
**Window → UXP Plugins → MCP UXP Spike**.

**5. Click "Run all probes."**

## Reading the result

The panel prints a JSON verdict and writes it to `/tmp/mcp-uxp-spike-report.json`. The server also
logs every transport that reaches it.

The two lines that matter:

```
Issue #9 (frame capture): FIXED by UXP | still broken
Transport:                websocket | http-fetch | file-bridge
```

Probe A does **not** trust `exportSequenceFrame`'s return value — the QE DOM lies about this in
both directions, so success is decided purely by whether a file exists on disk afterwards.

A failing probe is a **result, not an error**. "Loopback WebSocket is blocked" is exactly the kind
of thing worth learning in an afternoon rather than three weeks into a port.

## Please paste the JSON verdict into the tracking issue

If you can run this against a real Premiere, that's genuinely the most useful thing anyone can do
for this project right now. Neither of these questions can be settled from Adobe's documentation.
