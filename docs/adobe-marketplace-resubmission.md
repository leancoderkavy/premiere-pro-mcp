# Adobe Marketplace resubmission runbook

This runbook prepares a candidate for owner-operated Adobe Marketplace work. It does
not submit, approve, publish, or certify a listing.

## Naming boundary

Use **MCP for Adobe Premiere Pro** as the Marketplace display name. It describes
compatibility rather than presenting an Adobe product name as the product brand. The
same display name must appear in the Marketplace portal, CEP bundle and panel, UXP
manifest and panel, screenshots, and current customer-facing product copy.

Repository, package, extension IDs, URLs, and artifact filenames such as
`premiere-pro-mcp`, `com.mcp.premiere.bridge`, and `MCPBridgeCEP.zxp` are stable
technical identifiers. They are not a reason to show an older display name in a
customer-visible Marketplace field or panel.

## Candidate preparation

1. Start from the intended release commit and record its full SHA.
2. Run `npm run validate:marketplace-branding`, `npm run check`, and the applicable
   channel package validation/build commands. Retain the command output and artifact
   hashes with the release evidence.
3. Open the CEP panel and, when applicable, the UXP panel from the candidate build.
   Capture fresh, non-sensitive screenshots showing the exact display name.
4. Re-read the current reviewer feedback and listing history in the authenticated
   Adobe portal. Review history is the source of truth when it conflicts with a
   summary status badge.
5. Update the portal's display name, screenshots, copy, package, and requested
   metadata to match the candidate. Use the exact portal-required package format.

## Explicit owner actions

Only the listing owner may perform these actions in Adobe's portal:

- upload a new package or version;
- change listing fields, screenshots, or reviewer notes;
- submit or resubmit for review;
- publish a reviewed listing or change its availability.

Before each action, verify that the portal shows the intended version and display
name. After review, record the portal result, reviewer feedback, final listing URL,
and timestamp in release evidence. Do not update public copy to say "available on
Adobe Marketplace" until the public listing URL is live and independently checked.

## Non-claims

A passing branding validator proves only source consistency. It does not prove that
Adobe accepted the package, that a listing is public, or that a qualified Premiere
host completed a workflow. Keep those three facts as separate release gates.
