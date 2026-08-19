# Recommendation 50: keyframe semantic verification

## Evidence

Adobe’s stable `ComponentParam` API exposes keyframe lists, values at time, and interpolation actions; `Keyframe` exposes position, value, and temporal interpolation mode.

- [Adobe ComponentParam reference](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/componentparam)
- [Adobe Keyframe reference](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/keyframe)

## Proposed improvement

Extend typed effect automation with a dry-run keyframe plan that canonicalizes tick positions, parameter value types, interpolation modes, and expected pre-state. After one transaction, read back the complete affected range and report semantic differences.

## Acceptance criteria

- Duplicate ticks, unsupported value shapes, invalid interpolation, and out-of-range times fail before mutation.
- Confirmation binds component identity, parameter identity, sequence revision, and plan digest.
- Unknown commit state is never automatically retried.
- Licensed-host fixtures cover scalar, boolean, color, and point parameters where supported.

Keyframe readback proves parameter state, not rendered visual correctness.
