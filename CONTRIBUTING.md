# Contributing to Premiere Pro MCP Server

Thanks for your interest in contributing! This guide covers how to get set up and submit changes.

## Development Setup

### Prerequisites

- Node.js 18+
- Adobe Premiere Pro 2020+ (for testing)
- An MCP-compatible client (Claude Desktop, Windsurf, Cursor, etc.)

### Getting started

```bash
git clone https://github.com/ppmcp/premiere-pro-mcp.git
cd premiere-pro-mcp
npm install
npm run dev          # Watch mode — recompiles on changes
npm run install-cep  # Symlink CEP plugin into Premiere Pro
```

After making changes, restart your MCP client to pick up the new tools.

## Project Architecture

```
src/
├── index.ts              # Entry point
├── server.ts             # Registers all tools with the MCP SDK
├── bridge/
│   ├── file-bridge.ts    # File-based IPC (.jsx → .json)
│   └── script-builder.ts # Generates ES3 ExtendScript with helpers
└── tools/                # 28 tool modules
```

### How tools work

Each tool module exports a `getXTools(bridgeOptions)` function that returns a `Record<string, ToolDef>`. A tool definition has:

- **`description`** — shown to the AI client
- **`parameters`** — JSON Schema object (converted to Zod at registration)
- **`handler`** — async function that builds ExtendScript and sends it via the bridge

Example:

```typescript
my_tool: {
  description: "Does a thing in Premiere Pro",
  parameters: {
    type: "object" as const,
    properties: {
      name: { type: "string", description: "Name of the thing" },
    },
    required: ["name"],
  },
  handler: async (args: { name: string }) => {
    const script = buildToolScript(`
      var result = app.project.name;
      return __result({ projectName: result, input: "${escapeForExtendScript(args.name)}" });
    `);
    return sendCommand(script, bridgeOptions);
  },
},
```

### ExtendScript rules

All generated scripts must be **ES3-compatible**:

- Use `var`, not `let`/`const`
- No arrow functions — use `function(x) { ... }`
- No template literals — use string concatenation
- No `Array.forEach/map/filter` — use manual `for` loops
- No destructuring, spread, or default parameters
- Always use `escapeForExtendScript()` for user-provided strings

### Helper functions

`buildToolScript()` prepends these helpers to every script:

- `__result(data)` — return success JSON
- `__error(msg)` — return error JSON
- `__findProjectItem(nameOrId)` — find project item by name or node ID
- `__findClip(nodeId)` — find clip on timeline by node ID
- `__findSequence(nameOrId)` — find sequence by name or ID
- `__ticksToSeconds(ticks)` / `__secondsToTicks(seconds)` — time conversion
- `__getClipComponents(clip)` — enumerate effect components

## Adding a New Tool

1. **Find the right module** in `src/tools/` or create a new one if it's a new capability area
2. **Add the tool definition** following the pattern above
3. **If creating a new module**, register it in `src/server.ts`:
   ```typescript
   import { getMyTools } from "./tools/my-module.js";
   // ... in createServer():
   ...getMyTools(bridgeOptions),
   ```
4. **Build and test**: `npm run build`
5. **Test in Premiere Pro** by calling the tool from your MCP client

## Submitting Changes

### Pull requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-new-tool`
3. Make your changes
4. Run `npm run build` to verify compilation
5. Test with Premiere Pro if possible
6. Submit a pull request with a clear description

### Commit messages

Use clear, descriptive commit messages:

```
Add stabilize_clip tool using Warp Stabilizer effect
Fix set_clip_properties Position X/Y handling
Add workspace.ts module with get/set workspace tools
```

### Code style

- Follow existing patterns in the codebase
- Keep tool descriptions concise but informative
- Use TypeScript types for handler arguments
- Don't add comments unless they explain non-obvious behavior

## Reporting Issues

When filing an issue, please include:

- Premiere Pro version
- OS (macOS/Windows)
- MCP client (Claude Desktop, Windsurf, Cursor, etc.)
- The tool name and parameters you used
- The error message or unexpected behavior
- Whether the CEP panel shows "Running"

## QE DOM Notes

The QE DOM is undocumented. If you discover new QE methods or behaviors:

1. Test thoroughly — QE operations can be destructive
2. Document what you find in `RESEARCH.md`
3. Mark QE-based tools with "Uses QE DOM" in their descriptions
4. Always call `app.enableQE()` before using QE objects

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
