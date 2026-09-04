# Guarded After Effects MOGRT authoring

This repository can author a narrow, deterministic MOGRT from After Effects. It
does not turn the MCP server into a general-purpose After Effects scripting
endpoint, and it does not claim that a generated file has correct animation,
editable controls, Premiere compatibility, or visual quality.

## What is supported

The `lower_third` recipe creates one comp in the already open, saved After
Effects project. It adds a lower-third backing shape, headline text, optional
subtitle text, and an accent Color Control; it attempts to expose the headline,
subtitle, and accent controls in Essential Graphics before requesting the MOGRT
export.

The four tools form one constrained path:

1. `verify_after_effects_connection` is read-only and returns only connector,
   host-version, saved-project, and project-item-count state.
2. `preview_mogrt_recipe` validates a bounded recipe and an existing output
   directory within an operator-approved workspace. It issues a one-time token
   that expires after ten minutes.
3. `create_mogrt_recipe` consumes that token only when `confirm_export` is
   explicitly true. It requires `edit`, `export`, and `filesystem` authority.
4. `verify_mogrt_artifact` checks local file presence and the ZIP header only.

## Install and host preparation

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
file is not proof of the controls, import behavior, rendering, or design. The
required completion evidence is:

1. Verify the `.mogrt` file locally.
2. Import it into a disposable Premiere sequence.
3. Inspect the exposed properties and capture a rendered review frame.
4. Only then treat the template as usable for delivery.

Automated tests cover the bridge isolation, schema bounds, workspace containment,
one-time approval, and artifact-check contracts. They do not substitute for a
licensed After Effects and Premiere host run.
