---
name: edit-premiere-project
description: Inspect, edit, verify, save, and export an open Adobe Premiere Pro project through the premiere-pro MCP server. Use for rough cuts, timeline assembly or cleanup, clip and track changes, transitions and effects, dialogue or audio adjustments, captions, project organization, frame inspection, and delivery exports.
---

# Edit Premiere Project

Operate Premiere through the `premiere-pro` MCP tools. Preserve the user's current
project state, make only requested changes, and verify the timeline after mutations.

## Establish a live session

1. Call `get_capabilities` to inspect platform coverage and enabled authority.
2. Call `ping` before any other Premiere operation.
3. If `ping` fails, stop editing and tell the user to:
   - Open or restart Premiere Pro.
   - Install the bridge with `npx -y premiere-pro-mcp@1.4.0 --install-cep` if needed.
   - Open **Window > Extensions > MCP Bridge** and confirm it reports **Running**.
4. Call `get_premiere_state` and inspect the active sequence before planning changes.
5. Do not claim that a project, sequence, or export exists until a live tool result confirms it.

## Plan the edit

- Clarify only missing choices that materially change the edit, such as target sequence,
  source media, timing, track placement, or export preset.
- Prefer the server's `premiere-rough-cut`, `premiere-dialogue-cleanup`,
  `premiere-caption-and-style`, or `premiere-delivery` prompt when it matches the request.
- Inspect project items and sequence structure before referring to item, clip, track, or
  sequence identifiers.
- Re-query identifiers after timeline mutations; do not reuse stale node IDs.
- Keep existing tracks, effects, timing, and project organization unless the request
  requires changing them.

## Apply changes safely

For compound insert or removal operations:

1. Construct one exact edit plan.
2. Call `preview_edit_plan`.
3. Present the preview when it contains destructive operations or the user's intent is
   ambiguous.
4. Call `apply_edit_plan` only with the unchanged plan and exact confirmation token.
5. Preview again after any plan change.

For other mutations:

- Validate the active project, sequence, tracks, media paths, and relevant identifiers
  immediately before the call.
- Ask before deleting media, sequences, tracks, or clips unless the user explicitly
  requested that exact deletion.
- Ask before overwriting a project or export destination.
- Never enable `unsafe-script`, call `execute_extendscript`, `send_raw_script`, or
  `evaluate_expression` unless the user explicitly requests raw scripting and accepts
  the expanded authority.
- Stop after an error that makes later steps depend on unknown state. Re-inspect before
  retrying.

## Verify and finish

1. Inspect the affected sequence with `get_sequence_structure`,
   `get_timeline_summary`, or the narrowest relevant inspection tool.
2. Compare the result against the requested timing, ordering, tracks, effects, audio,
   and captions.
3. Save only after successful verification when the user requested persistent changes.
4. For exports, validate the active sequence, destination, filename, and preset before
   calling `export_sequence`; then verify and report the returned artifact path.
5. Report completed, skipped, and failed work separately. Include any remaining
   verification that requires playback or human visual judgment.

## Editing judgment

- Prefer reversible operations and conservative parameter values.
- Do not invent creative choices the user did not request when those choices affect
  pacing, story, color, mix, typography, or delivery requirements.
- Use frame capture or playback inspection when useful, while clearly separating
  machine verification from subjective editorial approval.
- Treat file paths as local to the Premiere host. Never expose unrelated files or
  secrets from the machine in the response.
