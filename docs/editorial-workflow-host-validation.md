# Editorial workflow licensed-host validation

## Status

This runbook is a release gate for `platform_cutdown` planning and
`apply_editorial_organization_plan`. It is not performed by the repository's
unit, contract, lint, or build checks. Record every completed run with the
exact source commit, panel build hash, Premiere version, operating system, and
fixture revision before promoting a claim beyond automated-contract coverage.

The local test suite proves that cutdown planning stays local and that the
orchestrator rejects incomplete UXP readback contracts. It does **not** prove
that a licensed Premiere host created, moved, colored, displayed, saved, or
undid an item.

## Safety setup

1. Use a copy of a disposable `.prproj`, never a customer project.
2. Capture a before screenshot of the Project panel and save the fixture
   project under a new name.
3. Record the exact server commit, UXP panel build hash, Premiere build,
   operating-system version, and MCP client.
4. Use only generated fixture media with non-sensitive names. Do not include
   local paths, project names, media names, prompts, transcripts, tokens, or
   customer content in the shared report.
5. Save redacted bridge responses and an after screenshot. Verify Undo restores
   the original project state before closing the fixture.

## Required matrix

| ID | Host coverage | Procedure | Pass evidence | Boundary that remains |
| --- | --- | --- | --- | --- |
| EWP-PLAN-001 | Windows and macOS; supported server install | Capture context, create a `platform_cutdown` plan for a 1080x1920 target, then preview it. | The plan names the captured source sequence and target dimensions; no UXP command or project mutation occurred. | This is local planning only; it does not prove clone, Auto Reframe, captions, or export. |
| EWP-ORG-001 | Premiere 25.6+ UXP host on Windows and macOS | Run one reviewed organization recommendation that creates a bin, moves one source, and applies a color label. | Redacted `bins.create`, `bins.move`, and `bins.color` responses each have their documented readback boundary; Project-panel screenshot confirms bin ID/name, parent, and color; Undo restores the fixture. | Structural Project-panel state only, not editorial quality. |
| EWP-ORG-002 | Same host matrix | Supply an intentionally stale expected-parent ID for a source. | The move is rejected; no source parent changed; any earlier committed create is reported as `partial` and is manually undone. | A stale guard must not be described as atomic rollback. |
| EWP-ORG-003 | Same host matrix | Supply an existing destination bin and move a single source without a color rule. | The response contains the requested destination ID and an `after.parentId` matching it, plus the `project_item_parent_readback` verification metadata. | The structured response is not visual or render verification. |

Run EWP-PLAN-001 on every supported client/operating-system release path. Run
EWP-ORG-001 through EWP-ORG-003 on every Premiere/OS combination claimed for
the guarded UXP apply route. A failed, unsupported, or not-run result is a
valid report outcome; do not replace it with a mock result or broaden the
marketing claim.

## Report shape

Store a redacted report outside source control unless it contains only fixture
data. Each case needs a `status` of `passed`, `failed`, `unsupported`, or
`not_run`, the test ID, host facts, source commit, a fixture checksum, and
evidence references. A `passed` mutation case additionally requires before and
after Project-panel captures, the structured UXP response, and Undo evidence.

```json
{
  "sourceCommit": "<40-character git SHA>",
  "host": { "os": "Windows|macOS", "premiereVersion": "<version>", "panelBuild": "<hash>" },
  "fixture": { "revision": "<non-sensitive ID>", "sha256": "<SHA-256>" },
  "cases": [
    { "id": "EWP-ORG-001", "status": "not_run", "evidence": [] }
  ]
}
```

Do not call a case licensed-host verified merely because `npm test` passed or
because the UXP panel reported `verified`. A reviewer must inspect the recorded
host and post-state evidence for the exact claimed combination.
