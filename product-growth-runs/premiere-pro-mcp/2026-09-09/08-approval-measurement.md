# Execution and measurement

Product: MCP for Adobe Premiere Pro. Market: local Premiere editors and developers.
Date: September 9, 2026. Scope: organic adoption and named-repo comparison.
Status: local verification passed; external outcomes not yet established.

Local evidence for this implementation:

- `npm run check`: 171 files, 3,224 tests passed, including build, inventories,
  source/release metadata, branding, registry metadata, and documentation checks.
- Focused configuration/measurement checks: 22 tests passed. A generated entry
  launched this package's `--version`; generated Codex TOML also parsed with an
  independent TOML parser. No real AI-client acceptance is claimed.
- Landing lint, production build and performance budget passed. SEO export check:
  25 canonical pages, unique titles/descriptions, valid JSON-LD, 428 internal
  links and anchors.
- `npm run pack:check` passed its package-content and isolated-install checks.
- Playwright on the production HTTP server locally: 1440px desktop and 390px
  mobile, one H1, correct canonical, no horizontal overflow, FAQ click/keyboard
  interaction, and navigation into the setup guide. The production server had no
  console errors in this pass. The initial generic Python preview server lacked
  Next Flight filename remapping, so final navigation checks used the actual
  application server. Screenshots remain local under `output/playwright/`.
- Current remote main was still `dcafe7a965a2a50648cd166a62f015ad810870c6`
  when these results were prepared. CI, deployment, new release and licensed-host
  results remain separate checks.

Refresh the public baseline from this checkout:

```sh
npm run growth:scorecard -- --output docs/marketing/competitive-baseline-YYYY-MM-DD.json
```

Choose a new filename for every run. Existing snapshots are never overwritten.
The script reads public GitHub repository counts and npm downloads only, records
their sources and date ranges, and exits unsuccessfully if a required measurement
is unavailable. Failed requests leave nulls, never fabricated zeroes. It makes no
search-engine, user-count, or licensed-host claims.

| Outcome | Baseline | Decision rule |
| --- | --- | --- |
| Stars | 240 vs 530; relative lead -290 | Overtake by at least one and sustain the lead across weekly snapshots |
| Growth pace | No same-method weekly trend established | Working target: improve relative lead by at least 25/week; 12 such weeks would overcome today's gap. This is an experimental target, not a forecast |
| npm distribution | 1,897 vs 1,123, August 31–September 6 | Compare only equal API date ranges; do not infer unique installs |
| Search | No fresh controlled rank or GSC baseline | Compare full equal windows and documented query/locale/device samples |
| Activation | No current first-run completion rate measured | Measure successful connection and first useful workflow; do not divide downloads by stars |
| Workflow quality | No comparative licensed-host runs in this task | Same fixture; exact versions; expected vs observed result; Undo, reopen and output inspection |

The weekly review should answer: what changed, which step improved or failed,
which evidence supports the explanation, and which one change to test next.
Keep raw private Search Console or telemetry exports outside public Git. Existing
browser and runtime events do not establish a shared editor identity.

Before any public workflow campaign, use `docs/workflow-proof-runbook.md` and
`docs/workflow-proof-receipt.template.json`. Record synthetic/local evidence first.
Then prepare a single demonstration and a relevant destination; request a star
only after the reader has received useful material. No contacts, posts, ad spend,
or paid media generation were performed in this run.

Next actions: review the implementation, verify deployment after approval, then run
the existing host-proof workflow and repeat the measurements.
Owner: repository maintainer.
Approval needed: merge/deploy/release and specific external outreach. The source
helper must remain marked unreleased until the package release includes it.
Completion criteria: tested changes reviewed now; star/search objectives remain
open until later measurements demonstrate them.
