# Premiere API and documentation surface registry

The machine-readable source is
`src/resources/premiere-surface-registry.json`; npm consumers receive it at
`dist/resources/premiere-surface-registry.json`. It prevents the generated
Premiere DOM declaration inventory from being mistaken for all Adobe
extensibility documentation.

Adobe separates the Premiere DOM from the general UXP JavaScript runtime,
supported HTML/CSS, Spectrum components, plugin guides, and the downloadable
Hybrid C++ SDK. Adobe's separately distributed Premiere Pro C++ PrSDK covers
native importers, exporters, effects, transitions, devices, and related plug-ins;
it is not the same SDK as a UXP Hybrid addon. This project also retains CEP/ExtendScript compatibility and
uses explicitly experimental QE behavior, for which Adobe publishes no
authoritative reference.

The stable Premiere DOM and general UXP JavaScript declarations have complete
symbol inventories. Adobe's live sitemap supplies a complete page inventory
for HTML, CSS, Spectrum, plugin guides, and supporting UXP documentation.
The pinned community Premiere scripting guide also has a complete member
inventory, explicitly labeled as non-Adobe authority and not runtime proof.
The [beta Media drift receipt](adobe-beta-media-drift.md) separately records the
pinned stable-to-beta `Media` declaration delta. It is deliberately not a beta
surface inventory or beta-host support claim. The [beta C2PA declaration
receipt](adobe-beta-c2pa-drift.md) records only the separate beta-only C2PA
surface and does not expose a C2PA operation or claim a manifest can be read in
any host. The [beta WorkAreaUtils declaration receipt](adobe-beta-work-area-drift.md)
records the separate beta-only work-area surface without changing existing
legacy work-area tools or claiming equivalent beta behavior.
The [beta MediaManager declaration receipt](adobe-beta-media-manager-drift.md)
records the separate beta-only cache-purge declaration without exposing a
destructive cache operation or claiming host behavior.
Other remaining surfaces stay visibly partial, not started, externally gated,
or unavailable from an authoritative source. Both C++ SDK
inventories remain externally gated because their headers and packaged
documentation require Adobe Developer Console access. An inventory is
not implementation proof, and automated contracts are not licensed-host proof.

When an authorized SDK artifact becomes available, the
[native SDK header-inventory receipt](native-sdk-header-inventory.md) can record
its archive hash and relative header hashes without copying access-controlled
files into this repository. That receipt leaves both C++ surfaces blocked until
the relevant declaration classification, reproducible native build, and
licensed-host evidence are supplied. A future Hybrid benchmark must also bind
its submitted runs to matching verified SDK, addon-layout, and current local
CCX receipts, as described by the [Hybrid benchmark gate](uxp-hybrid-benchmark.md);
the digest binding is not a native-build or host-behavior claim. A temporary development bundle can also
produce a [Hybrid addon-layout receipt](uxp-hybrid-addon-receipt.md) for the
public root `main.js` entrypoint and three target paths without disclosing
source or binaries; it is still not binary architecture, signing, loading, or
runtime proof. A subsequent [Hybrid CCX archive receipt](uxp-hybrid-ccx-receipt.md)
can bind those public layout facts to the matching files and a content-free safe
ZIP entry-name-set digest in a local `.ccx` ZIP without disclosing archive
contents or entry names, while rejecting inconsistent or feature-insufficient
local ZIP version-needed, Deflate-only compression-option flags, framed non-ZIP64 extra fields, and core header fields, unaccounted local-record or central-directory-to-end
bytes, ambiguous non-ASCII entry-name encodings or declared UTF-8 file comments, and declared Unix special file
types, nonempty directory entries, or nonzero directory CRC-32 values. It is not UDT,
portal, installation, or host-runtime proof. Where a ZIP entry uses a streamed
data descriptor, the local archive verifier also checks its required CRC and
sizes against the central directory without extracting unselected contents. The
verifier also recomputes ZIP CRC-32 for the already-required manifest,
entrypoint, and addon payloads; it does not decompress unselected entries.
Deflated required entries must also consume their exact declared compressed-data
range, rejecting unused trailing bytes without reading unselected entries. The
verifier rejects encrypted-entry,
central-directory-encryption, and other unsupported general-purpose flags, as
well as ZIP64 entry metadata, before reading required payloads.

The same registry pins the exact competitor commits reviewed for feature-gap
work. A competitor feature family becomes an implementation candidate only
after source inspection proves a current gap and a concrete workflow benefit.
Unsafe arbitrary-code defaults, copied tool-count claims, and unverified host
behavior are excluded from parity.
