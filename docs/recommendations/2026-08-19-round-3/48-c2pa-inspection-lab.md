# Recommendation 48: experimental C2PA inspection lab

## Evidence

Adobe documents C2PA soft-binding resolution for recovering a manifest after credentials are stripped, while Premiere Content Credentials automation remains beta or lacks a stable documented Premiere API.

- [Adobe CAI soft-binding API](https://developer.adobe.com/cai-soft-binding-api)
- [Adobe Premiere UXP changelog](https://developer.adobe.com/premiere-pro/uxp/changelog)

## Proposed improvement

Build an opt-in, read-only lab that accepts an explicitly selected artifact, extracts only bounded provenance identifiers, and optionally resolves a soft binding through an allowlisted Adobe endpoint. Keep it outside the stable action catalog until a stable Premiere API and host evidence exist.

## Acceptance criteria

- Disabled by default with separate network consent and quotas.
- No signing, credential creation, or authenticity verdict is claimed.
- Manifest output is size-bounded, schema-validated, and privacy-redacted.
- Fixtures cover absent, malformed, stripped, conflicting, and offline credentials.

C2PA provenance data supplies history claims; it does not prove media is truthful.
