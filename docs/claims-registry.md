# Claims Registry

`claims-registry.json` is the canonical governance record for product claims.
It intentionally separates facts that are computed from release metadata from
positioning, external research, commercial hypotheses, and claims that must
not be made until evidence exists.

## Use it before publishing

1. Published-package counts, compatibility, downloads, and provenance come from
   the npm tarball. The website repository
   ([leancoderkavy/premiere-pro-mcp-site](https://github.com/leancoderkavy/premiere-pro-mcp-site))
   syncs them automatically into its `lib/published-release.json` and renders
   <https://premiere-pro-mcp.com/facts/>. `release-metadata.json` describes the
   development source and may include unreleased work even when its version
   string matches the public package. Keep these scopes separate.
2. Keep the qualification adjacent to the claim. A connected tool count is not
   a promise that a particular operation is available or verified on a host.
3. Label planned offers and pricing as hypotheses until there is an approved
   offer with terms, billing, and support scope.
4. Treat Marketplace publication, trusted signing, real-host behavior,
   testimonials, adoption, activation, and revenue as evidence-gated claims.
5. Run `npx vitest run tests/claims-registry.test.ts` after changing a release
   fact or a governed README claim. Website copy is guarded in the site
   repository.

## Outcome states in tool results

Public copy that quotes a tool result must keep its outcome state. A green
test proves package behavior only; none of these states is a host claim by
itself.

| State | Meaning |
| --- | --- |
| `verified` | Premiere's readback confirmed the requested state after the call. |
| `committed` | Premiere accepted the change; the tool does not claim a readback. |
| `committed_unverified` | Premiere accepted the change, but readback was unavailable or incomplete, so it is not reported as verified. |
| `requested_unverified` | The tool dispatched a host request, but cannot establish that Premiere accepted or applied the requested state. Inspect the host before retrying; this state never claims a committed change. |
| `template_verified` | The content was verified in the file handed to Premiere (for example the text baked into a copied `.mogrt` by `add_title`), not in Premiere's own readback, because the host exposes none. Confirm rendered output separately, for example with `export_frame`. |
| failed | A structured error with `success: false`; never reported as success. A post-call error may report `mutationAttempted:true` and `mutationOutcome:"unknown"`; failure does not imply rollback or no mutation. |

The registry is not a launch checklist. Distribution and host-proof gates are
maintained separately in [distribution-readiness.md](distribution-readiness.md).
