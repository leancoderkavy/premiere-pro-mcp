# Recommendation 29: UXP API-era compatibility adapter

## Evidence

Adobe changed `Sequence.setSelection` in Premiere 26.3 from asynchronous `Promise<boolean>` to synchronous `boolean`, demonstrating that host-version differences can change call semantics.

- [Adobe UXP changelog](https://developer.adobe.com/premiere-pro/uxp/changelog)
- [Adobe Sequence reference](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequence)

## Proposed improvement

Centralize version-sensitive Adobe calls behind typed adapters that normalize sync/async returns without guessing support. Generate an audited compatibility table from official declarations and runtime probes.

## Acceptance criteria

- The 25.x and 26.3 selection signatures have explicit contract fixtures.
- Unknown versions fail closed for mutations and expose diagnostics.
- Runtime probes do not mutate user projects.
- Direct version-sensitive calls outside the adapter fail lint or review checks.

Contract fixtures are not a substitute for runs in each licensed host version.
