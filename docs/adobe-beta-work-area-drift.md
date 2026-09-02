# Adobe beta WorkAreaUtils declaration drift

`src/resources/adobe-beta-work-area-drift.json` records the narrow work-area
declaration surface that is absent from this repository's pinned stable
`@adobe/premierepro@26.3.0` package and present in its pinned
`@adobe/premierepro@26.5.0-beta.73` alias. The package sources are the
[stable npm package](https://www.npmjs.com/package/@adobe/premierepro/v/26.3.0)
and the
[pinned beta npm package](https://www.npmjs.com/package/@adobe/premierepro/v/26.5.0-beta.73).

The generated receipt covers only the beta root binding
`premierepro.WorkAreaUtils`, the empty `WorkAreaUtils` instance type, and the
five methods of `WorkAreaUtilsStatic`. It has no MCP action and makes no
production call to that beta surface.

The repository's existing `get_work_area` and `set_work_area` tools use
established legacy host paths. This receipt does not change those paths or
claim that they are behaviorally equivalent to beta `WorkAreaUtils` methods.
In particular, declarations alone do not prove sequence selection, mutation
success, range validation, or live-host readback.

Generate the receipt after intentionally changing either pinned package:

```sh
npm run adobe:beta-work-area-drift
```

CI and `npm run check` use `npm run adobe:beta-work-area-drift:check` to reject
a stale receipt. Promotion beyond static accounting requires a public stable
release and documentation, a compatible action design, and controlled
licensed-host verification.
