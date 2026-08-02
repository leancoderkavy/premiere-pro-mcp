# Claude Desktop distribution

`premiere-pro-mcp-<version>.mcpb` is the one-file Claude Desktop extension.
It packages the server and its production dependencies, so an editor does not
need to install Node.js, npm, or edit an MCP JSON file. Claude Desktop supplies
the Node runtime when it launches the local stdio server.

This bundle connects Claude to the local Premiere bridge; it does **not**
install the Premiere bridge itself. Install the matching UXP `.ccx` for
Premiere Pro 25.6+ first. CEP remains the compatibility path for older Premiere
hosts and for operations the UXP bridge does not yet support.

## Build and validate

Maintainers build a release candidate with:

```sh
npm run build:claude
```

The command compiles the server, validates the checked-in MCPB v0.4 manifest,
stages only production dependencies with `npm ci --omit=dev`, validates the
staged manifest with the pinned `@anthropic-ai/mcpb` CLI, and writes:

```text
artifacts/premiere-pro-mcp-<version>.mcpb
```

`node scripts/validate-distribution.mjs --claude` is the fast manifest and
version check. The release workflow uploads the `.mcpb` artifact and attaches
it to a published GitHub Release. The former `.dxt` alias is intentionally not
produced: MCPB is the current bundle format and re-labeling an MCPB file as DXT
does not create a supported legacy package.

## Install and release boundaries

Users install a private bundle from Claude Desktop's **Settings → Extensions →
Advanced settings → Install Extension…** and select the `.mcpb` file. A public
directory listing or an organization allowlist is controlled by Anthropic and
is outside this repository's CI; the workflow never submits or publishes a
bundle there.

The CI artifact is structurally validated but unsigned. A release owner must
provide and protect an appropriate signing certificate and private key before
adding MCPB signing to the release process. Do not use a throwaway self-signed
certificate as a substitute for a trusted release identity.

See Anthropic's [local MCP server installation guidance](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
and the [MCPB format](https://github.com/modelcontextprotocol/mcpb) for the
host-controlled installation and directory rules.
