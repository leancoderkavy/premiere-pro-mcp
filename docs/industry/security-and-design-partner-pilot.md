# Security and design-partner pilot for professional post-production

## Purpose and status

This document defines a proposed 60-day design-partner pilot for a narrowly
scoped **Project Intake Assistant**. It is intended for Premiere-based post
teams that want to test reviewed project inspection and organization workflows
without delegating creative authorship or uncontrolled access to production
media.

The pilot is a product-discovery and evidence-gathering activity. It is **not**
a security certification, legal advice, a TPN assessment, a claim of
production readiness, or permission to process a customer's media. A facility
must approve its own data, labor, clearance, security, and retention policies
before participating.

Terms in this document are deliberately distinct:

- **Current repository behavior** is grounded in linked implementation and
  documentation evidence.
- **Pilot requirement** is a condition for participating in the proposed
  program.
- **Proposal** is a future product or operating control that is not represented
  as implemented until it has code, tests, and licensed-host evidence.

## Evidence basis and present boundaries

The repository documents a recommended local `stdio` deployment in which the
MCP client, server, Premiere connector, and host run on the same computer. The
CEP bridge uses a private per-user temporary directory; the optional UXP bridge
listens only on `127.0.0.1` and authenticates its WebSocket connection. See the
[local setup and security guidance](../../README.md#security) and the
[UXP bridge transport contract](../../uxp-plugin/README.md#mcp-side-transport).

The current project-context store is local and opt-in. It persists bounded
metadata and hashed project/media-path identities, not native project or media
paths, but it can persist explicit enrichment content when an MCP client asks
it to do so. Its storage boundary does not make an AI client or model provider
private. See the [project-context engine](../project-context-engine.md) and the
[context-retention proposal](../recommendations/2026-08-18-round-2/36-context-retention-policy.md).

The repository also supports a network-reachable HTTP transport, but it binds
to `0.0.0.0`, requires bearer authentication in production, and is not a safe
default for a shared post facility without identity-aware edge controls. It is
therefore excluded from the pilot baseline. The existing UXP manifest declares
`network.domains: "all"` for Premiere compatibility, even though the panel CSP
and its workspace validator restrict the configured bridge to loopback URLs.
That broad declared permission is a material installation-review issue, not a
claim that the current panel can be accepted by every facility policy.

Existing code and documentation distinguish host responses and structural
readback from playback or rendered-output proof. Automated checks do not prove
that a licensed Premiere host created, displayed, saved, or undid an item. See
the [licensed-host validation runbook](../editorial-workflow-host-validation.md)
and the [sequence-sandbox proposal](../recommendations/2026-08-18-round-2/39-sequence-sandbox-verification.md).

## Pilot scope

The initial pilot is limited to this workflow:

1. Inspect an explicitly selected project and selected incoming media.
2. Compare it with a facility-approved intake template.
3. Produce a read-only issue report and an exact proposed organization plan.
4. Let an authorized human review, edit, reject, or approve the plan.
5. Apply only supported, explicitly approved organization actions.
6. Reinspect the affected targets and create a content-free operation receipt.

The following are out of scope for all pilot stages unless a later, separately
approved protocol says otherwise:

- autonomous editorial or story decisions;
- background monitoring of projects or storage;
- arbitrary ExtendScript or expression execution;
- generative video, audio, voice, face, performance, or final-production
  media;
- unreviewed external review, asset-management, delivery, or transcription
  integrations;
- automated source-to-sequence transcript cutting, rendered-output claims, and
  production turnover claims; and
- shared remote MCP control planes, shared bearer tokens, or public endpoints.

## Local-first pilot topology

The proposed baseline keeps control and operational evidence inside the
facility-managed workstation or network boundary. It does not make claims about
what an independently chosen AI client, operating system, Adobe service, or
network appliance does with data.

```text
Facility-controlled workstation

  Approved MCP client
       | stdio only
       v
  Premiere Pro MCP server --------> local project-context store (opt-in)
       |                                 |
       | private local IPC                | facility retention policy
       v                                 v
  CEP connector / authenticated UXP loopback bridge
       |
       v
  Licensed Premiere Pro and operator-selected workspace

No pilot-default Internet egress from the MCP server or connector.
No remote HTTP/SSE transport. No vendor analytics key. No external model call
from the workflow pack.
```

### Pilot requirements

- Run the MCP server locally over `stdio`; keep the MCP client, server,
  connector, and Premiere host on the same facility-managed machine.
- Do not start `http-server`, deploy the pilot workflow to Fly.io, configure
  `MCP_AUTH_TOKEN`, or expose a bridge directory through a sync agent, proxy,
  or VPN as part of the pilot.
- Use a dedicated pilot configuration with `POSTHOG_API_KEY` unset. The pilot
  administrator must record that setting in the installation evidence.
- Use only a facility-approved MCP client and model-routing configuration. The
  client must be able to keep prompts, tool arguments, transcript text, media
  names, project names, and local paths inside the facility's approved data
  boundary. If that cannot be shown, use synthetic fixtures only.
- Review the exact connector package hash, server package version, and UXP
  manifest before installation. A facility that cannot accept the current
  broad UXP network declaration must not enable the UXP route in the pilot.
- Grant the UXP panel one operator-selected workspace only. Treat workspace
  containment as a bridge policy rather than an operating-system sandbox, and
  do not use a workspace that includes unrelated productions.
- Default to read-only inspection. Run application only through the guarded
  organization path after the named approver reviews an unstale plan.

## Egress inventory

This inventory is deliberately conservative. It records known paths in the
repository and the pilot disposition; it is not a substitute for a facility's
endpoint monitoring and package review.

| Surface | Current repository behavior | Pilot disposition | Data permitted to leave the workstation |
| --- | --- | --- | --- |
| MCP client to local server | Local `stdio` is the recommended path. The repository does not control the client or model provider selected by a facility. | Allowed only after the facility approves the specific client and model route. | Only what the approved client is authorized to process; this document makes no assumption that the client is private. |
| Server to CEP connector | Local file-based IPC in a private per-user bridge directory. | Allowed. Keep both processes on the same workstation and do not sync the directory. | None off-workstation. |
| Server to UXP panel | Authenticated WebSocket on `127.0.0.1`; panel CSP and runtime URL validation allow loopback URLs. | Allowed only after manifest review and an accepted workspace permission. | None off-workstation. |
| Project-context store | Local application-data store; opt-in capture; paths are hashed before persistence. Explicit enrichments may contain user-provided text. | Allowed only in a customer-controlled encrypted-at-rest location with an approved retention setting. | None by the server itself. |
| PostHog telemetry | Disabled unless `POSTHOG_API_KEY` is configured. When enabled, code records bounded operational events and disables person profiles. | Prohibited. Leave the key unset and verify no telemetry host is configured. | None. |
| HTTP/SSE MCP transport | Optional, network-reachable server route with bearer authentication and rate limits. | Prohibited. Do not start it or route it through a tunnel, proxy, sync agent, or remote host. | None. |
| Adobe cloud features | The repository exposes capability reporting and, in limited cases, observation after an editor uses a Premiere feature. It does not make current MCP calls to initiate Adobe generative features. | Excluded from the workflow. Any Adobe network feature remains an independent customer/Adobe relationship. | None through this pilot workflow. |
| C2PA soft-binding inspection | A read-only, separately consented external-inspection lab is proposed, not a stable pilot action. | Prohibited. | None. |

Before each pilot stage, the facility administrator records the package hashes,
environment-variable names and whether set, enabled transports, the selected
MCP client, and observed outbound destinations. The record must contain no
tokens, prompts, local paths, project names, or media names.

## Telemetry and content-handling rules

The existing optional PostHog implementation documents a bounded event contract:
operational events may include a method, tool name, outcome, status code, and
duration; it excludes authentication tokens, IP addresses, MCP arguments,
project paths, media names, tool results, and person profiles. That is useful
implementation evidence, but the design-partner baseline is stricter: no vendor
telemetry is enabled.

The pilot must not collect, transmit, or place in shared pilot reports:

- video, audio, stills, proxies, exports, render frames, checksums that can be
  used to retrieve content, or raw file contents;
- project, Production, sequence, bin, clip, media, storage-root, user, client,
  production, or facility names;
- native paths, workspace tokens, bridge tokens, credentials, IP addresses,
  device identifiers, browser storage, or authentication headers;
- prompts, tool arguments, tool results, editor notes, raw transcript text,
  shot descriptions, dialogue, captions, review notes, or metadata values;
- face, voice, performance, biometric, likeness, talent, clearance, or labor
  information; and
- persistent cross-facility identifiers or behavioral profiles.

**Proposal — content-free pilot measurements.** Use locally generated,
rotating participant and project aliases; retain the alias mapping only inside
the facility. Share aggregates such as stage, host version, action class,
result certainty, elapsed duration band, and issue category. A shared report
must redact or omit any field that could identify a production or reconstruct a
request.

## Roles and approvals

The pilot does not give an AI client independent authority. One person may hold
multiple roles only if the facility explicitly accepts that separation-of-duty
risk.

| Role | Responsibilities | May approve |
| --- | --- | --- |
| Facility administrator | Installs approved packages, confirms local-only configuration, controls access and revocation, and keeps the egress record. | Enrollment, configuration changes, and any exception to the local-first baseline. |
| Workflow owner / post supervisor | Converts an existing intake SOP into a versioned pilot template, defines expected outputs, and reviews pilot outcomes. | Template changes and promotion between pilot stages. |
| Assistant editor | Selects the intended project/media, reviews issues and proposed actions, and performs or witnesses the workflow. | Read-only runs and submission of a plan for approval. |
| Editor or designated post approver | Retains editorial judgment and confirms that a specific plan may modify the identified project targets. | Each mutating plan; a separate confirmation for non-undoable action. |
| Security/privacy reviewer | Reviews model route, telemetry state, permissions, retention, and incident evidence. | Any data-flow exception, use of cleared active-project media, and case-study release. |
| Pilot evidence reviewer | Checks redaction, host facts, post-state evidence, and claim wording. | A result may be counted toward a published case study. |

### Approval contract for a mutation

For each application attempt, the system and pilot record must present:

1. the project and target identities as aliases plus a facility-local lookup;
2. the captured project/context revision and plan digest;
3. the exact proposed creates, moves, labels, or metadata actions;
4. action-level undoability and known verification boundary;
5. the approving human, time, and expiration; and
6. the post-operation readback and result certainty.

The pilot must reject a stale plan, ambiguous target, expired approval, changed
project, unavailable host capability, missing bridge authentication, or unknown
workspace authority. It must never automatically retry a mutation after an
uncertain commit. A partial result is a visible outcome, not a successful batch.

**Proposal — two-person gate.** Require both the assistant editor and the
designated post approver for a plan that crosses projects, writes outside the
expected intake bins, affects more than the facility-defined batch limit, or
contains a non-undoable action. No role may approve an `unsafe-script` action
in this pilot because that authority remains out of scope.

## Generative-media separation

Generative operations require their own data, rights, talent, labor, clearance,
and provenance review. They are not an extension of ordinary project
organization.

The design-partner pilot therefore:

- does not invoke or ask an AI service to synthesize video, stills, dialogue,
  music, sound effects, voice, face, performance, captions, or metadata;
- does not send source material, transcripts, likenesses, or performance data
  to a generative provider;
- does not claim that a Premiere-generated item is cleared, human-authored,
  licensed, factual, or authentic;
- may inspect an already-existing item only as an ordinary project/timeline
  item, without treating inspection as evidence of provenance; and
- keeps any future generative experiment in a separate feature flag, consent
  record, approved data route, rights/clearance review, and visibly labeled
  output path.

The current repository similarly reports generative features as user-assisted
or unavailable rather than presenting a stable MCP generation operation. The
proposed C2PA inspection lab is read-only, disabled by default, and explicitly
does not make an authenticity verdict. See
[advanced feature boundaries](../../README.md#collaboration-and-ai-feature-boundaries)
and the [C2PA inspection proposal](../recommendations/2026-08-19-round-3/48-c2pa-inspection-lab.md).

## Audit, receipts, and retention

The immediate audit record is an operational receipt, not a surveillance log
and not a claim that a rendered result is correct. Existing guidance already
distinguishes bounded, redacted event receipts and licensed-host evidence from
visual or render verification.

**Proposal — minimum receipt fields.** Store the following in a facility-owned
location with access limited to the pilot roles:

```json
{
  "receiptVersion": "1",
  "pilotRunAlias": "facility-local alias",
  "workflowPackVersion": "version or source commit",
  "host": {
    "os": "Windows or macOS",
    "premiereVersion": "observed version",
    "connectorBuild": "build hash",
    "backend": "cep or uxp"
  },
  "plan": {
    "digest": "hash of the reviewed plan",
    "capturedRevision": "facility-local revision alias",
    "actionCounts": { "inspect": 0, "create": 0, "move": 0, "label": 0 }
  },
  "approval": { "approverRole": "post_approver", "expiresAt": "timestamp" },
  "result": {
    "state": "planned | rejected_before_mutation | committed_unverified | structurally_verified | render_verified",
    "perAction": "content-free statuses only",
    "undoChecked": false
  },
  "evidence": ["facility-controlled redacted evidence reference"]
}
```

No receipt may include raw targets, names, paths, prompt content, transcript
text, token values, or media-derived content. `render_verified` must remain
unused for Project Intake unless a documented render-specific procedure is
separately run; a successful API response or property readback is not enough.

**Proposal — retention rule.** Default receipt retention to 30 days for the
pilot, with a facility-selected shorter period where required. Keep only
aggregated, fully de-identified measurement results after deletion. Deletion
must remove primary and derived local pilot records and produce a content-free
deletion receipt. Do not retain a transcript or enrichment merely because a
receipt exists. The 30-day interval is an operational starting point, not a
legal retention recommendation.

## TPN-readiness framing

TPN readiness is a useful way to organize a facility-security conversation, but
this repository and pilot do **not** claim TPN membership, assessment, approval,
certification, endorsement, or compliance.

**Proposal — readiness evidence pack.** Before a facility considers a formal
third-party assessment, map the pilot's evidence to questions a content-security
review commonly asks:

- asset and data-flow inventory, including each outbound destination and the
  proof that the default pilot has none;
- package origin, build hash, signing/distribution method, dependency inventory,
  update owner, and revocation/rollback procedure;
- individual identities, least privilege, approval records, secret handling,
  workstation access controls, and offboarding;
- network architecture, firewall/egress rules, remote-support policy, logging
  boundaries, incident escalation, and evidence preservation;
- encryption, facility-selected storage and backup policy, retention/deletion,
  vendor/model review, and subcontractor exclusions; and
- security test results, licensed-host validation reports, known limitations,
  and remediation ownership.

This pack should identify gaps plainly. A completed checklist is readiness
evidence for a future review, not a substitute for the requirements or decision
of a studio, facility, insurer, customer, or TPN assessor.

## Design-partner recruitment

Recruit three to five Premiere-based teams. The first cohort should favor teams
whose intake work is frequent, documented, and structurally verifiable:

- documentary, unscripted, interview-heavy, trailer/promotional, branded, or
  independent-feature post teams;
- approximately three to twenty editorial users, with at least one working
  assistant editor and one empowered post supervisor;
- a licensed Premiere installation that the facility may use for controlled
  fixture and duplicate-project tests on a supported operating system;
- a real intake SOP containing naming, bin, label, metadata, proxy, and
  exception rules that can be expressed without story judgment;
- a technical/security contact who can approve the client/model route and
  local-only setup; and
- willingness to measure a manual baseline, run supervised sessions, report
  failures, and decline to use the workflow when its evidence is insufficient.

Exclude a candidate from the first cohort if it requires public remote access,
cannot disable telemetry, needs generated media, expects autonomous editing,
cannot use duplicate or cleared project material for early stages, or cannot
assign a named approver.

## Proposed 60-day pilot stages

| Stage | Days | Allowed material and actions | Required exit evidence |
| --- | ---: | --- | --- |
| 0. Enrollment and threat review | 1–7 | No project actions. Review SOP, model route, installation package, permissions, topology, retention, roles, and stop procedure. | Signed facility-local pilot charter; egress inventory; template v1; named roles; baseline measurement plan. |
| 1. Fixture rehearsal | 8–21 | Generated or non-sensitive fixture media only. Read-only reports first, then one-action organization tests in disposable copied projects. | At least ten runs per team; redacted before/after/Undo evidence for each mutation; no unapproved egress. |
| 2. Duplicate-project validation | 22–42 | Completed, cleared, or duplicate projects approved by the facility. Apply only approved bin, move, label, and metadata operations. | At least twenty additional runs per team; stale-plan/ambiguous-target/host-disconnect drills; per-action structural readback and recovery evidence. |
| 3. Supervised operational trial | 43–60 | Facility-approved active-project intake only if the security reviewer authorizes it. Human approval remains mandatory; no generative or remote integration. | Repeated voluntary use, baseline comparison, unresolved-risk register, and an evidence-reviewed end-of-pilot decision. |

The transition to a later stage requires the workflow owner and security/privacy
reviewer to accept the prior-stage evidence. Failure to meet a target does not
justify changing the evidence definition or silently broadening a claim.

## Metrics and decision gates

Measure both benefit and safety. All measurements must use facility-local
aliases and time bands or aggregates; do not export content-bearing logs.

| Category | Metric | Interpretation boundary |
| --- | --- | --- |
| Reliability | Completed runs / attempted runs; structurally verified actions / approved actions; partial/unknown results | Counts host and workflow outcomes, not editorial correctness or render quality. |
| Targeting safety | Wrong-project, wrong-sequence, wrong-item, stale-plan, and approval-bypass events | Any wrong-target mutation is a stop condition, not an acceptable error rate. |
| Recoverability | Undo/recovery success, time to identify uncertainty, time to restore fixture state | Recovery in a fixture does not prove recovery for every production condition. |
| Human control | Plan edit/rejection rate, approval rate, approver identity coverage, and unapproved-action count | A high rejection rate may reveal useful guardrails or a poor template; it is not automatically failure. |
| Workflow value | Median manual versus assisted intake time, manual correction time, and repeat voluntary use | Report sample size, task definition, material type, and confidence limits; do not generalize to all editing. |
| Security/privacy | Observed outbound destinations, telemetry-disabled checks, permission exceptions, receipt-redaction defects | A passing check verifies the inspected setup only; it is not a facility-wide security assessment. |
| Usability | Install-to-first-verified-run time, operator confidence, and support interventions | Self-reported confidence is not proof of host reliability. |

**Proposed promotion gate.** Do not present Project Intake as production-ready
until at least 100 licensed-host runs across every claimed host configuration
show no wrong-project, wrong-sequence, or wrong-media mutation; every mutation
has attributable approval; uncertain commits were not retried; and structural
readback, recovery, and egress records were independently reviewed. This is a
future gate, not a statement that the current repository has passed it.

## Stop conditions and incident handling

Immediately pause the affected workflow and prohibit further application in the
following situations:

- a mutation targets the wrong project, Production, sequence, item, bin, or
  workspace;
- a plan is applied without a valid named approval, or a stale/digest-mismatched
  plan is accepted;
- a mutation returns an uncertain, partial, conflicting, or unverifiable result
  that the operator cannot safely inspect and recover;
- any prompt, transcript, tool argument/result, path, token, media name, or
  customer content appears in vendor telemetry, a shared report, or an
  unapproved outbound destination;
- the configured MCP client or model route changes without security review;
- a bridge token, package, manifest permission, workspace authority, endpoint,
  or project-storage root changes unexpectedly;
- an attempted feature crosses into generative, remote, arbitrary-script, or
  external-integration scope; or
- a participant reports a labor, privacy, clearance, security, or customer
  policy conflict.

The facility administrator first disconnects the bridge and preserves only
content-free diagnostic facts. The workflow owner then determines whether the
project needs manual inspection, Undo/recovery, or escalation under the
facility's incident process. The pilot evidence reviewer records the condition
as `failed`, `partial`, `unknown`, or `not_run`; it must never be reclassified
as successful merely because the host later appears normal. Resume requires a
documented root-cause review, updated template or control, a fixture rehearsal,
and fresh approver authorization.

## Evidence template

Use one redacted record per run. Keep screenshots, bridge responses, project
copies, and alias mappings inside the facility; references below are opaque,
facility-controlled IDs rather than files to be shared externally.

```yaml
pilot_run_alias: P-017
date_bucket: 2026-W35
stage: fixture_rehearsal
workflow: project_intake_v1
workflow_pack_version: "commit-or-signed-package-hash"
host:
  os: Windows
  premiere_version: "facility-recorded"
  connector_build: "hash"
  backend: uxp
configuration:
  transport: stdio
  http_server_started: false
  telemetry_key_configured: false
  uxp_manifest_reviewed: true
  approved_workspace_confirmed: true
  outbound_destinations_observed: []
plan:
  project_alias: PRJ-LOCAL-4
  revision_alias: REV-LOCAL-9
  digest: "sha256-or-equivalent"
  actions: { inspect: 12, create: 1, move: 4, label: 4 }
approval:
  assistant_editor_present: true
  post_approver_present: true
  approval_expires_before: "facility-local timestamp"
result:
  status: structurally_verified
  per_action_summary: { succeeded: 9, rejected_before_mutation: 0, partial: 0, unknown: 0 }
  undo_checked: true
  render_verified: false
evidence_references:
  - FACILITY-ONLY-BEFORE-AFTER-001
  - FACILITY-ONLY-UNDO-001
issues:
  - none
review:
  redaction_checked: true
  eligible_for_aggregate_metrics: true
```

This template is intentionally compatible with, but does not replace, the
repository's [licensed-host report shape](../editorial-workflow-host-validation.md#report-shape).
The host report remains necessary before a claim crosses from automated
contracts to a licensed-host capability claim.

## Case-study claim gates

No public case study, sales claim, or partner quote may be created from a pilot
until all of the following are true:

1. The facility has given explicit written approval for the specific identity,
   quote, logo, workflow description, and data that may be published.
2. The security/privacy reviewer confirms that the exported evidence contains
   no customer content, identifiers, prompts, transcript text, paths, or hidden
   telemetry.
3. The evidence reviewer confirms the exact host versions, package/build hashes,
   run count, workflow stage, outcome classifications, and failure count.
4. The reported time comparison defines the baseline, task, measurement method,
   sample size, material class, manual-correction treatment, and date range.
5. At least two teams have voluntarily repeated the workflow after supervised
   sessions. A single successful demonstration is not an adoption claim.
6. Any result stated as verified is limited to the evidence actually collected:
   planning, structural project readback, Undo/recovery, or separately measured
   render verification.
7. The copy says what happened in the measured pilot, for example, “Across
   _N_ supervised intake runs at participating teams, median measured intake
   time changed from _X_ to _Y_ for the defined workflow,” rather than claiming
   general editing speed, autonomous editing, security certification, or
   universal Premiere compatibility.

Published material must retain a limitations note: pilot outcomes do not prove
creative quality, delivery correctness, rights clearance, model privacy outside
the approved route, or compatibility with untested Premiere/client/operating
system combinations.

## Next decision

Before recruiting a design partner, implement or formally accept the proposed
configuration attestation, content-free receipts, retention/deletion controls,
plan digest/expiry, per-action result certainty, and stop/resume workflow. Then
run the existing licensed-host validation procedure with non-sensitive fixtures
on every configuration that the pilot intends to name. Until then, this document
is a proposed control plan, not evidence that the controls are in production.
