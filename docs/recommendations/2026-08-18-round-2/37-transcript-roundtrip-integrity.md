# Recommendation 37: transcript round-trip integrity

## Evidence

Adobe’s stable UXP `Transcript` API can export transcript JSON, import JSON into text segments, create an import action, query supported languages, and test transcript presence.

- [Adobe Transcript reference](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/transcript)

## Proposed improvement

Add a dry-run transcript importer that validates schema, language metadata, time ordering, clip identity, and a canonical content digest before constructing an Adobe action. Verify post-commit presence and bounded export equivalence.

## Acceptance criteria

- Malformed, overlapping, out-of-range, and wrong-clip segments fail before mutation.
- Confirmation binds the canonical digest and project revision.
- Readback reports semantic differences without leaking transcript text into logs.
- Real-host fixtures cover supported languages and large transcripts.

JSON equivalence does not prove word-level alignment or transcription accuracy.
