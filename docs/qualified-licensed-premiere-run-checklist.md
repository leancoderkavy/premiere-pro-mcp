# Qualified licensed-Premiere run checklist

This is an owner-run release gate. It records a real, licensed Adobe Premiere host
run; it is not satisfied by unit tests, a simulated connector, a package build, or a
Marketplace review.

## Safe setup

- [ ] Use a copy of a generated, disposable fixture project in an approved workspace.
  Never open, save, or mutate a customer project for release evidence.
- [ ] Record the candidate's full source SHA, MCP client/version, operating system,
  Premiere version/build, connector type and build hash, and fixture checksum.
- [ ] Start with `verify_premiere_connection` and `get_version_info`; retain redacted
  structured output. A connection with no document or active sequence is useful
  diagnostic evidence, not a completed workflow run.
- [ ] Capture a redacted before state. Exclude project paths, media names, prompts,
  credentials, and customer content.

## Required evidence

- [ ] Run the relevant row(s) in
  [editorial-workflow-host-validation.md](editorial-workflow-host-validation.md) on
  each Premiere/OS combination represented by the release claim.
- [ ] For every mutating case, retain before and after captures, the structured
  response/readback, and proof that Undo restored the fixture.
- [ ] Store the redacted report outside source control unless it contains only
  generated fixture data, then run
  `npm run validate:host-report -- path/to/redacted-report.json`.
- [ ] A human reviewer accepts the host facts and evidence before marketing language
  changes from package-supported to host-verified.

## Release boundary

A passing report means the evidence package is complete enough for human review. It
does not prove Marketplace approval, universal Premiere compatibility, or editorial
quality. A failed, unsupported, or `not_run` matrix entry remains a valid recorded
outcome and must not be replaced by a mock result.
