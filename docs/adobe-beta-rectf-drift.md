# Adobe beta RectF declaration drift

`src/resources/adobe-beta-rectf-drift.json` records the pinned stable
`@adobe/premierepro@26.3.0` to beta `@adobe/premierepro@26.5.0-beta.73`
`RectF` factory migration. Beta moves matching call and construct signatures to
`RectFStatic` while retaining `width` and `height` on `RectF`.

This is static declaration accounting only. It does not construct `RectF`, use
it with another API, prove host availability, or establish licensed-host
validation. Run `npm run adobe:beta-rectf-drift` after intentional package
updates; CI uses `npm run adobe:beta-rectf-drift:check`.
