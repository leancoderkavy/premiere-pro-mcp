# Recommendation 33: generated UXP permission minimization

## Evidence

Adobe UXP manifests explicitly declare network and local-file-system permissions. Permission scope is part of the install-time trust boundary.

- [Adobe UXP manifest](https://developer.adobe.com/premiere-pro/uxp/plugins/concepts/manifest/)
- [Adobe UXP network recipe](https://developer.adobe.com/premiere-pro/uxp/resources/recipes/network)

## Proposed improvement

Generate release manifests from a reviewed permission policy and fail CI on undeclared expansion. Separate development, benchmark, and production permissions; include a human-readable permission diff in releases.

## Acceptance criteria

- Production never inherits development-only addon or network permissions.
- New permissions require rationale, threat analysis, and explicit review.
- Runtime endpoints are still validated even when Adobe requires a broad domain declaration.
- Packaged manifest hashes are verified in release provenance.

Manifest minimization reduces exposure but does not replace runtime authentication.
