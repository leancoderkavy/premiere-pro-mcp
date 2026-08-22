# Positioning

**Product:** Premiere Pro MCP
**Market:** Professional Adobe Premiere Pro workflow automation
**Date:** 2026-08-22
**Research scope:** Positioning, audience, offers, message hypotheses, and objections.
**Status:** Recommended direction; no customer validation, commercial terms, or launch approval.

## Recommended primary segment

**Small post-production teams and agencies with repeated Premiere workflows**: approximately 3–20 editors, a technical editor or post supervisor, recurring project setup/cutdown/delivery routines, and an existing AI-client champion. This is an ICP hypothesis based on `INS-002`, `INS-005`, and `INS-006`; validate it in interviews before committing roadmap or messaging.

### Secondary segments

- High-output independent editors with repeat deliverables (`INS-005`, hypothesis).
- Developer-led media teams that need structured, inspectable Premiere integration (`INS-001`, inference).

### Deprioritized initial segments

- Editors seeking only one-click viral clips, captions, silence removal, or podcast camera switching; established alternatives already position tightly around those outcomes (`INS-005`).
- Teams requiring autonomous creative judgment without review (`INS-003`).
- Users unable to run local Premiere and connector components (`INS-002`).

## Jobs to be done

| ID | Job | Evidence | Product implication | State |
|---|---|---|---|---|
| JTBD-001 | When I repeat a Premiere preparation task, help me inspect the current project and execute a bounded workflow without guessing what changed. | INS-001, INS-005 | Contractual workflow pack with plan and result receipt. | inference |
| JTBD-002 | When I install a new editing automation system, help me know whether my host, connector, and client are ready before I risk a project. | INS-001, INS-002 | Companion readiness check and repair experience. | inference |
| JTBD-003 | When my team standardizes a recurring edit, help us reuse a workflow without forcing us to abandon our preferred AI client. | INS-001, INS-006 | Cross-client MCP setup plus versioned shared workflow packs. | hypothesis |

## Positioning statement

For post-production teams and high-output Premiere editors who repeat project setup, cutdown, and delivery work, **Premiere Pro MCP** is a local-first, structured automation layer that lets compatible AI clients inspect, plan, and run supported workflows in Premiere. Unlike one-purpose AI extensions or a generic in-app assistant, it is designed around **explicit capability checks, reviewable workflow plans, and verifiable results**. This statement is an inference from `INS-001`, `INS-005`, `INS-007`, and `INS-008`; it must be limited to host-tested workflows.

## Value proposition and reasons to believe

| Claim area | Approved direction | Evidence | State |
|---|---|---|---|
| Safety and clarity | “Start with a read-only connection check; inspect before a supported edit.” | Documented `verify_premiere_connection` and capability boundaries. [SRC-001] [SRC-002] | verified |
| Workflow value | “Turn repeat project work into a reviewable workflow.” | Product capabilities + outcome-led competitor landscape. [SRC-001] [SRC-010] [SRC-012] | inference |
| Choice | “Use a compatible MCP client rather than a single assistant.” | Repository documentation describes compatible clients. [SRC-001] | verified |
| Local-first | “Recommended setup keeps the server and connector on the editor's computer; review your AI client's privacy separately.” | [SRC-001] | verified |
| Proof boundary | “Verify the actual result on your host.” | [SRC-002] | verified |

## Message angles

| ID | Angle | Audience | Evidence / insight | Draft headline | State |
|---|---|---|---|---|---|
| ANG-001 | Review before change | Risk-aware editors and post leads | INS-001, INS-003 | “Automate repeatable Premiere work—with a preview before anything changes.” | recommended |
| ANG-002 | Local workflow control | Privacy-conscious technical editors | INS-001, INS-007 | “Keep the bridge local. Keep the workflow inspectable.” | recommended |
| ANG-003 | Reliable first run | New evaluators | INS-002 | “Know your Premiere connection is ready before you edit.” | recommended |
| ANG-004 | Repeatable team outcomes | Post supervisors | INS-005, INS-006 | “Turn recurring editorial steps into reviewed team workflows.” | hypothesis |
| ANG-005 | Your client, structured workflows | Developer-led media teams | INS-001, INS-008 | “Bring your preferred AI client to a structured Premiere workflow.” | hypothesis |

## Recommended offer architecture

| Offer | User outcome | Included concept | Price / availability | Evidence state |
|---|---|---|---|---|
| Community | Self-service access to the existing MCP core | MIT-licensed server, documented safe connection check, community documentation | Free, current product fact. [SRC-001] | verified |
| Design Partner | Assisted implementation of repeat workflows | Guided installation, workflow configuration, direct feedback loop, host test participation | Invite-only hypothesis; **no price, terms, or enrollment are approved** | hypothesis |
| Studio Companion | Reliable onboarding and operating experience | Detection, repair, safe check, workflow gallery, preview, receipts, updates, support bundle | Proposed paid layer; **no price, SKU, billing, or availability is approved** | hypothesis |
| Team / Enterprise | Standardized workflows and deployment | Shared workflow pack management, deployment support, policy controls, priority support | Future concept; require confirmed demand, security plan, and legal review | hypothesis |

## Objections and responsible responses

| Objection | Response direction | Evidence / restriction |
|---|---|---|
| “Adobe already has an AI Assistant.” | Acknowledge the overlap; show the specific tested workflow, cross-client setup, and evidence/receipt behavior. Do not claim broad superiority. | INS-003, SRC-006 |
| “Will this damage my project?” | Say what the tested workflow checks, what confirmation is required, and how verification works. Never promise universal safety. | INS-001, SRC-002 |
| “Will my media be uploaded?” | Explain the local-first product path and separately point to the chosen AI client's own privacy terms. | SRC-001 |
| “Why pay when the core is open source?” | Offer operational assurance, workflow packs, onboarding, updates, deployment, and support; never imply the MIT core is unavailable. | INS-002, INS-006 |
| “Does it work on my Premiere version?” | Route to the compatibility matrix and safe check; state only verified host/version support. | INS-002, SRC-002 |

## Unverified positioning claims — prohibited until validated

| Claim | State | Required evidence |
|---|---|---|
| “Built for agencies” | hypothesis | At least three consented agency pilots with retained use. |
| “Save hours every week” | pending live verification | Time-on-task study and approved customer claim. |
| “Production-ready” | pending live verification | Licensed-host matrix, support policy, and real workflow evidence. |
| “The best Premiere AI assistant” | prohibited comparative claim | Independent comparison criteria and substantiation; not recommended. |

## Next actions

1. Test `ANG-001` against `ANG-003` in interviews and on the landing page only after approval (`INS-001`, `INS-002`).
2. Turn the proposed offer architecture into a written product requirements document (`INS-002`, `INS-006`).
3. Keep all price fields blank until design-partner evidence exists (`INS-006`).

**Owner:** Product marketing lead
**Approval needed:** Product owner approval for public positioning and any commercial packaging.
**Completion criteria:** One primary ICP, one primary angle, and a host-tested workflow have written approval and traceable evidence.
