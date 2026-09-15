# The cutting room — interactive 3D parallax timeline

## Design

The cinematic homepage becomes a floating editing desk. Three photographic film
frames sit above a dimensional timeline, with a curved perforated filmstrip,
projector haze, and drifting particles. Pointer and scroll parallax move the
WebGL camera and CSS perspective together. Premiere violet, charcoal, warm amber,
and original coastal artwork connect the scene to the product's editing workflow.

The timeline uses real HTML controls:

- Drag the playhead or use arrow keys, Home, and End to scrub a 24-second sequence
  at 24 frames per second. Timecode, selected clip, caption, and featured film
  frame share the same state.
- Select a timeline clip, floating film frame, or chapter button to bring that
  shot forward. The three film frames move smoothly to their new positions.
- Play, pause, rewind, and replay advance through the three still-image shots.
- “Separate layers” lifts picture, color, and sound into separate depth planes.
  “Bring layers together” restores the compact desk.

This is an interactive film study using still images. The waveform is decorative;
there is no audio playback, live Premiere session, or media-editing backend.
Product links, installation flows, and experiment assignment are unchanged.

## Runtime

- WebGL loads separately on fine-pointer viewports at least 900px wide.
- Rendering stops offscreen, in hidden tabs, and when motion is paused.
- Parallax updates CSS variables and a shared WebGL ref without React rerenders.
  Pointer dragging holds the parallax target steady so the ruler stays underhand.
- Sequence playback begins only on request and suspends offscreen or in hidden
  tabs. The page motion toggle controls decorative motion; explicit transport
  controls remain usable with reduced motion.
- Reduced-motion and Save-Data preferences default to the HTML still composition.
- Mobile, no-JavaScript, loading, and WebGL failure states retain a layered HTML
  composition using the same artwork. The mobile image is under 50 KB. Mobile
  timeline controls use a flat layout with touch targets and no WebGL dependency.
- The native range input and buttons provide keyboard and touch interaction.
  Caption announcements occur on shot changes; timecode updates are not live
  screen-reader announcements. Without JavaScript, the scene remains static.
- A single texture atlas is reused across the three frames. Shader patterns draw
  film perforations; CSS and one SVG path draw the ruler and waveform.
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
320 to 1440px, accessibility, keyboard scrubbing and chapters, transport playback,
mouse dragging on the projected 3D ruler, clip selection with separated layers,
touch controls, motion, context loss, navigation, installation actions,
no-JavaScript content, and the existing analytics contract.

Preview the built treatment at `/design-preview/` through the repository HTTP
server. This change has not been deployed to production.

Local results: root build, landing production build, targeted ESLint, and all 38
homepage browser tests passed. After the final spacing and visibility adjustments,
all eight affected responsive, accessibility, motion, interaction, touch, and
no-JavaScript checks passed again, including the projected 3D pointer drag.
The cinematic page loads 214,446 bytes of initial
gzipped JavaScript against the existing 240,000-byte limit. Browser checks also
confirmed offscreen disposal and successful WebGL re-entry. Mobile at 390px has
no overflow and loads no canvas. These are Chromium checks; Safari and Firefox
have not been verified in this run.

### Desktop

![Cinematic 3D cutting room](cinema-3d-desktop.webp)

### Separated layers

![Picture, color, and audio layers floating above the editing desk](cinema-3d-layers.webp)

### Mobile

![Touch-friendly mobile film study and timeline](cinema-3d-mobile.webp)
