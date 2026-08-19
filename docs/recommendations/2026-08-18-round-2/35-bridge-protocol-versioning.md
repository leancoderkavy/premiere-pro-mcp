# Recommendation 35: versioned UXP bridge protocol

## Evidence

Adobe’s UXP runtime and Premiere API surface evolve independently, while this project connects the panel through an authenticated loopback WebSocket.

- [Understanding UXP APIs](https://developer.adobe.com/premiere-pro/uxp/resources/fundamentals/apis)
- [Adobe UXP changelog](https://developer.adobe.com/premiere-pro/uxp/changelog)

## Proposed improvement

Version the panel/server hello, command envelope, event envelope, error shape, and feature flags. Negotiate the highest mutually supported bridge version and reject ambiguous downgrade.

## Acceptance criteria

- Cross-version fixtures cover the current and previous supported bridge version.
- Unknown commands and fields have documented forward-compatibility behavior.
- Downgrade cannot bypass authentication or capability checks.
- Fuzz tests bound nesting, arrays, strings, and numeric values after frame parsing.

Bridge negotiation is distinct from MCP protocol and Adobe host-version negotiation.
