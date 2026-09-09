# Cinematic homepage experiment

The user's brief is a complete 3D, animated homepage with a PostHog A/B test. The implementation direction is a cinematic editing studio: near-black canvas, titanium surfaces, acid-green actions, film frames suspended in depth, and precise timeline typography. The existing homepage remains the control. No product application or documentation routes are redesigned.

## Visual target

At 1440px, use a 1280px content width, a 76px navigation rail, and a split hero. Left: a short release label, “Your vision. In the timeline.”, product explanation, and two actions. Right: original cinematic artwork behind a floating command panel and a three-dimensional timeline. The artwork and timeline must be the dominant visual, with real readable HTML controls outside the WebGL scene. A compact facts rail closes the first composition.

Continue with an interactive three-chapter workflow, an illustrated video walkthrough, a local connection diagram, a client-specific installer, accessible FAQs, and a large final action. Vary composition instead of repeating a card grid. Keep all current setup, recovery, compatibility, privacy, source, and documentation destinations discoverable.

## System

- Canvas #0a0c0b; surfaces #111511 and #19201b; text #f2f5ee; secondary #a5ada4; line #2c342d; accent #d2ff5a; accent text #161e08.
- Geist Sans for editorial type; Geist Mono for timeline/timecode and labels. Hero 52–88px, section titles 36–56px, body 16–18px. Small labels at least 11px.
- Four/eight-pixel spacing rhythm, 8px control radius, 16px major viewport radius. Subtle borders; depth reserved for the film stage.
- Motion: spring pointer parallax on fine pointers, slow timeline drift, short scroll reveals. Global pause control. Reduced motion and save-data use still compositions. Suspend rendering when hidden or offscreen. No scroll hijacking or custom cursor.
- Use Radix tabs, accordion, and dialog; Lucide icons. No fabricated product screenshots, customer proof, or live-host claims.
- 320/360/390/430px: stack hero, reduce scene height, wrap action row and fact rail, use horizontally scrollable client tabs. 768/1024px: two columns when readable. 1440px: full composition.

## Experiment contract

- Flag: `homepage-cinematic-2026`; variants `control` and `test`, intended equal split.
- Assignment belongs to an anonymous signed visitor cookie and PostHog's flag evaluator. Server chooses the complete HTML before rendering; no client layout swap.
- Primary outcome: actual setup-download clicks (`homepage_setup_downloaded`); secondary: successful safe-prompt copies (`homepage_safe_prompt_copied`). These are onboarding intent, not verified installation or activation.
- Expose only after the selected root page becomes visible. Direct preview routes, preview query parameters, bots, DNT/GPC, disabled configuration, and unavailable flag decisions do not emit exposures.
- Keep GA's existing bounded onboarding events. Send only allowlisted actions and variants to PostHog, using visitor identity rather than the MCP server's operational identity.
- Control fallback on configuration/network failure; do not enable the experiment until the deployed variant and the correct PostHog project are verified.

## Verification

Production build and existing byte budgets; server assignment/exposure/privacy/tamper tests; desktop and 320–1440px browser captures; keyboard navigation, installer tabs/copy/error states, dialog close/focus restoration, FAQ, motion pause/reduced motion, console inspection, and accessibility scan. Test the root route through the actual HTTP server, including nonce CSP, rather than treating the standalone preview as root-route evidence.
