# Workflow proof runbook

## Status

This is a reproducible recording and evidence checklist, not a claim that a
licensed Premiere walkthrough has been recorded. The repository currently
ships a redacted template only. Do not attach customer projects, media,
transcripts, credentials, prompts, local paths, or raw bridge logs.

## Goal

Record one short, uncut, fixture-only workflow that makes the product's
boundaries visible:

1. Install the current package and connector on a supported computer.
2. Run `premiere-pro-mcp --doctor` and preserve its redacted result.
3. Open a disposable project in a licensed Premiere host, then perform the
   safe connection check through an MCP client.
4. Import a fixture caption artifact or use an existing fixture sequence.
5. Preview the exact proposed operation before applying any supported change.
6. Read back the resulting structural state and, where relevant, independently
   verify a generated artifact.
7. Record the current commit, package version, Premiere build, OS, connector
   build, client, fixture checksum, and every verification boundary.

The recording should label the difference between local installation,
client-to-host connection, structural readback, playback review, and rendered
output review. A successful build, panel response, or HTTP health check is not
substitute evidence for the next level.

## Safe fixture requirements

- Use generated, non-sensitive media and a disposable `.prproj` copy.
- Use opaque fixture IDs rather than project or media names in retained receipts.
- Redact the local paths, MCP configuration, tokens, prompt text, transcript
  content, and screenshots containing personal or customer material.
- Record a before state, an after state, and Undo/reopen evidence for each
  mutation shown.
- Stop and report `unsupported`, `failed`, or `not_run` when that is the
  observed outcome. Do not replace it with a mocked success or marketing claim.

## Publishable bundle

Before publishing a video or article, retain a fixture-only bundle containing:

- a copyable prompt or command sequence;
- a redacted `--doctor` output;
- the selected backend and exact package/connector versions;
- the pre-mutation plan or preview receipt;
- structural readback and any artifact verification result;
- separate playback or rendered-output review when claimed;
- a completed instance of
  [`workflow-proof-receipt.template.json`](workflow-proof-receipt.template.json).

The bundle is adequate for human review only when every retained item is
fixture-only and redacted. It never converts an unreviewed recording into a
general support claim for every Premiere or client version.
