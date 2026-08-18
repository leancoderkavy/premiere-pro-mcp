# Recommendation 20: AAF artifact verification

## Evidence

Premiere 26.3 adds `ProjectConverter.exportAAF()` and `AAFExportOptions`. The existing
UXP tool truthfully records Adobe's boolean return with `outputVerified: false`; a host
return alone does not prove that a usable artifact exists.

- [Adobe Premiere UXP changelog](https://developer.adobe.com/premiere-pro/uxp/changelog)
- [Adobe ProjectConverter API](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/projectconverter)

## Proposed improvement

After a successful host return, verify the approved destination is contained, exists,
is a regular non-link file, has a stable nonzero size, and was modified by this operation.
Return a scoped artifact link and preserve `usable_in_target_nle: not_verified` unless an
independent importer validates it.

## Acceptance

- Pre-existing, missing, empty, unstable, linked, and outside-root paths fail verification.
- Verification never changes Adobe's host return or silently retries export.
- Results separate host-return, filesystem-artifact, and downstream-usability evidence.
- Windows/macOS live runs cover success, cancellation, overwrite, and permission failure.

File existence is not proof that another NLE can import the AAF correctly.
