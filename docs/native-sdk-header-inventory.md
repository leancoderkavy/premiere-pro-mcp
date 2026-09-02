# Native SDK header-inventory receipt

Adobe's public Hybrid Plugin guide identifies the UXP Hybrid SDK's `src/api`
and `src/utilities` headers, but the SDK itself is downloaded from the Adobe
Developer Console. Adobe likewise distributes the standalone Premiere Pro C++
PrSDK and its documentation through the Developer Console. Neither artifact is
present in this repository, so neither is treated as an implementation source.

`npm run native:sdk-header-inventory` provides a fail-closed, local receipt for
a personally authorized SDK download. It records only relative header paths,
byte counts, and SHA-256 hashes; it does not copy header contents, native
sources, binary artifacts, or absolute local paths into the output.

```powershell
npm run native:sdk-header-inventory -- `
  --sdk uxp-hybrid `
  --sdk-version <SDK version> `
  --archive C:\sdk-evidence\uxp-hybrid-sdk.zip `
  --sdk-root C:\sdk-evidence\uxp-hybrid-sdk `
  --output C:\sdk-evidence\uxp-hybrid-headers.json
```

For `uxp-hybrid`, the command requires the public-guide layout:
`src/api/UxpAddonTypes.h`, `src/api/UxpAddonShared.h`, and
`src/utilities/UxpAddon.h`. The archive is hashed directly, while every header
is hashed independently. `--check` compares a regenerated receipt with a
reviewed one; `--validate-only` verifies the supplied artifact without writing.

Use the standalone verifier when a reviewer needs to inspect a receipt without
receiving the SDK extraction or archive. It rejects extra fields (including
header contents and absolute paths), inconsistent totals, non-canonical or
duplicate paths, malformed digest fields, and Hybrid receipts missing the public-guide
headers:

```powershell
npm run native:sdk-header-inventory:verify -- `
  --input C:\sdk-evidence\uxp-hybrid-headers.json
```

For a Hybrid benchmark candidate, append `--print-canonical-sha256` and copy
only the resulting lowercase digest into `sdkHeaderReceiptSha256` in the
benchmark evidence:

```powershell
npm run native:sdk-header-inventory:verify -- `
  --input C:\sdk-evidence\uxp-hybrid-headers.json `
  --print-canonical-sha256
```

The receipt itself stays in the authorized local evidence location and is
supplied separately to the benchmark verifier; this repository does not receive
the SDK extraction or archive.

This checks receipt structure and declared provenance only. It cannot verify
the private archive bytes, compile the SDK, or establish that an addon can load
in Premiere.

For `premiere-prsdk`, pass each documented include directory explicitly because
Adobe does not publicly publish a stable header layout:

```powershell
npm run native:sdk-header-inventory -- `
  --sdk premiere-prsdk `
  --sdk-version <SDK version> `
  --archive C:\sdk-evidence\premiere-prsdk.zip `
  --sdk-root C:\sdk-evidence\premiere-prsdk `
  --include-dir <documented include directory> `
  --output C:\sdk-evidence\premiere-prsdk-headers.json
```

The receipt is header-file accounting, not complete C++ declaration parsing. It
does not prove entitlement, a native build, a `.uxpaddon`, manifest permission,
MCP exposure, or behavior in a licensed Premiere host. A later native change
must separately provide source, reproducible builds, signing/notarization where
applicable, authenticated installation, and the existing licensed-host gate.

Official references: [Hybrid Plugins](https://developer.adobe.com/premiere-pro/uxp/plugins/hybrid-plugins/),
[Building Hybrid Plugins](https://developer.adobe.com/premiere-pro/uxp/plugins/hybrid-plugins/build/),
and [Premiere developer access](https://developer.adobe.com/premiere-pro/access-the-developer-console/).
