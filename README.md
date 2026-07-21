<div align="center">

# Premiere Pro MCP Server

**Give AI full control over Adobe Premiere Pro.**

269 tools across 29 modules, 3 resources, and 4 guided workflows.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-1.27-purple.svg)](https://modelcontextprotocol.io)
[![npm](https://img.shields.io/npm/v/premiere-pro-mcp.svg)](https://www.npmjs.com/package/premiere-pro-mcp)
[![Fly.io](https://img.shields.io/badge/Fly.io-deployed-7C3AED.svg)](https://premiere-pro-mcp.fly.dev)
[![Premiere Pro](https://img.shields.io/badge/Premiere%20Pro-2020--2026-9999FF.svg)](https://www.adobe.com/products/premiere.html)

</div>

---

## What is this?

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that lets AI assistants like **Claude**, **Windsurf**, **Cursor**, or any MCP-compatible client directly control Adobe Premiere Pro — importing media, editing timelines, applying effects, managing keyframes, exporting, and more.

```
"Add the B-roll clips to V2, apply a cross dissolve between each, color correct them to match the A-roll, and export a 1080p ProRes."
```

The AI handles the entire workflow through 269 tools spanning the supported ExtendScript, QE DOM, and safe edit-planning surfaces.

### What's new in 1.2.0

- **Safe edit plans:** preview compound insert/remove operations, bind approval to a SHA-256 plan token, then apply the validated plan in one bridge command.
- **Capability profiles:** unsafe scripting is disabled by default and requires explicit `unsafe-script` authority.
- **Modern MCP responses:** tools expose safety annotations and structured results; four workflow prompts and a machine-readable workflow resource guide common edits.
- **UXP bridge preview:** a packaged Premiere 25.6+ panel adds capability discovery, state events, reconnecting WebSocket transport, and supported frame export with file verification. Live host verification is still required.

---

## Quick Start

### 1. Install

**Option A — npm (recommended):**

```bash
npm install -g premiere-pro-mcp
```

**Option B — Clone from source:**

```bash
git clone https://github.com/ppmcp/premiere-pro-mcp.git
cd premiere-pro-mcp
npm install
npm run build
```

### 2. Install the CEP plugin

**If installed via npm:**

```bash
premiere-pro-mcp --install-cep
```

**If cloned from source:**

```bash
npm run install-cep
```

This installs the plugin into Premiere Pro's per-user extensions folder and enables debug mode.

<details>
<summary>Manual installation (macOS)</summary>

```bash
mkdir -p ~/Library/Application\ Support/Adobe/CEP/extensions
ln -s "$(pwd)/cep-plugin" ~/Library/Application\ Support/Adobe/CEP/extensions/MCPBridgeCEP

# Enable unsigned extensions (CSXS 9–14)
for v in 9 10 11 12 13 14; do
  defaults write com.adobe.CSXS.$v PlayerDebugMode 1
done
```

</details>

<details>
<summary>Manual installation (Windows)</summary>

1. Copy the `cep-plugin` folder to `%APPDATA%\Adobe\CEP\extensions\MCPBridgeCEP`
2. Open Registry Editor and set these **String (`REG_SZ`)** values to `1` (not DWORD):
   - `HKEY_CURRENT_USER\Software\Adobe\CSXS.12\PlayerDebugMode`
   - (repeat for CSXS.9 through CSXS.14)

</details>

### 3. Configure your MCP client

<details>
<summary><strong>Claude Desktop</strong></summary>

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "premiere-pro": {
      "command": "node",
      "args": ["/absolute/path/to/premiere-pro-mcp/dist/index.js"]
    }
  }
}
```

</details>

<details>
<summary><strong>Windsurf / Cascade</strong></summary>

Add to your MCP server configuration:

```json
{
  "premiere-pro": {
    "command": "node",
    "args": ["/absolute/path/to/premiere-pro-mcp/dist/index.js"]
  }
}
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

Add to `.cursor/mcp.json` in your project or global config:

```json
{
  "mcpServers": {
    "premiere-pro": {
      "command": "node",
      "args": ["/absolute/path/to/premiere-pro-mcp/dist/index.js"]
    }
  }
}
```

</details>

### 4. Verify the bridge in Premiere Pro

1. Open (or restart) Premiere Pro
2. The bridge starts automatically using the default temp directory (or its previously saved setting)
3. Optionally go to **Window > Extensions > MCP Bridge** to confirm the green "Running" status or change the **Temp Directory** to match your MCP client config
4. Ask your AI assistant: *"What's my current Premiere Pro project?"*

The default bridge directory is derived from the operating system on both sides, so most local setups should not set `PREMIERE_TEMP_DIR`. If you override it, use the same absolute path in the MCP server and CEP panel; Windows and macOS paths are not interchangeable.

### Windows and macOS capability coverage

| Surface | Windows | macOS | Verification boundary |
|---|---|---|---|
| CEP production bridge | Premiere Pro 2020–2026 | Premiere Pro 2020–2026 | Run `get_capabilities`, then `ping` with Premiere open |
| UXP preview bridge | Premiere Pro 25.6+ | Premiere Pro 25.6+ | Live loopback WebSocket and host API verification required |
| npm CEP installer | Copies plugin and verifies `REG_SZ` debug keys | Copies plugin and verifies the installed manifest/debug settings | Restart Premiere after installation |
| CI build and unit tests | Node 18 and 22 | Node 18 and 22 | GitHub-hosted OS runners; no Adobe host is available in CI |

`get_capabilities` reports the current operating system, temp directory, CEP/UXP coverage, enabled authority profile, and any live-host verification still required. It does not claim a Premiere operation succeeded; use `ping` and inspect each tool result for runtime evidence.

---

## Architecture

**Local (stdio):**
```
┌───────────────┐   stdio (MCP)   ┌──────────────┐   File-based IPC   ┌──────────────┐
│  AI Client    │ ◄──────────────► │  MCP Server  │ ◄────────────────► │  CEP Plugin  │
│  (Claude,     │                  │  (Node.js /  │   .jsx commands    │  (runs inside │
│   Windsurf,   │                  │   TypeScript) │   .json responses  │   Premiere)   │
│   Cursor)     │                  └──────────────┘                    └──────┬────────┘
└───────────────┘                                                             │ evalScript()
                                                                              ▼
                                                                       ┌──────────────┐
                                                                       │  Premiere Pro │
                                                                       │  ExtendScript │
                                                                       │  + QE DOM     │
                                                                       └──────────────┘
```

**Remote (HTTP/SSE — Fly.io):**
```
┌───────────────┐  HTTP+SSE (MCP)  ┌─────────────────────┐   File-based IPC   ┌──────────────┐
│  AI Client    │ ◄───────────────► │  MCP Server         │ ◄────────────────► │  CEP Plugin  │
│  (any MCP     │                   │  premiere-pro-mcp   │   .jsx / .json     │  (Premiere)  │
│   client)     │                   │  .fly.dev           │   shared volume    └──────────────┘
└───────────────┘                   └─────────────────────┘
```

1. AI client invokes an MCP tool (e.g., `add_to_timeline`)
2. MCP server generates ES3-compatible ExtendScript with helper functions prepended
3. Script is written to a `.jsx` command file in a shared temp directory
4. CEP plugin polls for command files, executes via `CSInterface.evalScript()`
5. Result JSON is written to a response file and returned to the AI

The file-based IPC bridge is simple, reliable, and works across macOS and Windows without network sockets.

---

## Tools (268)

### Discovery & Inspection (10 + 10)

| Tool | Description |
|------|-------------|
| `get_project_info` | Current project name, path, sequences, items |
| `get_active_sequence` | Detailed active sequence with all clips |
| `list_project_items` | All items in the project panel |
| `get_full_project_overview` | Comprehensive snapshot: bin tree, sequences, media types |
| `get_full_sequence_info` | Exhaustive sequence data: tracks, clips, effects, markers |
| `get_full_clip_info` | Everything about a clip: effects, keyframes, metadata |
| `get_timeline_summary` | Human-readable overview: duration, coverage %, effects |
| `search_project_items` | Filter by name, extension, offline status, color label |
| `get_premiere_state` | Full snapshot: project, sequence, playhead, selection |
| `inspect_dom_object` | Explore any Premiere Pro DOM object interactively |

### Project Management (26)

| Tool | Description |
|------|-------------|
| `save_project` / `save_project_as` / `open_project` | File operations |
| `create_project` / `close_project` | Project lifecycle |
| `import_media` / `import_folder` / `import_ae_comps` | Import media and AE comps |
| `create_bin` / `delete_bin` / `rename_bin` / `create_smart_bin` | Bin management |
| `import_sequences` / `import_fcp_xml` | Import from other projects |
| `create_bars_and_tone` | Generate bars & tone media |
| `set_scratch_disk_path` | Configure scratch disks |
| `consolidate_and_transfer` | Project Manager consolidation |

### Timeline & Editing (10 + 27 advanced)

| Tool | Description |
|------|-------------|
| `add_to_timeline` / `overwrite_clip` | Insert and overwrite edits |
| `ripple_delete` | Remove clip and close gap (QE) |
| `roll_edit` / `slide_edit` / `slip_edit` | Professional trim modes (QE) |
| `move_clip_to_track` | Move between tracks (QE) |
| `set_clip_speed_qe` / `reverse_clip` | Speed/reverse (QE) |
| `split_clip` / `trim_clip` / `move_clip` | Basic edits |
| `set_clip_properties` | Opacity, scale, rotation, position |
| `link_selection` / `unlink_selection` | Link/unlink A/V |

### Effects & Color (8)

| Tool | Description |
|------|-------------|
| `apply_effect` / `apply_audio_effect` | Apply by name (QE) |
| `remove_effect` / `remove_all_effects` | Remove effects |
| `color_correct` | Lumetri: exposure, contrast, temperature, etc. |
| `apply_lut` | Apply LUT files |
| `stabilize_clip` | Warp Stabilizer with configurable settings |

### Keyframes (8)

| Tool | Description |
|------|-------------|
| `add_keyframe` / `get_keyframes` | Create and read keyframes |
| `remove_keyframe` / `remove_keyframe_range` | Delete keyframes |
| `set_keyframe_interpolation` | Linear / Hold / Bezier |
| `get_value_at_time` | Query interpolated value at any time |
| `set_color_value` | Set color properties on effects |

### Export & Encoding (14)

| Tool | Description |
|------|-------------|
| `export_sequence` | Export via Adobe Media Encoder |
| `capture_frame` | Export frame as PNG, return as base64 image |
| `export_as_fcp_xml` / `export_aaf` / `export_omf` | Interchange formats |
| `encode_project_item` / `encode_file` | Direct encoding |
| `start_batch_encode` | Start render queue |

### Source Monitor & Playback (7 + 4)

| Tool | Description |
|------|-------------|
| `open_in_source` / `close_source_monitor` | Source monitor control |
| `insert_from_source` / `overwrite_from_source` | 3-point editing |
| `play_timeline` / `stop_playback` | Playback control (QE) |
| `play_source_monitor` | Play in source monitor |

### Selection & Clipboard (7 + 6)

| Tool | Description |
|------|-------------|
| `select_clips_by_name` / `select_clips_in_range` | Smart selection |
| `copy_effects_between_clips` | Copy effects via QE |
| `batch_apply_effect` | Apply effect to multiple clips |
| `set_blend_mode` | 27 blend modes |

### Media Properties (16)

| Tool | Description |
|------|-------------|
| `set_offline` / `has_proxy` / `detach_proxy` | Offline/proxy management |
| `set_override_frame_rate` | Override FPS |
| `set_scale_to_frame_size` | Auto-scale to sequence frame |
| `get_xmp_metadata` / `set_xmp_metadata` | Raw XMP access |
| `get_color_space` | Color space info |

### Sequence Management (11)

| Tool | Description |
|------|-------------|
| `create_sequence` / `create_sequence_from_preset` | Create sequences from `.sqpreset` files without opening Premiere's modal dialog |
| `duplicate_sequence` / `delete_sequence` | Manage sequences |
| `auto_reframe_sequence` | Auto-reframe for social media |
| `attach_custom_property` | FCP XML custom properties |
| `unnest_sequence` | Replace nested sequence with its clips |

### Workspace & Captions (2 + 1)

| Tool | Description |
|------|-------------|
| `get_workspaces` / `set_workspace` | Switch workspace layouts |
| `create_caption_track` | Create caption/subtitle tracks |

### Scripting (6)

| Tool | Description |
|------|-------------|
| `execute_extendscript` | Run arbitrary ExtendScript (ES3) |
| `evaluate_expression` | Quick one-line eval |
| `send_raw_script` | Bypass security validation (advanced) |

### ...and 100+ more

Track targeting, batch operations, markers, audio levels, motion/transform, metadata, sequence settings, navigation, project analysis, and more. Run `get_project_info` to get started — the AI will discover what it needs.

---

## MCP Resources

The server exposes three LLM context resources and four workflow prompts:

| Resource URI | Description |
|-------------|-------------|
| `config://premiere-instructions` | Best practices: workflow order, timeline rules, effect tips, error handling |
| `config://extendscript-reference` | Complete ExtendScript API reference for writing custom scripts |
| `config://premiere-workflows` | Machine-readable catalog for rough cuts, dialogue cleanup, captions, and delivery |

These are automatically available to MCP clients that support resources, giving the AI deep context about how to drive Premiere Pro effectively.

---

## Remote Deployment (Fly.io)

The server includes an HTTP/SSE transport (`src/http-server.ts`) for remote access via [mcp-remote](https://github.com/geelen/mcp-remote) or any MCP client that supports Streamable HTTP.

A live instance is running at **https://premiere-pro-mcp.fly.dev**.

### Connect via mcp-remote

```json
{
  "mcpServers": {
    "premiere-pro": {
      "command": "npx",
      "args": ["mcp-remote", "https://premiere-pro-mcp.fly.dev/mcp"]
    }
  }
}
```

### Self-host on Fly.io

```bash
# Clone and deploy your own instance
git clone https://github.com/ppmcp/premiere-pro-mcp.git
cd premiere-pro-mcp
fly apps create your-app-name
# Required: add bearer token auth
fly secrets set MCP_AUTH_TOKEN=your-secret-token
fly deploy --remote-only
```

Then connect with:
```json
{
  "mcpServers": {
    "premiere-pro": {
      "command": "npx",
      "args": ["mcp-remote", "https://your-app-name.fly.dev/mcp",
               "--header", "Authorization: Bearer your-secret-token"]
    }
  }
}
```

> **Note:** The file bridge still requires the CEP plugin to share the same `PREMIERE_TEMP_DIR`. For cloud deployments this means running a sync agent or using `fly proxy` / WireGuard to reach your local machine.

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|--------|
| `PREMIERE_TEMP_DIR` | Shared temp directory for MCP ↔ CEP communication | OS temp dir + `/premiere-mcp-bridge` |
| `PREMIERE_TIMEOUT_MS` | Command timeout in milliseconds | `30000` |
| `PREMIERE_DEFAULT_SEQUENCE_PRESET` | Override the auto-discovered `.sqpreset` used by `create_sequence` | auto-discovered |
| `PREMIERE_MCP_CAPABILITIES` | Comma-separated authority profile; add `unsafe-script` only when raw scripting is required | `inspect,edit,export,filesystem` |
| `PORT` | HTTP port (HTTP/SSE transport only) | `3000` |
| `MCP_AUTH_TOKEN` | Bearer token required by the HTTP transport | unset |
| `ALLOW_UNAUTHENTICATED` | Set to `1` to run HTTP without auth (unsafe; throwaway instances only) | unset |

---

## Project Structure

```
premiere-pro-mcp/
├── src/
│   ├── index.ts                 # Entry point — stdio transport setup
│   ├── http-server.ts           # Entry point — HTTP/SSE transport (Fly.io / remote)
│   ├── server.ts                # MCP server — registers 268 tools + 3 resources + 4 prompts
│   ├── bridge/
│   │   ├── file-bridge.ts       # File-based IPC (write .jsx, poll .json)
│   │   └── script-builder.ts    # ExtendScript generator with ES3 helpers
│   ├── tools/                   # 28 tool modules
│   │   ├── discovery.ts         # Project discovery and queries
│   │   ├── project.ts           # Project management and import
│   │   ├── media.ts             # Media and proxy management
│   │   ├── sequence.ts          # Sequence creation and settings
│   │   ├── timeline.ts          # Timeline clip operations
│   │   ├── effects.ts           # Effect application and color correction
│   │   ├── transitions.ts       # Transition management (QE DOM)
│   │   ├── audio.ts             # Audio levels and keyframes
│   │   ├── text.ts              # Text overlays and MOGRTs
│   │   ├── markers.ts           # Sequence and clip markers
│   │   ├── tracks.ts            # Track add/delete/lock/visibility
│   │   ├── playhead.ts          # Playhead, work area, in/out points
│   │   ├── metadata.ts          # Metadata, XMP, color labels
│   │   ├── export.ts            # Export, frame capture, encoding
│   │   ├── advanced.ts          # QE DOM: ripple, roll, slide, slip, speed
│   │   ├── keyframes.ts         # Keyframe CRUD and interpolation
│   │   ├── scripting.ts         # Execute arbitrary ExtendScript
│   │   ├── inspection.ts        # Deep project/sequence/clip inspection
│   │   ├── selection.ts         # Clip selection utilities
│   │   ├── clipboard.ts         # Copy effects, batch operations
│   │   ├── source-monitor.ts    # Source monitor control
│   │   ├── track-targeting.ts   # Track targeting, motion, audio props
│   │   ├── utility.ts           # Batch ops, analysis, navigation
│   │   ├── health.ts            # Connectivity ping
│   │   ├── workspace.ts         # Workspace layout switching
│   │   ├── captions.ts          # Caption track creation
│   │   ├── playback.ts          # Timeline/source playback control
│   │   └── project-manager.ts   # Project consolidation/transfer
│   └── resources/
│       └── extendscript-reference.ts  # API reference for LLM context
├── cep-plugin/                  # CEP panel that runs inside Premiere Pro
│   ├── CSXS/manifest.xml        # Extension manifest (PPRO 14.0+)
│   ├── index.html               # Panel UI
│   ├── main.js                  # Bridge polling and script execution
│   ├── host.jsx                 # ExtendScript entry point
│   └── CSInterface.js           # Adobe CEP interface library
├── scripts/
│   ├── install-cep.sh           # macOS CEP installer (symlink + debug mode)
│   └── install-cep.ps1          # Windows CEP installer (copy + REG_SZ debug mode)
├── Dockerfile                   # Multi-stage Docker build for Fly.io
├── fly.toml                     # Fly.io deployment config
├── RESEARCH.md                  # API research and implementation status
├── CONTRIBUTING.md              # Contribution guidelines
├── CHANGELOG.md                 # Version history
└── LICENSE                      # MIT License
```

---

## Technical Details

### CEP and UXP backends

CEP remains the production backend because it provides broad ExtendScript access and the undocumented **QE DOM** used for effects, ripple deletes, and advanced trims across Premiere Pro 2020–2026. The packaged `uxp-plugin` is a Premiere 25.6+ preview backend for supported frame export, capability discovery, and state events. It does not silently retry failed UXP mutations through CEP.

### ExtendScript Compatibility

All generated scripts use **ES3 syntax** (`var`, manual `for` loops, no arrow functions, no `let`/`const`) since ExtendScript is based on ECMAScript 3. The bridge writes a versioned helper library to the shared temp directory and loads it once per ExtendScript engine via `$.evalFile`; each command then sends only its tool-specific script.

### Security

Understand the trust model before deploying this: **any client that can reach the MCP
server can control Premiere Pro.** `execute_extendscript` and `send_raw_script` are
arbitrary-code-execution tools by design and are disabled by default. Enable them only by setting
`PREMIERE_MCP_CAPABILITIES=inspect,edit,export,filesystem,unsafe-script`.

- **Run it locally over stdio** unless you have a specific reason not to. That's the safe default.
- **The HTTP transport (`http-server`) requires `MCP_AUTH_TOKEN`** and refuses to start
  without it. It binds `0.0.0.0` and is remotely reachable, so never expose it publicly
  without a strong token (set `ALLOW_UNAUTHENTICATED=1` only for a throwaway public instance).
- The bridge temp directory is created private to your user (mode `0700`), and the server
  refuses to use one owned by another user — relevant on shared machines, where the CEP
  panel would otherwise execute any `cmd_*.jsx` staged there.
- There is a 500 KB script size limit, and a small regex check that rejects `eval()`,
  `new Function()`, and `System.callSystem()` in tool-generated scripts. **This is a guard
  rail, not a sandbox** — it is trivially bypassable and is not a security boundary. Do not
  rely on it to contain untrusted input; the real boundary is who can reach the server.

### QE DOM

Many tools use the undocumented QE DOM (enabled via `app.enableQE()`). These tools are marked with "Uses QE DOM" in their descriptions. The QE DOM provides capabilities unavailable through the standard ExtendScript API:

- Apply effects and transitions by name
- Ripple delete, roll/slide/slip edits
- Set clip speed and reverse
- Frame blending and time interpolation
- Remove all effects from a clip

---

## Troubleshooting

<details>
<summary><strong>CEP plugin doesn't appear in Premiere Pro</strong></summary>

1. Verify debug mode:
   - macOS: `defaults read com.adobe.CSXS.12 PlayerDebugMode` should return `1`
   - Windows: `reg query "HKCU\SOFTWARE\Adobe\CSXS.12" /v PlayerDebugMode` should report `REG_SZ    1` (a `REG_DWORD` value is not valid for unsigned CEP discovery)
2. Check the plugin exists:
   - macOS: `ls ~/Library/Application\ Support/Adobe/CEP/extensions/MCPBridgeCEP`
   - Windows: `dir "%APPDATA%\Adobe\CEP\extensions\MCPBridgeCEP"`
3. Completely restart Premiere Pro (not just close/reopen the project)
4. Check the CSXS version matches your Premiere Pro version

</details>

<details>
<summary><strong>Commands timeout or hang</strong></summary>

1. Open the CEP panel and verify it shows "Running" with a green dot (the bridge normally starts automatically)
2. Ensure temp directories match between MCP client config and CEP panel
3. Read the timeout error: if it reports an in-flight heartbeat, dismiss any open Premiere modal dialog; without a heartbeat, verify the bridge is running and using the same temp directory
4. Increase timeout: set `PREMIERE_TIMEOUT_MS` to `60000` or higher
5. Try `ping` tool to test basic connectivity

</details>

<details>
<summary><strong>AI client can't see tools</strong></summary>

1. Restart the AI client after editing config
2. Verify the path to `dist/index.js` is absolute and correct
3. Run `node dist/index.js` in a terminal to check for startup errors
4. Ensure `npm run build` completed without errors

</details>

<details>
<summary><strong>QE DOM tools fail</strong></summary>

1. QE tools require an active sequence — open one first
2. Some QE operations are index-based and can fail if clips have been reordered
3. Re-query the sequence structure after QE operations

</details>

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

[MIT](LICENSE) — free for personal and commercial use.
