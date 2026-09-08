# SERP position plan: "premiere pro mcp"

Measured 2026-09-07 on a Google web search for `premiere pro mcp`. This file
records the observed positions and the specific gaps behind them. Positions
move; re-measure before acting on this file, and do not treat any line here as
a claim about current rank.

## Observed positions (2026-09-07)

| Position | Result |
| --- | --- |
| 1 | `github.com/hetpatel-11/Adobe_Premiere_Pro_MCP` |
| 2 | `premiere-pro-mcp.com` (this project's site) |
| 3 | `github.com/leancoderkavy/premiere-pro-mcp` (this repository) |

Also on page 1: a video block, `viasocket.com`, `mcpmarket.com`,
`pulsemcp.com`, a Reddit thread, and an AI Overview.

Comparative repository signals on the same date:

| Signal | This repository | Position-1 repository |
| --- | --- | --- |
| Created | 2026-02-27 | 2025-07-07 |
| Stars | 239 | 526 |
| Forks | 39 | 110 |
| Repository slug | `premiere-pro-mcp` | `Adobe_Premiere_Pro_MCP` |
| Official MCP Registry | not listed | listed via downstream directories |

Both repositories sit on the same domain, so the difference is page-level:
age, link and engagement signals, and exact-phrase coverage.

## Gaps found

1. **Not published to the official MCP Registry.** A registry query for
   `io.github.leancoderkavy` returns `count: 0`. Two other Premiere servers are
   listed. The registry is the upstream source for several directory sites that
   already rank on this query, so the absence costs both listings and links.
   This is the largest remaining gap.
2. **Stale tool count in the GitHub repository description.** The description
   reads 344 tools while the published npm artifact exposes 349 and the
   development source exposes 365. The description is also what Google renders
   as the result title for the repository page.
3. **AI Overview attributes the wrong install command.** The Overview shown on
   this query pairs `npm install -g adobe-premiere-pro-mcp` with this project's
   `premiere-pro-mcp --install-cep`, blending two separate projects. The only
   npm package published from this repository is `premiere-pro-mcp`.

## Constraint: the searched phrase is a retired display name

The query string itself is a retired display name under the naming boundary in
[`adobe-marketplace-resubmission.md`](../adobe-marketplace-resubmission.md), and
`scripts/validate-adobe-marketplace-branding.mjs` fails the build if it appears
in `README.md`, either plugin manifest, the Claude manifest, or
`landing/lib/product.ts`. The display name describes compatibility instead of
presenting an Adobe product name as this project's brand.

Keyword work therefore cannot raise exact-phrase density on customer-facing
surfaces, and should not try to. Two observations bound how much that costs:

- The site already reached position 2 on this query while using only the
  compliant display name, so the match does not depend on the literal string.
- Package and repository identifiers such as `premiere-pro-mcp` are stable
  technical identifiers and remain available for npm keywords and URLs.

Treat the naming boundary as fixed. Route ranking effort to registry
publication, directory listings, and answer accuracy instead.

## Actions taken in the repository

- README: an at-a-glance identity table naming the canonical package and the
  exact install commands, plus a FAQ section covering the related queries
  Google lists for this term. Both use the compliant display name.
- `package.json`: added hyphenated identifier keywords.

## Actions that require owner authorization

These are outward-facing and are not performed automatically.

1. **Publish to the official MCP Registry.** Follow
   [`mcp-registry-readiness.md`](mcp-registry-readiness.md): run
   `npm run validate:mcp-registry-metadata` and `npm run preflight:mcp-registry`,
   then `mcp-publisher login github` and
   `mcp-publisher publish registry/server.json`.
2. **Update the GitHub repository description** so it carries a current tool
   count. Keep the compliant display name; the naming boundary applies to this
   customer-facing field as well.
3. **Submit to the directory sites already ranking on this query** once the
   registry listing exists, using only the evidence-bounded facts listed in
   `mcp-registry-readiness.md`.
4. **Request indexing** for the updated home page and repository in Search
   Console, then review query and impression data before making further copy
   changes.
