# Adobe UXP JavaScript API inventory

The generated `src/resources/uxp-js-api-inventory.json` accounts for every named API declaration in Adobe's pinned `@adobe/cc-ext-uxp-types@7.3.1` package. This is the general UXP runtime surface used by Premiere panels; it is separate from the Premiere DOM inventory.

Run `npm run uxp:js-api-inventory` after deliberately updating the pinned Adobe package or the exact panel mappings. CI runs `npm run uxp:js-api-inventory:check` and fails when the declaration version, normalized declaration hash, symbol set, or classifications drift.

`mapped` means an exact declared symbol is referenced by `src/resources/uxp-js-coverage.json`. It is static source evidence only. `unmapped` is a review queue, because many DOM, storage, XMP, web, and platform APIs do not warrant standalone editing tools. Neither state proves availability in a licensed Premiere host.

The npm package includes the generated inventory, and package verification resolves every non-null inventory path recorded in the Premiere surface registry.
