# UXP CCX distribution

The UXP bridge is packaged as a `.ccx` candidate for direct installation
through Adobe Creative Cloud Desktop. It targets Premiere Pro 25.6+ only. The
CI packer creates a deterministic ZIP-based CCX structure without requiring
UXP Developer Tool, but Adobe's own tooling and a real Premiere installation
remain the authoritative installation check.

## Build channels

Validate the source manifest and build the normal direct-distribution package:

```sh
node scripts/validate-distribution.mjs --uxp
node scripts/build-uxp-ccx.mjs
```

This writes:

```text
artifacts/premiere-pro-mcp-uxp-<version>-direct.ccx
```

The builder uses a fixed ZIP timestamp, lexical file order, and stored entries,
then reads the generated central directory and checks every entry and CRC. The
result is reproducible for identical source bytes. It also rejects symlinks,
requires the UXP v5 Premiere manifest, checks the version against
`package.json`. Adobe's Premiere 26.3 runtime requires the compatible `domains: "all"`
manifest form for the WebSocket connection; `workspace.cjs` remains the enforced authority and
accepts only `ws://127.0.0.1:<port>/uxp` or `ws://localhost:<port>/uxp`.

For an Adobe Creative Cloud Marketplace submission, Adobe Developer
Distribution must first create the Marketplace plugin ID. Build a separate
package without changing the checked-in direct manifest:

```sh
UXP_DISTRIBUTION_CHANNEL=marketplace \
UXP_MARKETPLACE_PLUGIN_ID='<Adobe-issued ID>' \
node scripts/build-uxp-ccx.mjs
```

In PowerShell:

```powershell
$env:UXP_DISTRIBUTION_CHANNEL = 'marketplace'
$env:UXP_MARKETPLACE_PLUGIN_ID = '<Adobe-issued ID>'
node scripts/build-uxp-ccx.mjs
```

That produces `artifacts/premiere-pro-mcp-uxp-<version>-marketplace.ccx`. The
script refuses a Marketplace build without an Adobe-issued ID or if that ID is
the direct-distribution ID. This preserves Adobe's required split between
direct and Marketplace identities when both channels are used.

## CI and approval boundaries

`.github/workflows/uxp-package.yml` builds and uploads the direct CCX on every
published release. It can also be run manually for a Marketplace candidate
after the owner supplies the Adobe-issued ID. The workflow only produces
artifacts; it does not create a Developer Distribution listing, submit an
artifact, make a Marketplace listing public, or claim Adobe approval.

Adobe recommends packaging through UXP Developer Tool for normal release work.
This repository's deterministic packer is intended for CI artifact creation
because a CCX is a ZIP archive, but it does not replace these required release
gates:

1. Install the resulting CCX through Creative Cloud Desktop on Windows, Intel
   macOS, and Apple Silicon as applicable.
2. Load the panel in a real Premiere Pro 25.6+ host and run the documented
   read-only connection check.
3. For Marketplace distribution, use the exact ID from Adobe Developer
   Distribution, complete listing metadata and reviewer instructions, and wait
   for Adobe review and approval.

Adobe states that ordinary UXP CCX packages do not use the CEP-style digital
signature/timestamp process. Direct installs may still show Creative Cloud's
trust warning, so distribute the artifact only from a source users can verify.
See Adobe's [packaging guide](https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/package/)
and [Marketplace guide](https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/adobe-marketplace/).

## Capability boundary

The CCX package being well-formed does not establish live-host capability
parity. UXP is the supported path for the operations its runtime capability
probe advertises. CEP remains the explicit compatibility path for older hosts
and unsupported UXP operations; a failed UXP mutation must never be silently
retried through CEP.
