# Cinematic homepage QA

Local design result: **passed**. Production experiment status: **not launched; correct PostHog project access is unavailable**.

The public homepage is the only redesigned surface. Documentation, guides, privacy, workflow, and product-intake routes retain their existing interfaces. The original homepage remains the control. Original user edits in the main checkout were preserved by using the isolated `codex/cinematic-homepage-ab-20260909` worktree at base `dcafe7a`.

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
| Repository checks | `npm run check` passed, including the TypeScript build, reference inventories, marketing/public manifests, and all 3,235 tests across 171 files |
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
| SEO export | 24 canonical pages, valid JSON-LD, unique metadata, and 410 internal links/anchors passed |
| Initial JavaScript | Control 211,675 bytes gzip; treatment 223,443 bytes gzip; both below the unchanged 240,000-byte budget |
| Text delivery | Negotiated gzip for HTML/CSS/JS; nonce injected before HTML compression; images/video/fonts preserved |
| Local mobile Lighthouse | Performance 91; accessibility 100; best practices 100; SEO 100; LCP 3.5s; TBT 40ms; CLS reported as 0 |

The Lighthouse JSON report completed successfully, but its CLI exited with a Windows EPERM error during temporary-profile cleanup. The reported scores are local simulated-mobile evidence, not production measurements. Raw report: `output/playwright/lighthouse-compressed-final.json`. No live Premiere host execution was part of this website test.

## Experiment verification

A local HTTP PostHog fixture received real SDK flag requests and captures from the production Node server. Browser visits to `/` received both complete assigned documents, with private/no-store caching, the root canonical, indexable metadata, and all four JSON-LD entities. Both variants emitted `$feature_flag_called` after rendering, followed by successful safe-prompt conversion events under the same anonymous visitor identity. The fixture is separate from production analytics.

Automated checks cover signing, identity stability, disabled/unknown flags, provider timeouts, stale-cookie enrollment revocation, exposure-before-conversion ordering, exact action allowlists, real-download classification, privacy signals, bots, cross-origin rejection, wrong variants, oversized bodies, and compression negotiation. DNT/GPC browser visits received control without an experiment cookie.

Live provider configuration, production deployment, and actual production ingestion remain unverified. See the [experiment definition and launch sequence](docs/design/homepage-experiment-launch.md). Do not interpret local fixture events as live PostHog project data.

The connector returned 404 when asked for the previously recorded Premiere project under its current Tradewink organization. A separate browser access check ended when Computer Use could not verify whether the current browser URL was allowed. No further browser input or PostHog mutation was attempted after that stop.
