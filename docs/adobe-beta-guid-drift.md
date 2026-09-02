# Adobe beta Guid declaration drift

`src/resources/adobe-beta-guid-drift.json` records the pinned stable
`@adobe/premierepro@26.3.0` to beta `@adobe/premierepro@26.5.0-beta.73`
`Guid` factory-placement migration. Both packages bind `premierepro.Guid` to
`GuidStatic`, but beta moves matching call and construct signatures from `Guid`
to `GuidStatic` while retaining `Guid.toString()` and `GuidStatic.fromString()`.

This is static declaration accounting only. It does not construct or parse a
`Guid`, change existing GUID workflows, use a GUID with another API, prove
host availability, or establish licensed-host validation. Run
`npm run adobe:beta-guid-drift` after intentional package updates; CI uses
`npm run adobe:beta-guid-drift:check`.
