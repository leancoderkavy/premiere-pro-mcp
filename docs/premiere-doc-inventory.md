# Adobe Premiere UXP documentation inventory

`src/resources/premiere-doc-inventory.json` is generated from Adobe Developer's live sitemap. It accounts for every URL under `/premiere-pro/uxp/` and classifies each page as Premiere DOM, UXP JavaScript, HTML, CSS, Spectrum, plugin guides, or supporting Premiere UXP documentation.

Run `npm run premiere:docs-inventory` to refresh the artifact. CI runs `npm run premiere:docs-inventory:check`, fetches the authoritative sitemap, and fails if Adobe adds, removes, reclassifies, or changes the `lastmod` value of a page.

Page inventory is documentation coverage only. It does not imply that every documented API should be exposed as an MCP tool, that the panel implements every UI feature, or that a capability has been validated in a licensed Premiere host.
