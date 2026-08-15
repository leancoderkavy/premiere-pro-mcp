---
name: develop-premiere-pro-mcp
description: Develop, debug, test, review, document, and release the premiere-pro-mcp repository. Use when changing MCP tools, schemas, server registration, CEP or UXP bridges, generated ExtendScript, authority profiles, packaging, release metadata, or compatibility claims in this repo.
---

# Develop Premiere Pro MCP

Make focused, evidence-backed changes to this TypeScript MCP server. Preserve unrelated
worktree changes and distinguish automated verification from behavior proven in a live
Premiere Pro host.

## Orient to the repository

1. Read `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, and `RESEARCH.md` only as needed
   for the task. Treat current source and release metadata as authoritative over dated
   snapshots.
2. Inspect `git status` before editing. Do not stage, rewrite, or remove unrelated work.
3. Trace the relevant path before changing it:
   - `src/server.ts` assembles the MCP surface.
   - `src/tools/` contains tool schemas and handlers.
   - `src/bridge/` implements host communication.
   - `cep-plugin/` is the broad production bridge.
   - `uxp-plugin/` is capability-aware and supports only its declared Premiere APIs.
4. Use Node.js 24 for development when available; preserve the package's Node 20.19+
   runtime floor. Install deterministically with `npm ci` when dependencies are missing.

## Implement safely

- Reuse nearby helpers and module patterns before adding abstractions or dependencies.
- Keep tool schemas, descriptions, registrations, structured results, authority profiles,
  tests, documentation, generated catalogs, and reported counts synchronized.
- Generate ExtendScript as ECMAScript 3: use `var`, traditional functions and loops, and
  avoid arrows, `let`, `const`, template literals, and other modern runtime syntax.
- Escape every user-controlled string with existing helpers before embedding it in a
  generated script. Never interpolate raw paths, names, expressions, or prompts.
- Keep raw scripting disabled unless the explicit `unsafe-script` capability is enabled.
- Prefer documented Premiere APIs. Label QE DOM behavior experimental.
- Verify mutation postconditions. Do not treat a host API return value alone as proof of
  success, and do not silently fall back from failed UXP work to CEP or QE.
- Preserve private-directory ownership checks, authentication, size limits, secret
  handling, and telemetry privacy. Never collect prompts, arguments, results, tokens,
  IP addresses, project paths, media names, or person profiles.

## Test proportionally

1. Add or update tests for behavior, failure paths, validation, escaping, authorization,
   registration, and metadata affected by the change.
2. Run the narrowest relevant tests while iterating.
3. Run `npm run check` before completion. Run `npm run test:coverage` when changing
   coverage-sensitive behavior.
4. Inspect the final diff and status so generated output or unrelated files are not
   included accidentally.
5. Treat build, unit tests, mocks, and CI as package evidence only. Require a supported
   Premiere host and the applicable running CEP or UXP bridge for live-host claims.

## Handle releases and compatibility claims

- Search all version-bearing package, lock, manifest, marketplace, MCP configuration,
  updater, landing, and installation files when changing a version.
- Verify the exact commit, checks, registry artifact, release assets, deployment health,
  and host state separately when the task includes those outcomes.
- Never claim a commit, push, merge, publication, deployment, or live Premiere result
  without direct evidence from that layer.
- Report what changed, exact checks run, failures or skipped checks, and whether live CEP
  or UXP verification was performed.

