# The cutting room — cinematic 3D landing section

## Design

The cinematic homepage's former WebGL scene tilted a single campaign illustration.
The replacement uses three separate film frames, a curved perforated filmstrip,
an extruded editing timeline, an animated playhead, projector haze, and drifting
particles. A perspective camera follows the pointer gently and drifts slowly.
Premiere violet, charcoal, warm amber, and original coastal film artwork connect
the scene to the product's editing workflow.

Three keyboard-accessible chapter buttons change the featured shot and caption.
This is an illustrative scene, not a live Premiere recording or an interactive
editor. Product links, installation flows, and experiment assignment are unchanged.

## Runtime

- WebGL loads separately on fine-pointer viewports at least 900px wide.
- Rendering stops offscreen, in hidden tabs, and when motion is paused.
- Reduced-motion and Save-Data preferences default to the HTML still composition.
- Mobile, no-JavaScript, loading, and WebGL failure states retain a layered HTML
  composition using the same artwork. The mobile image is under 50 KB.
- A single texture atlas is reused across the three frames. Shader patterns render
  perforations, ruler ticks, and waveforms together instead of hundreds of meshes.
- Pixel ratio is capped at 1.5; no postprocessing or additional runtime dependency.

## Asset provenance

Created with the built-in image-generation tool on 2026-09-15. These are original,
generated film stills, not existing film footage. The source is retained in the
Codex generated-images directory; optimized assets are versioned in the project:

- `landing/public/marketing/cinema-coast-atlas.webp`: 1536 × 1024, 194,216 bytes.
- `landing/public/marketing/cinema-coast-atlas-mobile.webp`: 800 × 533, 48,996 bytes.

Prompt: Create an original cinematic contact sheet with three equally sized
horizontal widescreen coastal film stills stacked vertically, edge to edge.
Top: a distant lone silhouette on a rugged Pacific coast ridge at amber sunset,
mist, dark grasses, and ocean. Middle: aerial craggy coastline and sea stacks,
golden light through fog, deep turquoise ocean. Bottom: blue-hour rolling waves,
spray, jagged coastal mountains, violet haze, and a distant lighthouse. Use
photographic realism, anamorphic cinematography, organic 35mm texture, amber
highlights, and deep petrol shadows. No text, borders, interfaces, logos, or
watermarks. Maintain three precise horizontal bands in a landscape 3:2 atlas.

## Verification

Run from `landing`: `npm run build`, the targeted ESLint check, and
`npx playwright test e2e/homepage.spec.ts` after the root `npm run build`.
The browser suite covers both homepage variants, seven responsive widths from
320 to 1440px, accessibility, keyboard chapters, motion, context loss, navigation,
installation actions, no-JavaScript content, and the existing analytics contract.

Preview the built treatment at `/design-preview/` through the repository HTTP
server. This change has not been deployed to production.

Local results: root build, landing production build, targeted ESLint, and all 35
homepage browser tests passed. After the shader optimization, the five affected
responsive/accessibility, motion, chapter, and no-JavaScript tests passed again.
The cinematic page loads 210,259 bytes of initial gzipped JavaScript against the
existing 240,000-byte limit. Browser checks also confirmed offscreen disposal and
successful WebGL re-entry. Mobile at 390px has no overflow and loads no canvas.

### Desktop

![Cinematic 3D cutting room](cinema-3d-desktop.webp)

### Mobile

![Layered mobile film composition](cinema-3d-mobile.webp)
