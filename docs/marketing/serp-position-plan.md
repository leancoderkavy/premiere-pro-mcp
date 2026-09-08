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

1. **Exact query phrase absent from the README.** Before this plan the string
   "Premiere Pro MCP" appeared zero times in `README.md`; every mention used
   the canonical inversion "MCP for Adobe Premiere Pro". The canonical name is
   worth keeping, but the searched phrase needs to appear as a stated alias.
2. **Not published to the official MCP Registry.** A registry query for
   `io.github.leancoderkavy` returns `count: 0`. Two other Premiere servers are
   listed. The registry is the upstream source for several directory sites that
   already rank on this query, so the absence costs both listings and links.
3. **Stale tool count in the GitHub repository description.** The description
   reads 344 tools while the published npm artifact exposes 349 and the
   development source exposes 365. The description is also what Google renders
   as the result title for the repository page.
4. **AI Overview attributes the wrong install command.** The Overview shown on
   this query pairs `npm install -g adobe-premiere-pro-mcp` with this project's
   `premiere-pro-mcp --install-cep`, blending two separate projects. The only
   npm package published from this repository is `premiere-pro-mcp`.

## Actions taken in the repository

- README: alias line under the title, a "Premiere Pro MCP at a glance"
  identity table naming the canonical package and install commands, and a FAQ
  section answering the related queries Google lists for this term.
- `package.json`: added exact-phrase and alias keywords.
- `landing/app/layout.tsx`: home page title now leads with the searched phrase.

## Actions that require owner authorization

These are outward-facing and are not performed automatically.

1. **Publish to the official MCP Registry.** Follow
   [`mcp-registry-readiness.md`](mcp-registry-readiness.md): run
   `npm run validate:mcp-registry-metadata` and `npm run preflight:mcp-registry`,
   then `mcp-publisher login github` and
   `mcp-publisher publish registry/server.json`.
2. **Update the GitHub repository description** so it leads with the searched
   phrase and carries a current tool count.
3. **Submit to the directory sites already ranking on this query** once the
   registry listing exists, using only the evidence-bounded facts listed in
   `mcp-registry-readiness.md`.
4. **Request indexing** for the updated home page and repository in Search
   Console, then review query and impression data before making further copy
   changes.
