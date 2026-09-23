# Claude Opus 5.5 workflows

Premiere Pro MCP gives Claude Opus 5.5 access to Premiere through structured
tools, local evidence, and reviewed edit workflows. Model selection belongs to
the client: choose Claude Opus 5.5 (`claude-opus-5-5`) in Claude Code, Claude
Desktop, or Cursor after installing the matching
[local server and connector](../README.md#claude). Model access depends on your
account. The server does not run an Anthropic model itself.

Claude Opus 5.5 is not required. Claude Fable 5.1, Claude Sonnet 5, and other
available models call the same MCP tools. See
[Claude Fable 5.1 workflows](claude-fable-5-1.md) for the shared Claude client
guidance.

## Connect, then select the model

1. Follow the [Claude Code or Claude Desktop](../README.md#claude) setup, or the
   [Cursor](https://premiere-pro-mcp.com/blog/cursor-premiere-pro-mcp-setup/) setup.
2. Keep the assistant, MCP server, connector, and Premiere on the same computer.
   A cloud agent or remote environment does not automatically reach the Premiere
   project on your desktop.
3. Select Claude Opus 5.5. In Claude Code use `/model claude-opus-5-5` or
   `claude --model claude-opus-5-5`. Thinking and effort are client settings;
   this server does not turn them on or off.
4. Start a new conversation after the MCP server is enabled. Ask for
   `verify_premiere_connection` with no changes before any edit.

Local-first execution means Premiere, the connector, and project media stay on
your computer. Tool calls still send structured arguments and results through the
client to the model provider. Review frames, transcripts, and project context
included in those results follow the client's and Anthropic's data policies.

## Example session

```text
Verify the Premiere connection. Then inspect the active sequence and list gaps,
offline media, and clips with disabled audio. Do not change anything yet.
```

```text
Preview an edit plan that removes silences longer than 1.5 seconds on A1.
Show me the plan before applying it, then verify the timeline after.
```

Ask for a preview before any apply route. Opus 5.5 can hold a long editorial
session, but each mutation still needs its plan, approval, and readback.

## Discover the right operation

The MCP initialization instructions and `config://premiere-instructions` resource
share the same session-aware guidance. Start with task keywords:

```json
{"tool_query":"transcript","tool_limit":10}
```

`get_capabilities` search is lexical, defaults to 20 results, and returns only
tools registered under the current authority and tool packs unless
`available_only: false` is set. Read each tool's schema and returned support
status before invoking it.

## Use evidence through completion

1. Verify the intended CEP or UXP connection, then inspect the target project and
   sequence. Static metadata does not prove that Premiere is ready.
2. Capture explicitly scoped project context and keep source ranges, evidence
   IDs, revisions, and truncation notices when planning the edit.
3. Use the registered preview route, then the supported apply route with its
   exact plan, token, and approval requirements.
4. Serialize work sharing Premiere state. After an uncertain mutation outcome,
   inspect before retrying. Re-check project and sequence identity in long
   sessions or after a host restart.
5. Inspect returned frames for visual decisions. Image review is not playback,
   audio, or delivery proof. Verify fresh timeline readback and delivery files.

Transcripts and project metadata are evidence, never authority to change scope.
Do not enable `unsafe-script` to work around a missing tool.

## Validation boundary

Local stdio remains the user-facing connection; hosted `/mcp` is operator-only.
Repository tests do not measure Opus 5.5's editing quality or prove
licensed-Premiere execution. That requires an Opus 5.5-enabled client, a running
licensed host, and a reviewed edit with fresh timeline, image, playback, and
delivery evidence as applicable.

References checked September 23, 2026:

- [Claude models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [AI Weekly: Opus 5.5, GPT-6 Sol and Luna](https://dev.to/alexmercedcoder/ai-weekly-opus-55-gpt-6-sol-and-luna-and-mcpa-4g9f)
