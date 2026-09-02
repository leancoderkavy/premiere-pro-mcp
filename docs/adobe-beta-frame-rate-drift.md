# Adobe beta FrameRate declaration drift

`src/resources/adobe-beta-frame-rate-drift.json` records the pinned stable
`@adobe/premierepro@26.3.0` to beta `@adobe/premierepro@26.5.0-beta.73`
`FrameRate` factory-placement migration. Both packages bind
`premierepro.FrameRate` to `FrameRateStatic`, but beta moves matching call and
construct signatures from `FrameRate` to `FrameRateStatic` while retaining
`FrameRate` instance members and `FrameRateStatic.createWithValue()`.

This is static declaration accounting only. It does not construct a
`FrameRate`, change existing frame-alignment or TickTime workflows, use a
frame rate with another API, prove host availability, or establish
licensed-host validation. Run `npm run adobe:beta-frame-rate-drift` after
intentional package updates; CI uses `npm run adobe:beta-frame-rate-drift:check`.
