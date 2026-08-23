# Licensed-host sweep

This is a reproducible reporting workflow for a real, licensed Premiere Pro
host. It is deliberately a **curated** connection-and-bounded-edit sweep, not
a claim that every registered tool has been run. CI can validate its report
shape, but it cannot supply licensed-host evidence.

The checked-in matrix is
[`licensed-host-sweep.matrix.json`](licensed-host-sweep.matrix.json). It covers
read-only connection checks for CEP and authenticated UXP plus one generated-
fixture marker mutation with an Undo check. An `unsupported`, `failed`, or
`not_run` outcome is useful evidence and must remain recorded as such.

[`licensed-host-sweep.template.json`](licensed-host-sweep.template.json) is a
static example of the same report shape. Prefer the generator so the source
commit and selected matrix cases are not copied by hand.

## Prepare a report

Use a generated, disposable fixture and write the report outside the repository
unless every input and artifact is deliberately public. The generator does not
open Premiere, read project data, or call MCP tools. It only records supplied
safe identifiers and the checked-out source SHA.

```bash
npm run prepare:host-sweep -- \
  --host-os Windows \
  --premiere-version 26.3.0 \
  --panel-build 0123abcd \
  --fixture-revision generated-fixture-v1 \
  --fixture-sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --output ../premiere-host-evidence/sweep.json
```

Add `--case LHS-CONNECTION-001` one or more times to create a smaller,
explicitly scoped run. The resulting report starts with every selected status
as `not_run`; it cannot create a passing result.

## Run and record

1. Fully close Premiere, install or repair the exact connector bytes under
   test, then reopen a copy of the generated fixture.
2. Record the operating-system, Premiere, panel-build, fixture, and source
   values in the generated report. Do not use an account, machine, project, or
   media name as an identifier.
3. Run each selected matrix case manually. Keep raw captures and any redacted
   structured response in the approved private evidence location, not in this
   JSON report.
4. Add opaque evidence references only, such as
   `{ "kind": "panel_state", "ref": "lhs-cep-ping-panel-001" }`.
   A reference cannot contain a path, URL, account, prompt, token, project
   name, or response content.
5. For `LHS-MARKER-UNDO-001`, retain before state, after state, structured
   response, and Undo proof. Do not mark it `passed` unless Undo restores the
   fixture.

## Validate before review

```bash
npm run validate:host-report -- ../premiere-host-evidence/sweep.json
```

The validator enforces
[`licensed-host-sweep.schema.json`](licensed-host-sweep.schema.json), matrix
membership, opaque evidence references, and the required evidence types for a
passed case. It rejects local paths, credential-like text, and fields that
could carry a raw response. A passing validation result means the record is
well-formed enough for human evidence review; it does not prove a tool,
version, or workflow is generally supported.

See also the focused
[editorial workflow host-validation runbook](editorial-workflow-host-validation.md)
for the planning and organization acceptance matrix.
