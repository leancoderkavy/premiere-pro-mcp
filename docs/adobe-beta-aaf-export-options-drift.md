# Adobe beta AAFExportOptions declaration drift

`src/resources/adobe-beta-aaf-export-options-drift.json` records the narrow
factory-type migration for `AAFExportOptions` between this repository's pinned
stable `@adobe/premierepro@26.3.0` package and its pinned
`@adobe/premierepro@26.5.0-beta.73` alias. The package sources are the
[stable npm package](https://www.npmjs.com/package/@adobe/premierepro/v/26.3.0)
and the
[pinned beta npm package](https://www.npmjs.com/package/@adobe/premierepro/v/26.5.0-beta.73).

In stable declarations, `premierepro.AAFExportOptions` names the options type,
which contains construct and call signatures. In beta declarations, the root
binding names the new `AAFExportOptionsStatic` type instead; its factory
signatures match the stable shapes, while the non-factory option members remain
unchanged. The receipt records that binding change, the new static type, and
the moved factory signatures.

It does not create `AAFExportOptions`, expose an MCP action, or start an AAF
export. Static declarations do not prove that a beta host exposes the factory,
that export settings, output paths, or effect behavior are accepted, or that an
AAF export starts or completes. It also does not establish beta support, stable
support, or licensed-host validation.

Generate the receipt after intentionally changing either pinned package:

```sh
npm run adobe:beta-aaf-export-options-drift
```

CI and `npm run check` use
`npm run adobe:beta-aaf-export-options-drift:check` to reject a stale receipt.
Promotion beyond static accounting requires a public stable release and
documentation, an explicitly bounded AAF-export capability design, and
controlled licensed-host verification.
