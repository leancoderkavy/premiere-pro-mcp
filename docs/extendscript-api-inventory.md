# Premiere ExtendScript API inventory

`src/resources/extendscript-api-inventory.json` deterministically catalogs every attribute and method on object pages in the pinned Docs for Adobe Premiere scripting guide. Each entry records its object, member heading, kind, inline signature, and source path.

The source is community-maintained and is labeled accordingly in the artifact. Inventory completeness means complete accounting of that pinned guide, not Adobe authority, undocumented QE coverage, or proof that every member works in every Premiere version.

Run `npm run extendscript:api-inventory` to deliberately regenerate the artifact and `npm run extendscript:api-inventory:check` to verify freshness.
