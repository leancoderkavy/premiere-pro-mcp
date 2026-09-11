# Configure an exact local server installation

The `--print-client-config` helper is included in v1.15.1 and later.

The `premiere-pro-mcp` and `adobe-premiere-pro-mcp` npm packages belong to separate
repositories, but both declare a `premiere-pro-mcp` command. A command name alone
does not identify its package. This helper prints a client entry that invokes the
current Node executable and this copy's server file by absolute path.

From this checkout, after `npm ci` and `npm run build`:

```sh
node dist/index.js --print-client-config claude
node dist/index.js --print-client-config cursor
node dist/index.js --print-client-config vscode
node dist/index.js --print-client-config codex
```

Choose one command for your client. Each prints only its JSON or TOML entry;
it does not install anything, write configuration, inspect your existing settings,
contact Premiere, start an MCP session, or copy environment variables.

| Target | Where to merge the entry |
| --- | --- |
| `claude` | The `mcpServers` object in Claude Desktop's developer configuration; the same shape can be used for Claude Code's local MCP JSON configuration |
| `cursor` | The `mcpServers` object in Cursor's local MCP configuration |
| `vscode` | The `servers` object in the local user MCP configuration opened with **MCP: Open User Configuration** |
| `codex` | A single `[mcp_servers.premiere-pro-leancoderkavy]` table in your local Codex configuration |

Merge the entry named `premiere-pro-leancoderkavy` into existing configuration.
Preserve other entries and settings; do not replace the whole file or create a
duplicate TOML table. Disable the previous entry for this Premiere connection
before starting the replacement, so only one server and matching connector are
active. Connector installation is still separate.

The output contains local executable paths and may include your user name. Keep
it local rather than posting it as a support bundle. Use a stable installation
directory: moving/removing that directory or changing the Node installation
requires regenerating the entry. In-place package updates continue to use that
path; this is a path selection, not a version lock or package integrity check.
Generate it from the intended installation on the same computer as Premiere.

After reviewing and merging the entry, restart the client, open a disposable
Premiere project, start this project's connector, and ask:

> Safely check my Premiere connection with verify_premiere_connection. Make no changes.

Configuration output establishes only the command and arguments. Actual client
discovery, connection, editing, and rendering require separate validation.

Sources checked September 9, 2026:

- [Other package's bin declaration at the inspected commit](https://github.com/hetpatel-11/Adobe_Premiere_Pro_MCP/blob/ee31c3def7c3ca1c68662ea7737a9f8e5a2b634f/package.json)
- [npm executable mapping](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#bin)
- [VS Code MCP configuration](https://code.visualstudio.com/docs/agent-customization/mcp-servers)
- [Cursor MCP configuration](https://cursor.com/docs/mcp)
- [Codex MCP configuration](https://developers.openai.com/codex/mcp)
