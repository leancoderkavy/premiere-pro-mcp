# Recommendation 49: UXP external-launch policy

## Evidence

Adobe UXP requires explicit `launchProcess` manifest permissions for external schemes and file extensions, distinguishes `openPath()` from `openExternal()`, and reports user denial through return values.

- [Adobe UXP external-process recipe](https://developer.adobe.com/premiere-pro/uxp/resources/recipes/external-process)
- [Adobe Premiere UXP manifest](https://developer.adobe.com/premiere-pro/uxp/plugins/concepts/manifest/)

## Proposed improvement

If the panel adds “open export,” “reveal artifact,” or documentation links, route them through one allowlisted launch broker. Require a user gesture, canonical destination, scheme/extension policy, and explicit denial handling.

## Acceptance criteria

- Production permissions contain only reviewed schemes and extensions.
- Arguments, custom commands, UNC paths, and untrusted URLs are rejected.
- Launch failures never become export failures or success claims.
- Windows and macOS packaging tests verify the exact manifest.

This recommendation does not add process execution to the current production panel.
