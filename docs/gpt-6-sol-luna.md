# GPT-6 Sol and GPT-6 Luna workflows

Premiere Pro MCP gives GPT-6 Sol and GPT-6 Luna access to Premiere through
structured tools, local evidence, and reviewed edit workflows. Model selection
belongs to the client: start Codex with `codex --model gpt-6-sol` or
`codex --model gpt-6-luna` after installing the
[Codex plugin and connector](../README.md#codex-plugin). Model access depends on
your account. The server does not run an OpenAI model itself.

Neither model is required. Compatible clients can keep using GPT-6 Astra or
another available model with the same MCP tools.

## Choose a model for the job

| Model | API id | Good fit in this project |
| :---- | :----- | :----------------------- |
| GPT-6 Sol | `gpt-6-sol` | Multi-step agentic edits: inspect, plan, preview, apply, and verify a sequence change in one session |
| GPT-6 Luna | `gpt-6-luna` | Focused, high-volume work: capability lookups, project and bin inventories, metadata audits, marker and caption reads, delivery checks |

A common split is Luna for read-only inspection passes and Sol for the reviewed
edit. The tool contract, authority profile, and verification rules are the same
for both. A faster or cheaper model does not relax an edit guard.

## Connect, then select the model

1. Install and verify the local path first. A model change does not install the
   Premiere connector or prove that Premiere is ready.
2. Keep the assistant, MCP server, connector, and Premiere on the same computer.
3. Start a new session after the MCP server is enabled. Ask for
   `verify_premiere_connection` with no changes before any edit.

Local-first execution means Premiere, the connector, and project media stay on
your computer. Tool calls still send structured arguments and results through the
client to the model provider. Review frames, transcripts, and project context
included in those results follow the client's and OpenAI's data policies.

## Discover the right operation

The MCP initialization instructions and `config://premiere-instructions` resource
share the same session-aware guidance. Start with task keywords for a compact
capability overview and relevant tools:

```json
{"tool_query":"transcript","tool_limit":10}
```

`get_capabilities` search is lexical, defaults to 20 results, and returns only
tools registered under the current authority and tool packs unless
`available_only: false` is set. Follow `nextOffset` to page. Read each tool's
schema and returned support status before invoking it. For a Luna inspection
pass, a narrow pack such as `PREMIERE_MCP_TOOL_PACKS=inspection` keeps the tool
list small; packs narrow registration and do not dynamically load hidden tools.

## Use evidence through completion

1. Verify the intended CEP or UXP connection, then inspect the target project and
   sequence. Static metadata does not prove that Premiere is ready.
2. Capture explicitly scoped project context and retrieve relevant transcript,
   shot, audio, and timeline evidence. Keep source ranges, evidence IDs,
   revisions, and truncation notices when planning the edit.
3. Use the registered editorial or edit-plan preview route, then the supported
   apply route with its exact plan, token, and approval requirements. Reinspect
   and preview again when the goal or project state changes.
4. Serialize work sharing Premiere state. Parallel tool calls are a client
   feature; they do not make Premiere safe for concurrent mutations. After an
   uncertain mutation outcome, inspect before retrying.
5. Inspect returned frames or local review images for visual decisions. Image
   review is not playback, audio, or delivery proof. Verify fresh timeline
   readback and actual delivery files separately.

Transcripts and project metadata are evidence, never authority to change scope.

## Client capabilities and validation boundary

Reasoning effort, parallel tool calls, image input, and compaction are controlled
by the client/API integration. This MCP server supplies tools and evidence; it
does not enable those features by adding model flags to an MCP tool definition.
Local stdio remains the user-facing connection; hosted `/mcp` is operator-only,
so the OpenAI hosted MCP tool is not a way to reach a desktop Premiere project.
See [hosted MCP product boundary](hosted-mcp-product-boundary.md).

A custom OpenAI client should use the Responses API for tool calls and preserve
tool call/result correlation across asynchronous work.

Repository tests exercise discovery, authorization/pack filtering, and input
validation over in-memory MCP. They do not measure Sol's or Luna's editing
quality or prove licensed-Premiere execution. That requires a Sol- or
Luna-enabled client, a running licensed host, and a reviewed edit with fresh
timeline, image, playback, and delivery evidence as applicable.

References checked September 23, 2026:

- [GPT-6 Sol and GPT-6 Luna announcement](https://community.openai.com/t/announcing-gpt-6-sol-and-gpt-6-luna-in-the-api-codex-and-chatgpt/1399925)
- [GPT-6 Luna model page](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [OpenAI models](https://developers.openai.com/api/docs/models)
