# Approval and measurement plan

**Product:** Premiere Pro MCP
**Market:** Professional Adobe Premiere Pro workflow automation
**Date:** 2026-08-22
**Research scope:** Launch gates, claim governance, privacy-aware measurement, and weekly learning loop.
**Status:** Draft operating plan; no tracking changes, publication, marketplace action, outreach, billing, or spend is authorized.

## North-star recommendation

**Weekly Verified Workflow Completions (WVWC):** count unique active installations that complete a named workflow and receive that workflow's defined verification receipt during a seven-day window.

This is a recommendation based on `INS-001` and `INS-004`. It is not a current metric, target, baseline, or claim.

## Funnel definitions

| Stage | Proposed event | Definition | Evidence | State |
|---|---|---|---|---|
| Acquisition | `landing_view` | User loads an approved acquisition or workflow page. | INS-004 | proposed |
| Intent | `safe_check_start` | User begins the documented read-only connection flow. | INS-001 | proposed |
| Activation | `safe_check_ready` | System returns the documented ready state for a safe connection check. | SRC-001, SRC-002 | proposed |
| Consideration | `workflow_preview_started` | User views a named workflow plan before applying it. | INS-001 | proposed |
| Outcome | `workflow_verified` | A named workflow returns its predefined verification receipt. | INS-001, INS-005 | proposed |
| Retention | `verified_workflow_repeat_7d` | Same installation completes another verified workflow within seven days. | INS-004 | proposed |
| Commercial validation | `design_partner_qualified` | Human reviewer confirms interview/pilot fit and consent. | INS-006 | proposed |

## Data minimization rules

- Never record project names, media names, file paths, clip contents, raw prompts, rendered media, or verification-receipt payloads by default.
- Record only the minimum metadata needed to understand funnel state: product version, OS category, Premiere major version, connector type, workflow ID, outcome class, duration bucket, and anonymized installation identifier.
- Keep the existing documented optional telemetry boundary: no telemetry should be described as active until the deployed configuration and event delivery are verified (`SRC-001`).
- Require a security/privacy review before any new event is implemented (`INS-004`).

## Approval checklist

| Gate | Evidence required | Owner | Approval needed | State |
|---|---|---|---|---|
| Claims | Registry maps every claim to a source and evidence state. | Product marketing | Product/legal | required |
| Product fidelity | Named workflow passes on stated licensed Premiere host/version. | Engineering + QA | Engineering owner | required |
| Privacy | Event schema, privacy notice, retention, and support bundle are reviewed. | Security/privacy | Privacy owner | required |
| Accessibility | Captions/transcript, contrast, keyboard behavior, readable responsive layout. | Design + QA | Accessibility reviewer | required |
| Destination | Landing URL, canonical, support path, failure recovery, and CTA work. | Web owner | Product owner | required |
| Tracking | Test events arrive and reconcile without sensitive content. | Analytics owner | Privacy + analytics | required |
| Distribution | Correct channel package, listing copy, testing notes, terms/privacy/support links. | Distribution owner | Product/legal + platform process | required |
| Pricing/billing | Commercial terms, entitlement, cancellation/refund, taxes, support policy. | Business owner | Legal + finance + product | required |
| Paid media | Exact campaign, audience, budget, creative, landing page, kill rule. | Growth lead | Explicit budget owner | required |

## Evidence-state rules

| State | Meaning | Public-use rule |
|---|---|---|
| verified | Direct current source or reproduced product/host evidence. | May use with its stated scope. |
| page evidence | Public page says it; no independent validation. | Quote as page claim, not proof. |
| inference | Reasoned conclusion from sources. | Label or phrase conservatively. |
| hypothesis | Testable recommendation without proof. | Do not present as fact or availability. |
| user supplied | Provided in the brief but not independently verified. | Confirm before material external use. |
| pending live verification | Requires current host, portal, analytics, or operational check. | Do not make public claim. |

## Weekly learning loop

1. **What changed?** Report funnel stage counts and support categories only after tracking verification.
2. **Why might it have changed?** List at least two explanations; label causal claims as hypotheses unless a controlled test supports them.
3. **What evidence supports that explanation?** Link to analytics date range, error taxonomy, user research, or experiment ID.
4. **What will be tested next?** Select one variable from `AD-001`–`AD-004`, `SEO-005`–`SEO-014`, or a product-onboarding experiment.
5. **What should stop, continue, or scale?** Stop unverified claims and costly support paths; continue validated activation steps; scale only after repeatable verified outcomes.

## Pre-pilot completion gates

| ID | Gate | Completion criteria | Evidence | State |
|---|---|---|---|---|
| GATE-001 | Host proof | Three named workflows have versioned licensed-host reports on both Windows and macOS; any unsupported route fails closed. | INS-003 | pending live verification |
| GATE-002 | Onboarding | At least five observed clean installs complete the safe-check without maintainer intervention; failure reasons are classified. | INS-002 | pending live verification |
| GATE-003 | Claims | Website, docs, and launch materials have a single source-backed claims registry. | INS-001 | recommended |
| GATE-004 | Measurement | Privacy-safe events are validated end to end and include no prohibited content. | INS-004 | pending live verification |
| GATE-005 | Demand | 12–15 interviews identify a repeated workflow and explicit interest in a design-partner discussion. | INS-006 | pending live verification |
| GATE-006 | Support | Named owner, support route, known-limitations page, and recovery guidance exist. | INS-002 | recommended |

## Pilot and public-beta decision rule

- **Start an assisted design-partner pilot only when GATE-001 through GATE-006 are complete and product/legal owners approve the scope.**
- **Consider a public commercial beta only after consented design-partner evidence demonstrates repeated verified workflow use, sustainable support, and approved commercial/legal terms.**
- **Do not translate competitor price observations into Premiere Pro MCP pricing without validated demand, willingness-to-pay research, and approval.** (`INS-005`, `INS-006`)

## Next actions

1. Assign owners and evidence locations for GATE-001 through GATE-006.
2. Review the proposed data-minimization rules with privacy/security before any instrumentation change.
3. Hold a go/no-go review after the proof sprint; retain all missing gates as blockers.

**Owner:** Product lead, analytics owner, and security/privacy owner
**Approval needed:** Explicit approval is required for tracking implementation, pilots, external outreach, marketplace action, commercial terms, publication, and paid media.
**Completion criteria:** Each release or campaign has a completed evidence checklist, named approvers, recorded decision, and a rollback/support plan.
