# UXP Hybrid addon-layout receipt

Adobe's public Hybrid build guide requires a temporary Hybrid manifest with
manifest version 6 or newer, `addon.name`, and
`requiredPermissions.enableAddon`. It also requires one `.uxpaddon` at each
of these bundle-relative paths:

```text
mac/x64/<addon name>.uxpaddon
mac/arm64/<addon name>.uxpaddon
win/x64/<addon name>.uxpaddon
```

The production panel deliberately remains manifest v5 with no addon declaration
or addon permission. Do not run this procedure against `uxp-plugin/`; use a
separate, local development bundle after obtaining an authorized Hybrid SDK.

`npm run native:hybrid-addon-receipt` reads that local bundle and an already
verified Hybrid SDK header receipt. It writes only public-layout relative paths,
byte counts, SHA-256 digests, minimal manifest facts, and the canonical header
receipt digest. It does not copy the development manifest, addon binaries,
SDK headers, archive, absolute paths, signing material, or host responses.

```powershell
npm run native:hybrid-addon-receipt -- `
  --plugin-root C:\hybrid-evidence\benchmark-plugin `
  --sdk-header-receipt C:\hybrid-evidence\uxp-hybrid-headers.json `
  --output C:\hybrid-evidence\benchmark-addon-layout.json
```

Use `--validate-only` to examine the local bundle without producing a receipt,
or `--check` to compare a regenerated receipt with a reviewed local file. A
reviewer who has access to both local receipts can verify the binding without
receiving the development bundle:

```powershell
npm run native:hybrid-addon-receipt:verify -- `
  --input C:\hybrid-evidence\benchmark-addon-layout.json `
  --sdk-header-receipt C:\hybrid-evidence\uxp-hybrid-headers.json `
  --print-canonical-sha256
```

The verifier checks the documented layout and the supplied header-receipt
identity. It does **not** prove that a binary was compiled with the SDK, has the
advertised architecture, is signed or notarized, can load in UXP Developer
Tool, exposes the benchmark adapter, is an MCP capability, or behaves in a
licensed Premiere host. Those remain separate build, signing, UDT installation,
and licensed-host gates.

Official references: [Hybrid Plugins](https://developer.adobe.com/premiere-pro/uxp/plugins/hybrid-plugins/)
and [Building Hybrid Plugins](https://developer.adobe.com/premiere-pro/uxp/plugins/hybrid-plugins/build).
