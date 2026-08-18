# Recommendation 18: capability-aware transcript language cache

## Evidence

Premiere 26.3 adds `Transcript.querySupportedLanguages()`. Re-querying immutable host
metadata for every planning workflow adds round trips, while assuming languages from
locale or prior hosts would misrepresent installed capability.

- [Adobe Premiere UXP changelog](https://developer.adobe.com/premiere-pro/uxp/changelog)
- [Adobe Transcript API](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/transcript)

## Proposed improvement

Cache the bounded normalized language list by exact Premiere version, UXP protocol,
and connection generation. Invalidate on reconnect or capability change, return cache
age/source, and never infer language-pack installation beyond Adobe's returned data.

## Acceptance

- Repeated reads on one connection use one host call.
- Reconnect, version change, probe failure, and explicit refresh invalidate safely.
- Codes/names are normalized, deduplicated, size-bounded, and preserve unknown fields only in debug fixtures.
- A query failure returns unavailable, never a stale claim from another host.

This optimizes capability discovery; it does not start transcription.
