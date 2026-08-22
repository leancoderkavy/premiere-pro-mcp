# Claims Registry

`claims-registry.json` is the canonical governance record for product claims.
It intentionally separates facts that are computed from release metadata from
positioning, external research, commercial hypotheses, and claims that must
not be made until evidence exists.

## Use it before publishing

1. Start with `release-metadata.json` for version, catalog, and compatibility
   facts. Do not manually copy a tool count from an old release.
2. Keep the qualification adjacent to the claim. A connected tool count is not
   a promise that a particular operation is available or verified on a host.
3. Label planned offers and pricing as hypotheses until there is an approved
   offer with terms, billing, and support scope.
4. Treat Marketplace publication, trusted signing, real-host behavior,
   testimonials, adoption, activation, and revenue as evidence-gated claims.
5. Run `npx vitest run tests/claims-registry.test.ts` after changing a release
   fact, the marketing context, or a governed public claim.

The registry is not a launch checklist. Distribution and host-proof gates are
maintained separately in [distribution-readiness.md](distribution-readiness.md).
