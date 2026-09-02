# UXP hybrid benchmark and promotion gate

This repository does not ship or enable a native UXP addon. It ships a deterministic
JavaScript benchmark, an adapter contract for a future Adobe SDK build, and a
fail-closed evidence verifier. The production `uxp-plugin/manifest.json` remains
manifest v5 without `enableAddon` or an `addon` declaration.

## Official baseline

Adobe documents Hybrid Plugins as an advanced path for performance-critical C++
work. Premiere first officially supported the feature in 26.2. The SDK is downloaded
from Adobe Developer Console and versioned separately from the host. A candidate
plugin must use manifest v6, declare its `.uxpaddon`, and explicitly request
`requiredPermissions.enableAddon`.

Adobe's bundle layout is strict:

```text
mac/x64/premiere-mcp-benchmark.uxpaddon
mac/arm64/premiere-mcp-benchmark.uxpaddon
win/x64/premiere-mcp-benchmark.uxpaddon
```

Windows evidence must use a Release build so it does not depend on Visual Studio
debug runtimes. Both macOS binaries must be signed and notarized with a valid Apple
Developer ID before distribution.

Official references:

- [Hybrid Plugins overview](https://developer.adobe.com/premiere-pro/uxp/plugins/hybrid-plugins/)
- [Building Hybrid Plugins](https://developer.adobe.com/premiere-pro/uxp/plugins/hybrid-plugins/build/)
- [Hybrid Plugins FAQ](https://developer.adobe.com/premiere-pro/uxp/plugins/hybrid-plugins/faq/)
- [UXP manifest](https://developer.adobe.com/premiere-pro/uxp/plugins/concepts/manifest/)
- [Premiere UXP changelog](https://developer.adobe.com/premiere-pro/uxp/changelog/)

## Candidate addon contract

After downloading the official SDK, build a dedicated benchmark addon from the SDK
template. It must export one synchronous function:

```js
runBenchmarkKernel(values: Float64Array, iterations: number): number
```

The return value must match `PremiereMcpHybridBenchmark.weightedEnergy()` within the
harness tolerance. No SDK headers or prebuilt binaries are copied into this
repository, and the contract is not an assertion that a native implementation exists.

Use a temporary development manifest—not the production manifest—to declare the
addon and `enableAddon`. Load it through UXP Developer Tool into stable Premiere
26.2 or newer. In the panel's developer console, run:

```js
PremiereMcpHybridBenchmark.run({
  requireAddon: true,
  sampleCount: 30,
  warmupCount: 3,
  iterations: 4,
  inputLength: 131072,
  seed: 1337
})
```

Record at least 20 samples for both JavaScript and native implementations after the
same warmup. Collect process peak working-set memory with the same host-monitoring
method on every target; the UXP heap snapshots returned by the harness are
diagnostic only and are not accepted as process memory evidence.

## Promotion criteria

Copy `benchmarks/uxp-hybrid/evidence.template.json`, validate it against the adjacent
schema, and add one run for each required target: Windows x64, macOS x64, and macOS
arm64. Every run must use the same full source commit, an identified SDK version, a
Release binary SHA-256, matching output, and stable Premiere 26.2+.

Create and structurally verify a hash-only UXP Hybrid header receipt from the
authorized SDK download first. Add the canonical digest printed by the receipt
verifier as `sdkHeaderReceiptSha256`, retain the actual receipt outside this
repository, and give its local path to the benchmark verifier. The receipt must
identify `uxp-hybrid`, and its `source.sdkVersion` must exactly match every run's
`sdkVersion`.

The native implementation must improve both p50 and p95 by at least 30% on every
target while keeping peak working-set regression at or below 10%. Verify with:

```powershell
npm run benchmark:uxp-hybrid:verify -- `
  --input .\path\to\evidence.json `
  --sdk-header-receipt C:\sdk-evidence\uxp-hybrid-headers.json
```

Only a zero exit code and `promotionEligible: true` support a later PR that adds the
native source, reproducible build files, signed/notarized artifacts, manifest v6, and
addon permission. This receipt binding verifies only the documented hash-only receipt
structure and the submitted evidence's SDK identity; it does not verify the private
archive bytes, establish access entitlement, compile an addon, or prove behavior in a
licensed Premiere host. This benchmark PR itself is not that promotion.
