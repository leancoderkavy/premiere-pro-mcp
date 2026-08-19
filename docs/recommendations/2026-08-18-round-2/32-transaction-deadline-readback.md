# Recommendation 32: transaction deadline and readback budget

## Evidence

Adobe UXP mutations are expressed as actions and executed through project transactions; many surrounding reads remain asynchronous and can stall independently.

- [Adobe Sequence reference](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequence)
- [Understanding UXP APIs](https://developer.adobe.com/premiere-pro/uxp/resources/fundamentals/apis)

## Proposed improvement

Define separate deadlines for preflight, synchronous action construction, transaction execution, and post-commit readback. Return a receipt that identifies the last known phase and never retries an uncertain mutation automatically.

## Acceptance criteria

- Tests inject timeouts at every phase and assert mutation certainty.
- Readback exhaustion returns `committed_unverified`, not false failure.
- The scheduler prevents a timed-out call from releasing unsafe conflicting work.
- Phase budgets are configurable within capped limits.

A completed transaction still requires host readback or human observation for outcome claims.
