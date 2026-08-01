# GitHub Copilot repository instructions

## Project and architecture

- This repository is the TypeScript MCP server for Adobe Premiere Pro. The production path is a local Node.js server communicating with the CEP bridge through private file-based IPC. The UXP bridge is a capability-aware preview for supported Premiere 25.6+ APIs.
- `src/server.ts` assembles the MCP surface. Tool modules live in `src/tools/`, bridge code in `src/bridge/`, the production CEP extension in `cep-plugin/`, and the preview backend in `uxp-plugin/`.
- Treat `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, and `RESEARCH.md` as the canonical product, trust-model, contribution, and compatibility references.

## Development workflow

- Use Node.js 24 for repository work; the supported runtime floor is Node.js 20.19.
- Install deterministically with `npm ci`.
- Before requesting review, run `npm run check`. For changes that affect coverage-sensitive behavior, also run `npm run test:coverage`.
- Keep generated build output, credentials, certificates, Premiere project/media files, and local diagnostics out of commits.
- Make focused changes. Do not rewrite unrelated files or update dependency lockfiles unless the task requires it.

## Implementation rules

- Generated ExtendScript must remain ECMAScript 3 compatible: use `var`, traditional functions and loops, and no arrow functions, `let`, `const`, template literals, or other modern syntax.
- Escape every user-controlled string embedded in ExtendScript with the existing escaping helpers. Never interpolate raw paths, names, expressions, or prompts into generated scripts.
- Preserve capability and authority boundaries. Raw scripting tools stay disabled unless the explicit `unsafe-script` capability is enabled.
- Prefer documented Premiere APIs. QE DOM behavior is experimental and must be described as such.
- Mutating tools must verify their postconditions. Do not report success from a host API return value alone, and do not silently retry a failed UXP mutation through CEP or QE.
- Keep tool schemas, descriptions, registrations, structured results, tests, documentation, and reported counts synchronized.
- Reuse existing helpers and module patterns before introducing new abstractions or dependencies.

## Testing and review expectations

- Add or update tests for behavior changes, failure paths, escaping, validation, authority enforcement, and tool registration.
- Automated tests and CI prove package behavior only. Claims about Premiere-side compatibility require a real supported Premiere host with the applicable CEP or UXP bridge running.
- Clearly distinguish `committed`, `verified`, `committed_unverified`, and failed host mutations in user-visible results and documentation.
- Do not weaken authentication, private temp-directory ownership checks, script-size limits, telemetry privacy, or secret handling.
- Telemetry must remain bounded to operational metadata. Never collect prompts, arguments, results, tokens, IP addresses, project paths, media names, or person profiles.

## Pull requests

- Explain the user impact and the compatibility boundary.
- Link the related issue when one exists.
- Report the exact checks run and whether live Premiere verification was performed.
- Never claim a release, registry publication, deployment, or host-side validation unless it was directly verified.
