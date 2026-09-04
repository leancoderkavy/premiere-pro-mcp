# Previewable local doctor repair plans

## Status

`premiere-pro-mcp --doctor` reports local installation/configuration facts only.
It does not inspect a project, send an MCP request, open Premiere, read a
token, or prove that a host connection works.

Every component now includes a stable diagnostic code, such as
`CEP_CONNECTOR_MISSING`, `NODE_RUNTIME_UNSUPPORTED`, or
`PREMIERE_HOST_NOT_CHECKED`. Codes are safe to include in a support request;
the report excludes paths, tokens, environment values, prompts, project data,
and tool arguments/results.

## Preview first

```powershell
premiere-pro-mcp --doctor --plan-fixes
```

This emits a no-write JSON repair plan. The plan can recommend one of four
actions:

- install the missing local CEP connector;
- install a supported Node.js runtime;
- configure UXP only if that backend is desired;
- run a safe client-to-Premiere connection check.

Only a missing CEP connector on Windows or macOS is eligible for local
automation. Node installation, UXP setup, and live connection checks remain
manual because they require authority outside the local package or a live host.

## Apply an eligible connector repair

Fully quit Premiere Pro, then make that closure explicit:

```powershell
premiere-pro-mcp --doctor --apply-fixes --confirm-premiere-closed
```

Without `--confirm-premiere-closed`, `--apply-fixes` makes no changes and
returns `withheld`. With confirmation, the command can move an incomplete
local connector directory to a timestamped backup, run the existing connector
installer, and rerun the local doctor check. The backup is retained; this flow
does not delete it automatically.

The result distinguishes `applied`, `withheld`, `manual_required`, and `failed`.
It never reports Premiere open, an MCP client connected, a selected project, or
an editing/rendering outcome. After an `applied` local check, restart Premiere
and run the safe connection check from the MCP client before editing.
