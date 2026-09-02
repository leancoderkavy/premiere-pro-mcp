# Adobe beta TickTime declaration drift

`src/resources/adobe-beta-tick-time-drift.json` records the pinned stable
`@adobe/premierepro@26.3.0` to beta `@adobe/premierepro@26.5.0-beta.73`
`TickTime` factory-placement migration. Both packages bind
`premierepro.TickTime` to `TickTimeStatic`, but beta moves matching call and
construct signatures from `TickTime` to `TickTimeStatic` while retaining
`TickTime` instance members and existing `TickTimeStatic` helpers.

This is static declaration accounting only. It does not construct a
`TickTime`, change existing TickTime arithmetic or frame-alignment workflows,
use a time value with another API, prove host availability, or establish
licensed-host validation. Run `npm run adobe:beta-tick-time-drift` after
intentional package updates; CI uses
`npm run adobe:beta-tick-time-drift:check`.
