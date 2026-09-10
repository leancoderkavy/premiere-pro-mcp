# Search discovery implementation: September 10, 2026

## Evidence and decision

The public baseline at `competitive-baseline-2026-09-10.json` records 245 GitHub stars for this repository and 535 for hetpatel-11's repository. The unauthenticated GitHub REST best-match query `premiere pro mcp` returned this repository second and the comparison repository first. This is one API query sample, not Google rank, Trending, or a personalized browser result. For August 31–September 6, npm reported 1,897 and 1,123 downloads respectively; downloads do not measure unique active editors.

Ahrefs API v3 was queried on September 10, with US keyword scope and Site Explorer date September 9. `keywords-explorer-overview` returned these average monthly estimates:

| Query | US volume | Global volume |
| --- | ---: | ---: |
| premiere pro mcp | 70 | 350 |
| adobe premiere pro mcp | 20 | 100 |
| premiere mcp | 20 | 90 |
| premiere pro automation | 50 | 70 |

The tools, Cursor, and Codex variants were omitted from the response; no volume is inferred for them. `serp-overview` returned no positions for `premiere pro mcp`. Site Explorer reported zero indexed keyword/traffic estimates for both `premiere-pro-mcp.com` and `premiere-mcp.com` using `mode=subdomains`; these are Ahrefs coverage estimates, not evidence of zero real traffic. No Premiere project was available through the connected Ahrefs project list, so no current GSC measurement was obtained from that connector. No Google ranking or ranking gain is claimed.

The live site still lacked the already-merged package comparison from PR #485 at inspection. Existing live setup examples used a global executable shared by the two npm packages. The site described tool categories but sent readers elsewhere for the complete tool reference. These observed gaps justify the implementation more directly than creating additional overlapping keyword articles.

## Changes

- Publish `/tools/`: searchable source tool names, descriptions, action modes, availability filters, and individual anchors. Render every entry in initial HTML, including when JavaScript is disabled.
- Generate `/tool-catalog.json` from the existing source-derived supported-actions catalog. Validate tool uniqueness, surface counts, normalized source digest, and format. The existing registered-tool check continues to verify the catalog against MCP registration; marketing generation checks the site representation.
- Link the reference from the README, website footer, documentation, comparison, sitemap, and machine-readable references.
- Add one distinct Cursor setup guide using current official configuration documentation, local host requirements, a versioned package entry, connection verification, and recovery steps.
- Replace ambiguous global startup examples in the main setup flow, docs, and relevant guides with this project's versioned npm package.
- Offer workflow evaluation and an optional GitHub star after the useful reference. No incentive, access restriction, bulk outreach, or artificial engagement.

The source catalog may include unreleased changes even when its version string matches npm. These website changes do not publish a new npm version and do not establish execution inside a licensed Premiere host.

## Validation and measurement

Required before merge: generator and search tests, root checks, landing lint/build/performance, export checks for canonical URLs and every tool anchor, desktop/mobile interaction checks, and all required PR CI checks. Deploy the resulting main commit and inspect the live reference, Cursor guide, comparison page, redirects, and HTTP health separately.

After indexing and a complete comparable observation window, inspect query/page clicks and impressions in the existing private GSC scorecard. Keep setup/kit/GitHub click measurements separate from stars and installed editors. No experiment or ranking effect is asserted on launch day.

## Primary sources

- [Our repository](https://github.com/leancoderkavy/premiere-pro-mcp) and [comparison repository](https://github.com/hetpatel-11/Adobe_Premiere_Pro_MCP): live GitHub API baseline linked above.
- [Existing supported-actions catalog](../supported-actions.md) and [published release provenance](../../landing/lib/published-release.json): separate source and package facts.
- [Cursor MCP configuration](https://cursor.com/docs/mcp): inspected September 10 for local stdio, JSON settings, and configuration scopes.
- [npm package execution](https://docs.npmjs.com/cli/v11/commands/npx/): versioned package selection.
- [Ahrefs API reference](https://docs.ahrefs.com/docs/api/reference/introduction): results above were obtained from the connected Ahrefs API tools, not inferred from search-result ordering.
