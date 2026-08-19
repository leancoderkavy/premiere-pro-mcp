# Recommendation 39: sequence-sandbox verification mode

## Evidence

Adobe’s stable `Sequence.createCloneAction` can clone a sequence through an undoable action.

- [Adobe Sequence reference](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequence)

## Proposed improvement

Offer an opt-in verification mode that clones the target sequence, applies a proposed edit plan only to the clone, captures bounded structural diffs, and requires a separate confirmation before applying an independently revalidated plan to the original.

## Acceptance criteria

- Clone names and IDs are collision-safe and traceable to an operation receipt.
- The original sequence is never targeted during sandbox execution.
- Cleanup is explicit and refuses deletion if identity or revision changed.
- Tests cover clone failure, partial apply, user edits, and stale confirmation.

Success on a clone does not guarantee identical rendering or a safe original apply.
