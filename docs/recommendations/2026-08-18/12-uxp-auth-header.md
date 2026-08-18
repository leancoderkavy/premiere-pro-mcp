# Recommendation 12: remove UXP tokens from URLs

## Evidence

The loopback bridge authenticates with a token query parameter. URLs are more likely
than headers to appear in diagnostics, proxy logs, screenshots, or error strings.
Adobe UXP WebSocket access remains permission-gated by the manifest and runtime URL checks.

- [Adobe UXP network security](https://developer.adobe.com/premiere-pro/uxp/resources/recipes/network)

## Proposed improvement

Move the secret to a WebSocket subprotocol or supported authorization header while
retaining constant-time comparison, loopback binding, exact path checks, and a short
documented compatibility window for query authentication. Redact both forms everywhere.

## Acceptance

- New panel connections contain no secret in the URL.
- Missing, duplicate, malformed, and wrong credentials fail before upgrade.
- Logs, telemetry, status UI, and errors never contain credential material.
- Compatibility mode is opt-in, warned, tested, and assigned a removal version.

The chosen mechanism must be proven in Premiere 26.3 UXP, not only browser mocks.
