# Adobe beta Media declaration drift

`src/resources/adobe-beta-media-drift.json` records a narrow, generated comparison
of the `Media` type in this repository's pinned stable
`@adobe/premierepro@26.3.0` package and pinned
`@adobe/premierepro-beta@26.5.0-beta.73` alias. It stores the package versions,
normalized `Media` declaration hashes, public member shapes, and the classified
stable-to-beta change set without importing the beta package into production code.

Run `npm run adobe:beta-media-drift` after intentionally updating either pinned
package. `npm run adobe:beta-media-drift:check` is part of `npm run check`, so a
stale receipt or an unsupported `Media` declaration shape fails closed.

For the current pins, the receipt records beta-only `Media.getStart()` and
`Media.getDuration()` methods, while the stable `start` and `duration` properties
change from synchronous `TickTime` to `Promise<TickTime>` in beta. The stable
`Media.createSetStartAction()` signature is unchanged. This is a focused Media
audit, not a full stable-to-beta package diff.

The receipt is declaration accounting only. It does not show that a beta host
exposes these members, that a stable host accepts beta calls, or that any MCP
action is supported. Production adapters continue to use only stable documented
declarations; beta-only methods require a stable release, public documentation,
and licensed-host validation before they can be exposed.

Official package references: [stable 26.3.0](https://www.npmjs.com/package/@adobe/premierepro/v/26.3.0)
and [pinned 26.5 beta](https://www.npmjs.com/package/@adobe/premierepro/v/26.5.0-beta.73).
