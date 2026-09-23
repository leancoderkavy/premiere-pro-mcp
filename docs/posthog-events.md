# PostHog critical-path setup audit

Source audit: 2026-09-22. Draft review only; no deployment, project configuration
changes, purchases, or live Premiere validation. Tests use mocks/local fixtures,
not production ingestion. The local stdio MCP server remains the product; HTTP
auth metrics describe an operator-managed transport, not a hosted user account.

## Events added and confirmed

| Event | Trigger and bounded properties | Audit result |
| --- | --- | --- |
| `marketing_viewed`, `$pageview` | Landing route changes; `path`, campaign attribution | Confirmed. Manual pageviews; unknown routes become `/other`, blog slugs become `/blog/[slug]`. |
| `primary_cta_clicked` | CTA interaction; static `location`, `destination` | Confirmed; an intent, not a completed install. |
| `onboarding_assistant_selected` | Assistant selector; static `assistant` | Confirmed. |
| `onboarding_download_started` | Setup download link clicked; static `route` | Confirmed; does not prove download completion. |
| `onboarding_safe_prompt_copied` | Clipboard write resolves for the first safe prompt | Confirmed; never sends clipboard text. |
| `onboarding_copy_failed` | Setup safe-prompt or installation-command clipboard write fails; `action=safe_prompt\|install_command` | **Added** to both existing setup copy components. No error object, message, stack, or clipboard text. |
| `onboarding_advanced_opened`, `onboarding_recovery_opened`, `marketing_demo_played` | Supporting setup/demo actions; static `demo` where present | Confirmed. |
| `onboarding_workflow_prompt_copied`, `onboarding_workflow_link_copied` | Workflow kit copy success; static `workflow` | Confirmed. |
| `onboarding_project_intake_prompt_copied`, `onboarding_project_intake_template_selected`, `onboarding_project_intake_template_copied` | Intake actions; static `prompt_kind` or `template_kind` | Confirmed; no entered project details. |
| `onboarding_workflow_guide_recommendation_viewed`, `onboarding_workflow_guide_prompt_copied` | Workflow guide actions; static `workflow_type` | Confirmed. |
| `premiere_mcp_activation_completed` | Read-only connection check confirms bridge + project + sequence; `backend`, `activation_stage` | Confirmed; repeated checks can emit repeatedly. |
| `mcp_tool_call` | Registered handler completion/throw; catalog `tool`, `outcome`, `duration_ms`, optional bounded `error_type` | Confirmed; covers core actions and failures without arguments/results. |
| `mcp_connection_attempt` | HTTP auth rejection or authorized request admitted after body parsing; `outcome`, supported HTTP `method` | Confirmed. Not a login/signup or count of every auth check. |
| `mcp_request` | HTTP transport completion/throw; `outcome`, `method`, `status_code`, `duration_ms`, optional bounded `error_type` | Confirmed; HTTP success is not proof of a successful tool mutation. |
| `mcp_request_rejected` | Size/JSON/admission rejection; `outcome`, `status_code`, optional `phase=pre_auth` | Confirmed. No token, principal, request body, or IP properties. |

No landing account/signup or real checkout/payment flow exists. No fabricated
auth, checkout, purchase, or revenue events were added. Automatic exception
capture stays disabled; MCP failures already have operational outcomes.

The optional HTTP homepage experiment separately emits
`homepage_experiment_assigned`, `$experiment_exposure`, mirrors its allowlisted
CTA/setup events, and derives `homepage_setup_downloaded` and
`homepage_safe_prompt_copied`. Its signed anonymous cookie is separate from both
browser SDK and MCP server identities. Filter browser events by `surface=website`
and experiment events by their experiment properties; do not sum mirrored events
as independent conversions. The new copy failure is browser-only; the experiment
endpoint's event allowlist is unchanged.

## Initialization, identity, and privacy

- Browser: `landing/app/layout.tsx` passes build-time settings to deferred
  `landing/public/analytics.js`; `landing/lib/onboarding-events.ts` queues early
  interactions. US/EU cloud ingestion hosts and project-token syntax are checked.
  DNT/GPC and design previews suppress capture; privacy is checked again after
  SDK loading and before sending. There are no `identify`/alias calls.
- Browser hardening in this PR: `person_profiles=never`, explicit disabling of
  exception/dead-click/performance/heatmap capture, automatic campaign/referrer
  collection disabled, and a `before_send` property allowlist. SDK-added URLs,
  referrers, click IDs, `$set`/`$set_once`, and exception payloads are discarded.
  Ingestion token and anonymous SDK routing IDs remain. Use the custom `path`
  property for route reports; `$current_url` is intentionally absent.
- Browser custom properties are product/event/time, normalized route, static
  action identifiers, `surface=website`, and `$process_person_profile=false`.
  First/latest-touch UTM fields retain the existing 80-character character filter.
  Campaign labels must not contain personal identifiers or secrets. Google
  Analytics remains a separate existing integration; the PostHog send filter does
  not govern Google's automatic metadata.
- MCP: `src/telemetry.ts` initializes `posthog-node` only with `POSTHOG_API_KEY`.
  No new opt-in or phone-home path was introduced. Common properties are service,
  version, environment, region, transport, and `$process_person_profile=false`.
  Identity is the configured anonymous ID, Fly machine ID, or a random boot ID.
  No browser/editor identity joining or person profiles. GeoIP disabling is now
  explicit instead of depending on SDK defaults.
- MCP error names are mutable: this PR maps them to a small built-in category
  allowlist (`Error`, `TypeError`, etc.) or `UnknownError`. It never captures
  messages, stacks, prompts, arguments, results, media/project paths, or tokens.
  CLI and HTTP shutdown paths flush the existing client.
- Experiment: `src/homepage-experiment.ts` requires explicit enablement, a project
  token, and a signing secret of at least 32 characters. It validates origin,
  cookie, exposure, request size, event names, and parameter values. It disables
  GeoIP and person profiles and respects DNT/GPC headers.

SDK configuration references: [browser configuration](https://posthog.com/docs/libraries/js/config),
[privacy controls](https://posthog.com/docs/product-analytics/privacy),
[Node SDK](https://posthog.com/docs/libraries/node).

## Setup gaps and operator checks

| Setting / gap | Current behavior and required follow-up |
| --- | --- |
| `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` | Landing has an existing public project-token fallback. Public ingestion tokens are not personal API secrets. Explicitly configure each deployment; use an empty string to disable PostHog in a build. Project ownership and live delivery were not verified. |
| `NEXT_PUBLIC_POSTHOG_HOST` | Defaults to US; only exact US/EU cloud ingestion URLs are accepted. Match the token's region. Self-hosted/proxy browser hosts are not currently supported. |
| `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` | Independent public fallback exists. Set to an empty string as well for an analytics-free preview. Public settings are baked into the static export; changing runtime environment alone does not update it. |
| `POSTHOG_API_KEY`, `POSTHOG_HOST` | Server opt-in project token and ingestion URL (US default). Leave key unset for local/private workflows. Do not use a personal API key. No production environment was read or changed. |
| `POSTHOG_DISTINCT_ID`, `POSTHOG_ENVIRONMENT` | Use non-personal installation IDs and deployment labels. Do not put email, names, paths, or secrets in operator-controlled telemetry settings. |
| `service_version`, `transport` | Version falls back to `unknown` without `npm_package_version`; transport falls back to `unknown` without `PREMIERE_MCP_TRANSPORT`. Confirm deployment metadata when using these dimensions. |
| `HOMEPAGE_EXPERIMENT_ENABLED`, `HOMEPAGE_EXPERIMENT_SECRET` | Optional existing HTTP experiment; keep disabled unless separately authorized. The audit does not enable it or alter flags. |
| Browser SDK delivery | Loads the existing CDN `array.js`; defaults date is configured but asset version is not pinned. Local contract tests do not establish behavior of every future CDN revision. |
| Funnel limits | No individual browser-to-MCP join; no install/payment completion claim. Activation is a readiness check, not unique retention. Diagnostic tool success can mean a completed check reporting `needs_attention`. |
| Delivery / dashboards | Project settings, retention, ingestion, source maps, and dashboard definitions were not inspected. Verify in an authorized nonproduction project before release; no live analytics event was intentionally sent by this audit. |

Validation: privacy tests execute the browser loader with a mocked SDK, including
US/EU loading, early-event flush, privacy changes, hostile SDK enrichment, and
route redaction; MCP tests cover disabled telemetry and hostile error names.
No live Premiere host validation is implied.

## Review validation receipt

- Node 24.21.0; `npm ci` and `npm --prefix landing ci` installed the existing
  lockfiles without dependency edits.
- Targeted Vitest run: 6 files / 28 tests passed (telemetry, telemetry fallbacks,
  landing analytics, marketing analytics, PostHog privacy, MCP modernization).
- `npm run check`: lint, inventories, build, generated catalogs and metadata
  checks passed. Unit tests: 200 files passed, 1 failed; 3,673 tests passed,
  8 failed. All failures are existing `tests/tools/media-watch.test.ts` file
  watchers returning `EMFILE` in this environment. The same eight failures were
  reproduced in a clean `origin/main` source snapshot. The first unauthenticated
  inventory attempt hit GitHub HTTP 403; the authenticated rerun passed inventories.
- `npm run test:coverage`: same eight watcher failures; coverage gate not verified.
- `npm --prefix landing run lint` and `npm --prefix landing run build`: passed,
  including static export and performance budgets.
- Local Playwright at `http://127.0.0.1:3160/`, 1440×1000: homepage rendered,
  setup copy rejection showed the existing clipboard-unavailable message,
  exactly one `onboarding_copy_failed` was captured with no success event, and
  sensitive URL/error data was absent. No page exceptions or framework overlay.
  Browser plugin was unavailable; regular Playwright used the existing local
  fixture and a mocked browser SDK, blocking external network requests.
- Live PostHog ingestion, live Premiere, other browser engines, and mobile
  layout were not verified. Hold merge pending normal CI and review.
