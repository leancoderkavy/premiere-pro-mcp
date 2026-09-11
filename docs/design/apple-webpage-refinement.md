# Apple-inspired webpage refinement

This continues the user's selected Apple-inspired direction and the Premiere
violet campaign from `marketing-artwork-v2`. It is a refinement of the homepage
treatment, with the existing control and PostHog assignment preserved.

## Visual target

Use the compositional restraint of [MacBook Pro](https://www.apple.com/macbook-pro/)
and [Final Cut Pro](https://www.apple.com/final-cut-pro/): a quiet product navigation,
one clear hero statement, large artwork, editorial section headings, and readable
details after the visual story. No Apple assets, trademarks, or marketing claims
are copied into the product.

The current page repeats framed artwork inside simulated interface frames and
repeats centered headings at every section. The revision gives the coastal
artwork its own stage, removes redundant simulated timelines and tiny timecodes,
and alternates centered hero storytelling with left-aligned section introductions.
Workflow chapters become one clean dark gallery with an editable text prompt
below it. Mobile chapter controls must fit without horizontal clipping.

## System and acceptance

- Premiere violet `#9999ff`, deep indigo `#00005b`, near-black `#050507`, white,
  and paper gray `#f5f5f7`. Muted text must retain accessible contrast.
- System sans typography; hero 42–96px, section titles 35–56px, body 17–21px.
- A 1200px maximum content width, 16–24px phone gutters, a 56px desktop navigation,
  and varied 64–104px section spacing.
- Original generated campaign artwork remains explicitly illustrative. Setup,
  safe prompt, client links, and product facts come from the repository.
- Preserve global motion pause, reduced-motion handling, WebGL recovery,
  keyboard navigation, accessible tab semantics, and video playback.
- Verify 320–1440px layouts, both variants' end-to-end journeys, accessibility,
  static export, SEO, and asset/JavaScript budgets against the actual local server.

Production rollout and experiment measurement are separate from these local
design and functional checks.

## Verified local result

- Landing ESLint passed without warnings. The Node build and Next.js static
  export passed; no new packages or external scripts were added.
- All 35 Playwright end-to-end tests passed on the final revision in 47.9 seconds.
  The suite exercises the real local HTTP server and a local PostHog fixture,
  both variant journeys, setup destinations, clipboard handling, video, motion
  pause, WebGL recovery, and exposure/conversion safeguards.
- The workflow tab test now checks ArrowRight navigation to match the horizontal
  gallery. The tabs' accessible names include their visible labels.
- Responsive checks passed from 320 to 1440px. Automated accessibility scans
  passed at 390 and 1440px for both variants. The release ribbon lives inside
  the main landmark; all five assistant choices remain visible on phones.
- Treatment initial JavaScript is 208,976 bytes gzip against a 240,000-byte
  budget. Control is 199,426 bytes. All six artwork byte budgets passed.
- SEO export validation passed for 27 canonical pages and 926 internal links
  and anchors. Browser inspection covered the hero, workflow gallery,
  walkthrough cover, and Codex setup, with no browser errors reported.

Actual local page captures: [desktop](apple-webpage-refinement-desktop.webp)
(1440 × 7647) and [phone](apple-webpage-refinement-mobile.webp) (390 × 8180).
These document the application, not an image-generated mockup. At the time of
these local captures, this revision had not been deployed and no production
experiment settings had been changed. Subsequent release evidence belongs in
the release PR and the running experiment's dated revision history.
