# AGENTS.md

Canonical instructions for any IDE or coding agent working in this repository.
Cursor, GitHub Copilot, Codex, Claude Code, Gemini CLI, Windsurf, and similar tools should start here.

This is **not** the product website LLM crawl file. That generated file is `landing/public/llms.txt`.

Adapter stubs (`CLAUDE.md`, `GEMINI.md`, `CONVENTIONS.md`, `.github/copilot-instructions.md`, `.cursor/rules/`, `.windsurf/rules/`, `.clinerules`, `.continue/rules/`, `.junie/guidelines.md`) point here. Keep those stubs thin; put durable guidance in this file or in a focused Cursor/Copilot path rule.

## What this repository is

Independent TypeScript [MCP](https://modelcontextprotocol.io) server that gives a compatible AI client structured control over supported **Adobe Premiere Pro** workflows. Display name: MCP for Adobe Premiere Pro. npm package: `premiere-pro-mcp`. MCP server name: `io.github.leancoderkavy/premiere-pro`.

It is not affiliated with Adobe. The only npm package published from this repo is `premiere-pro-mcp`.

Production path: local Node.js MCP server (stdio) talking to a **CEP** panel inside Premiere through private file-based IPC (`.jsx` command files and `.json` responses). **UXP** is a capability-aware preview backend for Premiere 25.6+ documented APIs. A failed UXP mutation must never be silently retried through CEP or the undocumented QE DOM.

The local stdio server is the product. The HTTP `/mcp` endpoint is an operator-managed transport, not a public remote-Premiere product. See `docs/hosted-mcp-product-boundary.md`.

## Canonical sources

Read only what the task needs. Current source and release metadata beat dated snapshots.

| Topic | Source |
| --- | --- |
| Product, setup, architecture overview | `README.md` |
| This agent map | `AGENTS.md` (this file) |
| Trust model and vulnerability reports | `SECURITY.md` |
| Human contributor workflow | `CONTRIBUTING.md` |
| API research (dated; not live counts) | `RESEARCH.md` |
| Registered tool catalog | `docs/supported-actions.md` (generated) |
| Product claims governance | `docs/claims-registry.md`, `docs/claims-registry.json` |
| Published-package facts | `landing/lib/published-release.json` |
| Development source metadata | `release-metadata.json` |
| MCP runtime instructions for clients | `src/workflows/agent-instructions.ts` |
| Hosted HTTP boundary | `docs/hosted-mcp-product-boundary.md` |
| UXP 26.3 coverage | `docs/adobe-uxp-26.3-coverage.md` |
| Claude Code develop skill | `claude-plugins/premiere-pro/skills/develop-premiere-pro-mcp/SKILL.md` |

Do not mix published-package counts with development-source counts. `docs/supported-actions.md` is the source catalog; `landing/lib/published-release.json` is the inspected npm artifact. A listed tool is not proof that a particular Premiere host supports it.

## Architecture

```text
AI client  --stdio MCP-->  Node server (src/server.ts)
                              |  CEP: write cmd_*.jsx, poll JSON  -->  cep-plugin  -->  ExtendScript / QE DOM
                              |  UXP: authenticated WebSocket     -->  uxp-plugin  -->  documented Premiere UXP
                              |  AE:  optional CEP                -->  after-effects-cep-plugin (MOGRT studio)
```

- `src/index.ts` — stdio entry.
- `src/http-server.ts` — Streamable HTTP `/mcp`. Requires `MCP_AUTH_TOKEN` in production.
- `src/server.ts` — registers tools, resources, prompts; filters by authority and tool packs.
- `src/tools/` — one module per capability area; each exports `getXTools(...)`.
- `src/bridge/script-builder.ts` — ES3 ExtendScript helpers and `escapeForExtendScript`.
- `src/bridge/file-bridge.ts` — private temp-dir IPC for CEP.
- `src/bridge/uxp-websocket-bridge.ts` — authenticated UXP transport.
- `src/security/capabilities.ts` — `inspect`, `edit`, `export`, `filesystem`, `unsafe-script`.
- `src/ai/` — local planning/preview helpers. They do not call Adobe generative APIs.
- `src/workflows/` — tool packs, structured results, client-facing instructions, prompt catalog.
- `cep-plugin/` — production Premiere CEP panel.
- `uxp-plugin/` — Premiere 25.6+ UXP panel (CommonJS, Adobe ESLint plugin).
- `after-effects-cep-plugin/` — separate AE connector for guarded MOGRT recipes.
- `landing/` — Next.js 16 marketing site (`premiere-pro-mcp.com`).
- `tests/` — Vitest. Mocks the bridge; does not prove live Premiere behavior.
- `scripts/` — inventories, catalogs, installers, publish helpers.

Premiere metadata is several host surfaces. Documented UXP `Metadata.*` methods
are already mapped. Project-panel column JSON, Premiere-private project metadata
XML, and file/clip XMP are distinct; `premiere://project/metadata` is only a
path-redacted project/timeline summary. Field-level inspect/update uses
`uxp.XMPMeta` / AdobeXMPScript with a 256-field cap, sensitive-EXIF omit, and
field readback; CEP can still accept a complete XML payload plus `updatedFields`.
Do not dump unbounded packets, wrap undocumented QE metadata, or promote C2PA
into production tools without a bounded contract and a stable host pin. Keep MCP
`agent-instructions.ts`, the workflow catalog, and both `edit-premiere-project`
skill copies in sync when this surface changes.

### How a CEP tool call works

1. Handler validates arguments in TypeScript.
2. It builds ES3 ExtendScript and embeds user strings only through `escapeForExtendScript`.
3. `sendCommand` writes a command file under a user-owned temp directory (mode `0700`).
4. The CEP panel executes via `CSInterface.evalScript` and writes a JSON result.
5. Mutating tools read Premiere state back and report `committed`, `verified`, `committed_unverified`, or failure. A host API return value alone is not success.

## Commands

Use Node.js 24 for repository work. Package engines floor: **Node.js 20.19+**. Install with `npm ci`.

| Task | Command |
| --- | --- |
| Install | `npm ci` |
| Watch compile | `npm run dev` |
| Build | `npm run build` |
| Unit tests | `npm test` |
| One test file | `npx vitest run tests/tools/timeline.test.ts` |
| Coverage (when changing coverage-sensitive code) | `npm run test:coverage` |
| Full gate (lint, inventories, build, tests) | `npm run check` |
| Install CEP panel | `npm run build` then `npm run install-cep` |
| Landing site | `npm --prefix landing ci` then `npm --prefix landing run dev` |
| Landing e2e | `npm run test:landing:e2e` |

CI (`.github/workflows/cross-platform.yml`) runs `npm ci` and `npm run check` on Windows and macOS for Node 20, 22, and 24. Coverage is enforced on Windows / Node 22.

`npm run lint` currently lints `uxp-plugin/**/*.cjs` only. Landing has its own ESLint via `npm --prefix landing run lint`.

## Hard constraints

### ExtendScript (CEP / AE generated scripts)

ExtendScript is ECMAScript 3. Generated host code must use `var`, traditional `function`, and `for` loops. Do not emit `let`, `const`, arrow functions, template literals, destructuring, spread, default parameters, or `Array.forEach` / `map` / `filter`.

Escape every user-controlled string before embedding it:

```typescript
const script = buildToolScript(`
  var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
  if (!item) return __error("Item not found");
  return __result({ name: item.name });
`);
```

Never interpolate raw paths, names, expressions, or prompts into generated scripts.

### Authority and unsafe scripting

Default capabilities: `inspect,edit,export,filesystem`. `execute_extendscript`, `send_raw_script`, and `evaluate_expression` stay disabled unless `PREMIERE_MCP_CAPABILITIES` explicitly includes `unsafe-script`. Do not enable that capability to work around a missing tool.

### UXP vs CEP

Prefer documented Premiere APIs. QE DOM (`app.enableQE()`) is experimental; mark it in tool descriptions. UXP tools must honor the runtime capability probe. Do not fall back from a failed UXP mutation to CEP or QE.

### Verification and claims

- Mutating tools must verify postconditions with readback.
- Distinguish `committed`, `verified`, `committed_unverified`, and failed outcomes in user-visible results and docs.
- Automated tests prove package behavior only. Live Premiere claims need a supported host with the applicable CEP or UXP bridge running.
- Never claim a release, npm publish, Marketplace listing, deployment, or host-side validation unless that layer was directly verified.
- Do not invent testimonials, download rankings, or host compatibility.

### Telemetry and secrets

Telemetry is opt-in operational metadata only. Never collect prompts, arguments, results, tokens, IP addresses, project paths, media names, or person profiles. Do not weaken auth, private temp-directory ownership checks, script-size limits, or secret handling.

Keep `.env`, credentials, certificates, Premiere project/media files, `dist/`, coverage, and local diagnostics out of commits.

### Focused changes

Reuse existing helpers and module patterns. Do not rewrite unrelated files or bump lockfiles unless the task requires it. Preserve unrelated worktree changes.

## Adding or changing a tool

1. Find the right module in `src/tools/` (or add a module for a new capability area).
2. Export a `getXTools(...)` record. Each tool needs a description, JSON Schema `parameters` (every property described), and a handler.
3. Register new modules in `src/server.ts`.
4. If tests enumerate modules (see `tests/tools/tool-modules.test.ts`), add the module there.
5. Keep schemas, descriptions, registrations, structured results, authority, tests, `docs/supported-actions.md`, and reported counts synchronized. Regenerators: `npm run docs:supported-actions` and the inventory `:check` scripts inside `npm run check`.
6. Add tests for success, failure, escaping, validation, and authority.
7. After `npm run build`, restart the MCP client. Live-host verification is optional for schema work and required for compatibility claims.

## Testing expectations

- Vitest mocks `sendCommand` / UXP sockets. Green tests are not a Premiere proof.
- Coverage thresholds live in `vitest.config.ts` (statements 91, branches 90, functions 94, lines 93).
- Prefer the narrowest test file while iterating; run `npm run check` before calling the work done.

## Landing site (`landing/`)

Next.js 16 app. APIs and file conventions may differ from older Next.js. Before editing it, read the guide in `landing/node_modules/next/dist/docs/` (not the repo root `node_modules`).

`landing/AGENTS.md` and `landing/CLAUDE.md` are Next.js agent stubs plus a short project pointer. Do not delete the `BEGIN:nextjs-agent-rules` / `END:nextjs-agent-rules` block; `next dev` rewrites it.

Public facts, tool counts, and crawl files are generated. Change source metadata or generators rather than hand-editing `landing/public/llms.txt`. Qualify every public claim per `docs/claims-registry.md`.

## What not to touch casually

- Generated inventories under `src/resources/*.json` and matching `docs/*-inventory.md` / drift docs — use the `npm run …:check` / generate scripts.
- `landing/public/llms.txt` and other marketing reference outputs — `npm run marketing:check`.
- Version strings: search package, lockfile, CEP/UXP manifests, marketplace, MCP config, updater, landing, and installer files together.
- `.worktrees/` — local checkouts; do not commit.

## Pull requests

Explain user impact and the compatibility boundary. Link the issue when one exists. Report exact checks run and whether live Premiere verification happened. Update `.github/pull_request_template.md` fields when adding tools.
