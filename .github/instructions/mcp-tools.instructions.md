---
applyTo: "src/tools/**/*.ts,src/server.ts,src/security/**/*.ts,src/workflows/**/*.ts,tests/tools/**/*.ts"
---

Follow `AGENTS.md` (MCP tools section).

Export tools via `getXTools(...)` and register new modules in `src/server.ts` (and `tests/tools/tool-modules.test.ts` when that catalog lists modules). Keep schemas, descriptions, structured results, authority, tests, and `docs/supported-actions.md` synchronized.

Default capabilities are `inspect,edit,export,filesystem`. Do not enable `unsafe-script` to work around a missing tool. Mutating tools must verify postconditions with readback (`committed` / `verified` / `committed_unverified`). Never silently retry a failed UXP mutation through CEP or QE. Vitest mocks the bridge; it does not prove a live Premiere host.
