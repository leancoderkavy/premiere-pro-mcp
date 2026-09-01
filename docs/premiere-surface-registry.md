# Premiere API and documentation surface registry

The machine-readable source is
`src/resources/premiere-surface-registry.json`; npm consumers receive it at
`dist/resources/premiere-surface-registry.json`. It prevents the generated
Premiere DOM declaration inventory from being mistaken for all Adobe
extensibility documentation.

Adobe separates the Premiere DOM from the general UXP JavaScript runtime,
supported HTML/CSS, Spectrum components, plugin guides, and the downloadable
Hybrid C++ SDK. This project also retains CEP/ExtendScript compatibility and
uses explicitly experimental QE behavior, for which Adobe publishes no
authoritative reference.

Only the stable Premiere DOM declaration surface currently has a complete
symbol inventory. Every other surface remains visibly partial, not started,
externally gated, or unavailable from an authoritative source. An inventory is
not implementation proof, and automated contracts are not licensed-host proof.

The same registry pins the exact competitor commits reviewed for feature-gap
work. A competitor feature family becomes an implementation candidate only
after source inspection proves a current gap and a concrete workflow benefit.
Unsafe arbitrary-code defaults, copied tool-count claims, and unverified host
behavior are excluded from parity.
