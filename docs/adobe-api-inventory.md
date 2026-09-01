# Adobe Premiere API inventory

The generated `src/resources/adobe-api-inventory.json` is the exhaustive review
queue for the stable `@adobe/premierepro` declaration package pinned by this
repository. It records every exported type, namespace, enum, property, method,
constructor, and call signature and compares exact symbol names with
`src/resources/adobe-uxp-coverage.json`.

Run `npm run adobe:api-inventory` after intentionally changing the Adobe package
or the coverage manifest. CI runs `npm run adobe:api-inventory:check`, so package
surface drift or a stale generated file fails closed.

`mapped` means only that an exact declaration symbol appears in a coverage entry.
It does not mean that the symbol needs a standalone MCP tool, that every argument
shape is exposed, or that a licensed Premiere host verified it. `unmapped` is a
triage queue: each entry must eventually be mapped to a tool/workflow, classified
as an auxiliary value/type, or documented as intentionally unsupported with a
specific reason. `manifestOnly` exposes aliases or stale names referenced by the
coverage manifest but absent from the pinned declarations.

The inventory covers the Premiere DOM declarations. General UXP JavaScript,
HTML/CSS/Spectrum, Hybrid C++ SDK, CEP/ExtendScript, and undocumented QE surfaces
need separate inventories and evidence boundaries; this file must not be used to
claim those surfaces are complete.
