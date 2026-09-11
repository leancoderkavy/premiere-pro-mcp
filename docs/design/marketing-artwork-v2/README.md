# Coastal edit campaign artwork

Created September 10, 2026 with the built-in image generation tool (not the CLI/API fallback).

Three original 3D illustrations connect the campaign to the repository's editing, organization, and finishing workflows. Premiere-inspired periwinkle (#9999FF), deep indigo (#00005B), graphite, and titanium keep the Apple-inspired page's restrained visual language. A shared coastal film motif makes the imagery a coherent campaign.

These are conceptual illustrations, not screenshots or recordings of Adobe Premiere Pro, customer work, or proof of host execution. The inspection lens is a metaphor for careful review, not a claimed product feature. The product arranges and inspects existing footage; these images must not be presented as evidence that it generates video.

## Assets and placements

| Artwork | Full-resolution PNG | Placement | Suggested accompanying copy |
| --- | --- | --- | --- |
| Shape the story | [sequence-v2.png](sequence-v2.png) | Treatment hero, editing chapter, illustrated walkthrough cover | Your vision. In the timeline. |
| Find your focus | [collection-v2.png](collection-v2.png) | Organization chapter, media-management campaign | Your footage. In order. |
| Sweat the details | [finish-v2.png](finish-v2.png) | Finishing chapter, review campaign | Every detail. Considered. |

Web delivery files live in `landing/public/marketing/`: `{sequence,collection,finish}-v2.webp` at 1600 px wide and `*-v2-mobile.webp` at 720 px wide. Full-resolution PNGs above preserve the generated originals. Existing portal assets are retained under their original names. The image files contain no marketing text; place editable copy outside the art in page or campaign layouts. No Adobe logo or invented interface is embedded.

For ads, pair the suggested headline with: "Connect your AI assistant to reviewable Adobe Premiere Pro workflows." Use "Explore the workflow" as the CTA and `https://premiere-pro-mcp.com/` as the destination. Keep capability or compatibility claims tied to the current product documentation. All publishing remains separate from preparing these creative assets.

## Reproduction

The original images were saved into this directory. Run `npm --prefix landing run images:optimize` from the repository root to rebuild WebP delivery derivatives using Sharp. This performs resizing and encoding only. The landing build checks image byte budgets. `landing/lib/studio-artwork.ts` keeps the HTML fallback, 3D texture, and workflow asset references together.

## Local verification

The final local build passed TypeScript/static export, lint, all 35 landing
end-to-end tests, accessibility checks on both variants at phone and desktop
widths, image/JavaScript budgets, and the SEO export check (27 canonical pages,
926 internal links and anchors). Browser inspection confirmed the 1600 px
desktop images and 720 px phone sources load, chapter switching shows distinct
artwork, and the local preview reports no console errors. Existing tests cover
animation pause, reduced motion, WebGL context-loss fallback, video playback,
setup links, and experiment exposure/conversion behavior against a local fixture.

| Delivery image | Desktop bytes | Phone bytes |
| --- | ---: | ---: |
| Sequence | 92,416 | 28,302 |
| Collection | 126,900 | 37,182 |
| Finish | 190,396 | 48,832 |

These checks verify the local revision; they do not represent a production
deployment or a measured conversion improvement.

## Generation prompts

### Shape the story

```text
Use case: ads-marketing.
Asset type: premium 3D campaign artwork for Premiere Pro MCP, an open-source tool that connects AI assistants to reviewable editing actions in Adobe Premiere Pro. Illustrative concept art, not a product screenshot.
Create one exceptionally art-directed landscape image, exactly 1792 by 1024 pixels if supported, about turning selected footage into an editing sequence. A sculptural arrangement of three very thin smoked-glass widescreen film frames suspended over three elegant rows of solid translucent periwinkle clip blocks on a dark graphite surface. Think precision-crafted launch photography for an elite creative tool. The frames show three DIFFERENT complementary shots of one coastal film at blue hour: a wide monumental sea cliff and ocean, a closer view of a breaking silver wave, and distant tiny human silhouette on the cliff. Photoreal cinematic footage within the panels. The central film frame is large and dominant; the two flanking frames smaller and receding in depth, all arranged left-to-right like a carefully considered edit. Beneath them, restrained rectangular violet timeline clips align into a clean sequence, with one precise slender vertical pale playhead. These are sculptural physical objects, not a fake software interface. Small gaps, impeccable alignment, finely machined edges, believable glass thickness and occlusion.
Composition: entire sculptural arrangement contained in the central 80 percent, generous breathing room, straight-on low three-quarter perspective, calm balanced landscape composition. Dark seamless #050507 studio backdrop, faint soft reflection on graphite, no scenery outside the floating film frames. Subject bright enough to read clearly as a thumbnail. Palette: Adobe Premiere-inspired #9999FF periwinkle, deep #00005B indigo, graphite and titanium white, restrained warm natural light inside footage. Controlled softbox lighting, fine violet edge reflections, crisp professional Octane-level materials, no bloom or fog covering details. Premium simplicity and exceptional realism.
No text, letters, numbers, logos, watermark, buttons, laptop, camera hardware, portal, space suit, robots, rainbow neon, cables, stock-photo office, or unrelated decorations. Do not imply that the tool generates videos. Show the craft of arranging existing footage. Full bleed, no outer border.
```

### Find your focus

```text
Use case: ads-marketing.
Asset type: premium 3D campaign artwork for Premiere Pro MCP, an open-source bridge for organizing and editing projects in Adobe Premiere Pro. Illustrative concept art, not a real software screenshot.
Create one landscape image exactly 1792 by 1024 pixels if supported: a meticulous sculptural media library made of nine thin smoked-glass film contact sheets, arranged into three neat aligned stacks of three in a minimalist graphite studio. The three frontmost widescreen sheets display luminous photoreal cinematic footage: a monumental ocean cliff at blue hour, a breaking silver wave, and sculptural coastal grasses backlit at dusk. Rear sheets subtly reveal additional coastal shots. The three groups are ordered from left to right, standing at a gentle three-quarter angle on an invisible low plinth, separated by satisfying negative space. A thin translucent periwinkle divider and a small blank rounded tab distinguish each stack. The metaphor is a beautiful well-organized library of source footage; intentional calm, clarity and control. No sprawling pile, no random floating debris. Actual footage pictures must remain prominent and recognizable.
Composition: entire arrangement centered within 80 percent of image with generous room around it. Front-left camera at low product-photography angle, moderate perspective with clear layered depth and softly blurred furthest edges. Dark seamless #050507 background, matte graphite floor with only a faint reflection. Precise smoked-glass edges lit #9999FF Premiere-inspired periwinkle, deep #00005B indigo shadows, titanium highlights, natural silver-blue and warm dusk colors inside film images. Restrained professional launch campaign, physically plausible materials, high detail, soft controlled studio lighting, no overwhelming glow. Polished Apple-style product-photography restraint.
No text, letters, numbers, logos, watermark, fake app chrome, laptop, office, people outside the film images, portal, robots, confetti, rainbow neon or visual noise. Full bleed landscape, no outer border.
```

### Sweat the details

```text
Use case: ads-marketing.
Asset type: premium 3D campaign artwork for Premiere Pro MCP, an open-source bridge for reviewable editing workflows in Adobe Premiere Pro. Illustrative concept art, not an actual software screenshot.
Create one landscape image exactly 1792 by 1024 pixels if supported. A single large exceptionally thin precision-crafted smoked-glass widescreen film panel suspended just above a dark graphite surface, showing a breathtaking photoreal close cinematic shot of a silver-blue ocean wave curling against a monumental dark coastal cliff at dusk. The same geography as a refined coastal short film. Beautiful fine spray, crisp water texture, deep indigo shadows and delicate warm horizon light. In front of the panel toward the lower right, one elegant circular optical glass inspection lens, about one third of the screen height, magnifies a small region of the wave's texture with physically believable refraction. This lens is an abstract metaphor for careful finishing and review, not a real software feature. Under the panel lie three minimal precise horizontal translucent periwinkle keyframe rails, with only a few small diamond nodes, aligned and sparse. Sculptural, physical, art-directed objects; not UI chrome or a software window.
Composition: calm centered landscape product shot, panel at a gentle 8-degree three-quarter turn, the picture remains dominant and readable. All objects within central 80 percent with clean space around them. Seamless #050507 studio background, graphite floor with faint reflection, soft white edge lighting, exquisitely thin #9999FF Premiere-inspired periwinkle rims and deep #00005B indigo accents. Materials feel real, sophisticated and tactile. Subtle natural warmth inside footage, palette otherwise titanium, charcoal, silver and violet. Polished restrained launch campaign, exceptional lighting and dimensional depth, crisp foreground, no haze or excessive glow.
No text, letters, numbers, logos, watermark, app buttons, comparison slider, before-and-after claims, laptop, camera, portal, space suit, rainbow neon, robots, cables or clutter. Full bleed landscape, no outer border.
```
