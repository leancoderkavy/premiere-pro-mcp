# Product Marketing Context

**Document version:** v9
**Last updated:** 2026-08-23

## Product Overview

**One-liner:** Premiere Pro MCP provides reviewable workflow automation for Adobe Premiere Pro through compatible AI clients.

**What it does:** The local MCP server connects a compatible AI client to Premiere through the production CEP bridge, with a capability-gated UXP expansion on supported hosts. It lets an editor inspect local project context, create a bounded plan, confirm meaningful changes, and evaluate returned state or diagnostics before relying on a workflow.

**Product category:** Reviewable Premiere Pro workflow automation; MCP server and AI-assisted editorial infrastructure.

**Product type:** Free, MIT-licensed open-source developer and editor tool. A commercial companion product is a future product hypothesis, not a launched service.

**Business model and pricing:** The current server is free and open source; no paid plan, checkout, revenue, or hosted-media service is currently offered. A design-partner program ($499–$1,500 per team for 60 days) and a Pro companion ($19–$29 per month) are unvalidated pricing hypotheses, not published offers or promises.

## Target Audience

**Primary ICP:** Small post-production teams and agencies (roughly 3–20 editors) with repeatable Premiere setup, organization, cutdown, and delivery work. The practical champion is a technical editor, assistant editor, post supervisor, or workflow lead who can validate an install and define repeatable team workflows.

**Secondary audiences:** High-output independent editors with repeated project-preparation or delivery tasks, and developer-led media teams that need structured Premiere integration.

**Decision-makers:** Post-production leads, technical directors, workflow engineers, individual editors, and developer-tool evaluators.

**Primary use case:** Reduce repetitive Premiere work from a chosen MCP-capable client while keeping the recommended control path and project media on the local computer.

**Jobs to be done:**

- Inspect a project and active sequence before changing anything.
- Preview and carry out a supported, repeatable editing workflow.
- Preflight an export or return observable state and diagnostics after an operation.

**Initial workflow-pack hypotheses:** Project Intake, Platform Cutdowns, and Delivery Preflight. These are roadmap concepts until each workflow has a versioned contract and real-host evidence.

## Personas

| Persona | Cares about | Challenge | Value we promise |
| --- | --- | --- | --- |
| Technical editor or assistant editor | Faster repetitive work without surrendering creative judgment | UI macros and one-off scripts are brittle and hard to verify | Structured tools, previewable plans, diagnostics, and explicit results |
| Post-production lead or workflow owner | Repeatability, supportability, and safe adoption across editor systems | Host versions and undocumented APIs vary | Capability metadata, compatibility guidance, and evidence-bounded workflow contracts |
| Workflow developer | Extensible automation from an existing AI client | Building and maintaining a Premiere bridge is expensive | Open-source MCP, CEP, UXP, and packaging foundations |

## Problems & Pain Points

**Core problem:** Editors spend time on repeatable project inspection, organization, timeline, and delivery tasks that are difficult to coordinate with a natural-language interface alone.

**Why alternatives fall short:**

- Visual UI automation guesses at interface state and breaks across layouts.
- Generic AI video tools can require moving work into a separate hosted workflow.
- Raw scripts lack guided discovery, authority boundaries, and consistent diagnostics.
- A tool catalog alone does not define a reliable, repeatable outcome for a team.

**What it costs them:** Repetitive labor, interrupted creative focus, fragile handoffs, rework, and uncertainty about whether an automated operation changed the intended project state.

**Emotional tension:** Editors want assistance without an opaque system silently making destructive or unverifiable changes.

## Competitive Landscape

**Direct:** Other Premiere-focused MCP servers and AI-control bridges. Compare installability, supported host surfaces, verification behavior, safety boundaries, and maintenance evidence rather than tool count alone.

**Secondary:** Premiere scripts, panels, macros, and outcome-specific automation products. They can solve a narrow task well, but may not offer client choice, structured workflow contracts, or a local inspect-plan-confirm-verify path.

**Adobe AI Assistant:** Adobe's public beta overlaps with media organization, footage preparation, and initial-assembly work. Adobe's current FAQ also says that connecting a user model, reference-document or templated workflows, team conversation sharing, and chat-history export are not available today. Treat it as a complementary and evolving native alternative, not a competitor to dismiss. Do not claim that Premiere Pro MCP is generally better than Adobe AI Assistant; differentiate on client choice, local-first orchestration, structured workflow contracts, and explicit verification boundaries. Sources reviewed 2026-08-23: <https://helpx.adobe.com/premiere/desktop/premiere-ai-assistant/overview.html> and <https://helpx.adobe.com/premiere/desktop/premiere-ai-assistant/assistant-faq.html>.

**Indirect:** Manual editing and separate hosted AI editors. They can be familiar or convenient, but do not provide the same structured local control path into an existing Premiere project.

## Differentiation

**Key differentiators:**

- Local-first recommended architecture.
- Compatible-client choice rather than a single assistant experience.
- Broad structured tool surface with capability and authority metadata.
- Read-only connection verification and diagnostic paths.
- Opt-in local project context with evidence retrieval and stale-state guards.
- Preview-confirmed compound edit plans with exact target revalidation.
- Production CEP compatibility plus capability-gated UXP expansion.
- Open-source client bundles, connectors, and release artifacts.

**How we do it differently:** The product exposes structured tools and workflow boundaries instead of asking an AI to guess at Premiere's interface. Project-context work captures bounded local evidence, creates a non-mutating plan, and requires exact preview confirmation before a compound edit can apply.

**Why that matters:** An editor can inspect available support, preview risk, and evaluate returned state or diagnostics before relying on an operation.

**Positioning boundary:** Say “designed for reviewable workflows,” not “production-proven” or “safe for every project,” until a published licensed-host test matrix supports the narrower claim.

## Objections

| Objection | Response |
| --- | --- |
| “Will it upload my footage?” | The recommended setup keeps Premiere, the bridge, server, and media on the local computer. The chosen AI client's own privacy behavior still applies. |
| “Will every tool work on my Premiere version?” | No static compatibility claim proves a live operation. Run the read-only connection check, inspect capabilities, preview changes, and verify results. |
| “Is setup too technical?” | Claude Desktop has a self-contained bundle; the Premiere connector remains a separate install. Other clients currently use guided or advanced setup. Reducing this friction is a product priority, not a completed claim. |
| “Why not use Adobe AI Assistant?” | It can be the right native choice for its supported beta workflows. Premiere Pro MCP is for teams that value client choice, local structured integration, and explicit workflow verification. |

**Anti-persona:** Anyone seeking unattended destructive editing, guaranteed support across every Premiere build, a hosted service that uploads and edits media without local Premiere, or “viral clip” automation as the only desired outcome.

## Switching Dynamics

**Push:** Repetitive edits, fragile UI macros, scattered scripts, and difficult-to-audit handoffs.

**Pull:** Structured tools, local execution, client choice, plan review, and explicit diagnostics.

**Habit:** Manual Premiere workflows are predictable and already understood.

**Anxiety:** Installation friction, project safety, compatibility variation, assistant privacy, and uncertainty about whether an operation really succeeded.

## Customer Language

**Repository-provided task examples, not customer-interview quotations:**

- “What is my current Premiere project and active sequence? Do not make changes.”
- “Add the B-roll clips to V2, apply a cross dissolve, match the grade, and export.”

**Words to use:** reviewable workflow automation, local-first, structured tools, preview, supported, capability-gated, verified result, read-only check, explicit diagnostics.

**Words to avoid:** autonomous editor, guaranteed, flawless, one-click for every client, unsubstantiated endorsement language, live demo when simulated, uploads nothing under every configuration, full control without qualification.

**Glossary:**

| Term | Meaning |
| --- | --- |
| MCP server | The local service exposing structured Premiere tools to compatible AI clients |
| CEP bridge | The production connector used for the default Premiere compatibility path |
| UXP bridge | A newer capability-gated connection for supported Premiere workflows |
| Reviewable workflow | A bounded Inspect → Plan → Preview → Confirm → Apply → Verify path; availability and success remain host-specific |
| Verified result | A returned outcome backed by observable state or diagnostics, not merely an attempted command |

## Brand Voice

**Tone:** Confident, technical, calm, and evidence-aware.

**Style:** Outcome-led plain language first; technical detail and limitations close to the claim they qualify.

**Personality:** Precise, transparent, pragmatic, capable, editor-respecting.

## Proof Points

**Release facts:** v1.13.0 registers 318 core tools; the default profile exposes 316; an authenticated compatible UXP host can add 50 capability-gated tools for a 366-tool connected surface. The release also declares 37 modules, 4 MCP resources, and 11 workflow prompts. These are catalog and packaging facts from `release-metadata.json`, not a promise that a particular host operation will work.

**Compatibility boundary:** The release targets Premiere Pro 2020–2026; UXP workflows require a compatible Premiere Pro 25.6.0+ host and advertised capabilities. CEP remains the default compatibility route. A compatibility range, package validation, CI pass, HTTP health check, or local build is not real-host proof.

**Customers and testimonials:** No approved customer-logo claims, adoption claims, case studies, or public testimonials are currently documented.

**Activation and revenue:** The landing records only bounded anonymous setup actions and allowlisted UTM fields; the local runtime can separately record aggregate first-run check outcomes when an operator configures telemetry. These streams deliberately have no shared user identifier. Current production activation, retention, support, conversion, and revenue metrics have not been queried and must not be reported as known.

**Marketplace and deployment:** Do not claim current Adobe Marketplace approval, directory approval, signed public distribution, or live deployment from repository artifacts alone. Marketplace submission and publication, trusted signing, and real-host installation are separate external gates.

**Value themes:**

| Theme | Evidence-bound proof |
| --- | --- |
| Installable artifacts | npm package, Claude Desktop bundle, CEP and UXP packaging, and release artifacts; real-host install proof remains separate |
| Local-first | Recommended same-computer server, bridge, Premiere, and media architecture; the selected AI client's privacy behavior remains separate |
| Inspectable | Capability catalog, read-only first check, diagnostics, and explicit verification boundaries |
| Open | MIT license, public source, changelog, security policy, and cross-platform CI; CI does not prove a real Premiere edit |

## Goals

**Business goal:** Establish a repeatable path from install to verified workflow completion before offering a commercial companion broadly.

**Phase-0 conversion action:** Complete the assistant and connector installation, run `verify_premiere_connection`, then complete a supported workflow with a host-observable result. This is the intended activation event, not a reported conversion metric.

**Proof goals:** Maintain a canonical claims registry; test external clean installs; publish a versioned host-test matrix; and collect approved user evidence before using testimonial, adoption, or time-saved claims.

**Commercial validation goal:** Interview target workflow owners and validate a limited design-partner offer before publishing a price, checkout, or revenue target.

**Organic acquisition strategy:** Publish practical, intent-specific guides that lead to the read-only connection check and clearly distinguish package support, connected capabilities, and host-verified outcomes.

**Paid-acquisition gate:** Do not activate paid campaigns until the current release download, privacy policy, browser conversion events, and aggregate first-run reliability evidence have been verified. A campaign budget, platform, and activation remain separate owner decisions.

## Changelog

*Newest first. One line per revision: what changed and why.*

- v9 (2026-08-23) — Refreshed the Adobe AI Assistant public-beta scope and added project-backup, visual-review, and delivery-QC guide intents with explicit evidence boundaries.
- v8 (2026-08-22) — Prepared v1.13.0 release-candidate positioning for preview-only Project Intake while preserving the unpublished and licensed-host evidence boundaries.
- v7 (2026-08-22) — Added the read-only Project Intake workflow and refreshed source-derived tool, module, and workflow counts; kept release publication and licensed-host proof separate.
- v6 (2026-08-22) — Added privacy-bounded acquisition attribution and the paid-acquisition measurement gate after production-readiness hardening.
- v5 (2026-08-22) — Repositioned around reviewable workflow automation; refreshed v1.12.1 release facts, ICP, Adobe AI Assistant overlap, commercial hypotheses, and explicit proof boundaries.
- v6 (2026-08-22) — Released v1.12.2 with string-backed MOGRT property inputs and clearer legacy-QE effect-catalog diagnostics; real Premiere host validation remains separate.
- v4 (2026-08-20) — Added the project-context review workflow and client-choice differentiation after Adobe AI Assistant comparison.
- v3 (2026-08-19) — Updated proof counts for v1.11.4 and added the organic article strategy and activation path.
- v2 (2026-08-15) — Expanded audience, differentiation, objections, brand voice, proof, and activation goals; aligned the current 280-core and 307-connected tool surfaces.
- v1 (2026-07-27) — Initial context derived from the product README, package requirements, compatibility guidance, and usage-measurement work.
