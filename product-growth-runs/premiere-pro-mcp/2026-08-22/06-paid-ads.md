# Paid-ad experiment plan

**Product:** Premiere Pro MCP
**Market:** Professional Adobe Premiere Pro workflow automation
**Date:** 2026-08-22
**Research scope:** Human-controlled future experiment design; no campaign, audience upload, budget, creative production, or spend has occurred.
**Status:** Do not launch until host proof, tracking validation, landing-page readiness, and explicit budget approval are complete.

## Guardrails

- Optimize for verified workflow outcomes, not clicks, downloads, stars, or impressions (`INS-004`).
- Do not purchase or launch ads before a public, host-tested workflow page exists (`INS-001`, `INS-003`).
- Do not claim “production-ready,” “saves hours,” “editor approved,” Adobe Marketplace availability, or universal Premiere compatibility.
- Do not target customers using proprietary project/media data or upload customer lists without separate approval.
- Keep budget, bid strategy, platform account, audience expansion, and launch execution human-controlled.

## Required landing pages

| ID | Landing-page requirement | Evidence | State |
|---|---|---|---|
| LP-001 | Safe connection check page: exact read-only prompt, prerequisites, failure recovery, privacy qualification, host/version scope. | INS-001, INS-002 | not yet verified |
| LP-002 | One host-tested workflow page: inspect → plan → confirm → verify, with a real recording and receipt. | INS-001, INS-003, INS-005 | not yet verified |
| LP-003 | Companion/design-partner interest page that states availability and price only after explicit approval. | INS-002, INS-006 | hypothesis |

## Ad-test register

| ID | Channel | Hypothesis | Control | Treatment | KPI | Decision rule | Tracking | State |
|---|---|---|---|---|---|---|---|---|
| AD-001 | Search, high intent | Outcome-led “review before change” copy (`ANG-001`) produces more verified safe-check completions than tool-count copy for relevant Premiere automation queries. | “335 AI tools for Premiere Pro” wording; only if it has approved factual qualifications. | “Automate repeatable Premiere work—with a preview before anything changes.” | Verified safe-check completion per qualified landing visit | Evaluate only after a pre-approved minimum sample and conversion window; pause if no verified completions or support burden is unacceptable. | `landing_view`, `safe_check_start`, `safe_check_ready`; privacy-safe aggregate attribution | pending approval |
| AD-002 | Search, high intent | Installation-confidence copy (`ANG-003`) improves safe-check completion among evaluators who fear setup friction. | Generic installation CTA. | “Know your Premiere connection is ready before you edit.” | Median time from landing view to verified safe-check ready | Run after LP-001 is verified; iterate only if errors identify an actionable onboarding barrier. | Same as AD-001 plus `connector_repair_started`, `connector_repair_outcome` | pending approval |
| AD-003 | Video retargeting, consideration | A real workflow recording (`CRE-001`) leads to more verified workflow starts than an architecture-only animation (`CRE-002`). | Approved CRE-002 diagram. | Approved CRE-001 recording. | Verified workflow start per qualified returning visitor | Run only with consented compliant audience data and a sufficient verified baseline; kill any version that raises support burden without verified outcomes. | `demo_play_50`, `workflow_page_view`, `workflow_preview_started`, `workflow_verified` | pending approval |
| AD-004 | LinkedIn or specialist community sponsorship | Post-supervisor-oriented workflow-pack copy (`ANG-004`) creates more qualified design-partner applications than generic AI automation copy. | Generic automation benefits. | “Turn recurring editorial steps into reviewed team workflows.” | Qualified design-partner application accepted after human review | Do not launch until ICP interviews confirm role, pain, and buying context; stop if applications are unqualified. | `design_partner_interest`, manually reviewed qualification field, no sensitive project data | pending approval |

## Test design notes

### AD-001 — recommended first test

- **Primary variable:** Message framing only; identical destination, targeting, and landing experience.
- **Primary KPI:** Verified safe-check completion, not CTR.
- **Diagnostic metrics:** Query relevance, landing engagement, safe-check start, readiness failure category, support tickets per activated installation.
- **Prerequisites:** LP-001 live and verified, privacy review complete, support owner assigned, and product owner approves exact copy and budget.
- **Reason:** `INS-001` provides a tangible activation event and `INS-004` identifies the absence of a current funnel baseline.

### Exclusions

Do not test price, trial claims, performance claims, or Adobe affiliation until those are explicitly approved and evidenced. Do not run creator “viral clip” messaging as a primary experiment because that heads into a better-established competitive segment (`INS-005`).

## Measurement specification

| Event | Definition | Data prohibition | State |
|---|---|---|---|
| `landing_view` | Qualified page view with campaign/source metadata | No project, media, prompt, or file-path content | proposed |
| `safe_check_start` | User begins documented read-only connection flow | No personal/project contents | proposed |
| `safe_check_ready` | Connection check returns the documented ready result | No project names, paths, or media metadata | proposed |
| `workflow_preview_started` | User views a workflow plan | No workflow inputs unless separately privacy reviewed | proposed |
| `workflow_verified` | Host returns a workflow-specific verification receipt | No receipt payload until data classification is approved | proposed |
| `support_contact` | User initiates support from activation flow | Capture consent and minimum necessary contact data only | proposed |

## Next actions

1. Verify LP-001 and a real LP-002 before preparing creatives (`INS-001`, `INS-003`).
2. Have privacy/security review the event schema before implementation (`INS-004`).
3. Obtain explicit campaign, budget, account, audience, and creative approval before launching any test.

**Owner:** Growth lead with product analytics owner
**Approval needed:** Explicit approval for each campaign, platform account, audience, budget, creative, tracking implementation, and launch.
**Completion criteria:** A test can start only after every prerequisite is verified, its single primary variable is locked, and an accountable reviewer has approved the decision rule.
