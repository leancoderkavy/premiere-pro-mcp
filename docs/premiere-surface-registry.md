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
Remaining surfaces stay visibly partial, not started, externally gated, or
unavailable from an authoritative source. Both C++ SDK
inventories remain externally gated because their headers and packaged
documentation require Adobe Developer Console access. An inventory is
not implementation proof, and automated contracts are not licensed-host proof.

The same registry pins the exact competitor commits reviewed for feature-gap
work. A competitor feature family becomes an implementation candidate only
after source inspection proves a current gap and a concrete workflow benefit.
Unsafe arbitrary-code defaults, copied tool-count claims, and unverified host
behavior are excluded from parity.
