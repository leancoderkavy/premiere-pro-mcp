# Adobe beta PointF declaration drift

`src/resources/adobe-beta-pointf-drift.json` records the pinned stable
`@adobe/premierepro@26.3.0` to beta `@adobe/premierepro@26.5.0-beta.73`
`PointF` factory migration. Beta moves matching call and construct signatures to
`PointFStatic` while retaining `PointF` instance members.

This is static declaration accounting only. It does not construct `PointF`,
change the existing stable PointF workflow, use PointF with another API, prove
host availability, or establish licensed-host validation. Run
`npm run adobe:beta-pointf-drift` after intentional package updates; CI uses
`npm run adobe:beta-pointf-drift:check`.
