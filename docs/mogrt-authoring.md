# Guarded After Effects MOGRT authoring

This repository can author and route bounded MOGRT workflows from After
Effects into Premiere. It does not turn the MCP server into a general-purpose
After Effects scripting endpoint, and it does not claim that a generated file
has correct animation, editable controls, Premiere compatibility, visual
quality, or completed-render output.

## What is supported

The template library provides six deterministic recipes: `lower_third`,
`title_card`, `callout`, `quote_card`, `social_end_card`, and
`media_placeholder`. Each text recipe creates one
comp in the already open, saved After Effects project, adds bounded headline and
optional subtitle text plus an accent Color Control, then attempts to expose
those controls in Essential Graphics before requesting the MOGRT export.

By default (`text_controls: "full"`), each text layer also gets `<Layer> Font
Size` and `<Layer> Stroke Width` Slider Controls plus `<Layer> Fill Color` and
`<Layer> Stroke Color` Color Controls, wired to the Source Text through an AE
17.0+ text-style expression, and its Position, Scale, Rotation, Anchor Point,
and Opacity are requested as named Essential Graphics controls. The documented
AE scripting API has no call for the Essential Graphics font-family or
font-style edit flags (`capPropFontEdit`), so those stay off and the result
reports `fontFamilyEditable: false`; enable them manually in AE if needed.
`text_controls: "text_only"` keeps the older text-string-only exposure.

The `media_placeholder` recipe imports one workspace-contained PNG, JPEG, MOV,
or MP4 (`placeholder_media_path`), fits it to the comp, requests a replaceable
Essential Graphics media slot named `Media` through the AE 18.0+
`AVLayer.addToMotionGraphicsTemplateAs` API, and exposes its transform
controls. `headline` is an optional caption for this recipe. Fit/fill/stretch
modes and crop bounds are not implemented.

The create result returns per-control exposure booleans and, when the AE 16.1+
readback API exists, the source comp's controller names. This behavior has only
been checked by mocked unit tests. It has not been verified against a live
After Effects or Premiere host, so import each artifact into a disposable
Premiere sequence and inspect the Essential Graphics panel before delivery.

An optional `brand_kit` can constrain template naming with a prefix, supply
approved accent/text colors, request a font by name, position content within a
safe margin, and add an approved, workspace-contained PNG/JPEG logo. Font
availability is resolved by After Effects at creation time; the preview cannot
prove it is installed.

The base path remains constrained:

1. `verify_after_effects_connection` is read-only and returns only connector,
   host-version, saved-project, and project-item-count state.
2. `preview_mogrt_recipe` validates a bounded recipe and an existing output
   directory within an operator-approved workspace. It issues a one-time token
   that expires after ten minutes.
3. `create_mogrt_recipe` consumes that token only when `confirm_export` is
   explicitly true. It requires `edit`, `export`, and `filesystem` authority.
4. `verify_mogrt_artifact` checks local file presence and the ZIP header only.

The studio tools extend this without widening authority:

- `preview_mogrt_batch` and `create_mogrt_batch` process up to 20 JSON/CSV
  rows serially. The batch stops at a host failure and cannot roll back earlier
  compositions or exports.
- `validate_mogrt_brand_kit` validates a declared local kit before its preview.
- `inspect_after_effects_template_source` returns source-comp dimensions,
  duration, fonts, layer kinds, and (on AE 16.1+) Essential Graphics controller
  names. Older hosts report this readback as unavailable.
- `preview_mogrt_library_publish`, `publish_mogrt_to_library`, and
  `inspect_mogrt_library` manage immutable `v001`, `v002`, … copies inside an
  existing local library root; publication fails instead of overwriting.
- `inspect_after_effects_render_templates`, `preview_after_effects_render`,
  and `enqueue_after_effects_render` read template names and enqueue one
  approved output. They never start the render queue or claim an output file.
- `preview_mogrt_premiere_handoff` and `apply_mogrt_premiere_handoff` require
  an explicit `MOGRT Verify - …` sequence name and empty track, then verify the
  import and returned control descriptors in Premiere.

## Install and host preparation

For an ordered checklist connecting these tools, use
[`plan_cross_app_workflow`](cross-app-workflows.md). It identifies separate
approvals, required evidence, and manual rendering steps without executing them.

Install the dedicated connector—not the Premiere connector—and fully restart
After Effects:

```bash
premiere-pro-mcp --install-after-effects-cep
```

Open **Window > Extensions > MCP for Adobe After Effects**, then start the
connector. It uses `AFTER_EFFECTS_MCP_TEMP_DIR`, defaulting to the OS temporary
directory plus `after-effects-mcp-bridge`. That is intentionally distinct from
`PREMIERE_TEMP_DIR`, so simultaneous Premiere and After Effects instances cannot
claim each other's commands.

Before calling the create tool, the operator must open a saved `.aep` project
that is itself inside `approved_workspace_path`; the planned output directory
must already exist inside that same root. The tool rejects unsaved projects,
projects outside the root, non-existent directories, outside paths, and an
existing output filename. It never creates or switches projects, creates output
directories, overwrites an existing MOGRT, or accepts arbitrary script text.

## Verification boundary

After Effects reports that it accepted the export request, and the server then
reports immediate local artifact status. A returned boolean or an existing ZIP
file is not proof of controls, import behavior, rendering, or design. The
Premiere handoff is stronger evidence—it rechecks the named empty sequence,
observes inserted track items, and returns control descriptors—but it still is
not a visual proof. The required completion evidence is:

1. Verify the `.mogrt` file locally.
2. Import it into a disposable Premiere sequence.
3. Inspect the exposed properties and capture a rendered review frame with the
   existing `capture_frame` tool or a separate approved export workflow.
4. Only then treat the template as usable for delivery.

Automated tests cover the bridge isolation, schema bounds, workspace containment,
one-time approval, and artifact-check contracts. They do not substitute for a
licensed After Effects and Premiere host run.
