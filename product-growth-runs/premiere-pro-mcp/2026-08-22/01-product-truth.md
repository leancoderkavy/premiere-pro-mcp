# Product truth

**Product:** Premiere Pro MCP
**Market:** Professional Adobe Premiere Pro workflow automation
**Date:** 2026-08-22
**Research scope:** Current repository and public-package truth; not a marketplace, host, or customer-validation report.
**Status:** Product facts verified against current local repository head and public APIs where noted.

## Product truth table

| Fact | Source | Confidence | Allowed use | State |
|---|---|---:|---|---|
| Current package/release reference is v1.11.5. | SRC-001 | High | Say “v1.11.5 release”; recheck before a later release announcement. | verified |
| The project documents 287 registered core tools across 33 modules, four resources, and ten workflows. | SRC-001 | High | Supporting proof below outcome-led copy. | verified |
| The default profile exposes 285 core tools; a connected UXP host brings the documented surface to 335. | SRC-001, SRC-002 | High | State with capability/host qualification. | verified |
| The recommended first request is a read-only `verify_premiere_connection` check. | SRC-001, SRC-002 | High | Use as primary activation CTA. | verified |
| The product is free and MIT-licensed. | SRC-001 | High | State in Community offer. | verified |
| The server and connector run locally in the recommended setup; the chosen AI client's own privacy behavior remains separate. | SRC-001 | High | Say “local-first” with the AI-client qualification. | verified |
| Privacy-safe telemetry is optional and disabled without `POSTHOG_API_KEY`. | SRC-001 | High | Describe only as product capability; do not claim production telemetry is active. | verified |
| Draft PR #197 proposes local-first editorial plans, guarded UXP organization, and cutdowns. | SRC-005 | High | Say “draft” or “planned”; never market as released. | verified |
| npm returned 6,184 package downloads during 2026-07-23..2026-08-21. | SRC-004 | High | Discovery signal only, with exact date range. | verified |
| GitHub API returned 210 stars and 33 forks. | SRC-003 | High | Community discovery signal only. | verified |

## Product boundaries

| Boundary | Correct statement | State |
|---|---|---|
| Host behavior | Supported action registration is not a guarantee that a particular Premiere version, connection state, authority profile, or host operation will succeed. [SRC-002] | verified |
| Real-host proof | PR #197 is a draft and must be tested on licensed Premiere hosts before a real-edit or production-readiness claim. [SRC-005] | pending live verification |
| Privacy | “Local-first” does not alter the privacy terms or remote behavior of the selected AI client. [SRC-001] | verified |
| Commercialization | No paid companion, design-partner program, subscription, checkout, or commercial terms were found as current shipped product facts. | pending live verification |
| Marketplace | This run did not verify a current Adobe Marketplace listing state. | pending live verification |

## Unverified claims — do not use in approved copy

| Claim | Why restricted | State | Validation path |
|---|---|---|---|
| “Production-ready for client work” | No current licensed-host matrix or customer proof was supplied. | pending live verification | Versioned host test reports and customer approval. |
| “Saves hours” | No Premiere Pro MCP customer time study is in evidence. | pending live verification | Baseline/time-on-task study with consent. |
| “Editor approved” | No attributable, approved testimonial was supplied. | pending live verification | Written approval and case-study release. |
| “Works with every Premiere workflow” | Capability is host-, version-, and authority-dependent. [SRC-002] | disproven as universal claim | Use specific supported workflow and host bounds. |
| “Available on Adobe Marketplace” | Marketplace state was not live-verified. | pending live verification | Verify vendor portal and public listing URL. |

## Approved conversion action

The only current product CTA suitable for broad public use is: **“Run the read-only safe connection check.”** It maps to an existing documented command and avoids claiming that a mutation will succeed (`INS-001`). [SRC-001]

## Next actions

1. Create a versioned public-claims registry before changing marketing copy (`INS-001`).
2. Add a host-matrix evidence table for every workflow intended for marketing (`INS-003`).
3. Verify all distribution states at action time, not from prior notes.

**Owner:** Product marketing and engineering leads
**Approval needed:** Approval before any new product, privacy, compatibility, marketplace, or commercial claim is published.
**Completion criteria:** Every public claim is assigned an evidence state, exact source, owner, and revalidation trigger.
