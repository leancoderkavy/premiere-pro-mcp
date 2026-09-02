# Adobe beta MediaManager declaration drift

`src/resources/adobe-beta-media-manager-drift.json` records the narrow media
manager declaration surface that is absent from this repository's pinned stable
`@adobe/premierepro@26.3.0` package and present in its pinned
`@adobe/premierepro@26.5.0-beta.73` alias. The package sources are the
[stable npm package](https://www.npmjs.com/package/@adobe/premierepro/v/26.3.0)
and the
[pinned beta npm package](https://www.npmjs.com/package/@adobe/premierepro/v/26.5.0-beta.73).

The generated receipt covers only the beta root binding
`premierepro.MediaManager`, the empty `MediaManager` instance type, and the
declared `MediaManagerStatic.purgeMediaCache` method. It has no MCP action and
makes no production call to this beta surface.

`purgeMediaCache` is a cache-mutating operation. A declaration does not prove
what data a host clears, whether clearing succeeds, how long it takes, or how a
host reports failure. The receipt therefore does not expose cache purging or
claim beta/stable compatibility, host availability, or cache behavior.

Generate the receipt after intentionally changing either pinned package:

```sh
npm run adobe:beta-media-manager-drift
```

CI and `npm run check` use `npm run adobe:beta-media-manager-drift:check` to
reject a stale receipt. Promotion beyond static accounting requires a public
stable release and documentation, an explicit destructive-operation design,
and controlled licensed-host verification.
