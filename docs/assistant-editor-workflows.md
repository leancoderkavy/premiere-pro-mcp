# Reviewed assistant-editor workflows

This surface adds clean-room workflow parity for common talking-head, podcast,
recipe, and media-intake tasks. It does not bundle an AI model or provider and
does not copy third-party plugin code, presets, assets, or user interfaces.

## Dialogue analysis and derivatives

`analyze_dialogue_edit_candidates` analyzes caller-supplied, revision-bound
transcript segments locally. It flags configured filler phrases, consecutive
repeated phrases, and supplied long-silence ranges. Every result is a proposal;
the tool changes nothing and retains no transcript text.

`preview_derived_dialogue_sequence_uxp` re-exports each source transcript and
rejects stale revisions before returning an exact confirmation token. The
matching apply tool revalidates those revisions and creates new subclips and a
new ordinary sequence. Talking-head mode keeps linked source audio and video.
Podcast mode uses reviewed video ranges plus duration-matched ranges from one
reviewed master-audio source. Native multicam items and automatic angle choice
remain unsupported.

The UXP receipt proves only the identities Premiere returned or exposed during
structural readback. It explicitly does not prove rendered pixels, playback,
persistence after reopen, or Undo behavior. Original sources are not edited or
deleted.

## Recipes and watched media

Built-in and workspace-local JSON recipes are declarative allowlists. Previewing
a recipe expands named steps into existing guarded MCP routes; it cannot execute
arbitrary tool names or scripts. Custom recipe files must remain inside an
explicit approved workspace and pass closed-schema and size limits.

The media watcher is session-scoped, watches one contained folder, and records
bounded change signals. A fresh scan produces a path-redacted import proposal.
No file is imported automatically; native paths are disclosed only when the
caller explicitly requests them for deliberate import. HTTP transports share
watcher state across their request-scoped MCP server instances.

The intended sequence for every mutation is inspect, propose, preview, approve,
apply, and verify. A compatible authenticated Premiere 26.3 UXP host is required
for the derivative apply route; unit and mock-host tests are not licensed-host
proof.
