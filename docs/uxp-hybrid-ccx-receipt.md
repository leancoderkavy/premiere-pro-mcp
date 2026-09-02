# UXP Hybrid CCX archive receipt

Adobe documents `.ccx` installers as regular ZIP files and recommends creating
them with UXP Developer Tool (UDT). A Hybrid distribution package must retain
the Hybrid manifest, root `main.js`, and required platform-specific
`.uxpaddon` files. This repository does not contain a Hybrid SDK, native source,
addon binary, UDT installation, or packaged installer.

`npm run native:hybrid-ccx-receipt` is a bounded local verifier for a personally
authorized archive. It requires the existing schema-v2 Hybrid addon-layout
receipt and its verified Hybrid SDK header receipt. It reads the ZIP directory
without extracting any archive contents to disk, then confirms that exactly one
common bundle root contains these byte-identical required files:

```text
manifest.json
main.js
mac/x64/<addon name>.uxpaddon
mac/arm64/<addon name>.uxpaddon
win/x64/<addon name>.uxpaddon
```

The current schema-v2 receipt records only the CCX byte count and SHA-256, a
SHA-256 commitment and length for the manifest's nonempty `id`, minimal
manifest facts, the canonical addon-layout receipt digest, aggregate ZIP
entry/file/directory totals, and a one-way digest of the complete safe
entry-name set. It does not copy the archive, entry names, manifest, ID,
entrypoint, binaries, SDK headers, absolute paths, or signing material. The
standalone verifier retains schema-v1 receipt compatibility for historical
records; new receipts use schema v2.

```powershell
npm run native:hybrid-ccx-receipt -- `
  --ccx C:\hybrid-evidence\fixture-hybrid-plugin.ccx `
  --addon-receipt C:\hybrid-evidence\fixture-addon-layout.json `
  --sdk-header-receipt C:\sdk-evidence\uxp-hybrid-headers.json `
  --output C:\hybrid-evidence\fixture-ccx.json
```

Use `--validate-only` to examine a local archive without writing a receipt, or
`--check` to compare a regenerated receipt to a reviewed local file. The
standalone verifier re-reads the archive and fails if any ZIP entry is unsafe,
duplicated, encrypted, requests central-directory encryption, uses unsupported
general-purpose flags, unsupported compression, or ZIP64 entry metadata, or if its required
files, ZIP identity, manifest facts, header provenance, addon-layout receipt
binding, or complete entry-name-set digest changed. It also checks every local
ZIP header against its central-directory entry before reading required payloads,
so unselected archive entries cannot use a different version-needed value,
name, flags, compression method, declared size, or an
out-of-bounds/overlapping data range. The referenced local records, including
any valid data descriptors, must also account for every byte before the central
directory: the bounded verifier rejects a prefixed archive or an unreferenced
local header/payload rather than omitting it from the entry-name accounting.
For its ZIP32, unencrypted profile, the declared central-directory range must
also end directly at the end-of-central-directory record; the verifier rejects
unaccounted bytes in that gap rather than silently excluding them from its
structure validation.

When a central-directory entry declares a Unix origin and a POSIX file type,
the bounded verifier accepts only a regular file or directory. It rejects
declared links, devices, FIFOs, and sockets without extracting their contents.
Directory entries must have zero declared compressed and uncompressed bytes;
the verifier rejects file data hidden beneath a directory-name suffix without
extracting it.

Non-ASCII ZIP entry-name bytes must declare UTF-8 with general-purpose bit 11;
the verifier accepts unflagged legacy names only when they are ASCII. This keeps
its entry-name-set accounting independent of legacy ZIP code pages.

For a ZIP entry whose general-purpose bit 3 requests a streamed data descriptor,
the verifier additionally requires that descriptor immediately after the
declared payload and confirms its CRC-32 and both sizes against the central
directory. Both conventional descriptor encodings (with or without the common
signature) are supported. This remains ZIP-structure validation only; it does
not extract unselected entry contents.

The manifest, root entrypoint, and three required addon artifacts are already
read to bind them to the addon-layout receipt. While streaming those required
payloads, the verifier also recomputes their ZIP CRC-32 values and rejects a
central-directory checksum that does not match the uncompressed bytes. It does
not decompress or checksum unselected archive payloads.

For those same deflated required payloads, the verifier also requires the raw
DEFLATE stream to consume the exact central-directory compressed-data range.
It rejects unused trailing compressed bytes rather than accepting a valid
prefix followed by unrelated data. Unselected payloads are still not
decompressed.

```powershell
npm run native:hybrid-ccx-receipt:verify -- `
  --input C:\hybrid-evidence\fixture-ccx.json `
  --ccx C:\hybrid-evidence\fixture-hybrid-plugin.ccx `
  --addon-receipt C:\hybrid-evidence\fixture-addon-layout.json `
  --sdk-header-receipt C:\sdk-evidence\uxp-hybrid-headers.json `
  --print-canonical-sha256
```

This verifies ZIP structure and a content-free local integrity binding. It does
**not** prove that UDT created the archive, that the manifest ID is valid in or
matches Adobe's Developer Distribution portal, that a binary was compiled with
the SDK or has its advertised architecture, code-signing or notarization,
installation, UDT loading, Marketplace acceptance, MCP exposure, or behavior
in a licensed Premiere host. Those remain separate build, signing, distribution,
and licensed-host gates.

Official references: [Package a UXP plugin](https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/package/),
[Building Hybrid Plugins](https://developer.adobe.com/premiere-pro/uxp/plugins/hybrid-plugins/build/),
and [Hybrid Plugins](https://developer.adobe.com/premiere-pro/uxp/plugins/hybrid-plugins/).
The ZIP layout rules follow PKWARE's [ZIP File Format Specification](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT),
sections 4.3.6, 4.3.8, 4.3.12, and 4.3.16.
