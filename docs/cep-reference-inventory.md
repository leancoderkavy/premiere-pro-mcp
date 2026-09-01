# CEP and Premiere scripting reference inventory

`src/resources/cep-reference-inventory.json` accounts for every Git blob in three pinned trees:

- Adobe CEP Resources (Adobe authority), including CEP runtime libraries, SDK documentation, signing tools, samples, configuration, source, and assets.
- Adobe CEP Samples' `PProPanel/` subtree (Adobe authority), which is Premiere-specific sample code rather than a complete scripting specification.
- Docs for Adobe's Premiere scripting guide (community reference), kept explicitly separate from Adobe authority.

Run `npm run cep:reference-inventory` to deliberately refresh the pins or their recursive trees. The generated artifact records each repository, exact commit, path, blob SHA, byte size, authority class, scope, and file category.

This makes the pinned CEP platform file inventory complete. It does not make the curated ExtendScript symbol reference complete, prove that undocumented QE behavior is supported, or establish runtime compatibility with every Premiere/CEP version.
