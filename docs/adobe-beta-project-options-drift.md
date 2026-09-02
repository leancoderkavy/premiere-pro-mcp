# Adobe beta project-options declaration drift

`src/resources/adobe-beta-project-options-drift.json` records the narrow
factory-type migration for `OpenProjectOptions` and `CloseProjectOptions`
between this repository's pinned stable `@adobe/premierepro@26.3.0` package and
its pinned `@adobe/premierepro@26.5.0-beta.73` alias.

Stable declarations bind each `premierepro` member to its instance type, which
owns call and construct signatures. Beta declarations bind each member to a new
`*Static` type with the same factory signatures; the option members otherwise
match. The receipt records the new types, static members, root-binding changes,
and factory ownership changes.

It does not construct either options type or expose project-open/project-close
behavior. In particular, it does not control open/close dialogs, dirty-project
prompts, workspace saving, quit preparation, or any project lifecycle action.
Static declarations do not prove beta-host availability, stable-host
compatibility, project state, or licensed-host validation.

Generate the receipt after intentionally changing either pinned package:

```sh
npm run adobe:beta-project-options-drift
```

CI and `npm run check` use
`npm run adobe:beta-project-options-drift:check` to reject a stale receipt.
Promotion beyond static accounting requires public stable documentation, an
explicitly bounded lifecycle capability design, and controlled licensed-host
verification.
