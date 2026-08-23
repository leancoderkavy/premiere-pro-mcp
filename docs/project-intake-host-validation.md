# Project Intake licensed-host validation

This runbook is the evidence gate for the v1.13.0, **preview-only**
`preview_project_intake` workflow. It is not run by unit, contract, lint, or
package checks. It does not authorize an apply workflow, because v1.13.0 does
not provide one.

The 2026-08-22 Premiere 2026 attempt is recorded as blocked before CEP and MCP
execution in [the host-validation record](industry/host-validation-2026-08-22.md).
Do not transform that blocked attempt into a passing report or backfill a
report from automated tests.

## What this report can establish

For one exact source commit, CEP panel build, Premiere build, operating system,
client, and generated fixture, a completed report can index evidence that:

| Case | Required observed assertion | Required redacted evidence |
| --- | --- | --- |
| `PIP-CONNECT-001` | `verify_premiere_connection` returned `overall: "ready"`. | Structured connection-response digest. |
| `PIP-PREVIEW-001` | `preview_project_intake` returned `applied: false`, `capture.pathDisclosure: "redacted"`, and `organizationPlan.applied: false`. | Structured preview-response digest. |
| `PIP-NO-MUTATION-001` | The Project panel did not change and the project was not saved by the preview call. | Before and after Project-panel capture digests plus the structured preview-response digest. |

The report is an evidence index, not the evidence itself. Its references are
opaque `evidence://` identifiers and SHA-256 digests; keep the separately
redacted artifacts in the approved evidence store. A validator pass means only
that a human reviewer has a complete, privacy-bounded package to inspect. It
never makes a host, client, build, or workflow universally supported.

## Safe procedure

1. Start from the exact candidate source commit and record its full SHA. Do not
   reuse a report from another build.
2. Use a generated disposable fixture with non-sensitive labels. Never open or
   save a customer project, and never use customer media, prompts, transcripts,
   or credentials as evidence.
3. Capture redacted before state, then call `verify_premiere_connection` and
   `preview_project_intake` with `include_paths: false`. The preview must remain
   bounded and non-mutating. Do not call an organization apply tool as part of
   this runbook.
4. Capture redacted after state before closing the fixture. If the host is
   unavailable, the bridge fails, the preview errors, or the before/after state
   differs, record the relevant case as `failed`, `unsupported`, or `not_run`.
   Do not retry a potentially uncertain host action as if it were idempotent.
5. Copy [the versioned template](project-intake-host-report.template.json) out
   of source control. Replace only its non-sensitive provenance values and
   opaque evidence references. The template itself is deliberately `not_run`.
6. Validate the shared report before review:

   ```bash
   npm run validate:project-intake-host-report -- path/to/redacted-report.json
   ```

7. A human reviewer compares the evidence artifacts to the report, the exact
   source commit, and the linked [schema](project-intake-host-report.schema.json).
   Only that reviewer can decide whether the listed combination has enough
   evidence for a narrowly worded host-validation record.

## Privacy and failure-closed rules

- The report accepts no notes, project names, media names, native paths,
  prompts, transcripts, tokens, passwords, or arbitrary evidence locations.
- All six privacy confirmations must be `true`; any local-path or
  credential-like content makes validation fail.
- A passed preview case requires a separate passed no-mutation case. A preview
  response alone cannot establish that Premiere state remained unchanged.
- Non-passing cases contain no evidence references in this minimal shared
  index. Retain any sensitive diagnostic artifacts only in the approved
  restricted store, not in a repository report.
- This is CEP-specific because v1.13.0 Project Intake is validated through the
  CEP bridge. It neither proves UXP behavior nor permits CEP/QE mutation
  fallback.

See the broader [editorial host-validation runbook](editorial-workflow-host-validation.md)
for mutation evidence rules. This Project Intake runbook is intentionally
narrower: it tests only the current read-only preview contract.
