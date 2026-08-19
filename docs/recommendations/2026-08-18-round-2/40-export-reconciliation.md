# Recommendation 40: export artifact reconciliation

## Evidence

Adobe’s stable `EncoderManager` supports Premiere and AME export workflows, and its events distinguish queue, progress, completion, error, and cancellation.

- [Adobe EncoderManager reference](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/encodermanager/)
- [Adobe UXP changelog](https://developer.adobe.com/premiere-pro/uxp/changelog)

## Proposed improvement

Add an export reconciler that joins operation receipts, encoder events, expected destination, artifact stat/hash, and optional media probe into one state machine. On restart, recover only from durable evidence and never re-submit an uncertain job automatically.

## Acceptance criteria

- States distinguish queued, rendering, cancelled, failed, completed-no-artifact, and verified-artifact.
- Event gaps and duplicate events produce explicit uncertainty.
- Overwrite policy and artifact identity are bound to the original confirmation.
- Windows/macOS live-host runs cover Premiere and AME paths.

An artifact hash proves file identity, not visual or editorial correctness.
