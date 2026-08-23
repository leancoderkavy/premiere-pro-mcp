# Project Intake host-validation record

Date: 2026-08-22
Platform: Windows 11
Host: Adobe Premiere Pro 2026
Candidate: 1.13.0

## Scope

Validate the preview-only `preview_project_intake` tool through the installed
CEP bridge without opening or modifying an existing editorial project.

## Setup

- Created a disposable empty Premiere project under the repository's ignored
  `test-results` directory.
- Confirmed the project file was written (5,103 bytes).
- Ran `node dist/index.js --diagnose-cep`; the installed connector passed its
  filesystem and configuration checks.
- Did not open the existing recent project or import user media.

## Result

Blocked before MCP execution. Premiere became unresponsive while entering the
editing workspace for the disposable project. The same behavior recurred after
terminating only the hung Premiere process, restarting Premiere, and reopening
only the disposable project. The CEP panel could not be opened, so no bridge
command and no `preview_project_intake` call ran.

## Evidence boundary

- Connector installation diagnosis: passed.
- Deterministic engine and MCP handler automated tests: passed in the release
  worktree.
- Real Premiere/CEP tool execution: not demonstrated.
- Project mutation, media import, render verification, save/reopen verification,
  and macOS host coverage: not performed.

This record is failure evidence for the host gate, not evidence that Project
Intake works in Premiere 2026.

## 2026-08-23 follow-up

- Audited the public `v1.13.0` GitHub release connector before installation.
  Its SHA-256 was
  `583949dd0decd5ed91478ce3c39a75c67512b5b06ac6d1db712eb03ee9701bf7`,
  and its embedded CEP manifest reported `1.13.0`.
- Installed that exact signed connector and confirmed the local installer
  diagnosis passed.
- Adobe Premiere Pro 2026 opened the disposable project and rendered the empty
  editing workspace, but became unresponsive when the Window menu was invoked.
  No CEP panel command or MCP tool call completed.
- Adobe Premiere Pro (Beta) opened the same fixture through its required
  conversion flow into a separate disposable copy. The converted project then
  stalled on a black editing canvas before the CEP panel could be opened.

The repeated host failure now covers the stable and Beta applications with the
audited signed connector. It still does not demonstrate a
`preview_project_intake` execution, and it does not justify a real-host support
claim for this workflow.
