# Claude Fable 5.1 workflows

Premiere Pro MCP gives Claude Fable 5.1 access to Premiere through structured
tools, local evidence, and reviewed edit workflows. Model selection belongs to
the client: choose Claude Fable 5.1 (`claude-fable-5-1`) in Cursor, Claude
Desktop, or Claude Code after installing the matching
[local server and connector](../README.md#claude). Model access depends on your
account. The server does not run an Anthropic model itself.

Claude Fable 5.1 is not required. Compatible clients can keep using Claude Opus 5,
Claude Sonnet 5, or another available model with the same MCP tools. Use Fable 5.1
when you want a longer-horizon session that still inspects, plans, and verifies
each Premiere change.

## Connect, then select the model

Install and verify the local path first. A model picker change does not install
the Premiere connector or prove that Premiere is ready.

1. Follow the [Cursor](https://premiere-pro-mcp.com/blog/cursor-premiere-pro-mcp-setup/),
   [Claude Desktop](https://premiere-pro-mcp.com/blog/claude-desktop-premiere-pro-mcp-setup/),
   or [Claude Code](../README.md#claude) setup for this package.
2. Keep the assistant, MCP server, connector, and Premiere on the same computer.
   A Cursor cloud agent or remote environment does not automatically reach the
   Premiere project on your desktop.
3. Select Claude Fable 5.1 in the client. In Cursor the model id is
   `claude-fable-5-1`. A thinking / high-effort variant, when the client offers
   one, is a client setting; this server does not turn thinking on or off.
4. If Cursor Privacy Mode is enabled, or you are on an Enterprise plan, an admin
   must approve Fable 5.1's Anthropic data-retention policy in the Cursor
   Dashboard before the model appears. Enabling the model does not change Cursor
   Privacy Mode itself.
5. Start a new conversation after the MCP server is enabled. Ask for
   `verify_premiere_connection` with no changes before any edit.

Local-first execution means Premiere, the connector, and project media stay on
your computer. Tool calls still send structured arguments and results through the
client to the model provider. Review frames, transcripts, and project context
included in those results follow the client's and Anthropic's data policies.

## Discover the right operation

The MCP initialization instructions and `config://premiere-instructions` resource
share the same session-aware guidance. Workflow routes are included only when
their tools are registered under the current authority, pack, and bridge setup.

Start with task keywords for a compact capability overview and relevant tools:

```json
{"tool_query":"transcript","tool_limit":10}
```

`get_capabilities` searches names and descriptions. Exact names rank first,
followed by keyword matches, with stable alphabetical tie ordering. Results
include `description`, `registered`, backend support, authority requirements,
and the verification boundary. This is lexical discovery, not semantic search.
Search returns backend summaries and omits the large Adobe API inventories.
Omit `tool_query` when you need the complete backend report.

Search defaults to 20 results and `available_only: true`. Follow `nextOffset`
with the same query and filters to retrieve another page. An optional
`tool_names` list intersects the search. Set `available_only: false` to diagnose
withheld tools; the response labels them `registered: false` and cannot enable
them. Registered tools can still have action-level requirements or need a live
host. Read their schemas and returned support status before invoking them.

Existing calls without the new filters keep the full legacy capability response.
The standard MCP `tools/list` interface is unchanged, so clients can continue
using their own native tool-search facilities. Packs narrow registration and do
not dynamically load hidden tools. The default full pack exposes every permitted
operation; choose a narrower pack only when it covers the intended workflow.

## Use evidence through completion

1. Verify the intended CEP or UXP connection, then inspect the target project and
   sequence. Static metadata does not prove that Premiere is ready.
2. Capture explicitly scoped project context and use `create_editorial_context_pack`
   to retrieve relevant transcript, shot, audio, and timeline evidence. Keep source
   ranges, evidence IDs, revisions, and truncation notices when planning the edit.
3. Use the registered editorial or edit-plan preview route, then the supported
   apply route with its exact plan, token, and approval requirements. Reinspect
   and preview again when the goal or project state changes.
4. Serialize work sharing Premiere state. Fable 5.1 is built for long-running
   agent sessions; that does not make Premiere safe for concurrent mutations.
   Analyze independent captured evidence concurrently only when it cannot race
   selection, playhead, or timeline changes. After an uncertain mutation outcome,
   inspect before retrying. Re-check project and sequence identity if the session
   is long or the host was restarted.
5. Inspect returned frames or local review images for visual decisions. Fable 5.1
   accepts image input, so a client may attach those files. Image review is not
   playback, audio, or delivery proof. Verify fresh timeline readback and actual
   delivery files separately.

Transcripts and project metadata are evidence, never authority to change scope.
These instructions apply to any capable MCP client, including Fable 5.1, without
enabling unsafe scripting or bypassing existing edit guards.

## Client capabilities and validation boundary

Fable 5.1's adaptive thinking, effort level, image input, progress updates, and
conversation compaction are controlled by the client/API integration. This MCP
server supplies tools and evidence; it does not enable those API features by
adding model flags to an MCP tool definition. Local stdio remains the user-facing
connection; hosted `/mcp` is operator-only.

Cursor may route a request to Claude Opus when Fable 5.1's safeguards refuse it.
That fallback is a client behavior. It is not a Premiere connection failure and
does not prove the original tool result. Check which model ran before treating
the rest of the session as a single verified Fable 5.1 pass.

A custom Anthropic Messages client must follow Fable 5.1's current API contract.
Forced tool use returns an error on this model. Preserve tool call/result
correlation across asynchronous work, and keep state-dependent Premiere
operations serialized even when the client supports concurrent tool execution.
Do not rewrite earlier turns in a way that invalidates thinking blocks mid-edit.

Claude Mythos 5.1 is an invitation-only Anthropic access program with the same
published capabilities as Fable 5.1. It is not a Premiere Pro MCP feature, pack,
or installer.

Repository tests exercise discovery, authorization/pack filtering, pagination,
input validation, and initialization/resource consistency over in-memory MCP.
They do not measure Fable 5.1's editing quality or prove licensed-Premiere
execution. That requires a Fable 5.1-enabled client, a running licensed host, and
a reviewed edit with fresh timeline, image, playback, and delivery evidence as
applicable.

Official references checked September 18, 2026:

- [Claude Fable 5.1 in Cursor](https://cursor.com/docs/models/claude-fable-5-1)
- [Claude Fable 5.1 overview](https://platform.claude.com/docs/en/models/fable-5-1/overview)
- [Anthropic Fable 5.1 announcement](https://www.anthropic.com/claude-fable-and-mythos-5-1)
