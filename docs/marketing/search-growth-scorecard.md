# Search growth scorecard

First run: September 8, 2026. Scope: `premiere-pro-mcp.com` and
`leancoderkavy/premiere-pro-mcp`. Continue the existing
[90-day growth plan](90-day-growth-plan-2026-09-04.md); prioritize measured defects
and improvements to existing pages before adding overlapping guides.

## Baseline and first improvement

| Check | Live observation before this change | Action or measurement boundary |
| --- | --- | --- |
| Sitemap | 24 URLs, all HTTP 200 | Keep canonical URLs crawlable. |
| Page identity | All 24 returned one H1 and a matching canonical URL | Preserve existing page identity. |
| Indexing directives | No `noindex` in the inspected HTML or `X-Robots-Tag` headers | Crawl eligibility does not establish Google indexation. |
| Duplicate URLs | The explainer article returned HTTP 200 at `www`, without its trailing slash, and at `/index.html` | Permanently redirect real exported page aliases to one canonical address, preserving query parameters. |
| Missing page | An intentionally nonexistent path returned HTTP 404 | Keep missing routes outside canonical redirects. |
| Search crawlers | Live robots allows public pages, including OAI-SearchBot, Claude-SearchBot and PerplexityBot | Preserve MCP and health exclusions. Training crawler access is separate from search visibility. |
| Repository identity | GitHub API returned the correct homepage, current workflow description and relevant topics | Add prominent website, setup, troubleshooting and release-facts links to the README. |
| Public search sample | Quoted domain and branded repository queries surfaced the repository and third-party listings, including stale tool counts and package availability claims | A discovery sample, not a rank, traffic estimate, or complete index inventory. Do not copy third-party claims into product facts. |
| GSC standard and AI reports | Not measured in this run | Obtain authorized reports before claiming clicks, impressions, CTR, position or AI citation changes. |
| Field performance and AI answer citations | Not measured | Do not substitute build budgets or public search snippets for field metrics or sampled AI answers. |

The HTTP change applies only after resolving a real exported `index.html` inside
the static root. It consolidates page paths and the two known public host aliases
(`www.premiere-pro-mcp.com` and `premiere-pro-mcp.fly.dev`) in one hop. Local and
self-hosted origins stay local. Assets, missing pages, health, OAuth discovery and
MCP transport requests retain their routing. Query parameters are preserved.

## Repeat each morning

1. Refresh main and inspect pending search-growth PRs before creating work.
2. Recheck sitemap pages, canonical targets, response directives, duplicate-path
   redirects, missing routes, and relevant internal links. Run the export check
   after a landing build: `node landing/scripts/check-seo-export.mjs`.
3. Read authorized GSC reports using complete comparable 7-day and 28-day windows.
   Save private query/page exports outside public Git. Record the data-through
   date, device/country filters, brand/nonbrand split, and hidden query coverage.
   Treat average position as an average, never a fixed search rank.
4. Keep public search and AI samples separate: exact query, engine, date, locale
   when known, observed URL, brand mention, and claim accuracy. An unknown locale
   or missing result remains unknown. Repeat unexpected observations.
5. Implement justified improvements, verify and merge the exact tested PR head,
   then confirm resulting-main CI, the deployed image and live behavior. Record
   merge/deployment evidence in the PR. Technical delivery and later search
   outcomes are separate milestones.

## Sources checked September 8, 2026

- [Google canonicalization guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls): redirects and canonical annotations are complementary signals for consolidating duplicate URLs.
- [Google generative AI search guidance](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide): prioritize useful original content and technical SEO; special AI text files and inauthentic mentions are not a substitute.
- [Live sitemap](https://premiere-pro-mcp.com/sitemap.xml) and [robots policy](https://premiere-pro-mcp.com/robots.txt).
- [Repository](https://github.com/leancoderkavy/premiere-pro-mcp) and [release facts](https://premiere-pro-mcp.com/facts/).

No ranking improvement is claimed by this implementation. The initial run has no
comparable GSC baseline or verified AI citation baseline.
