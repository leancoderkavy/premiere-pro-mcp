# Recommendation 30: signed host capability attestation

## Evidence

Adobe documents host and UXP runtime version inspection, while Premiere APIs declare minimum versions per method. Static package declarations can therefore differ from the connected runtime.

- [Understanding UXP APIs](https://developer.adobe.com/premiere-pro/uxp/resources/fundamentals/apis)
- [Adobe UXP changelog](https://developer.adobe.com/premiere-pro/uxp/changelog)

## Proposed improvement

Have the authenticated panel produce a nonce-bound capability attestation containing host version, UXP version, plugin build hash, probed stable methods, and timestamp. Bind it to the current WebSocket connection and expire it quickly.

## Acceptance criteria

- Replayed, expired, cross-connection, and mismatched-build attestations are rejected.
- Probes are read-only and bounded.
- Tool discovery uses the attested intersection, not package-version assumptions.
- Diagnostics distinguish declared, probed, and live-verified capability.

Attestation proves what the panel observed, not that a later host operation succeeded.
