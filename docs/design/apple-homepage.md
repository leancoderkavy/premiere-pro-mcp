# Apple-inspired homepage refinement

September 10, 2026. The user requested an Apple-like website after selecting Premiere Pro colors. This revision applies that direction across the existing homepage treatment: centered product storytelling, generous spacing, quiet navigation, large typography, rounded controls, and alternating dark and light sections.

## Visual direction

[Apple's Final Cut Pro page](https://www.apple.com/final-cut-pro/) and [MacBook Pro page](https://www.apple.com/macbook-pro/) informed the composition and restraint. The implementation keeps this project's identity, original portal artwork, illustrated timeline, and repository-specific content. No Apple images, logos, product claims, or source code are included.

- Center the product name, headline, two actions, and enlarged editing scene. Place compatibility and product facts below the scene.
- Use near-black `#050507`, light gray `#f5f5f7`, and white surfaces. Retain Premiere violet `#9999ff` and deep indigo `#00005b`; light sections use darker violet links for contrast.
- Use system sans typography, a desktop headline up to 106px, section headings up to 64px, and a 1120px content width. Mobile typography, section spacing, and illustrations scale down independently.
- Present workflow summaries beside their illustrated previews, with compact segmented tabs. Make setup steps and FAQs readable on light surfaces.
- Retain gentle pointer response, timeline animation, video playback, and scroll reveals. The global pause button, reduced-motion preference, offscreen suspension, and WebGL failure fallback remain available.
- Frame the Three.js camera to the current canvas dimensions. Center the still-image fallback with layout properties so screenshot capture and motion settings cannot displace it.

## Repository and experiment boundaries

The existing control page, server-side assignment, signed visitor identity, exposure/conversion ordering, privacy exclusions, and preview exclusion remain integrated. Client setup routes, versioned downloads, Codex guide, safe connection prompt, troubleshooting, and footer destinations use the existing repository data and controls.

This document records local verification. Remote CI and production deployment are separate evidence layers, recorded in the release PR and the [PostHog experiment](https://us.posthog.com/project/528794/experiments/462966). The existing experiment runs with an equal control/test split; a deployed treatment revision must be dated in its description because results spanning that date include both designs.

## Local verification

- Rebased onto main `f53956a`, retaining PR #491's image-delivery and accessibility improvements. Landing ESLint and production build passed. Treatment initial JavaScript is 209,617 bytes gzip against a 240,000-byte budget; control is 199,428 bytes gzip.
- The rebased suite contains 35 Playwright end-to-end tests against the actual Node HTTP server and local PostHog fixture. Coverage includes both variants, repository facts and tool availability, setup destinations, clipboard recovery, navigation, accessible controls, responsive widths from 320 to 1440px, reduced motion, WebGL pause/recovery, video, and experiment safeguards.
- Automated accessibility scans reported no violations at 390px and 1440px. This is automated coverage, not a comprehensive assistive-technology audit.
- SEO export validation passed for 27 canonical pages and 926 internal links and anchors.
- Browser inspection covered the animated desktop hero, full-page desktop/mobile captures, mobile menu, and mobile installer. No browser errors were reported.

Full-page captures: [desktop](apple-homepage-desktop.webp) and [mobile](apple-homepage-mobile.webp). These are actual local application captures, not design mockups. The illustrated video remains explicitly labeled as an explanation rather than a recording of a licensed Premiere host.
