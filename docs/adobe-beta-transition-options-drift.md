# Adobe beta AddTransitionOptions declaration drift

`src/resources/adobe-beta-transition-options-drift.json` records the beta
factory-type migration for `AddTransitionOptions` against pinned stable
`@adobe/premierepro@26.3.0` and beta `@adobe/premierepro@26.5.0-beta.73`.
Beta moves matching call and construct signatures from the instance declaration
to new `AddTransitionOptionsStatic`; all non-factory option members match.

This is static accounting only. It does not construct options, create a
transition action, apply a transition, validate duration or alignment, prove
host availability, or provide licensed-host validation.

Run `npm run adobe:beta-transition-options-drift` after intentional pinned
package changes; `npm run adobe:beta-transition-options-drift:check` verifies
the committed receipt.
