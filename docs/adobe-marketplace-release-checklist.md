# Adobe Marketplace release checklist

This is a maintainer checklist, not evidence of Adobe approval, certification, or
publication. Direct CCX distribution and Adobe Marketplace distribution are separate
channels and must use the channel-specific package validation path. The current
Marketplace display name for this release path is **MCP for Adobe Premiere Pro**;
keep it identical in the portal, CEP bundle/menu, UXP manifest/panel, screenshots,
and customer-facing listing copy.

## Repository evidence required before submission

- [ ] The candidate commit has green cross-platform CI, dependency audit, release
  package validation, and the landing performance budget.
- [ ] `npm run validate:marketplace-branding` passed at the exact candidate commit.
- [ ] The signed direct artifact and the Marketplace-targeted CCX are built from the
  exact release commit, with artifact hashes recorded in the release notes.
- [ ] The published compatibility page distinguishes package support, connected
  capabilities, and licensed-host-verified workflows.
- [ ] Every workflow described as host-verified has a redacted report accepted by
  `npm run validate:host-report -- path/to/report.json` and reviewed by a human.
- [ ] Privacy policy, support contact, terms, security policy, release notes, and
  product screenshots are current and match the submitted package.
- [ ] The listing does not claim Adobe affiliation, approval, universal host support,
  or a result beyond the available evidence.

## Owner-controlled Adobe steps

- [ ] Verify the actual listing status in the Adobe Developer Distribution portal.
- [ ] Resolve every current reviewer finding in the portal. Do not treat a package
  build, a prior review, or a stale overview badge as a resubmission or approval.
- [ ] Confirm the portal display name is exactly **MCP for Adobe Premiere Pro** and
  update any screenshots or listing fields that show an older panel name.
- [ ] Enter the portal-issued Marketplace plugin ID only in the protected workflow
  dispatch input; never commit it as a production claim or imply publication from a
  successful package build.
- [ ] Upload the channel-specific CCX, screenshots, support details, reviewer notes,
  and test credentials when required by the portal.
- [ ] Record Adobe's review result and public listing URL before changing any public
  copy to say the Marketplace listing is available.

## Release decision

An approved Marketplace listing is an external distribution fact. It does not prove a
real Premiere edit, and a real-host report does not prove Marketplace approval. Keep
both dimensions in the release evidence separately.
