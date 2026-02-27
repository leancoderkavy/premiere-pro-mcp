<div align="center">

# Premiere Pro MCP Server

**Give AI full control over Adobe Premiere Pro.**

269 tools across 28 modules — the most comprehensive MCP server for video editing.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-1.12-purple.svg)](https://modelcontextprotocol.io)
[![Premiere Pro](https://img.shields.io/badge/Premiere%20Pro-2020--2025%2B-9999FF.svg)](https://www.adobe.com/products/premiere.html)

</div>

---

## What is this?

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that lets AI assistants like **Claude**, **Windsurf**, **Cursor**, or any MCP-compatible client directly control Adobe Premiere Pro — importing media, editing timelines, applying effects, managing keyframes, exporting, and more.

```
"Add the B-roll clips to V2, apply a cross dissolve between each, color correct them to match the A-roll, and export a 1080p ProRes."
```

The AI handles the entire workflow through 269 tools that cover nearly every ExtendScript and QE DOM API available in Premiere Pro.

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

This symlinks the plugin into Premiere Pro's extensions folder and enables debug mode.

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
2. Open Registry Editor and set these DWORD values to `1`:
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
      "args": ["/absolute/path/to/premiere-pro-mcp/dist/index.js"],
      "env": {
        "PREMIERE_TEMP_DIR": "/tmp/premiere-mcp-bridge"
      }
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
    "args": ["/absolute/path/to/premiere-pro-mcp/dist/index.js"],
    "env": {
      "PREMIERE_TEMP_DIR": "/tmp/premiere-mcp-bridge"
    }
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
      "args": ["/absolute/path/to/premiere-pro-mcp/dist/index.js"],
      "env": {
        "PREMIERE_TEMP_DIR": "/tmp/premiere-mcp-bridge"
      }
    }
  }
}
```

</details>

### 4. Start the bridge in Premiere Pro

1. Open (or restart) Premiere Pro
2. Go to **Window > Extensions > MCP Bridge**
3. Set the **Temp Directory** to match your MCP client config (e.g., `/tmp/premiere-mcp-bridge`)
4. Click **Start Bridge** — you should see a green "Running" status
5. Ask your AI assistant: *"What's my current Premiere Pro project?"*

---

## Architecture

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

1. AI client invokes an MCP tool (e.g., `add_to_timeline`)
2. MCP server generates ES3-compatible ExtendScript with helper functions prepended
3. Script is written to a `.jsx` command file in a shared temp directory
4. CEP plugin polls for command files, executes via `CSInterface.evalScript()`
5. Result JSON is written to a response file and returned to the AI

The file-based IPC bridge is simple, reliable, and works across macOS and Windows without network sockets.

---

## Tools (269)

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
| `create_sequence` / `create_sequence_from_preset` | Create sequences |
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

The server exposes two LLM context resources:

| Resource URI | Description |
|-------------|-------------|
| `config://premiere-instructions` | Best practices: workflow order, timeline rules, effect tips, error handling |
| `config://extendscript-reference` | Complete ExtendScript API reference for writing custom scripts |

These are automatically available to MCP clients that support resources, giving the AI deep context about how to drive Premiere Pro effectively.

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PREMIERE_TEMP_DIR` | Shared temp directory for MCP ↔ CEP communication | OS temp dir + `/premiere-mcp-bridge` |
| `PREMIERE_TIMEOUT_MS` | Command timeout in milliseconds | `30000` |

---

## Project Structure

```
premiere-pro-mcp/
├── src/
│   ├── index.ts                 # Entry point — stdio transport setup
│   ├── server.ts                # MCP server — registers all 269 tools + 2 resources
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
│   └── install-cep.sh           # CEP plugin installer (symlink + debug mode)
├── RESEARCH.md                  # API research and implementation status
├── CONTRIBUTING.md              # Contribution guidelines
├── CHANGELOG.md                 # Version history
└── LICENSE                      # MIT License
```

---

## Technical Details

### Why CEP instead of UXP?

CEP (Common Extensibility Platform) provides full ExtendScript access in Premiere Pro, including the undocumented **QE DOM** — which is the only way to apply effects by name, perform ripple deletes, and do advanced trim operations. UXP in Premiere Pro is still maturing and lacks equivalent API coverage. CEP works across **Premiere Pro 2020–2025+**.

### ExtendScript Compatibility

All generated scripts use **ES3 syntax** (`var`, manual `for` loops, no arrow functions, no `let`/`const`) since ExtendScript is based on ECMAScript 3. The `buildToolScript()` function prepends a library of helper functions to every script.

### Security

- Scripts are validated before execution — blocks `eval()`, `new Function()`, `System.callSystem()`
- 500KB script size limit
- `send_raw_script` bypasses validation for advanced users (with explicit opt-in)
- Temp directory created with restricted permissions (mode 700)

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

1. Verify debug mode: `defaults read com.adobe.CSXS.12 PlayerDebugMode` should return `1`
2. Check the plugin exists: `ls ~/Library/Application\ Support/Adobe/CEP/extensions/MCPBridgeCEP`
3. Completely restart Premiere Pro (not just close/reopen the project)
4. Check the CSXS version matches your Premiere Pro version

</details>

<details>
<summary><strong>Commands timeout or hang</strong></summary>

1. Verify the CEP panel shows "Running" with a green dot
2. Ensure temp directories match between MCP client config and CEP panel
3. Check if Premiere Pro is busy (rendering, modal dialog open)
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
