---
applyTo: "uxp-plugin/**,src/bridge/uxp-websocket-bridge.ts,src/tools/uxp*.ts,tests/uxp/**"
---

Follow `AGENTS.md` (UXP section).

`uxp-plugin/` is a capability-aware Premiere 25.6+ backend. Honor the runtime capability probe. Keep panel code in CommonJS `.cjs`. `npm run lint` applies `@adobe/eslint-plugin-premierepro` here.

Mutations need documented undoable transactions plus native readback. Failed post-commit readback is `committed_unverified`. Never fall back from a failed UXP mutation to CEP or QE. Path-based commands stay inside the approved workspace folder; do not send the folder token to the MCP server.
