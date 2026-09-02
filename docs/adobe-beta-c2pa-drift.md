# Adobe beta C2PA declaration drift

`src/resources/adobe-beta-c2pa-drift.json` records the narrow C2PA declaration
surface that is absent from this repository's pinned stable
`@adobe/premierepro@26.3.0` package and present in its pinned
`@adobe/premierepro@26.5.0-beta.73` alias. The package sources are the
[stable npm package](https://www.npmjs.com/package/@adobe/premierepro/v/26.3.0)
and the
[pinned beta npm package](https://www.npmjs.com/package/@adobe/premierepro/v/26.5.0-beta.73).

The generated receipt covers only:

- the `premierepro.C2PAService` root binding;
- `C2PAServiceStatic` and its declared members;
- the empty `C2PAService` instance type; and
- `Constants.C2PAManifestLocation` member identifiers and declaration order.

It does not generate an MCP action or call `C2PAService`. The stable package
does not declare this surface. The beta package declares `getManifest` and
manifest-location constants, but static declarations alone do not show that a
beta host exposes them, that a stable host accepts them, or that a file's
manifest can safely be read or validated.

`C2PAManifestLocation` has implicit TypeScript enum initializers. The receipt
records source order, not runtime numeric flag values or C2PA manifest-location
semantics. In particular, no caller should infer a numeric value from this
receipt or treat it as a content-credential verification result.

Generate the receipt after intentionally changing either pinned package:

```sh
npm run adobe:beta-c2pa-drift
```

CI and `npm run check` use `npm run adobe:beta-c2pa-drift:check` to reject a
stale receipt. Promotion beyond static accounting requires a public stable
release and documentation, an explicit capability design with bounded manifest
data, and controlled licensed-host verification.
