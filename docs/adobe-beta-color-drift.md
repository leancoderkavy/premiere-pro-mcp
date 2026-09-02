# Adobe beta Color declaration drift

`src/resources/adobe-beta-color-drift.json` records the pinned stable
`@adobe/premierepro@26.3.0` to beta `@adobe/premierepro@26.5.0-beta.73`
`Color` factory migration. Beta moves matching call and construct signatures to
`ColorStatic` while retaining `Color` instance members.

This is static declaration accounting only. It does not construct `Color`,
change the existing stable Color workflow, use Color with another API, prove
host availability, or establish licensed-host validation. Run
`npm run adobe:beta-color-drift` after intentional package updates; CI uses
`npm run adobe:beta-color-drift:check`.
