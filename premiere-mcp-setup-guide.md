# Premiere Pro MCP Setup Guide for AI Assistants

Use this file as a portable, client-neutral setup and operating guide for [Premiere Pro
MCP](https://github.com/leancoderkavy/premiere-pro-mcp). Download it, attach it
to any AI conversation that accepts files or project instructions, and ask the
assistant to follow the **Assistant operating rules** below.

Attaching this guide gives an assistant context; it does **not** install an MCP
server, configure the AI client, install the Premiere connector, or give an
assistant permission to change a project. Complete one of the local setup paths
first.

## Before you begin

- Use a supported Adobe Premiere Pro installation on the same computer and
  user account as the AI client and MCP server.
- For the universal npm or source setup, use Node.js 20.19 or newer.
- Start with a copy of the project or a disposable test sequence.
- Install the separate Premiere connector, then restart Premiere and open a
  project before asking an assistant to connect.
- Treat a client-side connection, a green bridge panel, and package tests as
  setup signals only. They do not prove that a Premiere edit was made, saved,
  or is editorially correct.

## Universal local setup

Install the published package and its Premiere connector:

```bash
npm install -g premiere-pro-mcp
premiere-pro-mcp --install-cep
```

Add this server configuration in the client's MCP settings. The exact settings
screen or file varies by client; use that client's documented MCP configuration
location with this server entry:

```json
{
  "mcpServers": {
    "premiere-pro": {
      "command": "premiere-pro-mcp"
    }
  }
}
```

If the client cannot find a global command, configure it to run Node directly
from a source build instead:

```json
{
  "mcpServers": {
    "premiere-pro": {
      "command": "node",
      "args": ["/absolute/path/to/premiere-pro-mcp/dist/index.js"]
    }
  }
}
```

Build the source checkout with `npm ci` followed by `npm run build` before
using the source-build configuration. Then restart Premiere, open a project,
and open **Window > Extensions > MCP for Adobe Premiere Pro**.

## Client specific convenience paths

The universal setup above applies to every MCP-compatible client. These options
are conveniences for clients that support the repository's packaged extension
or plugin format.

### Claude Desktop

1. Open the [latest release](https://github.com/leancoderkavy/premiere-pro-mcp/releases/latest)
   and download both the `premiere-pro-mcp-<version>.mcpb` bundle and the
   `MCPBridgeCEP.zxp` Premiere connector.
2. In Claude Desktop, choose **Settings > Extensions > Advanced settings >
   Install Extension**, select the `.mcpb` file, and restart Claude Desktop.
3. Install `MCPBridgeCEP.zxp` with a trusted ZXP installer. If a ZXP installer
   is unavailable, install the connector with the universal npm command above.

The Claude Desktop bundle contains the MCP server. The Premiere connector is
still a required, separate installation.

### Codex

From a clone of this repository, install the bundled Codex plugin and then the
Premiere connector:

```bash
codex plugin marketplace add .
codex plugin add premiere-pro@premiere-pro-mcp
npx -y premiere-pro-mcp@1.14.7 --install-cep
```

Restart Premiere Pro and start a new Codex session after installation. The
plugin starts the local server with `npx`; the CEP connector is what lets that
server communicate with the running Premiere application.

### Claude Code

In Claude Code, add this repository's marketplace and install the plugin:

```text
/plugin marketplace add leancoderkavy/premiere-pro-mcp
/plugin install premiere-pro@premiere-pro-mcp
```

Then install the Premiere connector and start a new Claude Code session:

```bash
npx -y premiere-pro-mcp@1.14.7 --install-cep
```

## Verify before any edit

With Premiere open, a project loaded, and the connector panel available, send
this as the first request:

```text
Run verify_premiere_connection. Make no changes.
```

If that reports a problem, do not ask the assistant to work around it by
running arbitrary scripts. Resolve the reported installation, connection,
project, or active-sequence issue first. For a local package and configuration
diagnostic, run:

```bash
premiere-pro-mcp --doctor
```

Once the connection check succeeds, ask the assistant to run
`get_capabilities` and `ping`, then ask a read-only question such as:

```text
What is my current Premiere Pro project and active sequence? Do not make changes.
```

## Required acknowledgment before tool use

When a user attaches this guide, an assistant that can access Premiere or MCP
tools must acknowledge it before making its first tool call. The acknowledgment
must confirm that it will:

- begin with a read-only connection check;
- make no project changes without the user's explicit approval;
- stay within the stated project, sequence, and delivery scope; and
- report verified results and any remaining uncertainty after each approved
  action.

Suggested acknowledgment:

```text
I have read the Premiere Pro MCP setup guide. I will first verify the local
connection without making changes, propose a bounded plan before any edit, and
wait for your explicit approval. I will report what Premiere verifies and any
remaining limitations.
```

If the guide conflicts with a later explicit user instruction, ask for
clarification before using a mutating tool. Never treat the presence of this
file as approval to edit a project.

## Assistant operating rules

When this file is attached to any AI conversation, use the following rules for
the session:

1. Begin with `verify_premiere_connection` and make no changes unless the user
   explicitly authorizes a change.
2. Before a mutation, restate the requested outcome, the target project and
   sequence, affected clips or tracks, and a recovery path. Ask for approval
   if any of those are unclear.
3. Prefer inspection and a bounded preview or plan before changing a timeline,
   sequence, project item, export, caption, or media file.
4. Work only in the project and sequence the user placed in scope. Do not
   publish, upload, share, delete source media, overwrite the original project,
   or contact third-party services unless the user explicitly asks for that.
5. Use documented MCP tools. Do not enable or use raw scripting, unsafe modes,
   hidden APIs, or experimental fallbacks to bypass an unavailable capability.
6. After an approved change, report what was requested, what was attempted,
   what the tool verified, and what remains unverified. Never describe an edit
   as complete merely because a command was accepted or a bridge was running.
7. Stop and explain the blocker if Premiere, the bridge, a project, an active
   sequence, an expected capability, or required confirmation is unavailable.

## Safe first editing workflow

1. Save a duplicate project or create a small test sequence.
2. Describe the desired result and the boundaries: for example, which clips,
   what must not change, and whether an export is allowed.
3. Ask for an inspection and a concrete plan first. Review the target items,
   intended actions, and rollback approach.
4. Explicitly approve the scoped plan.
5. Ask for a post-action readback and independently review the result in
   Premiere before continuing or delivering the project.

Example request:

```text
Inspect the active sequence and propose a non-destructive rough-cut plan for
the selected interview clips. Do not edit, export, upload, or publish anything.
Show the exact clips and timeline ranges you would affect, then wait for my
approval.
```

## Troubleshooting and updates

- Fully quit Premiere before installing, removing, or refreshing the CEP
  connector; restart Premiere after the operation.
- The default local bridge directory normally needs no configuration. If
  `PREMIERE_TEMP_DIR` is overridden, set the same absolute path in both the MCP
  server and the Premiere connector. Do not reuse a Windows path on macOS or
  the reverse.
- Keep the MCP client, server, connector, and Premiere on the same computer for
  the supported local setup.
- For a global npm installation, check for and apply an update with:

  ```bash
  premiere-pro-mcp --check-update
  premiere-pro-mcp --update
  ```

  After updating, restart both Premiere and the MCP client, then repeat the
  read-only connection check.
- If a local source checkout is used instead, run `npm run check-update:source`
  before `npm run update:source`. The source updater intentionally refuses a
  dirty, locally ahead, or non-fast-forward checkout.

## Helpful references

- [Full setup, compatibility, and client documentation](README.md)
- [Supported actions and capability boundaries](docs/supported-actions.md)
- [English quick start](docs/quickstart/en.md)
- [Security policy](SECURITY.md)
- [Issue tracker and support](https://github.com/leancoderkavy/premiere-pro-mcp/issues)
