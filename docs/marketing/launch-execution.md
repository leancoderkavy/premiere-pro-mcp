# Workflow launch execution

## Conversion contract

Technical Premiere editor → check a disposable sequence before handoff → compare a bounded report with visible state. Primary free entry: **Download starter kit** at `/workflows/`. First value is an observed correct report, not a copied prompt, download, or runtime-ready event. Retention artifact: a reusable public recipe. No paid offer is part of this change.

## Delivered in this PR

- Published v1.14.8 counts checked against the npm tarball and tag, separately from current development source.
- Generated HTML inputs, `marketing-facts.json`, and AI references with a stale-output gate in root checks and the landing build.
- Three public evaluation recipes, synthetic MP4 fixtures, caption sample, instructions, and ZIP download without signup.
- Sequence-check, frame-export, and preview-only assembly paths, with copy failure recovery and a public recipe link that includes no project information.
- Setup troubleshooting, sitemap/navigation wiring, and task-specific starter-kit links from four existing guides.
- Draft launch assets, experiment register, scorecard, and fixed AI-discovery prompt set.

## Evidence and open work

| Work | State | Completion evidence |
| --- | --- | --- |
| Released count provenance | npm tarball and tag inspected | `landing/lib/published-release.json` |
| Synthetic kit media | Generated and ffprobe-checked | `fixture-manifest.json` inside downloadable ZIP |
| Browser and build checks | See PR validation results | Local output and CI |
| Native Premiere fixture project | Not created | Requires a real host; kit documents manual construction |
| Actual workflow recording | Not run | Uncut fixture-only capture, version matrix, and reviewed receipt |
| Five independent installs | Not run | Consented tester reports with actual failures and results |
| Social/educator publication | Draft only | Verify deployed URLs and recording before sending |
| Registry publication | Prepared by existing registry work; not published here | Exact public listing matching the published artifact |
| Search Console/Bing metrics | Not queried | Owner-account reports; never infer indexing from HTTP 200 |

No running Premiere process was observed during implementation. Static content, media-file checks, browser tests, and mock/contract tests must not be relabeled as real-host proof.

## Maintain release facts

`release-metadata.json` describes the source checkout. `landing/lib/published-release.json` is a separately reviewed snapshot of an actual distributed release. Advance it only after checking the published artifact, matching tag, and provenance. Update all fields together, including integrity and review date. Then run:

```sh
npm run marketing:generate
npm run marketing:check
```

Do not use a package-version bump alone to update public counts or download claims. Public downloads and software metadata use the published snapshot. Development counts remain explicitly labeled. The existing `public-product-manifest.json` is a source-generated manifest, not a public release receipt.

Generate the fixture ZIP with `python scripts/build-workflow-starter-kit.py` (Python 3, FFmpeg and ffprobe required). Its recipe JSON must match `landing/lib/workflow-kits.json`; rebuild after changes. Generated media may differ across FFmpeg builds, so validate content and record hashes rather than assuming cross-encoder byte identity.

## Launch materials

For a real recording: result in seconds 0–3; setup/context in 3–10; preview in 10–25; application and playback in 25–45 only when actually performed; public kit link in the final seconds. Keep an uncut version and label time compression. Until then, publish only an accurately labeled evaluation-kit announcement.

**Evaluation-kit announcement draft:**

> We added a downloadable Premiere MCP evaluation kit: two synthetic clips, three prompts, and a checklist. Try a read-only sequence check, prepare a frame export, or preview an assembly on a disposable project. The kit has not yet been host-verified; reproducible successes and failures are welcome. No email required: https://premiere-pro-mcp.com/workflows/

**Post-recording tutorial title:** “Connect an AI assistant to Premiere: project check, preview, and result.” Use only the steps shown in the real recording.

**Educator draft, not sent:**

> I maintain MCP for Adobe Premiere Pro. We prepared a small evaluation kit with synthetic clips, explicit prompts, and setup recovery steps. If it fits your Premiere tutorials, you can test it independently and explain both successes and limitations. The kit is at [verified deployed URL].

Before distributing, verify the exact deployed `/workflows/`, `/docs/troubleshooting/`, and ZIP URLs. Start with owned GitHub/social surfaces, then individualized relevant educator/community contributions. No bulk messaging, paid placements, or endorsements are part of this PR.

## Experiments

| ID | Audience / channel | Hypothesis | Control → treatment | Primary measure | Diagnostic / decision | Dependency | State / owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| workflow-hook-01 | Editors / short video | Result-first opening attracts qualified visitors | Problem-first → result-first opening | Kit-entry actions per 1,000 views | Review at 1,000 views/variant or two weeks; sparse results directional | Actual recording, live destination | Draft / maintainer |
| workflow-entry-01 | Guide readers / organic | Sample media makes evaluation more concrete | Install link → kit link | Kit/browser next-step actions | Compare voluntary completion feedback separately | Browser events; no browser-runtime identity join | Prepared / maintainer |
| workflow-fit-01 | Voluntary testers / direct | Sequence check is easier to repeat | Sequence check → frames or preview | Observed seven-day repeat use | Investigate setup failure before broadening traffic | Consented tester cohort | Not run / maintainer |

Event mapping: kit download uses existing `primary_cta_clicked` with `destination=starter_kit_download`; successful prompt and recipe-link copies use `onboarding_workflow_prompt_copied` and `onboarding_workflow_link_copied`. Only a fixed workflow ID is added. Existing privacy controls, first-touch attribution, and analytics-off behavior apply. Copy failure sends no success event.

Use the scorecard CSV without names or project data. Empty means unmeasured, not zero. Sampled tester and anonymous browser/runtime metrics have different denominators; do not construct a user-level conversion funnel from them.
