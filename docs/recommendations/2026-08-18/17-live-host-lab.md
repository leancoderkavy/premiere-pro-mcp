# Recommendation 17: reproducible live-host compatibility lab

## Evidence

Adobe's 26.3 UXP changelog includes breaking and new APIs, while automated adapters
cannot establish behavior in licensed Premiere builds. The coverage manifest keeps
live-host evidence separate but lacks a reproducible collection protocol.

- [Adobe Premiere UXP changelog](https://developer.adobe.com/premiere-pro/uxp/changelog)

## Proposed improvement

Package privacy-safe small/medium/large fixture manifests and a manual host runner.
Record host/OS versions, artifact SHA-256, backend, command, timing phases, observable
readback, and outcome—never project/media names, paths, transcripts, or arguments.

## Acceptance

- Reports distinguish verified, committed-unverified, unsupported, failed, and not-run.
- Evidence promotion requires exact host, OS, artifact hash, command, and readback.
- CI validates schemas/fixtures without labeling mocks as Premiere.
- Reports include p50/p95/max dispatch, host, verification, and total latency.

The lab remains manual because CI is not a licensed interactive Premiere host.
