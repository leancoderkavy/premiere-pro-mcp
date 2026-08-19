# Recommendation 34: UXP filesystem token lifecycle

## Evidence

UXP local filesystem access is permission-gated and user-selected entries may be represented by persistent tokens rather than unrestricted native paths.

- [Adobe UXP manifest](https://developer.adobe.com/premiere-pro/uxp/plugins/concepts/manifest/)
- [Adobe UXP file-system recipes](https://developer.adobe.com/premiere-pro/uxp/resources/recipes/)

## Proposed improvement

Introduce a token broker that records purpose, project binding, creation time, last use, and revocation without exposing raw tokens to MCP clients. Re-prompt when a token is stale or no longer resolves.

## Acceptance criteria

- Tokens are encrypted at rest or remain solely in UXP-managed storage.
- Logs and tool results never contain token values.
- Revocation, moved files, and denied reauthorization fail deterministically.
- Cleanup is bounded by age and count with explicit user controls.

A valid token authorizes filesystem access only; it does not validate media contents.
