# Project Intake Assistant contract

**Contract ID:** `INDUSTRY-01`
**Version:** `0.1.0-draft`
**Status:** proposed product contract; not a production-readiness claim
**Last reviewed against source tree:** 2026-08-22

## Purpose and implementation status

Project Intake Assistant is a bounded, assistant-editor workflow for inspecting
media that is already in a Premiere project, proposing deterministic
organization and metadata changes, applying only an approved subset, and
recording what is known about the result. It is deliberately a workflow around
existing MCP actions, not a claim that an AI can make editorial decisions.

There is **no current `project_intake` MCP tool, facility-template schema, or
production-ready end-to-end intake workflow** in this repository. This document
is the contract for building one. The current source provides useful, narrower
building blocks:

- `verify_premiere_connection` is a read-only connection check that avoids
  returning project names, paths, and media details.
- Authenticated UXP discovery is capability-gated at the connected host; a
  failed UXP command must not silently fall back to CEP or QE.
- The authenticated UXP surface can inspect a compact revisioned project
  snapshot, Project-panel selection, bounded media health, proxy/ingest state,
  metadata, and project/Production storage state. It also has guarded project
  item organization and a reviewed organization-plan apply route.

Those are current source capabilities with their own limits, not evidence that
they work in every licensed Premiere build. See the [supported-actions
catalog](../supported-actions.md), [UXP capability foundation](../uxp-capability-foundation.md),
[stable workflow matrix](../uxp-stable-workflows.md), and [editorial workflow
host-validation runbook](../editorial-workflow-host-validation.md).

In this contract, **Current** means implemented in the source tree and
documented at the linked repository reference. **Proposed** means a required
addition for Project Intake; it must not be advertised as callable or
production-ready until it passes the acceptance gates below.

## Scope

### In scope

The first implementation MUST support a selected, explicit set of project
items in one connected project. It MAY propose only these classes of work when
the connected host advertises the necessary capability:

1. Read-only readiness checks: connection, host capability, active-project
   identity, project snapshot revision, Project-panel selection, bounded media
   health, proxy/ingest state, metadata state, and storage preflight.
2. Deterministic facility rules: expected bin destination, allowed color label,
   naming pattern, and allowlisted metadata fields.
3. Review-only organization plans that identify exact project-item IDs and
   expected parent IDs.
4. Explicitly approved bin creation, moves, color labels, and allowlisted
   metadata updates through documented UXP operations.
5. A redacted operation receipt with per-operation certainty and recovery
   instructions.

The workflow MUST begin read-only. A template check whose required host field is
not exposed by the selected capability MUST report `unsupported` or
`not_inspected`; it MUST NOT be inferred as a pass.

### Non-goals

Project Intake v0.1 MUST NOT:

- choose story, selects, pacing, or any other editorial judgment;
- import arbitrary files, scan disks, or treat a filesystem folder as the
  intake scope without a separate approved, workspace-gated import contract;
- inspect codecs, frame rates, audio-channel layouts, timecode, duplicate
  media, or proxy completeness unless the exact source field and its real-host
  support are added to the capability matrix;
- change a timeline, create a rough cut, replace media, relink media, attach a
  proxy, change ingest state, configure scratch disks, delete an item, or save
  a project as part of ordinary intake;
- call a generative, transcription, translation, cloud-analysis, or media
  upload provider;
- use filenames, a model guess, or a non-unique display name as mutation
  authority;
- claim atomic cross-command rollback, visual correctness, rendered-output
  correctness, copyright clearance, or production readiness.

Some excluded operations are separately exposed by the current UXP surface
(for example proxy attachment, relink, and storage configuration), but have
their own confirmation, workspace, non-undo, or verification boundaries. They
are intentionally outside this contract. See [supported actions](../supported-actions.md)
and [local-first editorial workflow boundaries](../ai-editorial-workflows.md).

## Personas and authority model

| Actor | May do | Must not do |
| --- | --- | --- |
| Assistant editor (operator) | Select the intake scope, review findings, edit the proposed plan, approve or reject a concrete plan, inspect the receipt. | Approve a plan on behalf of another person or bypass a stale-plan check. |
| Post supervisor (workflow owner) | Publish an approved template version, decide the permitted operation classes, review exceptions and pilot evidence. | Treat a receipt as proof of picture, sound, or delivery quality. |
| Facility administrator | Configure local bridge installation, approved workspace policy, identity/role integration, and retention policy. | Put secrets, native paths, media names, or transcripts into persistent workflow checkpoints. |
| MCP client / model | Request inspection and construct a plan strictly from the template and returned evidence. | Create its own template, self-approve, invent targets, or treat a recommendation as mutation authority. |
| UXP bridge / Premiere host | Advertise capabilities, execute a documented operation, and return its command-specific readback. | Establish licensed-host validity, visual quality, or an unexposed postcondition by itself. |

**Proposed authority rule:** `inspect` requires read authority and an
authenticated, connected host where UXP data is used. `plan` and `preview` are
non-mutating. `confirm` requires an attributable human identity plus the exact
plan digest. `apply` requires `edit` authority, a current host capability
attestation, the same project identity/revision, and an unexpired confirmation.
Only the UXP route is eligible for Project Intake mutations. CEP/QE fallback is
forbidden even if a similarly named legacy action is available.

The existing reviewed organization route already uses server-issued plan and
preview-confirmation material, stable source/parent guards, and UXP-only bin
transactions; it reports partial completion instead of rolling back a prior
bin creation. Project Intake MUST preserve those semantics rather than wrap
them in an "all-or-nothing" claim. See [local-first editorial workflows](../ai-editorial-workflows.md)
and [`apply_editorial_organization_plan`](../supported-actions.md).

## Required state machine

Each request has one immutable `requestId`; each planned mutation has a unique
`operationId`. A state transition is append-only in the proposed receipt ledger.
The only mutation state is **Apply**.

```text
Inspect -> Plan -> Preview -> Confirm -> Apply -> Verify -> Receipt
                 |          |          |         |
                 +-> Reject +-> Expire +-> Stop -+
```

| State | Required behavior | Mutation allowed? |
| --- | --- | --- |
| **Inspect** | Verify the intended backend, collect only capability-supported evidence, resolve stable target IDs, and capture project/revision locks. | No |
| **Plan** | Evaluate the immutable template against the inspection snapshot. Produce explicit findings and individual candidate operations. | No |
| **Preview** | Re-inspect the target project and guards, calculate a canonical plan digest, show before/after intent and limitations, then issue an opaque confirmation token. | No |
| **Confirm** | Record an identifiable human's explicit approval of the exact template version, plan digest, target project, and expiry. Any edit creates a new plan. | No |
| **Apply** | Re-check host capability, project identity/revision, confirmation, and every operation guard immediately before dispatch. Execute bounded operations; do not auto-retry an uncertain commit. | Yes, only the approved operations |
| **Verify** | Reinspect the exact host state exposed for each completed operation. Classify each result with a certainty state; stop on an unknown mutation or policy-defined failure. | No new mutation |
| **Receipt** | Persist or return a privacy-redacted, append-only record of the plan, approvals, results, certainty, evidence references, and recovery instructions. | No |

### Preconditions and stop conditions

The workflow MUST stop before mutation when any of the following is true:

- no active authenticated UXP bridge or the required command is not advertised;
- the selected project cannot be identified by a stable host project ID/GUID;
- the active project changed after Inspect or Preview;
- the current project/context revision differs from the preview lock;
- the template version/digest, plan digest, confirmation token, operator
  identity, or policy scope differs from the approved value;
- any target resolves to zero or multiple project items, or lacks an expected
  parent guard for a move;
- a confirmation expires, is rejected, or is not attributable to a human;
- an operation would be outside the template's permitted operation types or
  metadata allowlist.

The current project-context and editorial-plan foundations already reject stale
context/timeline revisions and keep review receipts separate from mutation
authority. Their snapshot is a useful input, but it does not prove that the
live host stayed unchanged; Project Intake therefore MUST re-inspect the host
immediately before Apply. See [project-context invalidation](../project-context-engine.md)
and [editorial-plan workflow](../ai-editorial-workflows.md).

## Stable IDs, revision locks, and digests

### Current identifiers to reuse

- **Host project identity:** use the UXP project GUID/ID returned by the
  revisioned project snapshot or project-session surface. Do not substitute a
  project name or path.
- **Project-item identity:** use the UXP Project-panel item ID. A display name
  may appear in preview copy but is never a mutation selector.
- **Parent identity:** every move records the exact `expectedParentId` from
  inspection and must fail if it changed before dispatch.
- **Host snapshot revision:** retain the `project.snapshot` revision from the
  same inspection pass as the resolved IDs.
- **Context revisions:** if local project context is used, retain its source,
  timeline, and combined context revisions separately. The current context
  engine hashes persisted project/media-path identities, and distinguishes a
  source change from a timeline-placement change.

The current project snapshot and Project-panel selection resolver are bounded
host reads; the current organization operations use stable project-item and
parent guards. See [UXP capability foundation](../uxp-capability-foundation.md),
[next-ten workflow matrix](../uxp-next-ten-workflows.md), and [project context
engine](../project-context-engine.md).

### Proposed locking algorithm

1. Inspect the explicitly selected project/items and capture `hostProjectId`,
   `hostSnapshotRevision`, `selectedItemIds`, and each selected item's current
   parent ID.
2. Canonicalize the approved template, the plan, and the selected target list
   using deterministic key ordering and UTF-8 JSON. Compute SHA-256 digests
   for the template and plan.
3. Bind the preview confirmation to the host project ID, snapshot revision,
   template digest, plan digest, capability-attestation ID, operator identity,
   and expiry.
4. Immediately before each operation, reacquire the minimal relevant host
   state. Reject a changed project ID, stale snapshot/revision, missing
   capability, changed parent, changed metadata guard, or changed selection.
5. Use a unique `operationId` for every host mutation. An operation that times
   out or loses the bridge after dispatch is **not** repeated automatically;
   it must be inspected before a human decides whether to create a new plan.

The digest and attestation binding are proposed. The repository already uses
opaque confirmation tokens and revision-locked previews in its editorial
workflow, while the proposed metadata batch planner calls for an exact project
revision, plan digest, per-item certainty, and no retry of unknown commits.
See [editorial workflow](../ai-editorial-workflows.md) and [metadata batch planner
recommendation](../recommendations/2026-08-18-round-2/38-metadata-batch-planner.md).

## Contract schemas

The following are proposed JSON contract shapes. They are intentionally
separate from existing individual MCP tool schemas. They use synthetic IDs and
contain no native paths, real project names, media names, prompts, transcript
content, or credentials.

### Intake request

```json
{
  "schemaVersion": "project-intake-request/v0.1",
  "requestId": "pi-20260822-0001",
  "template": {
    "id": "documentary-intake",
    "version": "3.2.0",
    "sha256": "sha256:<template-digest>",
    "permittedOperations": ["create_bin", "move_item", "set_color", "update_metadata"],
    "organizationRules": [
      {
        "ruleId": "interview",
        "destination": { "parentBinId": "bin-root", "name": "Interviews", "colorIndex": 4 },
        "match": { "mode": "operator-selected-only" }
      }
    ],
    "metadataAllowlist": ["project.description", "xmp.dc:subject"]
  },
  "scope": {
    "hostProjectId": "project-guid-redacted",
    "projectViewId": "view-redacted",
    "selectedProjectItemIds": ["item-redacted-01", "item-redacted-02"]
  },
  "policy": {
    "id": "facility-default",
    "version": "1",
    "requireHumanConfirmation": true,
    "allowPersistentContext": false
  }
}
```

Validation requirements: the template is immutable/versioned; IDs are unique;
the scope contains at least one exact host item ID; every metadata key is
allowlisted; and the caller cannot widen the template's operation set. A rule
using a semantic filename match is outside v0.1. The existing organization plan
requires caller-supplied rules and deliberately does not infer categories from
filenames; this contract keeps the same safety posture. See [local-first
editorial workflows](../ai-editorial-workflows.md).

### Inspection and proposed plan

```json
{
  "schemaVersion": "project-intake-plan/v0.1",
  "requestId": "pi-20260822-0001",
  "state": "preview",
  "binding": {
    "hostProjectId": "project-guid-redacted",
    "hostSnapshotRevision": "uxp-redacted",
    "templateSha256": "sha256:<template-digest>",
    "capabilityAttestationId": "proposed-attestation-id"
  },
  "findings": [
    {
      "findingId": "finding-01",
      "kind": "organization",
      "status": "actionable",
      "targetId": "item-redacted-01",
      "evidence": { "expectedParentId": "bin-root" },
      "message": "Selected item is approved for the configured destination."
    },
    {
      "findingId": "finding-02",
      "kind": "codec",
      "status": "unsupported",
      "message": "No Project Intake codec-field capability is implemented in this contract version."
    }
  ],
  "operations": [
    {
      "operationId": "pi-op-01",
      "type": "move_item",
      "target": { "projectItemId": "item-redacted-01", "expectedParentId": "bin-root" },
      "destination": { "binId": "bin-interviews" },
      "expectedPostcondition": { "parentId": "bin-interviews" },
      "authority": "human-confirmed-edit"
    }
  ],
  "limitations": [
    "Host readback establishes only exposed structural fields.",
    "No render, playback, or editorial-quality verification is included."
  ],
  "planSha256": "sha256:<plan-digest>",
  "confirmation": { "required": true, "expiresAt": "2026-08-22T20:00:00Z" }
}
```

Every finding MUST say whether it is `pass`, `actionable`, `warning`,
`unsupported`, `not_inspected`, or `blocked`; absence of a finding is never a
pass. Every mutation operation MUST provide an exact stable target, precondition,
expected postcondition, authority class, and recovery instruction. The
`capabilityAttestationId` is proposed: the existing recommendation describes a
nonce-bound, short-lived host capability attestation, but it is not a current
production feature. See [host capability attestation recommendation](../recommendations/2026-08-18-round-2/30-host-capability-attestation.md).

### Receipt

```json
{
  "schemaVersion": "project-intake-receipt/v0.1",
  "receiptId": "pir-20260822-0001",
  "requestId": "pi-20260822-0001",
  "endedState": "receipt",
  "binding": {
    "hostProjectId": "project-guid-redacted",
    "hostSnapshotRevision": "uxp-redacted",
    "templateSha256": "sha256:<template-digest>",
    "planSha256": "sha256:<plan-digest>",
    "sourceCommit": "<40-character-source-sha>",
    "panelBuild": "<panel-build-hash>"
  },
  "approval": {
    "approvedBy": "operator-pseudonym-or-enterprise-user-id",
    "approvedAt": "2026-08-22T19:00:00Z",
    "confirmationId": "opaque-confirmation-token"
  },
  "operations": [
    {
      "operationId": "pi-op-01",
      "type": "move_item",
      "result": "structurally_verified",
      "verificationBoundary": "project_item_parent_readback",
      "evidenceRefs": ["redacted-host-response-ref"],
      "recovery": "Use Premiere Undo after visually confirming the item and destination."
    }
  ],
  "summary": { "planned": 1, "applied": 1, "structurallyVerified": 1, "unknown": 0 },
  "privacy": { "nativePathsIncluded": false, "mediaNamesIncluded": false, "transcriptContentIncluded": false },
  "receiptSha256": "sha256:<canonical-receipt-digest>"
}
```

`receiptSha256` is a proposed integrity checksum, not a signature, C2PA claim,
or proof that no later Premiere edit occurred. Receipt storage/transport and
tamper-evident signing require a separate security design. The existing
host-validation runbook requires redacted host facts, fixture checksum, before/
after evidence, structured response, and Undo evidence for a passed mutation;
Project Intake receipts SHOULD reference the same kind of evidence without
embedding sensitive data. See [host-validation runbook](../editorial-workflow-host-validation.md).

## Result certainty

The receipt MUST report a result for the workflow and for every proposed
operation. The following contract normalization is **proposed**; it maps current
command-specific UXP outcomes without weakening their stated boundaries.

| Certainty | Meaning | Retry rule |
| --- | --- | --- |
| `planned` | No mutation was dispatched. | A new plan may be created. |
| `rejected_before_mutation` | A validation, authority, freshness, or capability check stopped the operation before dispatch. | Correct the cause and start a new Inspect/Plan cycle. |
| `committed_unverified` | Premiere accepted/committed the command, but the contract lacks a required readback for the requested effect. | Never retry automatically; inspect the host before a human decides next action. |
| `structurally_verified` | The command-specific host readback matches the expected structural postcondition. | Do not retry; this is not visual, playback, or render proof. |
| `render_verified` | A separately specified exported artifact was verified by the applicable output-file/render procedure. | Not emitted by ordinary v0.1 Project Intake operations. |
| `partial` | At least one operation is structurally verified and a later operation did not complete or is uncertain. | Stop the remaining batch, inspect known changes, then create a new plan. |
| `unknown_mutation` | Dispatch may have reached Premiere, but a timeout/disconnect/invalid response prevents knowing whether it changed state. | Do not retry; require host inspection and a fresh human decision. |
| `failed` | The operation failed before a confirmed postcondition; the receipt must state whether mutation is known absent or unknown. | Follow the classified recovery instruction. |
| `unsupported` / `not_run` | The capability or test evidence is absent. | Do not substitute another backend or a heuristic. |

Current UXP workflows already use command-specific readback and, for some
operations, `committed_unverified`; the current organization route reports
verified actions as `partial` if a later action fails and never silently rolls
back or retries an unknown commit. Current `verified` is structured host
readback, not licensed-host visual/render validation. See [third-wave workflow
matrix](../third-wave-uxp-workflows.md), [editorial workflows](../ai-editorial-workflows.md),
and [transaction deadline/readback recommendation](../recommendations/2026-08-18-round-2/32-transaction-deadline-readback.md).

## Failure taxonomy and recovery

| Code | Classification | Required receipt data and recovery |
| --- | --- | --- |
| `PI_CONNECTION_UNAVAILABLE` | `rejected_before_mutation` | Backend requested, connection-check result, and instruction to reconnect; no fallback mutation. |
| `PI_CAPABILITY_MISSING` | `unsupported` | Required command and advertised capability set; leave the check unresolved. |
| `PI_PROJECT_IDENTITY_CHANGED` | `rejected_before_mutation` | Expected/current redacted project IDs; restart Inspect. |
| `PI_REVISION_STALE` | `rejected_before_mutation` | Expected/current revision fingerprints; restart Inspect and Preview. |
| `PI_TEMPLATE_OR_PLAN_MISMATCH` | `rejected_before_mutation` | Template/plan digest identifiers only; obtain a new approval. |
| `PI_CONFIRMATION_INVALID` | `rejected_before_mutation` | Non-sensitive reason: missing, expired, rejected, or wrong approver; do not dispatch. |
| `PI_TARGET_AMBIGUOUS` | `rejected_before_mutation` | Candidate stable-ID count and rule ID; require the operator to reselect exact items. |
| `PI_GUARD_FAILED` | `rejected_before_mutation` | Target ID and expected/current parent or field fingerprint; re-inspect instead of forcing a move. |
| `PI_POLICY_DENIED` | `rejected_before_mutation` | Policy version and denied operation class; administrator/supervisor must change policy explicitly. |
| `PI_WORKSPACE_DENIED` | `rejected_before_mutation` | Workspace access mode only; ordinary v0.1 scope should not need a path workaround. |
| `PI_HOST_MODAL_OR_TIMEOUT` | `unknown_mutation` if dispatched, otherwise `rejected_before_mutation` | Last known phase and operation ID; inspect Premiere before retry. |
| `PI_INVALID_HOST_READBACK` | `unknown_mutation` | Raw response stays redacted; stop the batch and inspect the stated target. |
| `PI_PARTIAL_APPLY` | `partial` | Per-operation certainty, already changed IDs, remaining operations, and explicit Undo/manual recovery guidance. |
| `PI_PRIVACY_VIOLATION` | `rejected_before_mutation` | Field class rejected, not its value; redact and create a new request. |

The implementation MUST preserve the last known state if Apply begins: preflight,
dispatch, host return, and readback are distinct phases. It MUST NOT report a
successful rollback merely because a later operation failed. This follows the
current organization-plan and transaction/readback boundaries. See [editorial
workflows](../ai-editorial-workflows.md) and [transaction deadline/readback
recommendation](../recommendations/2026-08-18-round-2/32-transaction-deadline-readback.md).

## Privacy, data handling, and audit rules

### Contract rules (proposed)

1. Project Intake MUST be local-first by default. It MUST enumerate any network
   egress before a facility enables it and MUST not transmit footage, native
   paths, media names, transcript content, metadata values, prompts, or receipt
   bodies to telemetry or a model provider without a separately approved data
   path and retention policy.
2. Receipts MUST use stable IDs or one-way/deliberately redacted identifiers;
   they MUST exclude native paths, media names, transcript content, raw metadata
   values, credentials, persistent workspace tokens, and full raw host events.
3. Facility templates MUST be versioned and may contain rule IDs, field keys,
   and policy references. They MUST NOT contain secrets, production media paths,
   customer content, or hidden broad filesystem roots.
4. Persistent state MUST be opt-in and deletable. The workflow MUST surface
   where it is stored, retention duration, and the clear action.
5. The authoritative receipt is an operation record, not a training-data grant,
   provenance assertion, copyright determination, or productivity claim.

### Current constraints to honor

The current project-context engine is opt-in and local; it persists project
names, hashed project/media-path identities, bounded timeline metadata, and
explicit enrichments, while not persisting native paths. It also discards
enrichment keys resembling paths, passwords, tokens, secrets, or API keys.
Project Intake MUST obtain explicit operator consent before using that store and
MUST clear it when the chosen retention policy requires it. See [project context
storage rules](../project-context-engine.md).

The current UXP workspace access model returns neither the native workspace root
nor persistent token over MCP, and current workflow checkpoints forbid secrets,
paths, transcripts, and media names because persistent values may sync with
cloud projects. Project Intake MUST not bypass either boundary. See [README UXP
workspace policy](../../README.md) and [third-wave checkpoints](../third-wave-uxp-workflows.md).

## Host validation matrix

All cases below are **proposed Project Intake validation cases** and start as
`not_run`. Unit, contract, lint, and mock-bridge tests may validate schemas and
failure handling, but cannot mark a case licensed-host verified. Use a copied,
disposable project with generated, non-sensitive fixture media; retain redacted
responses, before/after Project-panel evidence, and Undo evidence. This extends
the existing [editorial host-validation runbook](../editorial-workflow-host-validation.md).

| ID | Coverage | Procedure | Required pass evidence | Boundary retained |
| --- | --- | --- | --- | --- |
| `PI-PLAN-001` | Each supported MCP client path on Windows and macOS | Inspect a fixture selection; create and preview a plan with one unsupported check. | No mutation; IDs/revision/digest present; unsupported check remains unresolved. | Does not prove host mutation. |
| `PI-ORG-001` | Each claimed Premiere/UXP/OS combination | Create or resolve one bin, move one selected item, apply one color rule. | Exact stable IDs/parent/color readback, before/after Project-panel captures, and Undo restores fixture. | Structural UI state only; no editorial-quality claim. |
| `PI-ORG-002` | Same as `PI-ORG-001` | Change the source parent after Preview. | Guard rejects before move; any earlier verified create is recorded as partial and manually undone. | No atomic rollback claim. |
| `PI-META-001` | Each claimed Premiere/UXP/OS combination | Read and update one allowlisted metadata field, including Unicode and no-op cases. | Requested-field readback and Undo evidence. | Field readback does not validate an external asset-management system. |
| `PI-MEDIA-001` | Each claimed Premiere/UXP/OS combination | Inspect offline/proxy health for 1, 64, and over-limit selections. | Bounded per-item receipt; no path disclosure without explicit approved request. | Does not establish real-media availability beyond exposed host state. |
| `PI-PRODUCTION-001` | Project and Production fixture where the host advertises it | Run storage/ingest preflight without mutation. | Redacted preflight response and no project-state change. | Does not validate Production configuration mutation. |
| `PI-FAULT-001` | Each claimed Premiere/UXP/OS combination | Disconnect/timeout after a dispatched fixture mutation; repeat with invalid readback. | `unknown_mutation`, no automatic retry, human inspection decision recorded. | Does not prove the prior command did or did not mutate. |
| `PI-PRIVACY-001` | Windows and macOS | Attempt to place path, token-like, transcript, and media-name fields in template, receipt, and checkpoint inputs. | Rejection/redaction before persistence or output. | Does not prove third-party provider retention policy. |

Each report MUST include source commit, panel build hash, Premiere version, OS
version, MCP client, fixture revision/checksum, case status, and evidence
references. A case is `passed`, `failed`, `unsupported`, or `not_run`; a
passing schema validator or an MCP response labeled `verified` is insufficient
without human review of the exact host and post-state evidence. The repository
already provides `npm run validate:host-report -- path/to/redacted-report.json`
for its documented redacted report format; Project Intake SHOULD either use its
compatible evidence shape or extend that validator in a separately reviewed
change. See [host-validation report rules](../editorial-workflow-host-validation.md).

## Acceptance gates

These are proposed promotion gates. They are not met merely because this
document exists or because current automated tests pass.

### Contract and implementation gate

- A versioned JSON schema validates request, plan, confirmation, receipt, and
  each failure/result state.
- Tests prove no mutation is reachable from Inspect, Plan, Preview, Confirm,
  Verify, or Receipt.
- Tests prove stale project/revision/template/plan/confirmation/parent guards
  fail before dispatch.
- Tests prove duplicate or ambiguous targets, unallowlisted metadata, and
  forbidden operations fail before dispatch.
- Tests prove a UXP failure never falls back to CEP/QE and an unknown commit is
  never automatically retried.
- Tests prove receipts redact forbidden fields and capture per-item partial
  completion with last known phase.
- Documentation lists every required host command, version/capability gate,
  postcondition, certainty boundary, and recovery instruction.

### Licensed-host pilot gate

- At least 100 documented, real-host Project Intake runs across every
  Premiere/OS/client combination claimed for the workflow, using the matrix
  above and the exact source/panel builds being considered.
- Zero wrong-project or wrong-project-item mutations in those runs.
- At least 99% of attempted supported operations reach their specified
  structural postcondition, with every exception classified and recoverable.
- Every mutation has an attributable human confirmation, exact target IDs,
  before/after evidence, and Undo/manual-recovery evidence appropriate to the
  operation.
- No failed or disconnected apply is labeled successful without the required
  readback; no automatic retry follows an uncertain dispatch.
- At least two design-partner teams repeat the workflow after supervised use.
  Any time-saving claim is based on recorded baseline and assisted durations,
  sample size, and rework—not an estimate.

### Security and release gate

- The deployment mode, model routing, network egress, identity/role behavior,
  audit retention/deletion, update channel, and emergency revocation path are
  documented and accepted by the pilot facility.
- The signed build and source/panel hashes in every receipt are reproducible.
- A privacy review confirms that templates, context, telemetry, receipts, and
  host reports follow the rules in this contract.
- Marketing says "proposed," "pilot," "licensed-host verified for listed
  combinations," or "unsupported" as applicable; it never extrapolates a
  successful fixture run to all productions.

Until every applicable gate is met, Project Intake is an implementation/pilot
workflow only. Current automated coverage and command-specific UXP readback are
valuable engineering evidence, but remain separate from licensed-host and
rendered-output evidence. See [verification matrix](../ai-editorial-workflows.md)
and [reproducible live-host lab recommendation](../recommendations/2026-08-18/17-live-host-lab.md).

## Implementation checklist

1. Add the proposed schemas and a canonical-digest implementation without
   changing existing individual tool semantics.
2. Add a read-only `inspect` and `plan` path first; report unavailable checks
   explicitly rather than adding heuristics.
3. Reuse the existing reviewed UXP organization route for a narrow first apply
   adapter; do not expose direct raw bin operations as the guided workflow.
4. Add metadata only after a separate exact field allowlist, readback mapping,
   and host tests exist.
5. Add confirmation/receipt persistence behind an explicit privacy and identity
   design; do not put receipt bodies in cloud-synced workflow checkpoints.
6. Run the host matrix and preserve redacted evidence before widening the
   supported-version statement.
