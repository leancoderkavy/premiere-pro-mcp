# Homepage design experiment

Status: implemented and verified locally; **draft created, inactive, and not launched** in owner organization `leancoderkavy`, project `528794`. [Open the experiment](https://us.posthog.com/project/528794/experiments/462966).

The connector's organization inventory resolved the earlier access problem. Experiment `462966` and its automatically linked flag `876869` were read back after creation: status `draft`, flag `active: false`, no start date, and equal control/test variants. Production deployment, runtime token destination, conversion metrics, and homepage-event ingestion still require verification before launch.

## Definition

| Setting | Value |
| --- | --- |
| Name | Premiere homepage — cinematic studio |
| Feature flag key | `homepage-cinematic-2026` |
| Control | `control`: existing homepage |
| Treatment | `test`: complete cinematic studio homepage |
| Intended split | Equal control/test split across eligible homepage visitors |
| Exposure | `$experiment_exposure`, matching the draft's verified `resolved_exposure_event`; sent only after visible rendering |
| Primary metric | Exposed visitors who click a real setup download, measured by `homepage_setup_downloaded` |
| Secondary metric | Exposed visitors who successfully copy the read-only first prompt, measured by `homepage_safe_prompt_copied` |
| Metric interpretation | Setup intent; neither metric verifies installation or a working Premiere host |
| Product filter | `product = premiere-pro-mcp` |

Hypothesis: the clearer visual workflow and client-specific installer increase setup intent without compromising accessibility, privacy, or loading performance. Use visitor-level conversion, not total event counts: a visitor can click more than one download or copy the prompt repeatedly. Select and document the conversion window before launch, using the project's actual traffic baseline.

The two outcome names are newly implemented events, verified against a local PostHog HTTP fixture. They were **absent** from the production project's schema during the September 10 UTC check, so the draft has no configured metrics yet. Recheck the schema after controlled production ingestion, reuse any equivalent saved metrics, and configure visitor-level conversion metrics before launch. Do not silently allow unknown events, fabricate production ingestion, or create a duplicate experiment.

## Runtime configuration

The existing `POSTHOG_API_KEY` and `POSTHOG_HOST` select the PostHog destination. Confirm that destination independently before enabling this test. The browser never receives the project key or signing secret.

- `HOMEPAGE_EXPERIMENT_ENABLED=true` enables assignment only when the other configuration is valid.
- `HOMEPAGE_EXPERIMENT_SECRET` must contain at least 32 characters of cryptographically random secret material. Use the same value on every running machine. Generate and store it through the deployment provider's secret mechanism; do not commit it.
- A false, missing, unknown, or unavailable flag serves the existing control without recording exposure. Flag evaluation is limited to 450 ms, with a bounded 60-second decision cache. A disabled runtime gate takes effect when processes restart; flag changes propagate after cached decisions expire.
- The signed `premiere_homepage_v1` cookie is HTTP-only, Secure, SameSite=Lax, and valid for 30 days. It contains only a random visitor ID, assignment, timestamp, and exposure acknowledgement.
- Events use a separate visitor identity, not the MCP server's operational identity. The collector accepts a small explicit event/value allowlist, validates origin and signed assignment, limits payloads to 1 KB, and applies a per-visitor rate limit.
- Each capture explicitly requests an asynchronous SDK flush, including pending event preparation. The collector acknowledgement does not wait for PostHog ingestion; visitors are not blocked by the analytics provider.
- DNT, GPC, known crawlers, and headless automation do not enroll. Both assignment and events fail closed when analytics is disabled. Preview routes are excluded from Google Analytics and the experiment.

## Review and launch sequence

1. Select owner organization `leancoderkavy`, project `528794`, and verify the runtime token's destination independently. This project also contains other MCP products' events; preserve the `product = premiere-pro-mcp` boundary.
2. Reuse draft experiment `462966` and flag `876869`. Read back the equal split, inactive flag, and resolved exposure event before adding conversion metrics. Do not create another experiment for the same key.
3. Deploy the reviewed code with the runtime gate off. Verify both complete documents, existing root behavior, security headers, canonical/JSON-LD, downloads, keyboard/mobile behavior, and byte budgets on the deployed host.
4. Configure the shared signing secret and runtime gate. Keep the flag inactive until the provider setup and controlled ingestion checks are ready. Configure the conversion metrics and test-account exclusions against the verified project schema.
5. Launch through PostHog, then verify assignment and exposure-to-conversion ordering on production. Record the exact deployment SHA, PostHog experiment URL, and provider ingestion evidence. Local fixture evidence does not replace this step.
6. Evaluate visitor-level results after an appropriate sample and observation window. Do not call a winner from a handful of downloads or early fluctuations.

## Review URLs

- `/?design=test` renders the new complete page without experiment enrollment.
- `/?design=control` renders the original page without experiment enrollment.
- `/design-preview/` is the exported treatment document, served with a `noindex` response header.
- `/` uses normal PostHog assignment when configured; otherwise it serves control.

Root assignment is private and non-cacheable. Preview exclusion uses the Node server's `X-Robots-Tag` header; both exported documents contain indexable metadata so hydration cannot accidentally noindex the assigned root. Both variants share the same canonical URL and Organization/WebSite/SoftwareApplication/FAQ structured data. Return links use `HomeLink` to load the server-selected document; Next's static root Flight payload always contains the control.

## Repeatable local end-to-end test

After installing root and landing dependencies, run `npm exec --prefix landing -- playwright install chromium` once, then `npm run test:landing:e2e` from the repository root. The command builds the actual Node server and static site, then runs 32 Playwright tests. `npm --prefix landing run test:e2e` reuses those compiled outputs for a faster rerun.

On Windows installations that require the system certificate store for Adobe reference fetches, set `$env:NODE_OPTIONS='--use-system-ca'` before running repository checks.

The test harness owns loopback ports 3160 and 3161 by default, with optional `LANDING_E2E_PORT` and `LANDING_E2E_POSTHOG_PORT` overrides. It sets `MCP_HTTP_HOST=127.0.0.1`, refuses to reuse an already running server, uses a temporary bridge directory and an in-memory context store, and sends analytics only to its local HTTP fixture. Download responses contain a harmless fixture payload. MCP discovery uses the actual authenticated local server and does not invoke Premiere tools.

The landing CI job runs the same suite after the build. Failed runs retain the Playwright HTML report, screenshots, and traces for seven days.

## Rollback

Disable the experiment flag, or set `HOMEPAGE_EXPERIMENT_ENABLED=false` and restart the deployment. The original homepage is still present. Allow up to 60 seconds for flag-decision cache expiry. Preserve experiment records so results can be interpreted against the actual stop time.

References: [PostHog experiment exposures](https://posthog.com/docs/experiments/exposures), [adding experiment code](https://posthog.com/docs/experiments/adding-experiment-code).
