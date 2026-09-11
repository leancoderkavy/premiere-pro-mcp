# Cinematic homepage QA

Latest local visual revision: [Apple-inspired homepage refinement](docs/design/apple-homepage.md), September 10, 2026. Its checks and screenshots cover the Premiere palette, centered hero, light feature/setup sections, and responsive composition. The report below records the earlier pre-launch QA state; its production status is historical and must not be read as the current provider state.

Local design result: **passed**. Production experiment status: **draft created; inactive and not launched**. [PostHog experiment](https://us.posthog.com/project/528794/experiments/462966).

The public homepage is the only redesigned surface. Documentation, guides, privacy, workflow, and product-intake routes retain their existing interfaces. The original homepage remains the control. Original user edits in the main checkout were preserved by using an isolated worktree. The initial design landed in PR #486; the follow-up QA fixes use `codex/homepage-e2e-repo-fixes-20260909`, rebased onto main `bf06352`, including Next.js 16.3.3 and PR #489's searchable tool reference and versioned setup commands.

## Visual evidence

- Direction and composition: [design specification](docs/design/cinematic-homepage.md).
- Desktop: [1440px capture](docs/design/cinematic-desktop.webp).
- Mobile: [390px capture](docs/design/cinematic-mobile.webp).
- Original artwork, optimized assets, and generation prompt: [asset notes](docs/design/cinematic-assets.md).
- All seven full-page captures and browser scripts remain in the local `output/playwright/` folder. The baseline capture was taken directly from the public root before implementation.

The rendered design follows the studio target across the hero, workflow chapters, walkthrough, local bridge diagram, installer, FAQs, final CTA, and footer. The hero combines original cinematic artwork, spatial film/timeline layers, a real Three.js scene on capable desktop devices, and accessible HTML annotations. Mobile uses a smaller image and a perspective composition. No customer proof or live Premiere recording was invented.

## Verification

| Check | Result |
| --- | --- |
| Repository checks | Lint, TypeScript build, reference inventories, marketing/public manifests, and all 3,265 tests across 174 files passed |
| Repeatable end-to-end suite | 34 Playwright tests passed against the compiled Node server, static site, actual MCP discovery, and local PostHog HTTP fixture |
| Landing checks | ESLint and production static-export build passed |
| Responsive widths | 320, 360, 390, 430, 768, 1024, and 1440px; no horizontal overflow; one main and one H1 |
| Workflow controls | Three Radix tab panels; keyboard activation verified |
| Installer | Client routes, actual download destinations, successful clipboard contents, advanced setup, and recovery |
| Mobile navigation | Dialog opens; Escape closes it; focus returns to the trigger |
| FAQ | Accordion answers and keyboard controls verified |
| Motion | Global pause, reduced-motion default, and offscreen/hidden suspension |
| Fallbacks | Forced WebGL context loss restores the HTML artwork; no-JavaScript content remains readable |
| Video | User-initiated illustrated walkthrough played; 10-second video, readyState 4, muted |
| Console | No application errors in the final browser passes; normal WebGL disposal notices are informational |
| Axe | Zero violations in desktop and mobile scans; visible-label/accessibility-name refinements also verified with Lighthouse |
| SEO export | 27 canonical pages, valid JSON-LD, unique metadata, and 926 internal links/anchors passed |
| Initial JavaScript | Control 199,542 bytes gzip; treatment 209,639 bytes gzip; both below the unchanged 240,000-byte budget |
| Production packaging | Docker image built successfully; health, control, and treatment returned 200 in a container limited to 256 MB; gate-off root did not enroll |
| Text delivery | Negotiated gzip for HTML/CSS/JS; nonce injected before HTML compression; images/video/fonts preserved |
| Initial design mobile Lighthouse | Performance 91; accessibility 100; best practices 100; SEO 100; LCP 3.5s; TBT 40ms; CLS reported as 0 |

The Lighthouse JSON report completed successfully, but its CLI exited with a Windows EPERM error during temporary-profile cleanup. These are local simulated-mobile scores from the initial design pass, before the subsequent end-to-end fixes. The final pass reran responsive/axe checks, SEO export, and unchanged byte budgets. Raw Lighthouse report: `output/playwright/lighthouse-compressed-final.json`. No live Premiere host execution was part of this website test.

## Repository-focused end-to-end findings

The follow-up verification found and fixed six issues:

1. Next client navigation from other pages returned the exported control to visitors assigned treatment. `HomeLink` now requests the server-selected document. Both variants retain identity, layout, and conversion tracking after return visits from Docs, Tool Reference, Workflows, Project Intake, Blog, Facts, Changelog, and Privacy.
2. Pause/resume could reuse a previous canvas's ready state before its replacement finished initializing. Readiness now resets on disposal and waits for a rendered frame; forced context loss after resuming restores the HTML artwork without an uncaught error.
3. Hydration could reinsert the preview's `noindex` metadata into an assigned homepage. Preview exclusion now resides in the HTTP response header, while both hydrated documents remain indexable at the root.
4. The documented safe first prompt names `verify_premiere_connection`, but the server's MCP discovery hints previously marked it non-read-only. The verified read-only handler now receives matching metadata. The E2E client confirms that tool and every workflow starter-kit tool exist in the actual local server catalog.
5. The newly created PostHog experiment resolves its exposure event to `$experiment_exposure`. The collector and tests now use that exact event, with the flag key and assigned variant, instead of the legacy event name. This was verified from experiment 462966's settings, not inferred from generic documentation.
6. Repeated end-to-end runs exposed intermittent SDK delivery delays after the browser received its exposure acknowledgement. Each capture now explicitly requests an asynchronous flush that includes pending event preparation. A concurrent-visitor check verifies exposure-before-conversion delivery for twelve independent identities without sending another event to drain the queue.

The treatment now includes the repository's Codex plugin route, searchable tool reference, and shared versioned manual setup commands, and clearly distinguishes the local bridge from the assistant's separate processing/privacy settings. Published version, tool count, release download paths, and copied prompts are checked against the repository's own metadata and README. The Docker context excludes the browser harness and generated QA artifacts; production images support an exact-source revision label.

Run `npm run test:landing:e2e` from the repository root. The suite also covers touch navigation, keyboard tabs, clipboard success/failure, download intent, disabled/unavailable flags, DNT/GPC/crawlers, preview exclusion, no-JavaScript content, exposure-before-conversion ordering, gzip/CSP, and collector rejection paths. Rebased-main verification: `output/playwright/rebased-main-e2e.log` (34 passed), `output/playwright/rebased-repository-check.log` (full check including 3,265 tests passed), and `output/playwright/production-docker-build.log`. Earlier local logs: `output/playwright/e2e-main-pass.log`, `output/playwright/e2e-main-landing-build.log`, `output/playwright/e2e-main-repository-check.log`, and `output/playwright/e2e-main-repository-tests.log`. The first combined check hit one Adobe inventory test timeout during concurrent browser work; the separate full repository test run passed without increasing the timeout. Windows reference fetches used Node's `--use-system-ca` option, with TLS verification enabled.

## Experiment verification

A local HTTP PostHog fixture received real SDK flag requests and captures from the production Node server. Browser visits to `/` received both complete assigned documents, with private/no-store caching, the root canonical, indexable metadata, and all four JSON-LD entities. Both variants emitted `$experiment_exposure` after rendering, followed by successful safe-prompt conversion events under the same anonymous visitor identity. The fixture is separate from production analytics.

Automated checks cover signing, identity stability, disabled/unknown flags, provider timeouts, stale-cookie enrollment revocation, exposure-before-conversion ordering, exact action allowlists, real-download classification, privacy signals, bots, cross-origin rejection, wrong variants, oversized bodies, and compression negotiation. DNT/GPC browser visits received control without an experiment cookie.

The owner organization `leancoderkavy` and project `528794` are now accessible. Draft experiment `462966` and linked flag `876869` exist with equal control/test variants, `active: false`, and no start date. The project's schema does not yet contain the new homepage conversion events, so metrics were not configured with unknown events. The production capture token fingerprint matches project `528794`; the runtime gate remains off. Production deployment and actual homepage-event ingestion remain unverified. See the [experiment definition and launch sequence](docs/design/homepage-experiment-launch.md). Do not interpret local fixture events as live PostHog project data.

The earlier connector attempt used the wrong active organization and returned 404. A later read-only organization inventory exposed the owner organization; selecting it and the verified project resolved connector access. Provider setup used the PostHog connector. The earlier Computer Use browser access check was not resumed.
